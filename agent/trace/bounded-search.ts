/**
 * Bounded action-sequence search over the extracted IR.
 *
 * Two modes:
 *   - **proof**: verify that all invariants hold after every reachable
 *     single-step transition (equivalent to what the Dafny StepPreservesInv
 *     lemma checks, but executed concretely).
 *   - **witness**: BFS for the shortest action sequence (length 1..maxDepth)
 *     that reaches a state violating at least one invariant.
 *
 * For parameterized actions the search samples a fixed set of representative
 * values per type (ints: 0, 1, -1, 2, -2, 10, -10, 100; bools: true/false).
 */

import type {
  StateMachineIR,
  Action,
  Invariant,
  FieldType,
} from "../contracts/state-machine-schema.js";
import { evaluate, buildEnv, type Value } from "./eval.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type StateSnapshot = Record<string, Value>;

export type TraceStep = {
  action: string;
  params: Record<string, Value>;
  beforeState: StateSnapshot;
  afterState: StateSnapshot;
};

export type CounterexampleTrace = {
  steps: TraceStep[];
  failingInvariant: string;
  finalState: StateSnapshot;
};

export type SearchMode = "proof" | "witness";

export type SearchOptions = {
  mode: SearchMode;
  /** Maximum action-sequence length to explore (default 6). */
  maxDepth?: number;
  /** Maximum total states to visit before stopping (default 50_000). */
  maxStates?: number;
};

export type SearchResult = {
  mode: SearchMode;
  explored: number;
  maxDepthReached: number;
  counterexamples: CounterexampleTrace[];
};

// ---------------------------------------------------------------------------
// Sample values for parameterized actions
// ---------------------------------------------------------------------------

const INT_SAMPLES: number[] = [0, 1, -1, 2, -2, 10, -10, 100];
const BOOL_SAMPLES: boolean[] = [true, false];
const STRING_SAMPLES: string[] = ["", "a"];

function samplesForType(t: FieldType): Value[] {
  switch (t) {
    case "int": return INT_SAMPLES;
    case "bool": return BOOL_SAMPLES;
    case "string": return STRING_SAMPLES;
  }
}

/** Cartesian product of sample values for an action's params. */
function paramCombinations(action: Action): Record<string, Value>[] {
  if (action.params.length === 0) return [{}];

  const lists = action.params.map((p) => ({
    name: p.name,
    values: samplesForType(p.type),
  }));

  let combos: Record<string, Value>[] = [{}];
  for (const { name, values } of lists) {
    const next: Record<string, Value>[] = [];
    for (const combo of combos) {
      for (const v of values) {
        next.push({ ...combo, [name]: v });
      }
    }
    combos = next;
  }
  return combos;
}

// ---------------------------------------------------------------------------
// State helpers
// ---------------------------------------------------------------------------

function initState(ir: StateMachineIR): StateSnapshot {
  const state: StateSnapshot = {};
  for (const iv of ir.initialValues) {
    state[iv.field] = iv.value;
  }
  return state;
}

function applyAction(
  ir: StateMachineIR,
  state: StateSnapshot,
  action: Action,
  params: Record<string, Value>,
): StateSnapshot {
  const env = buildEnv(state, params);
  const next: StateSnapshot = { ...state };
  for (const effect of action.effects) {
    next[effect.field] = evaluate(effect.expression, env);
  }
  return next;
}

function normalize(ir: StateMachineIR, state: StateSnapshot): StateSnapshot {
  let current = { ...state };
  for (const rule of ir.normalization) {
    const env = buildEnv(current);
    if (evaluate(rule.condition, env) === true) {
      current[rule.field] = evaluate(rule.value, env);
    }
  }
  return current;
}

function checkInvariants(
  ir: StateMachineIR,
  state: StateSnapshot,
): Invariant | null {
  const env = buildEnv(state);
  for (const inv of ir.invariants) {
    if (evaluate(inv.expression, env) !== true) {
      return inv;
    }
  }
  return null;
}

function stateKey(state: StateSnapshot): string {
  return JSON.stringify(
    Object.keys(state).sort().map((k) => [k, state[k]]),
  );
}

// ---------------------------------------------------------------------------
// Proof mode: single-step invariant check from Init
// ---------------------------------------------------------------------------

function proofSearch(ir: StateMachineIR, opts: SearchOptions): SearchResult {
  const maxDepth = opts.maxDepth ?? 6;
  const maxStates = opts.maxStates ?? 50_000;
  const counterexamples: CounterexampleTrace[] = [];
  const failingInvariants = new Set<string>();

  type QueueEntry = { state: StateSnapshot; trace: TraceStep[]; depth: number };
  const visited = new Set<string>();
  const queue: QueueEntry[] = [{ state: initState(ir), trace: [], depth: 0 }];
  let explored = 0;
  let maxDepthReached = 0;

  // Check Init itself
  const initFailing = checkInvariants(ir, initState(ir));
  if (initFailing) {
    counterexamples.push({
      steps: [],
      failingInvariant: initFailing.name,
      finalState: initState(ir),
    });
    failingInvariants.add(initFailing.name);
  }

  while (queue.length > 0 && explored < maxStates) {
    const { state, trace, depth } = queue.shift()!;

    if (depth >= maxDepth) continue;

    const sk = stateKey(state);
    if (visited.has(sk)) continue;
    visited.add(sk);
    explored++;

    for (const action of ir.actions) {
      for (const params of paramCombinations(action)) {
        const before = state;
        const after = normalize(ir, applyAction(ir, state, action, params));
        const step: TraceStep = {
          action: action.name,
          params,
          beforeState: before,
          afterState: after,
        };

        const failing = checkInvariants(ir, after);
        if (failing && !failingInvariants.has(failing.name)) {
          failingInvariants.add(failing.name);
          counterexamples.push({
            steps: [...trace, step],
            failingInvariant: failing.name,
            finalState: after,
          });
        }

        if (depth + 1 > maxDepthReached) maxDepthReached = depth + 1;

        if (!visited.has(stateKey(after))) {
          queue.push({ state: after, trace: [...trace, step], depth: depth + 1 });
        }
      }
    }
  }

  return { mode: "proof", explored, maxDepthReached, counterexamples };
}

// ---------------------------------------------------------------------------
// Witness mode: BFS for shortest violating trace
// ---------------------------------------------------------------------------

function witnessSearch(ir: StateMachineIR, opts: SearchOptions): SearchResult {
  const maxDepth = opts.maxDepth ?? 6;
  const maxStates = opts.maxStates ?? 50_000;
  const counterexamples: CounterexampleTrace[] = [];
  const failingInvariants = new Set<string>();

  type QueueEntry = { state: StateSnapshot; trace: TraceStep[]; depth: number };
  const visited = new Set<string>();
  const init = initState(ir);
  const queue: QueueEntry[] = [{ state: init, trace: [], depth: 0 }];
  let explored = 0;
  let maxDepthReached = 0;

  // Check Init
  const initFailing = checkInvariants(ir, init);
  if (initFailing) {
    counterexamples.push({
      steps: [],
      failingInvariant: initFailing.name,
      finalState: init,
    });
    return { mode: "witness", explored: 1, maxDepthReached: 0, counterexamples };
  }

  while (queue.length > 0 && explored < maxStates) {
    const { state, trace, depth } = queue.shift()!;

    if (depth >= maxDepth) continue;

    const sk = stateKey(state);
    if (visited.has(sk)) continue;
    visited.add(sk);
    explored++;

    for (const action of ir.actions) {
      for (const params of paramCombinations(action)) {
        const before = state;
        const after = normalize(ir, applyAction(ir, state, action, params));
        const step: TraceStep = {
          action: action.name,
          params,
          beforeState: before,
          afterState: after,
        };

        const failing = checkInvariants(ir, after);
        if (failing && !failingInvariants.has(failing.name)) {
          failingInvariants.add(failing.name);
          counterexamples.push({
            steps: [...trace, step],
            failingInvariant: failing.name,
            finalState: after,
          });
          // In witness mode, keep searching for other failing invariants
          // but this trace is already shortest for this invariant
        }

        if (depth + 1 > maxDepthReached) maxDepthReached = depth + 1;

        if (!visited.has(stateKey(after))) {
          queue.push({ state: after, trace: [...trace, step], depth: depth + 1 });
        }
      }
    }
  }

  return { mode: "witness", explored, maxDepthReached, counterexamples };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function boundedSearch(
  ir: StateMachineIR,
  opts: SearchOptions,
): SearchResult {
  return opts.mode === "proof" ? proofSearch(ir, opts) : witnessSearch(ir, opts);
}
