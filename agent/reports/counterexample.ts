/**
 * Convert bounded-search results into `VerificationFinding[]` that the
 * existing report / issue-filing pipeline understands.
 *
 * Output format per the B3 spec:
 *   - minimal action trace (arrow-separated action names)
 *   - exact failing invariant name
 *   - serialized before/after states for each step
 */

import type {
  VerificationFinding,
  VerificationCounterexample,
} from "./proof-summary.js";
import type {
  SearchResult,
  CounterexampleTrace,
  StateSnapshot,
} from "../trace/bounded-search.js";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Convert all counterexamples from a `SearchResult` into findings suitable
 * for `VerificationReport.findings`.
 */
export function counterexamplesToFindings(
  searchResult: SearchResult,
): VerificationFinding[] {
  return searchResult.counterexamples.map((trace) =>
    traceToFinding(trace, searchResult.mode),
  );
}

/**
 * Convert a single `CounterexampleTrace` into a `VerificationFinding`.
 */
export function traceToFinding(
  trace: CounterexampleTrace,
  mode: string,
): VerificationFinding {
  const normalizedTrace = buildNormalizedTrace(trace);
  const counterexample = buildCounterexample(trace);

  return {
    kind: "counterexample",
    title: `${trace.failingInvariant} violated${trace.steps.length > 0 ? ` after ${trace.steps.length} step${trace.steps.length > 1 ? "s" : ""}` : " at init"}`,
    explanation: buildExplanation(trace, mode),
    invariantName: trace.failingInvariant,
    normalizedTrace,
    counterexample,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Arrow-separated action names: "init -> Increment -> Decrement"
 */
function buildNormalizedTrace(trace: CounterexampleTrace): string {
  const parts = ["init"];
  for (const step of trace.steps) {
    const paramStr = Object.keys(step.params).length > 0
      ? `(${Object.values(step.params).join(", ")})`
      : "";
    parts.push(`${step.action}${paramStr}`);
  }
  return parts.join(" -> ");
}

function buildCounterexample(
  trace: CounterexampleTrace,
): VerificationCounterexample {
  return {
    failingInvariant: trace.failingInvariant,
    normalizedTrace: buildNormalizedTrace(trace),
    steps: trace.steps.map((step) => ({
      action: step.action,
      beforeState: serializeState(step.beforeState),
      afterState: serializeState(step.afterState),
    })),
  };
}

function buildExplanation(trace: CounterexampleTrace, mode: string): string {
  const lines: string[] = [];

  if (trace.steps.length === 0) {
    lines.push(
      `The initial state violates invariant "${trace.failingInvariant}".`,
    );
  } else {
    lines.push(
      `Bounded ${mode} search found a ${trace.steps.length}-step trace that violates invariant "${trace.failingInvariant}".`,
    );
  }

  lines.push("");
  lines.push(`Final state: ${serializeState(trace.finalState)}`);

  return lines.join("\n");
}

function serializeState(state: StateSnapshot): string {
  const parts = Object.entries(state).map(
    ([k, v]) => `${k}=${JSON.stringify(v)}`,
  );
  return `{ ${parts.join(", ")} }`;
}
