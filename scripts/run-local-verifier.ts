import { spawnSync } from "node:child_process";
import { cp, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  parseBooleanEnv,
  resolveInvariantConfig,
  resolveTargetConfig,
  resolveTranslatorProviderSetting,
} from "../agent/config/load-config.js";
import {
  validateStateMachineSchema,
  fromDiscoverySchema,
  validateIR,
  type StateMachineIR,
} from "../agent/contracts/state-machine-schema.js";
import { discoverStateMachineFromSource } from "../agent/discovery/discover-state-machine.js";
import {
  loadFileInvariants,
  proposeInvariants,
  mergeInvariants,
} from "../agent/invariants/loader.js";
import {
  type TranslatorProvider,
  translateIR,
} from "../agent/translator/ir-to-dafny.js";
import {
  renderProofSummaryMarkdown,
  renderSummaryText,
  type VerificationReport,
  type VerifyResult,
} from "../agent/reports/proof-summary.js";
import { boundedSearch } from "../agent/trace/bounded-search.js";
import { counterexamplesToFindings } from "../agent/reports/counterexample.js";
import {
  renderWitnessLemma,
  injectWitnessLemmas,
} from "../agent/trace/trace-to-dafny.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoConfig = resolveInvariantConfig();
const targetConfig = resolveTargetConfig(process.env.INVARIANT_SOURCE_FILE, repoConfig);
const sourcePath = targetConfig.sourceFile;
const promptPath = path.join(repoRoot, "agent/prompts/translator.prompt.txt");
const templatePath = path.join(repoRoot, "agent/dafny/state_machine.template.dfy");
const artifactRoot = process.env.INVARIANT_OUTPUT_DIR ?? repoConfig.artifactsDir;

async function main(): Promise<void> {
  // --- Discovery: source code → discovery schema → canonical IR ---
  const discoverySchema = await discoverStateMachineFromSource(sourcePath);
  validateStateMachineSchema(discoverySchema);
  const ir: StateMachineIR = fromDiscoverySchema(discoverySchema);

  const errors = validateIR(ir);
  if (errors.length > 0) {
    throw new Error(`IR validation failed:\n  ${errors.join("\n  ")}`);
  }

  const provider = resolveProvider();
  const apiKey = process.env.ANTHROPIC_API_KEY;

  // --- Invariant enrichment ---
  const invariantsFilePath = sourcePath.replace(/\.reducer\.ts$/, ".invariants.json");
  const fileInvariants = await loadFileInvariants(invariantsFilePath);
  ir.invariants = mergeInvariants(ir.invariants, fileInvariants);

  if (provider === "claude" && apiKey && shouldProposeInvariants()) {
    const proposed = await proposeInvariants(ir, apiKey);
    ir.invariants = mergeInvariants(ir.invariants, proposed);
  }

  ir.invariants = applyInvariantPolicy(ir.invariants, targetConfig);

  await mkdir(artifactRoot, { recursive: true });
  await cp(sourcePath, path.join(artifactRoot, path.basename(sourcePath)));
  await writeFile(path.join(artifactRoot, "discovered-machine.json"), `${JSON.stringify(discoverySchema, null, 2)}\n`, "utf8");
  await writeFile(path.join(artifactRoot, "ir.json"), `${JSON.stringify(ir, null, 2)}\n`, "utf8");

  // --- Translation (IR → Dafny) ---
  const translation = await translateIR({
    ir,
    promptPath,
    templatePath,
    provider,
    apiKey,
  });

  // --- Bounded trace search (counterexample generation) ---
  const searchResult = boundedSearch(ir, {
    mode: "witness",
    maxDepth: targetConfig.actionDepthBounds.witnessMaxDepth,
  });
  const traceFindings = counterexamplesToFindings(searchResult);

  // Inject witness lemmas into the Dafny source for solver confirmation
  const witnessLemmas = searchResult.counterexamples.map((trace, i) =>
    renderWitnessLemma(ir, trace, i),
  );
  const dafnyWithWitnesses = injectWitnessLemmas(
    translation.dafnySource,
    witnessLemmas,
  );

  const dafnyPath = path.join(artifactRoot, `${ir.name}.dfy`);
  await writeFile(dafnyPath, dafnyWithWitnesses, "utf8");
  await writeFile(path.join(artifactRoot, "translation-request.txt"), translation.requestText, "utf8");
  await writeFile(path.join(artifactRoot, "translation-response.txt"), translation.responseText, "utf8");
  await writeFile(path.join(artifactRoot, "search-result.json"), `${JSON.stringify(searchResult, null, 2)}\n`, "utf8");

  // --- Dafny verification ---
  const verifyResult = runDafnyVerify(dafnyPath);
  await writeFile(path.join(artifactRoot, "dafny.stdout.txt"), verifyResult.stdout, "utf8");
  await writeFile(path.join(artifactRoot, "dafny.stderr.txt"), verifyResult.stderr, "utf8");

  const report: VerificationReport = {
    machine: ir.name,
    discoveryPattern: ir.discoveryPattern ?? "unknown",
    sourceFile: ir.sourceFile ?? sourcePath,
    provider: translation.provider,
    model: translation.model,
    generatedFile: path.relative(repoRoot, dafnyPath),
    verification: verifyResult,
    findings: traceFindings.length > 0 ? traceFindings : undefined,
  };

  await writeFile(path.join(artifactRoot, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(path.join(artifactRoot, "summary.txt"), renderSummaryText(report), "utf8");
  await writeFile(path.join(artifactRoot, "proof-summary.md"), renderProofSummaryMarkdown(report), "utf8");

  process.stdout.write(renderSummaryText(report));

  if (verifyResult.status === "failed") {
    process.exitCode = 1;
    return;
  }
}

function resolveProvider(): TranslatorProvider {
  const configured = process.env.INVARIANT_TRANSLATOR_PROVIDER;
  if (configured === "mock" || configured === "claude") {
    return configured;
  }

  return resolveTranslatorProviderSetting(
    repoConfig.translatorProvider,
    Boolean(process.env.ANTHROPIC_API_KEY),
  );
}

function shouldProposeInvariants(): boolean {
  const override = parseBooleanEnv(process.env.INVARIANT_PROPOSE_INVARIANTS);
  return override ?? repoConfig.proposeInvariants;
}

function applyInvariantPolicy(
  invariants: StateMachineIR["invariants"],
  target: ReturnType<typeof resolveTargetConfig>,
): StateMachineIR["invariants"] {
  if (target.invariants.enforce.length === 0) {
    return invariants;
  }

  const allowed = new Set(target.invariants.enforce);
  const filtered = invariants.filter((invariant) => allowed.has(invariant.name));
  const missing = target.invariants.enforce.filter((name) => !filtered.some((invariant) => invariant.name === name));

  if (missing.length > 0) {
    throw new Error(
      `Configured invariants were not found for ${target.sourceFileRelative}: ${missing.join(", ")}.`,
    );
  }

  return filtered;
}

function runDafnyVerify(dafnyPath: string): VerifyResult {
  if (!existsSync(dafnyPath)) {
    return {
      status: "skipped",
      exitCode: null,
      stdout: "",
      stderr: "",
      reason: "Generated Dafny file was not created.",
    };
  }

  const which = spawnSync("sh", ["-lc", "command -v dafny"], {
    cwd: repoRoot,
    encoding: "utf8",
  });

  if (which.status !== 0) {
    return {
      status: "skipped",
      exitCode: null,
      stdout: "",
      stderr: "",
      reason: "Dafny is not installed on this machine.",
    };
  }

  const result = spawnSync("dafny", ["verify", dafnyPath], {
    cwd: repoRoot,
    encoding: "utf8",
  });

  return {
    status: result.status === 0 ? "verified" : "failed",
    exitCode: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
