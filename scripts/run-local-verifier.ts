import { spawnSync } from "node:child_process";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { validateStateMachineSchema, type StateMachineSchema } from "../agent/contracts/state-machine-schema.js";
import { discoverStateMachineFromSource } from "../agent/discovery/discover-state-machine.js";

type TranslatorProvider = "mock" | "claude";

type TranslationResult = {
  provider: TranslatorProvider;
  model: string;
  dafnySource: string;
  requestText: string;
  responseText: string;
};

type VerifyResult = {
  status: "verified" | "failed" | "skipped";
  exitCode: number | null;
  stdout: string;
  stderr: string;
  reason?: string;
};

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = process.env.INVARIANT_SOURCE_FILE ?? path.join(repoRoot, "agent/examples/non_negative_counter.reducer.ts");
const promptPath = path.join(repoRoot, "agent/prompts/translator.prompt.txt");
const templatePath = path.join(repoRoot, "agent/dafny/state_machine.template.dfy");
const artifactRoot = process.env.INVARIANT_OUTPUT_DIR ?? path.join(repoRoot, "artifacts/phase1");

async function main(): Promise<void> {
  const provider = resolveProvider();
  const prompt = await readUtf8(promptPath);
  const template = await readUtf8(templatePath);
  const machine = await discoverStateMachineFromSource(sourcePath);
  validateStateMachineSchema(machine);

  await mkdir(artifactRoot, { recursive: true });
  await cp(sourcePath, path.join(artifactRoot, path.basename(sourcePath)));
  await writeFile(path.join(artifactRoot, "discovered-machine.json"), `${JSON.stringify(machine, null, 2)}\n`, "utf8");

  const translation = await translateMachine({
    machine,
    prompt,
    template,
    provider,
  });

  const dafnyPath = path.join(artifactRoot, `${machine.name}.dfy`);
  await writeFile(dafnyPath, translation.dafnySource, "utf8");
  await writeFile(path.join(artifactRoot, "translation-request.txt"), translation.requestText, "utf8");
  await writeFile(path.join(artifactRoot, "translation-response.txt"), translation.responseText, "utf8");

  const verifyResult = runDafnyVerify(dafnyPath);
  await writeFile(path.join(artifactRoot, "dafny.stdout.txt"), verifyResult.stdout, "utf8");
  await writeFile(path.join(artifactRoot, "dafny.stderr.txt"), verifyResult.stderr, "utf8");

  const report = {
    machine: machine.name,
    discoveryPattern: machine.discoveryPattern,
    sourceFile: machine.sourceFile,
    provider: translation.provider,
    model: translation.model,
    generatedFile: path.relative(repoRoot, dafnyPath),
    verification: verifyResult,
  };

  await writeFile(path.join(artifactRoot, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(path.join(artifactRoot, "summary.txt"), renderSummary(report), "utf8");

  process.stdout.write(renderSummary(report));

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

async function translateMachine(args: {
  machine: StateMachineSchema;
  prompt: string;
  template: string;
  provider: TranslatorProvider;
}): Promise<TranslationResult> {
  const requestText = [
    args.prompt,
    "",
    "State Machine IR JSON:",
    JSON.stringify(args.machine, null, 2),
    "",
    "Reference template:",
    args.template,
  ].join("\n");

  if (args.provider === "claude") {
    return translateWithClaude(requestText);
  }

  const dafnySource = renderMockDafny(args.machine, args.template);
  return {
    provider: "mock",
    model: "deterministic-template",
    dafnySource,
    requestText,
    responseText: dafnySource,
  };
}

async function translateWithClaude(requestText: string): Promise<TranslationResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is required when INVARIANT_TRANSLATOR_PROVIDER=claude.");
  }

  const model = process.env.INVARIANT_CLAUDE_MODEL ?? "claude-sonnet-4-5";
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 4000,
      messages: [
        {
          role: "user",
          content: requestText,
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`Claude translation request failed with ${response.status}: ${await response.text()}`);
  }

  const payload = (await response.json()) as Record<string, unknown>;
  const outputText = extractOutputText(payload);

  return {
    provider: "claude",
    model,
    dafnySource: outputText,
    requestText,
    responseText: JSON.stringify(payload, null, 2),
  };
}

function extractOutputText(payload: Record<string, unknown>): string {
  const content = payload.content;
  if (!Array.isArray(content)) {
    throw new Error("Claude response did not include content blocks.");
  }

  const parts: string[] = [];
  for (const block of content) {
    if (typeof block !== "object" || block === null) {
      continue;
    }

    const maybeText = (block as { type?: unknown; text?: unknown }).text;
    const maybeType = (block as { type?: unknown }).type;
    if (maybeType === "text" && typeof maybeText === "string") {
      parts.push(maybeText);
    }
  }

  const joined = parts.join("\n").trim();
  if (!joined) {
    throw new Error("Claude response did not contain any text blocks.");
  }

  return joined;
}

function renderMockDafny(machine: StateMachineSchema, template: string): string {
  const actionVariants = machine.actions.map((action) => action.name).join(" | ");
  const applyCases = machine.actions
    .map((action) => {
      const signedDelta = action.delta >= 0 ? `+ ${action.delta}` : `- ${Math.abs(action.delta)}`;
      return `    case ${action.name} => Model(m.value ${signedDelta})`;
    })
    .join("\n");
  const proofCases = machine.actions
    .map((action) => {
      const normalizedResult = action.delta >= 0 ? `m.value + ${action.delta}` : `if m.value - ${Math.abs(action.delta)} < 0 then 0 else m.value - ${Math.abs(action.delta)}`;
      return [
        `    case ${action.name} =>`,
        `      assert Normalize(Apply(m, ${action.name})) == Model(${normalizedResult});`,
        `      assert Inv(Normalize(Apply(m, ${action.name})));`,
      ].join("\n");
    })
    .join("\n");

  return template
    .replace("__MODULE_NAME__", sanitizeIdentifier(machine.name))
    .replace("__ACTION_VARIANTS__", actionVariants)
    .replace("__INVARIANT_BODY__", machine.invariants[0]?.expression ?? "true")
    .replace("__INITIAL_VALUE__", String(machine.initialState.value))
    .replace("__APPLY_CASES__", applyCases)
    .replace("__PROOF_CASES__", proofCases);
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

function renderSummary(report: {
  machine: string;
  discoveryPattern: string;
  sourceFile: string;
  provider: string;
  model: string;
  generatedFile: string;
  verification: VerifyResult;
}): string {
  const lines = [
    `machine: ${report.machine}`,
    `source_file: ${report.sourceFile}`,
    `discovery_pattern: ${report.discoveryPattern}`,
    `provider: ${report.provider}`,
    `model: ${report.model}`,
    `generated_file: ${report.generatedFile}`,
    `verification_status: ${report.verification.status}`,
  ];

  if (report.verification.exitCode !== null) {
    lines.push(`dafny_exit_code: ${report.verification.exitCode}`);
  }

  if (report.verification.reason) {
    lines.push(`reason: ${report.verification.reason}`);
  }

  return `${lines.join("\n")}\n`;
}
function sanitizeIdentifier(value: string): string {
  return value.replace(/[^A-Za-z0-9_]/g, "");
}

async function readUtf8(filePath: string): Promise<string> {
  return readFile(filePath, "utf8");
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
