import { describe, it, expect } from "vitest";
import {
  counterexamplesToFindings,
  traceToFinding,
} from "./counterexample.js";
import type { SearchResult, CounterexampleTrace } from "../trace/bounded-search.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function oneStepTrace(): CounterexampleTrace {
  return {
    steps: [
      {
        action: "Decrement",
        params: {},
        beforeState: { value: 0 },
        afterState: { value: -1 },
      },
    ],
    failingInvariant: "NonNegative",
    finalState: { value: -1 },
  };
}

function initViolation(): CounterexampleTrace {
  return {
    steps: [],
    failingInvariant: "NonNegative",
    finalState: { value: -5 },
  };
}

function paramTrace(): CounterexampleTrace {
  return {
    steps: [
      {
        action: "Withdraw",
        params: { amount: 10 },
        beforeState: { balance: 0 },
        afterState: { balance: -10 },
      },
    ],
    failingInvariant: "NonNegative",
    finalState: { balance: -10 },
  };
}

function emptyResult(): SearchResult {
  return {
    mode: "witness",
    explored: 10,
    maxDepthReached: 3,
    counterexamples: [],
  };
}

function resultWithTraces(): SearchResult {
  return {
    mode: "witness",
    explored: 50,
    maxDepthReached: 4,
    counterexamples: [oneStepTrace(), paramTrace()],
  };
}

// ---------------------------------------------------------------------------
// traceToFinding
// ---------------------------------------------------------------------------

describe("traceToFinding", () => {
  it("produces kind=counterexample", () => {
    const finding = traceToFinding(oneStepTrace(), "witness");
    expect(finding.kind).toBe("counterexample");
  });

  it("includes invariant name", () => {
    const finding = traceToFinding(oneStepTrace(), "witness");
    expect(finding.invariantName).toBe("NonNegative");
  });

  it("builds normalized trace with arrows", () => {
    const finding = traceToFinding(oneStepTrace(), "witness");
    expect(finding.normalizedTrace).toBe("init -> Decrement");
  });

  it("builds normalized trace for parameterized action", () => {
    const finding = traceToFinding(paramTrace(), "witness");
    expect(finding.normalizedTrace).toBe("init -> Withdraw(10)");
  });

  it("builds normalized trace for init violation", () => {
    const finding = traceToFinding(initViolation(), "witness");
    expect(finding.normalizedTrace).toBe("init");
  });

  it("populates counterexample.steps", () => {
    const finding = traceToFinding(oneStepTrace(), "witness");
    expect(finding.counterexample).toBeDefined();
    expect(finding.counterexample!.steps).toHaveLength(1);
    expect(finding.counterexample!.steps![0]!.action).toBe("Decrement");
  });

  it("populates counterexample.failingInvariant", () => {
    const finding = traceToFinding(oneStepTrace(), "witness");
    expect(finding.counterexample!.failingInvariant).toBe("NonNegative");
  });

  it("includes before/after state in steps", () => {
    const finding = traceToFinding(oneStepTrace(), "witness");
    const step = finding.counterexample!.steps![0]!;
    expect(step.beforeState).toContain("value=0");
    expect(step.afterState).toContain("value=-1");
  });

  it("title mentions step count", () => {
    const finding = traceToFinding(oneStepTrace(), "witness");
    expect(finding.title).toContain("1 step");
  });

  it("title mentions 'at init' for zero-step trace", () => {
    const finding = traceToFinding(initViolation(), "witness");
    expect(finding.title).toContain("at init");
  });

  it("explanation mentions the search mode", () => {
    const finding = traceToFinding(oneStepTrace(), "witness");
    expect(finding.explanation).toContain("witness");
  });

  it("explanation includes final state", () => {
    const finding = traceToFinding(oneStepTrace(), "witness");
    expect(finding.explanation).toContain("value=-1");
  });
});

// ---------------------------------------------------------------------------
// counterexamplesToFindings
// ---------------------------------------------------------------------------

describe("counterexamplesToFindings", () => {
  it("returns empty array for no counterexamples", () => {
    expect(counterexamplesToFindings(emptyResult())).toHaveLength(0);
  });

  it("returns one finding per counterexample", () => {
    const findings = counterexamplesToFindings(resultWithTraces());
    expect(findings).toHaveLength(2);
  });

  it("all findings have kind=counterexample", () => {
    const findings = counterexamplesToFindings(resultWithTraces());
    for (const f of findings) {
      expect(f.kind).toBe("counterexample");
    }
  });
});
