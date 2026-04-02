import { describe, it, expect } from "vitest";
import { boundedSearch, type SearchResult } from "./bounded-search.js";
import type { StateMachineIR } from "../contracts/state-machine-schema.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Counter with normalization — invariant holds thanks to clamping. */
function safeCounter(): StateMachineIR {
  return {
    name: "SafeCounter",
    description: "Counter clamped at 0",
    stateFields: [{ name: "value", type: "int" }],
    initialValues: [{ field: "value", value: 0 }],
    actions: [
      {
        name: "Increment",
        params: [],
        effects: [{ field: "value", expression: "m.value + 1" }],
      },
      {
        name: "Decrement",
        params: [],
        effects: [{ field: "value", expression: "m.value - 1" }],
      },
    ],
    invariants: [
      {
        name: "NonNegative",
        description: "value >= 0",
        expression: "m.value >= 0",
        source: "annotation",
        confidence: 1.0,
      },
    ],
    normalization: [
      { field: "value", condition: "m.value < 0", value: "0" },
    ],
  };
}

/** Counter without normalization — Decrement can violate the invariant. */
function unsafeCounter(): StateMachineIR {
  return {
    name: "UnsafeCounter",
    description: "Counter without clamping",
    stateFields: [{ name: "value", type: "int" }],
    initialValues: [{ field: "value", value: 0 }],
    actions: [
      {
        name: "Increment",
        params: [],
        effects: [{ field: "value", expression: "m.value + 1" }],
      },
      {
        name: "Decrement",
        params: [],
        effects: [{ field: "value", expression: "m.value - 1" }],
      },
    ],
    invariants: [
      {
        name: "NonNegative",
        description: "value >= 0",
        expression: "m.value >= 0",
        source: "annotation",
        confidence: 1.0,
      },
    ],
    normalization: [],
  };
}

/** Machine where Init itself violates the invariant. */
function badInit(): StateMachineIR {
  return {
    name: "BadInit",
    description: "Init violates invariant",
    stateFields: [{ name: "value", type: "int" }],
    initialValues: [{ field: "value", value: -5 }],
    actions: [
      {
        name: "Noop",
        params: [],
        effects: [],
      },
    ],
    invariants: [
      {
        name: "NonNegative",
        description: "value >= 0",
        expression: "m.value >= 0",
        source: "annotation",
        confidence: 1.0,
      },
    ],
    normalization: [],
  };
}

/** Machine with parameterized withdraw that can go negative. */
function wallet(): StateMachineIR {
  return {
    name: "Wallet",
    description: "Wallet with deposit/withdraw",
    stateFields: [{ name: "balance", type: "int" }],
    initialValues: [{ field: "balance", value: 0 }],
    actions: [
      {
        name: "Deposit",
        params: [{ name: "amount", type: "int" }],
        effects: [{ field: "balance", expression: "m.balance + amount" }],
      },
      {
        name: "Withdraw",
        params: [{ name: "amount", type: "int" }],
        effects: [{ field: "balance", expression: "m.balance - amount" }],
      },
    ],
    invariants: [
      {
        name: "NonNegative",
        description: "balance >= 0",
        expression: "m.balance >= 0",
        source: "annotation",
        confidence: 1.0,
      },
    ],
    normalization: [],
  };
}

/** Multi-field machine with two invariants. */
function bankAccount(): StateMachineIR {
  return {
    name: "BankAccount",
    description: "Account with balance and frozen flag",
    stateFields: [
      { name: "balance", type: "int" },
      { name: "frozen", type: "bool" },
    ],
    initialValues: [
      { field: "balance", value: 100 },
      { field: "frozen", value: false },
    ],
    actions: [
      {
        name: "Withdraw",
        params: [],
        effects: [{ field: "balance", expression: "m.balance - 200" }],
      },
      {
        name: "Freeze",
        params: [],
        effects: [{ field: "frozen", expression: "true" }],
      },
    ],
    invariants: [
      {
        name: "NonNegativeBalance",
        description: "balance >= 0",
        expression: "m.balance >= 0",
        source: "annotation",
        confidence: 1.0,
      },
      {
        name: "FrozenImpliesPositive",
        description: "frozen implies positive balance",
        expression: "m.frozen ==> m.balance > 0",
        source: "llm",
        confidence: 0.8,
      },
    ],
    normalization: [],
  };
}

// ---------------------------------------------------------------------------
// Witness mode
// ---------------------------------------------------------------------------

describe("boundedSearch — witness mode", () => {
  it("finds no counterexample for safe counter", () => {
    const result = boundedSearch(safeCounter(), { mode: "witness", maxDepth: 4 });
    expect(result.counterexamples).toHaveLength(0);
    expect(result.explored).toBeGreaterThan(0);
  });

  it("finds 1-step counterexample for unsafe counter (Decrement from 0)", () => {
    const result = boundedSearch(unsafeCounter(), { mode: "witness", maxDepth: 4 });
    expect(result.counterexamples.length).toBeGreaterThanOrEqual(1);

    const ce = result.counterexamples[0]!;
    expect(ce.failingInvariant).toBe("NonNegative");
    expect(ce.steps).toHaveLength(1);
    expect(ce.steps[0]!.action).toBe("Decrement");
    expect(ce.finalState.value).toBe(-1);
  });

  it("finds 0-step counterexample when Init violates invariant", () => {
    const result = boundedSearch(badInit(), { mode: "witness", maxDepth: 2 });
    expect(result.counterexamples.length).toBe(1);

    const ce = result.counterexamples[0]!;
    expect(ce.failingInvariant).toBe("NonNegative");
    expect(ce.steps).toHaveLength(0);
    expect(ce.finalState.value).toBe(-5);
  });

  it("finds counterexample for parameterized wallet", () => {
    const result = boundedSearch(wallet(), { mode: "witness", maxDepth: 2 });
    expect(result.counterexamples.length).toBeGreaterThanOrEqual(1);

    const ce = result.counterexamples[0]!;
    expect(ce.failingInvariant).toBe("NonNegative");
    // Final balance must be negative (could be Withdraw(positive) or Deposit(negative))
    expect(ce.finalState.balance as number).toBeLessThan(0);
  });

  it("returns shortest trace (BFS property)", () => {
    const result = boundedSearch(unsafeCounter(), { mode: "witness", maxDepth: 6 });
    const ce = result.counterexamples[0]!;
    // Shortest trace is 1 step: Decrement from 0
    expect(ce.steps).toHaveLength(1);
  });

  it("finds counterexample for multi-field machine", () => {
    const result = boundedSearch(bankAccount(), { mode: "witness", maxDepth: 3 });
    expect(result.counterexamples.length).toBeGreaterThanOrEqual(1);

    const invNames = result.counterexamples.map((ce) => ce.failingInvariant);
    expect(invNames).toContain("NonNegativeBalance");
  });
});

// ---------------------------------------------------------------------------
// Proof mode
// ---------------------------------------------------------------------------

describe("boundedSearch — proof mode", () => {
  it("finds no counterexample for safe counter", () => {
    const result = boundedSearch(safeCounter(), { mode: "proof", maxDepth: 4 });
    expect(result.counterexamples).toHaveLength(0);
  });

  it("finds counterexamples for unsafe counter", () => {
    const result = boundedSearch(unsafeCounter(), { mode: "proof", maxDepth: 3 });
    expect(result.counterexamples.length).toBeGreaterThanOrEqual(1);
  });

  it("respects maxStates limit", () => {
    const result = boundedSearch(unsafeCounter(), {
      mode: "proof",
      maxDepth: 100,
      maxStates: 5,
    });
    expect(result.explored).toBeLessThanOrEqual(5);
  });
});

// ---------------------------------------------------------------------------
// Result metadata
// ---------------------------------------------------------------------------

describe("boundedSearch — result metadata", () => {
  it("reports the search mode", () => {
    const w = boundedSearch(safeCounter(), { mode: "witness", maxDepth: 2 });
    expect(w.mode).toBe("witness");

    const p = boundedSearch(safeCounter(), { mode: "proof", maxDepth: 2 });
    expect(p.mode).toBe("proof");
  });

  it("reports explored count > 0", () => {
    const result = boundedSearch(safeCounter(), { mode: "witness", maxDepth: 2 });
    expect(result.explored).toBeGreaterThan(0);
  });

  it("reports maxDepthReached > 0 when search runs", () => {
    const result = boundedSearch(unsafeCounter(), { mode: "witness", maxDepth: 3 });
    expect(result.maxDepthReached).toBeGreaterThanOrEqual(1);
  });
});
