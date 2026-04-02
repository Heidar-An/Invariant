import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  resolveInvariantConfig,
  resolveTargetConfig,
} from "../agent/config/load-config.js";
import {
  replayBoundedSearchResults,
  replayCounterexampleTrace,
  type CounterexampleTrace,
} from "../agent/replay/source-replay.js";
import type { SearchResult } from "../agent/trace/bounded-search.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoConfig = resolveInvariantConfig();
const artifactRoot = process.env.INVARIANT_OUTPUT_DIR ?? repoConfig.replayArtifactsDir;
const tracePath = process.env.INVARIANT_TRACE_FILE;
const searchResultPath = process.env.INVARIANT_SEARCH_RESULT_FILE;
const outputPath = process.env.INVARIANT_REPLAY_OUTPUT_FILE ?? path.join(artifactRoot, "source-replay.json");
const sourcePathOverride = process.env.INVARIANT_SOURCE_FILE;

async function main(): Promise<void> {
  if (!tracePath && !searchResultPath) {
    throw new Error("Set INVARIANT_TRACE_FILE or INVARIANT_SEARCH_RESULT_FILE before running source replay.");
  }

  const replayOutput = tracePath
    ? await replaySingleTrace(tracePath)
    : await replaySearchResults(searchResultPath!);

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(replayOutput, null, 2)}\n`, "utf8");

  const status = Array.isArray(replayOutput)
    ? `${replayOutput.filter((entry) => entry.replay.status === "confirmed-violation").length}/${replayOutput.length} confirmed`
    : replayOutput.status;

  process.stdout.write(`source_replay_status: ${status}\n`);
  process.stdout.write(`source_replay_output: ${path.relative(repoRoot, outputPath)}\n`);

  if (!Array.isArray(replayOutput) && replayOutput.error) {
    process.stdout.write(`source_replay_error: ${replayOutput.error}\n`);
  }

  if (!Array.isArray(replayOutput) && replayOutput.status === "error") {
    process.exitCode = 1;
  }

  if (Array.isArray(replayOutput) && replayOutput.some((entry) => entry.replay.status === "error")) {
    process.exitCode = 1;
  }
}

async function replaySingleTrace(traceFilePath: string) {
  const trace = await readJson<CounterexampleTrace>(traceFilePath);
  const targetConfig = resolveTargetConfig(
    sourcePathOverride ?? trace.sourceFile ?? repoConfig.defaultSourceFile,
    repoConfig,
  );

  if (trace.steps.length > targetConfig.actionDepthBounds.replayMaxDepth) {
    throw new Error(
      `Trace length ${trace.steps.length} exceeds replayMaxDepth ${targetConfig.actionDepthBounds.replayMaxDepth} for ${targetConfig.sourceFileRelative}.`,
    );
  }

  return replayCounterexampleTrace({
    sourceFile: targetConfig.sourceFile,
    trace,
  });
}

async function replaySearchResults(searchResultFilePath: string) {
  const searchResult = await readJson<SearchResult>(searchResultFilePath);
  const targetConfig = resolveTargetConfig(
    sourcePathOverride ?? repoConfig.defaultSourceFile,
    repoConfig,
  );

  return replayBoundedSearchResults({
    sourceFile: targetConfig.sourceFile,
    traces: searchResult.counterexamples,
    replayMaxDepth: targetConfig.actionDepthBounds.replayMaxDepth,
  });
}

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, "utf8")) as T;
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
