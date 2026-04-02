import { spawnSync } from "node:child_process";
import { cp, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

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

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = process.env.INVARIANT_SOURCE_FILE ?? path.join(repoRoot, "agent/examples/non_negative_counter.reducer.ts");
const promptPath = path.join(repoRoot, "agent/prompts/translator.prompt.txt");
const templatePath = path.join(repoRoot, "agent/dafny/state_machine.template.dfy");
const artifactRoot = process.env.INVARIANT_OUTPUT_DIR ?? path.join(repoRoot, "artifacts/phase2");

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

  if (provider === "claude" && apiKey && process.env.INVARIANT_PROPOSE_INVARIANTS === "true") {
    const proposed = await proposeInvariants(ir, apiKey);
    ir.invariants = mergeInvariants(ir.invariants, proposed);
  }

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

  const dafnyPath = path.join(artifactRoot, `${ir.name}.dfy`);
  await writeFile(dafnyPath, translation.dafnySource, "utf8");
  await writeFile(path.join(artifactRoot, "translation-request.txt"), translation.requestText, "utf8");
  await writeFile(path.join(artifactRoot, "translation-response.txt"), translation.responseText, "utf8");

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

  return process.env.ANTHROPIC_API_KEY ? "claude" : "mock";
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
