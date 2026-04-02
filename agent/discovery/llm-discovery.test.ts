import { describe, expect, it } from "vitest";

import { parseLlmDiscoveryResponse } from "./llm-discovery.js";

describe("parseLlmDiscoveryResponse", () => {
  it("given fenced json state machine when parsed then it normalizes source metadata", () => {
    const result = parseLlmDiscoveryResponse(
      `\`\`\`json
{
  "kind": "state-machine",
  "ir": {
    "name": "CheckoutFlow",
    "description": "Tracks checkout session state.",
    "stateFields": [
      { "name": "value", "type": "int" }
    ],
    "initialValues": [
      { "field": "value", "value": 0 }
    ],
    "actions": [
      {
        "name": "Increment",
        "params": [],
        "effects": [
          { "field": "value", "expression": "m.value + 1" }
        ]
      }
    ],
    "invariants": [
      {
        "name": "ValueNeverNegative",
        "description": "Counter stays non-negative.",
        "expression": "m.value >= 0",
        "source": "llm",
        "confidence": 0.7
      }
    ],
    "normalization": []
  }
}
\`\`\``,
      `${process.cwd()}/src/checkout.ts`,
    );

    expect(result.kind).toBe("state-machine");
    if (result.kind !== "state-machine") {
      throw new Error("expected state-machine result");
    }

    expect(result.ir.discoveryPattern).toBe("llm-claude-direct-ir");
    expect(result.ir.sourceFile).toBe("src/checkout.ts");
  });

  it("given explanatory text when parsed then it extracts the json object", () => {
    const result = parseLlmDiscoveryResponse(
      `I found a state machine.

{
  "kind": "not-a-state-machine",
  "reason": "The file only exports constants and utility helpers."
}`,
    );

    expect(result).toEqual({
      kind: "not-a-state-machine",
      reason: "The file only exports constants and utility helpers.",
    });
  });

  it("given invalid ir when parsed then it throws validation details", () => {
    expect(() =>
      parseLlmDiscoveryResponse(
        JSON.stringify({
          kind: "state-machine",
          ir: {
            name: "Broken",
            description: "Missing fields",
            stateFields: [],
            initialValues: [],
            actions: [],
            invariants: [],
            normalization: [],
          },
        }),
      ),
    ).toThrow(/LLM discovery returned invalid IR/);
  });

  it("given missing reason when parsed then it throws a contract error", () => {
    expect(() =>
      parseLlmDiscoveryResponse(
        JSON.stringify({
          kind: "not-a-state-machine",
        }),
      ),
    ).toThrow(/without a reason/);
  });
});
