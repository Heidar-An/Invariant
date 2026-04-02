import path from "node:path";
import process from "node:process";
import { isDeepStrictEqual } from "node:util";
import vm from "node:vm";
import { pathToFileURL } from "node:url";

import type { StateMachineInvariant } from "../contracts/state-machine-schema.js";
import type { CounterexampleTrace as BoundedSearchCounterexampleTrace } from "../trace/bounded-search.js";

export type ReplayableAction =
  | string
  | ({
      type: string;
    } & Record<string, unknown>);

export type CounterexampleTraceStep = {
  action: ReplayableAction;
  expectedBeforeState?: unknown;
  expectedAfterState?: unknown;
};

export type CounterexampleTrace = {
  sourceFile?: string;
  failingInvariant?: string;
  normalizedTrace?: string;
  initialState?: unknown;
  steps: CounterexampleTraceStep[];
};

export type ReplayInvariantEvaluation = {
  name: string;
  expression: string;
  status: "holds" | "violated" | "error";
  error?: string;
};

export type SourceReplayStepResult = {
  index: number;
  action: Record<string, unknown>;
  actionLabel: string;
  beforeState: unknown;
  afterState: unknown;
  matchedExpectedBeforeState?: boolean;
  matchedExpectedAfterState?: boolean;
  invariantEvaluations: ReplayInvariantEvaluation[];
};

export type SourceReplayStatus =
  | "confirmed-violation"
  | "no-violation"
  | "inconclusive"
  | "error";

export type SourceReplayResult = {
  status: SourceReplayStatus;
  machineName?: string;
  sourceFile: string;
  normalizedTrace: string;
  targetInvariant?: string;
  targetInvariantViolated?: boolean;
  missingInvariantNames: string[];
  initialState: unknown;
  finalState?: unknown;
  initialInvariantEvaluations: ReplayInvariantEvaluation[];
  finalInvariantEvaluations: ReplayInvariantEvaluation[];
  failedInvariantNames: string[];
  steps: SourceReplayStepResult[];
  usedModuleInvariants: boolean;
  usedNormalizeExport: boolean;
  error?: string;
  durationMs: number;
};

export type BoundedSearchReplayResult = {
  traceIndex: number;
  replay: SourceReplayResult;
};

type ReplayModule = {
  machineName?: string;
  initialState: unknown;
  invariants?: readonly StateMachineInvariant[];
  reducer: (state: unknown, action: unknown) => unknown;
  normalize?: (state: unknown) => unknown;
};

export async function replayCounterexampleTrace(args: {
  sourceFile?: string;
  trace: CounterexampleTrace;
  invariants?: StateMachineInvariant[];
}): Promise<SourceReplayResult> {
  const startedAt = process.hrtime.bigint();
  const sourceFile = resolveSourceFile(args.sourceFile ?? args.trace.sourceFile);

  if (!sourceFile) {
    return {
      status: "error",
      sourceFile: "",
      normalizedTrace: buildNormalizedTrace(args.trace),
      targetInvariant: args.trace.failingInvariant,
      targetInvariantViolated: undefined,
      missingInvariantNames: [],
      initialState: undefined,
      finalState: undefined,
      initialInvariantEvaluations: [],
      finalInvariantEvaluations: [],
      failedInvariantNames: [],
      steps: [],
      usedModuleInvariants: args.invariants === undefined,
      usedNormalizeExport: false,
      error: "A source file is required to replay a counterexample trace.",
      durationMs: elapsedMs(startedAt),
    };
  }

  try {
    const replayModule = await loadReplayModule(sourceFile);
    const invariants = args.invariants ?? normalizeInvariants(replayModule.invariants);
    const usedModuleInvariants = args.invariants === undefined;
    const usedNormalizeExport = typeof replayModule.normalize === "function";

    let currentState = cloneValue(args.trace.initialState ?? replayModule.initialState);
    const initialState = cloneValue(currentState);
    const initialInvariantEvaluations = evaluateInvariants(invariants, currentState);
    const steps: SourceReplayStepResult[] = [];

    for (const [index, step] of args.trace.steps.entries()) {
      const action = normalizeAction(step.action);
      const beforeState = cloneValue(currentState);
      const reducerInputState = cloneValue(currentState);
      const reducerInputAction = cloneValue(action);
      const reducedState = replayModule.reducer(reducerInputState, reducerInputAction);

      if (reducedState === undefined) {
        throw new Error(`Reducer returned undefined for replay step ${index + 1}.`);
      }

      currentState = usedNormalizeExport
        ? cloneValue(replayModule.normalize!(cloneValue(reducedState)))
        : cloneValue(reducedState);

      const afterState = cloneValue(currentState);
      steps.push({
        index,
        action,
        actionLabel: String(action.type),
        beforeState,
        afterState,
        matchedExpectedBeforeState:
          step.expectedBeforeState === undefined
            ? undefined
            : isDeepStrictEqual(beforeState, step.expectedBeforeState),
        matchedExpectedAfterState:
          step.expectedAfterState === undefined
            ? undefined
            : isDeepStrictEqual(afterState, step.expectedAfterState),
        invariantEvaluations: evaluateInvariants(invariants, afterState),
      });
    }

    const finalState = cloneValue(currentState);
    const finalInvariantEvaluations =
      steps.at(-1)?.invariantEvaluations ?? initialInvariantEvaluations;
    const failedInvariantNames = finalInvariantEvaluations
      .filter((evaluation) => evaluation.status === "violated")
      .map((evaluation) => evaluation.name);
    const missingInvariantNames = findMissingInvariantNames(
      args.trace.failingInvariant,
      finalInvariantEvaluations,
    );
    const targetInvariant = args.trace.failingInvariant;
    const targetInvariantEvaluation = targetInvariant
      ? finalInvariantEvaluations.find((evaluation) => evaluation.name === targetInvariant)
      : undefined;

    return {
      status: determineReplayStatus({
        targetInvariant,
        finalInvariantEvaluations,
        missingInvariantNames,
      }),
      machineName: replayModule.machineName,
      sourceFile,
      normalizedTrace: buildNormalizedTrace(args.trace),
      targetInvariant,
      targetInvariantViolated: targetInvariantEvaluation?.status === "violated",
      missingInvariantNames,
      initialState,
      finalState,
      initialInvariantEvaluations,
      finalInvariantEvaluations,
      failedInvariantNames,
      steps,
      usedModuleInvariants,
      usedNormalizeExport,
      durationMs: elapsedMs(startedAt),
    };
  } catch (error: unknown) {
    return {
      status: "error",
      sourceFile,
      normalizedTrace: buildNormalizedTrace(args.trace),
      targetInvariant: args.trace.failingInvariant,
      targetInvariantViolated: undefined,
      missingInvariantNames: [],
      initialState: args.trace.initialState,
      finalState: undefined,
      initialInvariantEvaluations: [],
      finalInvariantEvaluations: [],
      failedInvariantNames: [],
      steps: [],
      usedModuleInvariants: args.invariants === undefined,
      usedNormalizeExport: false,
      error: toErrorMessage(error),
      durationMs: elapsedMs(startedAt),
    };
  }
}

export function replayTraceFromBoundedSearchTrace(
  trace: BoundedSearchCounterexampleTrace,
  sourceFile?: string,
): CounterexampleTrace {
  return {
    sourceFile,
    failingInvariant: trace.failingInvariant,
    normalizedTrace: buildNormalizedTraceFromBoundedSearchTrace(trace),
    initialState: trace.steps[0]?.beforeState ?? trace.finalState,
    steps: trace.steps.map((step) => ({
      action:
        Object.keys(step.params).length > 0
          ? { type: step.action, ...step.params }
          : step.action,
      expectedBeforeState: step.beforeState,
      expectedAfterState: step.afterState,
    })),
  };
}

export async function replayBoundedSearchTrace(args: {
  sourceFile: string;
  trace: BoundedSearchCounterexampleTrace;
  invariants?: StateMachineInvariant[];
}): Promise<SourceReplayResult> {
  return replayCounterexampleTrace({
    sourceFile: args.sourceFile,
    invariants: args.invariants,
    trace: replayTraceFromBoundedSearchTrace(args.trace, args.sourceFile),
  });
}

export async function replayBoundedSearchResults(args: {
  sourceFile: string;
  traces: BoundedSearchCounterexampleTrace[];
  invariants?: StateMachineInvariant[];
  replayMaxDepth?: number;
}): Promise<BoundedSearchReplayResult[]> {
  return Promise.all(args.traces.map(async (trace, traceIndex) => {
    if (
      args.replayMaxDepth !== undefined
      && trace.steps.length > args.replayMaxDepth
    ) {
      return {
        traceIndex,
        replay: buildSkippedReplayResult({
          sourceFile: args.sourceFile,
          trace: replayTraceFromBoundedSearchTrace(trace, args.sourceFile),
          reason: `Replay skipped because trace length ${trace.steps.length} exceeds replayMaxDepth ${args.replayMaxDepth}.`,
        }),
      };
    }

    return {
      traceIndex,
      replay: await replayBoundedSearchTrace({
        sourceFile: args.sourceFile,
        trace,
        invariants: args.invariants,
      }),
    };
  }));
}

async function loadReplayModule(sourceFile: string): Promise<ReplayModule> {
  const moduleUrl = `${pathToFileURL(sourceFile).href}?replay=${Date.now()}`;
  const imported = (await import(moduleUrl)) as Record<string, unknown>;

  if (typeof imported.reducer !== "function") {
    throw new Error(`Expected ${sourceFile} to export a reducer(state, action) function.`);
  }

  if (!Object.prototype.hasOwnProperty.call(imported, "initialState")) {
    throw new Error(`Expected ${sourceFile} to export initialState.`);
  }

  if (
    Object.prototype.hasOwnProperty.call(imported, "normalize")
    && imported.normalize !== undefined
    && typeof imported.normalize !== "function"
  ) {
    throw new Error(`Expected ${sourceFile} normalize export to be a function when present.`);
  }

  return {
    machineName:
      typeof imported.machineName === "string" && imported.machineName.trim()
        ? imported.machineName
        : undefined,
    initialState: imported.initialState,
    invariants: normalizeInvariants(imported.invariants),
    reducer: imported.reducer as ReplayModule["reducer"],
    normalize:
      typeof imported.normalize === "function"
        ? (imported.normalize as ReplayModule["normalize"])
        : undefined,
  };
}

function normalizeAction(action: ReplayableAction): Record<string, unknown> {
  if (typeof action === "string") {
    return { type: action };
  }

  if (!action || typeof action !== "object" || Array.isArray(action)) {
    throw new Error("Replay actions must be strings or objects with a string type field.");
  }

  if (typeof action.type !== "string" || !action.type.trim()) {
    throw new Error("Replay action objects must include a non-empty string type field.");
  }

  return cloneValue(action) as Record<string, unknown>;
}

function normalizeInvariants(value: unknown): StateMachineInvariant[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return [];
    }

    const candidate = entry as Record<string, unknown>;
    if (
      typeof candidate.name !== "string"
      || typeof candidate.description !== "string"
      || typeof candidate.expression !== "string"
    ) {
      return [];
    }

    return [{
      name: candidate.name,
      description: candidate.description,
      expression: candidate.expression,
    }];
  });
}

function evaluateInvariants(
  invariants: StateMachineInvariant[],
  state: unknown,
): ReplayInvariantEvaluation[] {
  return invariants.map((invariant) => {
    try {
      const script = new vm.Script(`(${invariant.expression})`);
      const value = script.runInNewContext(
        {
          m: cloneValue(state),
        },
        { timeout: 100 },
      );

      if (typeof value !== "boolean") {
        throw new Error(`Expression resolved to ${typeof value} instead of boolean.`);
      }

      return {
        name: invariant.name,
        expression: invariant.expression,
        status: value ? "holds" : "violated",
      };
    } catch (error: unknown) {
      return {
        name: invariant.name,
        expression: invariant.expression,
        status: "error",
        error: toErrorMessage(error),
      };
    }
  });
}

function determineReplayStatus(args: {
  targetInvariant?: string;
  finalInvariantEvaluations: ReplayInvariantEvaluation[];
  missingInvariantNames: string[];
}): SourceReplayStatus {
  if (args.missingInvariantNames.length > 0) {
    return "inconclusive";
  }

  if (args.finalInvariantEvaluations.length === 0) {
    return "inconclusive";
  }

  if (args.targetInvariant) {
    const evaluation = args.finalInvariantEvaluations.find(
      (candidate) => candidate.name === args.targetInvariant,
    );

    if (!evaluation || evaluation.status === "error") {
      return "inconclusive";
    }

    return evaluation.status === "violated" ? "confirmed-violation" : "no-violation";
  }

  if (args.finalInvariantEvaluations.some((evaluation) => evaluation.status === "violated")) {
    return "confirmed-violation";
  }

  if (args.finalInvariantEvaluations.some((evaluation) => evaluation.status === "error")) {
    return "inconclusive";
  }

  return "no-violation";
}

function buildSkippedReplayResult(args: {
  sourceFile: string;
  trace: CounterexampleTrace;
  reason: string;
}): SourceReplayResult {
  return {
    status: "inconclusive",
    sourceFile: args.sourceFile,
    normalizedTrace: buildNormalizedTrace(args.trace),
    targetInvariant: args.trace.failingInvariant,
    targetInvariantViolated: undefined,
    missingInvariantNames: [],
    initialState: cloneValue(args.trace.initialState),
    finalState: undefined,
    initialInvariantEvaluations: [],
    finalInvariantEvaluations: [],
    failedInvariantNames: [],
    steps: [],
    usedModuleInvariants: false,
    usedNormalizeExport: false,
    error: args.reason,
    durationMs: 0,
  };
}

function findMissingInvariantNames(
  targetInvariant: string | undefined,
  evaluations: ReplayInvariantEvaluation[],
): string[] {
  if (!targetInvariant) {
    return [];
  }

  return evaluations.some((evaluation) => evaluation.name === targetInvariant)
    ? []
    : [targetInvariant];
}

function resolveSourceFile(sourceFile: string | undefined): string | undefined {
  if (!sourceFile) {
    return undefined;
  }

  return path.isAbsolute(sourceFile)
    ? sourceFile
    : path.resolve(process.cwd(), sourceFile);
}

function buildNormalizedTrace(trace: CounterexampleTrace): string {
  if (trace.normalizedTrace?.trim()) {
    return trace.normalizedTrace;
  }

  if (trace.steps.length === 0) {
    return "empty-trace";
  }

  return trace.steps
    .map((step) => {
      if (typeof step.action === "string") {
        return step.action;
      }

      if (step.action && typeof step.action === "object" && typeof step.action.type === "string") {
        return step.action.type;
      }

      return "unknown-action";
    })
    .join(" -> ");
}

function buildNormalizedTraceFromBoundedSearchTrace(
  trace: BoundedSearchCounterexampleTrace,
): string {
  const parts = ["init"];
  for (const step of trace.steps) {
    const paramNames = Object.keys(step.params);
    const paramsText = paramNames.length > 0
      ? `(${paramNames.map((name) => String(step.params[name])).join(", ")})`
      : "";
    parts.push(`${step.action}${paramsText}`);
  }
  return parts.join(" -> ");
}

function cloneValue<T>(value: T): T {
  return structuredClone(value);
}

function elapsedMs(startedAt: bigint): number {
  return Number((process.hrtime.bigint() - startedAt) / 1_000_000n);
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
