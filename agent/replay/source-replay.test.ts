import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  replayBoundedSearchResults,
  replayTraceFromBoundedSearchTrace,
} from "./source-replay.js";
import type { CounterexampleTrace } from "../trace/bounded-search.js";
import type { StateMachineInvariant } from "../contracts/state-machine-schema.js";

function makeBoundedTrace(): CounterexampleTrace {
  return {
    failingInvariant: "ValueNeverNegative",
    finalState: { value: -1 },
    steps: [
      {
        action: "Decrement",
        params: {},
        beforeState: { value: 0 },
        afterState: { value: -1 },
      },
    ],
  };
}

describe("replayTraceFromBoundedSearchTrace", () => {
  it("given a bounded-search trace when converted then it preserves state expectations", () => {
    const replayTrace = replayTraceFromBoundedSearchTrace(makeBoundedTrace(), "src/counter.ts");

    expect(replayTrace.sourceFile).toBe("src/counter.ts");
    expect(replayTrace.failingInvariant).toBe("ValueNeverNegative");
    expect(replayTrace.initialState).toEqual({ value: 0 });
    expect(replayTrace.normalizedTrace).toBe("init -> Decrement");
    expect(replayTrace.steps[0]).toEqual({
      action: "Decrement",
      expectedBeforeState: { value: 0 },
      expectedAfterState: { value: -1 },
    });
  });
});

describe("replayBoundedSearchResults", () => {
  const sampleReducerPath = path.resolve(
    process.cwd(),
    "agent/examples/non_negative_counter.reducer.ts",
  );
  const invariants: StateMachineInvariant[] = [
    {
      name: "ValueNeverNegative",
      description: "The counter must never go below zero.",
      expression: "m.value >= 0",
    },
  ];

  it("given a bounded-search counterexample when replayed then it confirms the source violation", async () => {
    const results = await replayBoundedSearchResults({
      sourceFile: sampleReducerPath,
      traces: [makeBoundedTrace()],
      invariants,
      replayMaxDepth: 4,
    });

    expect(results).toHaveLength(1);
    expect(results[0]!.replay.status).toBe("confirmed-violation");
    expect(results[0]!.replay.targetInvariant).toBe("ValueNeverNegative");
    expect(results[0]!.replay.failedInvariantNames).toEqual(["ValueNeverNegative"]);
  });

  it("given a trace longer than replayMaxDepth when replayed then it returns an inconclusive replay result", async () => {
    const results = await replayBoundedSearchResults({
      sourceFile: sampleReducerPath,
      traces: [
        {
          failingInvariant: "ValueNeverNegative",
          finalState: { value: -2 },
          steps: [
            {
              action: "Decrement",
              params: {},
              beforeState: { value: 0 },
              afterState: { value: -1 },
            },
            {
              action: "Decrement",
              params: {},
              beforeState: { value: -1 },
              afterState: { value: -2 },
            },
          ],
        },
      ],
      invariants,
      replayMaxDepth: 1,
    });

    expect(results[0]!.replay.status).toBe("inconclusive");
    expect(results[0]!.replay.error).toContain("exceeds replayMaxDepth 1");
  });
});
