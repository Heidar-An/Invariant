import { describe, it, expect } from "vitest";
import {
  renderWitnessLemma,
  injectWitnessLemmas,
  renderStateAssertion,
} from "./trace-to-dafny.js";
import type { StateMachineIR } from "../contracts/state-machine-schema.js";
import type { CounterexampleTrace } from "./bounded-search.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function counterIR(): StateMachineIR {
  return {
    name: "Counter",
    description: "Simple counter",
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

function walletIR(): StateMachineIR {
  return {
    name: "Wallet",
    description: "Parameterized wallet",
    stateFields: [{ name: "balance", type: "int" }],
    initialValues: [{ field: "balance", value: 0 }],
    actions: [
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

function twoStepTrace(): CounterexampleTrace {
  return {
    steps: [
      {
        action: "Increment",
        params: {},
        beforeState: { value: 0 },
        afterState: { value: 1 },
      },
      {
        action: "Decrement",
        params: {},
        beforeState: { value: 1 },
        afterState: { value: 0 },
      },
    ],
    failingInvariant: "NonNegative",
    finalState: { value: 0 },
  };
}

function initViolationTrace(): CounterexampleTrace {
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

// ---------------------------------------------------------------------------
// renderWitnessLemma
// ---------------------------------------------------------------------------

describe("renderWitnessLemma", () => {
  it("produces a named lemma", () => {
    const lemma = renderWitnessLemma(counterIR(), oneStepTrace(), 0);
    expect(lemma.name).toBe("Witness_NonNegative_0");
    expect(lemma.invariantName).toBe("NonNegative");
  });

  it("includes !Inv in ensures clause", () => {
    const lemma = renderWitnessLemma(counterIR(), oneStepTrace(), 0);
    expect(lemma.dafnySource).toContain("ensures !Inv(");
  });

  it("chains Apply and Normalize calls for each step", () => {
    const lemma = renderWitnessLemma(counterIR(), oneStepTrace(), 0);
    expect(lemma.dafnySource).toContain("Normalize(Apply(Init(), Decrement))");
  });

  it("handles two-step trace with intermediate bindings", () => {
    const lemma = renderWitnessLemma(counterIR(), twoStepTrace(), 0);
    expect(lemma.dafnySource).toContain("var s0");
    expect(lemma.dafnySource).toContain("var s1");
    expect(lemma.dafnySource).toContain("ensures !Inv(s1)");
  });

  it("handles init-violation (zero steps)", () => {
    const lemma = renderWitnessLemma(counterIR(), initViolationTrace(), 0);
    expect(lemma.dafnySource).toContain("ensures !Inv(Init())");
  });

  it("renders parameterized action args", () => {
    const lemma = renderWitnessLemma(walletIR(), paramTrace(), 0);
    expect(lemma.dafnySource).toContain("Withdraw(10)");
  });

  it("increments index in name", () => {
    const l0 = renderWitnessLemma(counterIR(), oneStepTrace(), 0);
    const l1 = renderWitnessLemma(counterIR(), oneStepTrace(), 1);
    expect(l0.name).toBe("Witness_NonNegative_0");
    expect(l1.name).toBe("Witness_NonNegative_1");
  });
});

// ---------------------------------------------------------------------------
// injectWitnessLemmas
// ---------------------------------------------------------------------------

describe("injectWitnessLemmas", () => {
  const baseDafny = `module Counter {\n  // ...\n}\n`;

  it("returns base source unchanged when no lemmas", () => {
    expect(injectWitnessLemmas(baseDafny, [])).toBe(baseDafny);
  });

  it("injects lemma before closing brace", () => {
    const lemma = renderWitnessLemma(counterIR(), oneStepTrace(), 0);
    const result = injectWitnessLemmas(baseDafny, [lemma]);
    expect(result).toContain("Witness lemmas");
    expect(result).toContain("Witness_NonNegative_0");
    // Closing brace should still be present
    expect(result.trimEnd().endsWith("}")).toBe(true);
  });

  it("injects multiple lemmas", () => {
    const l0 = renderWitnessLemma(counterIR(), oneStepTrace(), 0);
    const l1 = renderWitnessLemma(counterIR(), twoStepTrace(), 1);
    const result = injectWitnessLemmas(baseDafny, [l0, l1]);
    expect(result).toContain("Witness_NonNegative_0");
    expect(result).toContain("Witness_NonNegative_1");
  });
});

// ---------------------------------------------------------------------------
// renderStateAssertion
// ---------------------------------------------------------------------------

describe("renderStateAssertion", () => {
  it("renders Model with field values", () => {
    const assertion = renderStateAssertion(
      counterIR(),
      { value: -1 },
      "NonNegative",
    );
    expect(assertion).toContain("assert !Inv(Model(-1))");
    expect(assertion).toContain("NonNegative");
  });

  it("handles multi-field state", () => {
    const ir: StateMachineIR = {
      name: "Multi",
      description: "multi",
      stateFields: [
        { name: "a", type: "int" },
        { name: "b", type: "bool" },
      ],
      initialValues: [
        { field: "a", value: 0 },
        { field: "b", value: false },
      ],
      actions: [],
      invariants: [],
      normalization: [],
    };
    const assertion = renderStateAssertion(ir, { a: 5, b: true }, "Inv");
    expect(assertion).toContain("Model(5, true)");
  });
});
