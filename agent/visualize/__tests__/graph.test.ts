import { describe, it, expect } from "vitest";
import { renderGraphHTML } from "../graph.js";
import type { StateMachineIR } from "../../contracts/state-machine-schema.js";
import type { SearchResult } from "../../trace/bounded-search.js";

const sampleIR: StateMachineIR = {
  name: "Counter",
  description: "A simple counter state machine",
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
      description: "Value is never negative",
      expression: "m.value >= 0",
      source: "annotation",
      confidence: 1.0,
    },
  ],
  normalization: [
    { field: "value", condition: "m.value < 0", value: "0" },
  ],
};

describe("renderGraphHTML", () => {
  it("renders HTML with no counterexamples", () => {
    const result: SearchResult = {
      mode: "witness",
      explored: 100,
      maxDepthReached: 6,
      counterexamples: [],
    };

    const html = renderGraphHTML(sampleIR, result);
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("Counter");
    expect(html).toContain("No counterexamples found");
    expect(html).toContain("mermaid");
    expect(html).toContain("flowchart LR");
    expect(html).toContain("Increment");
    expect(html).toContain("Decrement");
    expect(html).toContain("NonNegative");
  });

  it("renders HTML with counterexample traces", () => {
    const result: SearchResult = {
      mode: "witness",
      explored: 50,
      maxDepthReached: 3,
      counterexamples: [
        {
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
        },
      ],
    };

    const html = renderGraphHTML(sampleIR, result);
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("Counterexample 1");
    expect(html).toContain("NonNegative");
    expect(html).toContain("INVARIANT VIOLATED");
    expect(html).toContain("flowchart TD");
    expect(html).toContain("Decrement");
    expect(html).not.toContain("No counterexamples found");
  });

  it("renders init-only counterexample", () => {
    const result: SearchResult = {
      mode: "proof",
      explored: 1,
      maxDepthReached: 0,
      counterexamples: [
        {
          steps: [],
          failingInvariant: "NonNegative",
          finalState: { value: -1 },
        },
      ],
    };

    const html = renderGraphHTML(sampleIR, result);
    expect(html).toContain("INVARIANT VIOLATED");
    expect(html).toContain("0 steps");
  });

  it("includes stats section", () => {
    const result: SearchResult = {
      mode: "witness",
      explored: 200,
      maxDepthReached: 4,
      counterexamples: [],
    };

    const html = renderGraphHTML(sampleIR, result);
    expect(html).toContain("200");
    expect(html).toContain("States Explored");
    expect(html).toContain("Max Depth");
  });

  it("renders parameterized action traces", () => {
    const ir: StateMachineIR = {
      ...sampleIR,
      actions: [
        {
          name: "Add",
          params: [{ name: "amount", type: "int" }],
          effects: [{ field: "value", expression: "m.value + amount" }],
        },
      ],
    };

    const result: SearchResult = {
      mode: "witness",
      explored: 10,
      maxDepthReached: 2,
      counterexamples: [
        {
          steps: [
            {
              action: "Add",
              params: { amount: -5 },
              beforeState: { value: 0 },
              afterState: { value: -5 },
            },
          ],
          failingInvariant: "NonNegative",
          finalState: { value: -5 },
        },
      ],
    };

    const html = renderGraphHTML(ir, result);
    expect(html).toContain("Add");
    expect(html).toContain("amount");
  });
});
