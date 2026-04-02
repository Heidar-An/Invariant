/**
 * Invariant loader — collects invariants from multiple sources and merges
 * them into the IR.
 *
 * Three sources (in priority order):
 *   1. Annotation — already present in the IR (from discovery or manual JSON).
 *   2. File      — loaded from a repo-local `.invariants.json` file.
 *   3. LLM       — proposed by Claude Sonnet 4.5 based on the state + actions.
 */

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import type {
  Invariant,
  InvariantSource,
  StateMachineIR,
} from "../contracts/state-machine-schema.js";

// ---------------------------------------------------------------------------
// File-based invariants
// ---------------------------------------------------------------------------

type FileInvariantEntry = {
  name: string;
  description: string;
  expression: string;
};

export async function loadFileInvariants(
  filePath: string,
): Promise<Invariant[]> {
  if (!existsSync(filePath)) {
    return [];
  }

  const raw = JSON.parse(await readFile(filePath, "utf8")) as {
    invariants: FileInvariantEntry[];
  };

  return raw.invariants.map((entry) => ({
    name: entry.name,
    description: entry.description,
    expression: entry.expression,
    source: "file" as InvariantSource,
    confidence: 1.0,
  }));
}

// ---------------------------------------------------------------------------
// LLM-proposed invariants
// ---------------------------------------------------------------------------

const INVARIANT_PROPOSAL_PROMPT = `You are given a state machine IR (intermediate representation) with state fields and actions.
Propose invariants — boolean expressions over \`m: Model\` — that should always hold after any sequence of actions starting from the initial state.

Rules:
- Each invariant expression must reference fields as \`m.<fieldName>\`.
- Only propose invariants you are confident about.  Do NOT propose speculative or trivially-true invariants.
- Return a JSON array of objects with keys: name, description, expression.
- Return ONLY the JSON array, no markdown fences or commentary.

State machine IR:
`;

export async function proposeInvariants(
  ir: StateMachineIR,
  apiKey: string,
): Promise<Invariant[]> {
  const requestBody = INVARIANT_PROPOSAL_PROMPT + JSON.stringify(ir, null, 2);

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-5",
      max_tokens: 2000,
      messages: [{ role: "user", content: requestBody }],
    }),
  });

  if (!response.ok) {
    throw new Error(
      `Invariant proposal request failed with ${response.status}: ${await response.text()}`,
    );
  }

  const payload = (await response.json()) as {
    content: { type: string; text: string }[];
  };

  const text = payload.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");

  const entries = JSON.parse(text) as FileInvariantEntry[];

  return entries.map((entry) => ({
    name: entry.name,
    description: entry.description,
    expression: entry.expression,
    source: "llm" as InvariantSource,
    confidence: 0.7,
  }));
}

// ---------------------------------------------------------------------------
// Merge
// ---------------------------------------------------------------------------

/**
 * Merge invariants from all sources into the IR. Deduplicates by expression.
 * Annotation invariants take priority, then file, then LLM.
 */
export function mergeInvariants(
  existing: Invariant[],
  additional: Invariant[],
): Invariant[] {
  const seen = new Set(existing.map((inv) => inv.expression));
  const merged = [...existing];

  for (const inv of additional) {
    if (!seen.has(inv.expression)) {
      seen.add(inv.expression);
      merged.push(inv);
    }
  }

  return merged;
}
