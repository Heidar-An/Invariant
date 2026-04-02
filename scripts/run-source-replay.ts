import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  resolveInvariantConfig,
  resolveTargetConfig,
} from "../agent/config/load-config.js";
import {
  replayCounterexampleTrace,
  type CounterexampleTrace,
} from "../agent/replay/source-replay.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoConfig = resolveInvariantConfig();
const artifactRoot = process.env.INVARIANT_OUTPUT_DIR ?? repoConfig.replayArtifactsDir;
const tracePath = process.env.INVARIANT_TRACE_FILE;
const outputPath = process.env.INVARIANT_REPLAY_OUTPUT_FILE ?? path.join(artifactRoot, "source-replay.json");
const sourcePathOverride = process.env.INVARIANT_SOURCE_FILE;

async function main(): Promise<void> {
  if (!tracePath) {
    throw new Error("Set INVARIANT_TRACE_FILE to a counterexample trace JSON file before running source replay.");
  }

  const trace = await readJson<CounterexampleTrace>(tracePath);
  const targetConfig = resolveTargetConfig(
    sourcePathOverride ?? trace.sourceFile ?? repoConfig.defaultSourceFile,
    repoConfig,
  );

  if (trace.steps.length > targetConfig.actionDepthBounds.replayMaxDepth) {
    throw new Error(
      `Trace length ${trace.steps.length} exceeds replayMaxDepth ${targetConfig.actionDepthBounds.replayMaxDepth} for ${targetConfig.sourceFileRelative}.`,
    );
  }

  const result = await replayCounterexampleTrace({
    sourceFile: targetConfig.sourceFile,
    trace,
  });

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");

  process.stdout.write(`source_replay_status: ${result.status}\n`);
  process.stdout.write(`source_replay_output: ${path.relative(repoRoot, outputPath)}\n`);

  if (result.error) {
    process.stdout.write(`source_replay_error: ${result.error}\n`);
  }

  if (result.status === "error") {
    process.exitCode = 1;
  }
}

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, "utf8")) as T;
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
