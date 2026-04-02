/**
 * IR → Dafny translator.
 *
 * Two modes:
 *   - "mock":  deterministic template-based rendering (no LLM, always available).
 *   - "claude": sends the IR + prompt to Claude Sonnet 4.5 and returns the
 *               generated Dafny source.
 */

import { readFile } from "node:fs/promises";
import type { StateMachineIR } from "../contracts/state-machine-schema.js";

export type TranslatorProvider = "mock" | "claude";

export type TranslationResult = {
  provider: TranslatorProvider;
  model: string;
  dafnySource: string;
  requestText: string;
  responseText: string;
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function translateIR(args: {
  ir: StateMachineIR;
  promptPath: string;
  templatePath: string;
  provider: TranslatorProvider;
  apiKey?: string;
}): Promise<TranslationResult> {
  const prompt = await readFile(args.promptPath, "utf8");
  const template = await readFile(args.templatePath, "utf8");

  const requestText = [
    prompt,
    "",
    "State Machine IR:",
    JSON.stringify(args.ir, null, 2),
    "",
    "Reference Dafny template:",
    template,
  ].join("\n");

  if (args.provider === "claude") {
    return translateWithClaude(requestText, args.apiKey!);
  }

  return {
    provider: "mock",
    model: "deterministic-template",
    dafnySource: renderDafnyFromIR(args.ir, template),
    requestText,
    responseText: renderDafnyFromIR(args.ir, template),
  };
}

// ---------------------------------------------------------------------------
// Deterministic (mock) renderer
// ---------------------------------------------------------------------------

function sanitizeIdentifier(value: string): string {
  return value.replace(/[^A-Za-z0-9_]/g, "");
}

function renderDafnyFromIR(ir: StateMachineIR, template: string): string {
  const modelFields = ir.stateFields
    .map((f) => `${f.name}: ${dafnyType(f.type)}`)
    .join(", ");

  const actionVariants = ir.actions.map((a) => {
    if (a.params.length === 0) return a.name;
    const params = a.params
      .map((p) => `${p.name}: ${dafnyType(p.type)}`)
      .join(", ");
    return `${a.name}(${params})`;
  });

  const initArgs = ir.initialValues
    .map((iv) => String(iv.value))
    .join(", ");

  const invariantBody = ir.invariants
    .map((inv) => `(${inv.expression})`)
    .join(" && ");

  const applyCases = ir.actions
    .map((action) => {
      const fieldAssignments = ir.stateFields.map((field) => {
        const effect = action.effects.find((e) => e.field === field.name);
        return effect ? effect.expression : `m.${field.name}`;
      });
      return `    case ${action.name}${action.params.length > 0 ? "(..)" : ""} => Model(${fieldAssignments.join(", ")})`;
    })
    .join("\n");

  const normalizeBody =
    ir.normalization.length > 0
      ? renderNormalization(ir)
      : "m";

  const proofCases = ir.actions
    .map((action) => {
      return `    case ${action.name}${action.params.length > 0 ? "(..)" : ""} =>\n      assert Inv(Normalize(Apply(m, a)));`;
    })
    .join("\n");

  // Build from template if it uses placeholders, otherwise build raw.
  if (template.includes("__MODULE_NAME__")) {
    return template
      .replace("__MODULE_NAME__", sanitizeIdentifier(ir.name))
      .replace(
        "datatype Model = Model(value: int)",
        `datatype Model = Model(${modelFields})`,
      )
      .replace("__ACTION_VARIANTS__", actionVariants.join(" | "))
      .replace("__INVARIANT_BODY__", invariantBody || "true")
      .replace("__INITIAL_VALUE__", initArgs)
      .replace("__APPLY_CASES__", applyCases)
      .replace(
        /function Normalize\(m: Model\): Model \{[^}]+\}/s,
        `function Normalize(m: Model): Model {\n    ${normalizeBody}\n  }`,
      )
      .replace("__PROOF_CASES__", proofCases);
  }

  // Fallback: emit raw Dafny module.
  return [
    `module ${sanitizeIdentifier(ir.name)} {`,
    `  datatype Model = Model(${modelFields})`,
    `  datatype Action = ${actionVariants.join(" | ")}`,
    "",
    `  ghost predicate Inv(m: Model) {`,
    `    ${invariantBody || "true"}`,
    `  }`,
    "",
    `  function Init(): Model {`,
    `    Model(${initArgs})`,
    `  }`,
    "",
    `  function Apply(m: Model, a: Action): Model {`,
    `    match a`,
    applyCases,
    `  }`,
    "",
    `  function Normalize(m: Model): Model {`,
    `    ${normalizeBody}`,
    `  }`,
    "",
    `  lemma InitSatisfiesInv()`,
    `    ensures Inv(Init())`,
    `  {`,
    `    assert Inv(Init());`,
    `  }`,
    "",
    `  lemma StepPreservesInv(m: Model, a: Action)`,
    `    requires Inv(m)`,
    `    ensures Inv(Normalize(Apply(m, a)))`,
    `  {`,
    `    match a`,
    proofCases,
    `  }`,
    `}`,
    "",
  ].join("\n");
}

function renderNormalization(ir: StateMachineIR): string {
  // Chain normalization rules as nested if-then-else, rebuilding the Model.
  // For simplicity, apply rules sequentially (last rule wins for a field).
  let result = "m";
  for (const rule of ir.normalization) {
    const fieldIndex = ir.stateFields.findIndex((f) => f.name === rule.field);
    if (fieldIndex === -1) continue;

    const fields = ir.stateFields.map((f) => {
      if (f.name === rule.field) {
        return rule.value;
      }
      return `m.${f.name}`;
    });

    result = `if ${rule.condition} then Model(${fields.join(", ")}) else ${result}`;
  }
  return result;
}

function dafnyType(t: string): string {
  switch (t) {
    case "int":
      return "int";
    case "bool":
      return "bool";
    case "string":
      return "string";
    default:
      return "int";
  }
}

// ---------------------------------------------------------------------------
// LLM (Claude Sonnet 4.5) translator
// ---------------------------------------------------------------------------

async function translateWithClaude(
  requestText: string,
  apiKey: string,
): Promise<TranslationResult> {
  const model = "claude-sonnet-4-5";

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
      messages: [{ role: "user", content: requestText }],
    }),
  });

  if (!response.ok) {
    throw new Error(
      `Claude translation request failed with ${response.status}: ${await response.text()}`,
    );
  }

  const payload = (await response.json()) as {
    content: { type: string; text: string }[];
  };

  const outputText = payload.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();

  if (!outputText) {
    throw new Error("Claude response did not contain any text blocks.");
  }

  return {
    provider: "claude",
    model,
    dafnySource: outputText,
    requestText,
    responseText: JSON.stringify(payload, null, 2),
  };
}
