import { spawnSync } from "node:child_process";
import { cp, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  resolveDiscoveryProviderSetting,
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
import { discoverStateMachineWithLlm } from "../agent/discovery/llm-discovery.js";
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
import { replayBoundedSearchResults } from "../agent/replay/source-replay.js";
import { boundedSearch } from "../agent/trace/bounded-search.js";
import { counterexamplesToFindings } from "../agent/reports/counterexample.js";
import {
  renderWitnessLemma,
  injectWitnessLemmas,
} from "../agent/trace/trace-to-dafny.js";
import {
  scoreFindings,
  renderConfidenceMarkdown,
  type ScoringContext,
} from "../agent/confidence/score.js";
import { renderGraphHTML } from "../agent/visualize/graph.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoConfig = resolveInvariantConfig();
const targetConfig = resolveTargetConfig(process.env.INVARIANT_SOURCE_FILE, repoConfig);
const sourcePath = targetConfig.sourceFile;
const discoveryPromptPath = path.join(repoRoot, "agent/prompts/discovery.prompt.txt");
const promptPath = path.join(repoRoot, "agent/prompts/translator.prompt.txt");
const templatePath = path.join(repoRoot, "agent/dafny/state_machine.template.dfy");
const artifactRoot = process.env.INVARIANT_OUTPUT_DIR ?? repoConfig.artifactsDir;

async function main(): Promise<void> {
  await mkdir(artifactRoot, { recursive: true });
  await cp(sourcePath, path.join(artifactRoot, path.basename(sourcePath)));

  // --- Discovery: source code → discovery schema/IR ---
  const discovery = await discoverMachine(sourcePath);
  await writeDiscoveryArtifacts(discovery);

  if (!discovery.ir) {
    throw new Error(
      `Discovery did not produce a state-machine IR for ${targetConfig.sourceFileRelative}.`,
    );
  }

  let ir = discovery.ir;

  const errors = validateIR(ir);
  if (errors.length > 0) {
    throw new Error(`IR validation failed:\n  ${errors.join("\n  ")}`);
  }

  if (discovery.reviewRequired && !discovery.reviewApproved) {
    throw new Error(
      `LLM discovery review required. Inspect artifacts in ${path.relative(repoRoot, artifactRoot)} and rerun with ${repoConfig.discoveryReview.approvalEnvVar}=true to continue verification.`,
    );
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
  const replayResults = await replayBoundedSearchResults({
    sourceFile: sourcePath,
    traces: searchResult.counterexamples,
    invariants: ir.invariants.map((invariant) => ({
      name: invariant.name,
      description: invariant.description,
      expression: invariant.expression,
    })),
    replayMaxDepth: targetConfig.actionDepthBounds.replayMaxDepth,
  });
  const findingsWithReplay = traceFindings.map((finding, index) => {
    const replay = replayResults.find((entry) => entry.traceIndex === index)?.replay;
    if (!replay || !finding.counterexample) {
      return finding;
    }

    return {
      ...finding,
      counterexample: {
        ...finding.counterexample,
        sourceReplay: replay,
      },
    };
  });
  const replayResultsByInvariant = new Map(
    findingsWithReplay.flatMap((finding) => {
      const replay = finding.counterexample?.sourceReplay;
      if (!finding.invariantName || !replay) {
        return [];
      }

      return [[
        finding.invariantName,
        {
          replayed: replay.status === "confirmed-violation" || replay.status === "no-violation",
          reproduced: replay.status === "confirmed-violation",
          error: replay.error,
        },
      ]];
    }),
  );

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
  await writeFile(path.join(artifactRoot, "source-replay-results.json"), `${JSON.stringify(replayResults, null, 2)}\n`, "utf8");

  // --- Dafny verification ---
  const verifyResult = runDafnyVerify(dafnyPath);
  await writeFile(path.join(artifactRoot, "dafny.stdout.txt"), verifyResult.stdout, "utf8");
  await writeFile(path.join(artifactRoot, "dafny.stderr.txt"), verifyResult.stderr, "utf8");

  // --- Confidence scoring ---
  const scoringCtx: ScoringContext = {
    ir,
    searchResult,
    verifyResult,
    translationProvider: translation.provider,
    replayResults: replayResultsByInvariant,
  };
  const confidenceReport = scoreFindings(scoringCtx);

  const report: VerificationReport = {
    machine: ir.name,
    discoveryPattern: ir.discoveryPattern ?? "unknown",
    sourceFile: ir.sourceFile ?? sourcePath,
    provider: translation.provider,
    model: translation.model,
    generatedFile: path.relative(repoRoot, dafnyPath),
    verification: verifyResult,
    findings: findingsWithReplay.length > 0 ? findingsWithReplay : undefined,
  };

  await writeFile(path.join(artifactRoot, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(path.join(artifactRoot, "confidence.json"), `${JSON.stringify(confidenceReport, null, 2)}\n`, "utf8");
  await writeFile(path.join(artifactRoot, "summary.txt"), renderSummaryText(report), "utf8");
  await writeFile(path.join(artifactRoot, "proof-summary.md"), `${renderProofSummaryMarkdown(report)}\n${renderConfidenceMarkdown(confidenceReport)}`, "utf8");

  // --- Graph visualization ---
  const graphPath = path.join(artifactRoot, "proof-graph.html");
  await writeFile(graphPath, renderGraphHTML(ir, searchResult), "utf8");

  process.stdout.write(renderSummaryText(report));
  process.stdout.write(`graph: ${graphPath}\n`);

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

function resolveDiscoveryProvider(): "ast" | "claude" {
  const configured = process.env.INVARIANT_DISCOVERY_PROVIDER;
  if (configured === "ast" || configured === "claude") {
    return configured;
  }

  return resolveDiscoveryProviderSetting(
    repoConfig.discoveryProvider,
    Boolean(process.env.ANTHROPIC_API_KEY),
  );
}

async function discoverMachine(sourceFile: string): Promise<DiscoveryRun> {
  const discoveryProvider = resolveDiscoveryProvider();
  if (discoveryProvider === "claude") {
    try {
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        throw new Error(
          "LLM discovery was selected but ANTHROPIC_API_KEY is not set.",
        );
      }

      const result = await discoverStateMachineWithLlm({
        filePath: sourceFile,
        promptPath: discoveryPromptPath,
        apiKey,
      });

      if (result.kind === "not-a-state-machine") {
        return discoverMachineWithAstFallback(sourceFile, {
          requestText: result.requestText,
          responseText: result.responseText,
          llmFallbackReason: result.reason,
        });
      }

      return {
        provider: "claude",
        reviewRequired: repoConfig.discoveryReview.mode === "require",
        reviewApproved: isDiscoveryReviewApproved(),
        ir: result.ir,
        requestText: result.requestText,
        responseText: result.responseText,
      };
    } catch (error: unknown) {
      return discoverMachineWithAstFallback(sourceFile, {
        llmFallbackReason: toErrorMessage(error),
      });
    }
  }

  return discoverMachineWithAstFallback(sourceFile);
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

function isDiscoveryReviewApproved(): boolean {
  return process.env[repoConfig.discoveryReview.approvalEnvVar] === "true";
}

async function writeDiscoveryArtifacts(discovery: DiscoveryRun): Promise<void> {
  const summary = {
    provider: discovery.provider,
    reviewRequired: discovery.reviewRequired,
    reviewApproved: discovery.reviewApproved,
    notStateMachineReason: discovery.notStateMachineReason,
    llmFallbackReason: discovery.llmFallbackReason,
  };

  await writeFile(
    path.join(artifactRoot, "discovery-result.json"),
    `${JSON.stringify(summary, null, 2)}\n`,
    "utf8",
  );

  if (discovery.discoverySchema) {
    await writeFile(
      path.join(artifactRoot, "discovered-machine.json"),
      `${JSON.stringify(discovery.discoverySchema, null, 2)}\n`,
      "utf8",
    );
  }

  if (discovery.ir) {
    await writeFile(
      path.join(artifactRoot, "discovered-ir.json"),
      `${JSON.stringify(discovery.ir, null, 2)}\n`,
      "utf8",
    );
  }

  if (discovery.requestText) {
    await writeFile(
      path.join(artifactRoot, "discovery-request.txt"),
      discovery.requestText,
      "utf8",
    );
  }

  if (discovery.responseText) {
    await writeFile(
      path.join(artifactRoot, "discovery-response.txt"),
      discovery.responseText,
      "utf8",
    );
  }

  if (discovery.notStateMachineReason) {
    throw new Error(
      `LLM discovery determined that ${targetConfig.sourceFileRelative} does not contain meaningful state-machine logic: ${discovery.notStateMachineReason}`,
    );
  }
}

async function discoverMachineWithAstFallback(
  sourceFile: string,
  fallbackContext: {
    requestText?: string;
    responseText?: string;
    llmFallbackReason?: string;
  } = {},
): Promise<DiscoveryRun> {
  const discoverySchema = await discoverStateMachineFromSource(sourceFile);
  validateStateMachineSchema(discoverySchema);

  return {
    provider: "ast",
    reviewRequired: false,
    reviewApproved: true,
    discoverySchema,
    ir: fromDiscoverySchema(discoverySchema),
    requestText: fallbackContext.requestText,
    responseText: fallbackContext.responseText,
    llmFallbackReason: fallbackContext.llmFallbackReason,
  };
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

  const dafnyBin = which.stdout.trim();
  const result = spawnSync(dafnyBin, ["verify", dafnyPath], {
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

type DiscoveryRun = {
  provider: "ast" | "claude";
  reviewRequired: boolean;
  reviewApproved: boolean;
  discoverySchema?: Awaited<ReturnType<typeof discoverStateMachineFromSource>>;
  ir?: StateMachineIR;
  requestText?: string;
  responseText?: string;
  notStateMachineReason?: string;
  llmFallbackReason?: string;
};

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
