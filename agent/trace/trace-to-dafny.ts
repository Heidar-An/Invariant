/**
 * Encode counterexample traces as Dafny witness lemmas.
 *
 * Given a `CounterexampleTrace` from the bounded search, this module emits a
 * Dafny lemma that _asserts_ the trace reaches a state violating the named
 * invariant.  When Dafny verifies the lemma successfully, the counterexample
 * is confirmed by the solver.  When it fails, the concrete trace was spurious
 * (e.g. due to expression-evaluation mismatches between JS and Dafny).
 *
 * Usage:
 *   1. Run `boundedSearch()` to get candidate traces.
 *   2. For each trace, call `renderWitnessLemma()` to get a Dafny snippet.
 *   3. Append the snippet to the generated Dafny module and run `dafny verify`.
 */

import type { StateMachineIR } from "../contracts/state-machine-schema.js";
import type { CounterexampleTrace, StateSnapshot } from "./bounded-search.js";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export type WitnessLemma = {
  /** Unique lemma name (safe Dafny identifier). */
  name: string;
  /** The invariant this witness targets. */
  invariantName: string;
  /** Full Dafny source for the lemma, ready to paste inside the module. */
  dafnySource: string;
};

/**
 * Render a Dafny lemma that confirms a counterexample trace.
 *
 * The lemma builds the final state by chaining `Apply` / `Normalize` calls
 * and asserts `!Inv(finalState)`.  If Dafny can verify this lemma, the trace
 * is a genuine invariant violation.
 */
export function renderWitnessLemma(
  ir: StateMachineIR,
  trace: CounterexampleTrace,
  index: number,
): WitnessLemma {
  const safeName = `Witness_${sanitize(trace.failingInvariant)}_${index}`;

  const lines: string[] = [];
  lines.push(`  lemma ${safeName}()`);

  // Build the chained expression: Normalize(Apply(Normalize(Apply(Init(), a1)), a2))
  let stateExpr = "Init()";
  const bindings: string[] = [];

  for (let i = 0; i < trace.steps.length; i++) {
    const step = trace.steps[i]!;
    const actionExpr = renderActionExpr(ir, step.action, step.params);
    stateExpr = `Normalize(Apply(${stateExpr}, ${actionExpr}))`;

    // For readability, bind intermediate states to local vars
    const varName = `s${i}`;
    bindings.push(`    var ${varName} := ${stateExpr};`);
  }

  // The lemma ensures the final state violates the invariant
  if (trace.steps.length > 0) {
    const finalVar = `s${trace.steps.length - 1}`;
    lines.push(`    ensures !Inv(${finalVar})`);
    lines.push(`  {`);
    for (const b of bindings) lines.push(b);
    lines.push(`  }`);
  } else {
    // Init itself violates the invariant
    lines.push(`    ensures !Inv(Init())`);
    lines.push(`  {`);
    lines.push(`  }`);
  }

  return {
    name: safeName,
    invariantName: trace.failingInvariant,
    dafnySource: lines.join("\n"),
  };
}

/**
 * Render a full Dafny module that includes all witness lemmas alongside the
 * original proof obligations.  `baseDafnySource` is the existing generated
 * Dafny; witness lemmas are injected before the closing `}`.
 */
export function injectWitnessLemmas(
  baseDafnySource: string,
  lemmas: WitnessLemma[],
): string {
  if (lemmas.length === 0) return baseDafnySource;

  const witnessBlock = [
    "",
    "  // --- Witness lemmas (counterexample confirmation) ---",
    ...lemmas.map((l) => l.dafnySource),
  ].join("\n");

  // Insert before the final closing brace of the module
  const lastBrace = baseDafnySource.lastIndexOf("}");
  if (lastBrace === -1) {
    return baseDafnySource + "\n" + witnessBlock + "\n}\n";
  }

  return (
    baseDafnySource.slice(0, lastBrace) +
    witnessBlock +
    "\n" +
    baseDafnySource.slice(lastBrace)
  );
}

/**
 * Render a standalone Dafny snippet that asserts a specific state violates
 * the invariant.  Useful for one-off confirmation without the full trace.
 */
export function renderStateAssertion(
  ir: StateMachineIR,
  state: StateSnapshot,
  invariantName: string,
): string {
  const fields = ir.stateFields.map((f) => renderValue(state[f.name]!));
  return `  assert !Inv(Model(${fields.join(", ")})); // violates ${invariantName}`;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sanitize(name: string): string {
  return name.replace(/[^A-Za-z0-9_]/g, "");
}

function renderValue(v: number | boolean | string): string {
  if (typeof v === "string") return `"${v}"`;
  return String(v);
}

function renderActionExpr(
  ir: StateMachineIR,
  actionName: string,
  params: Record<string, number | boolean | string>,
): string {
  const action = ir.actions.find((a) => a.name === actionName);
  if (!action) return actionName;

  if (action.params.length === 0) return actionName;

  const args = action.params.map((p) => renderValue(params[p.name]!));
  return `${actionName}(${args.join(", ")})`;
}
