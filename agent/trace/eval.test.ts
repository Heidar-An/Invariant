import { describe, it, expect } from "vitest";
import { evaluate, buildEnv } from "./eval.js";

// ---------------------------------------------------------------------------
// buildEnv
// ---------------------------------------------------------------------------

describe("buildEnv", () => {
  it("prefixes state fields with m.", () => {
    const env = buildEnv({ value: 5 });
    expect(env["m.value"]).toBe(5);
  });

  it("includes params without prefix", () => {
    const env = buildEnv({ value: 5 }, { amount: 10 });
    expect(env["m.value"]).toBe(5);
    expect(env["amount"]).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// Literals
// ---------------------------------------------------------------------------

describe("evaluate — literals", () => {
  it("evaluates integer literals", () => {
    expect(evaluate("42", {})).toBe(42);
  });

  it("evaluates true", () => {
    expect(evaluate("true", {})).toBe(true);
  });

  it("evaluates false", () => {
    expect(evaluate("false", {})).toBe(false);
  });

  it("evaluates string literals", () => {
    expect(evaluate('"hello"', {})).toBe("hello");
  });
});

// ---------------------------------------------------------------------------
// Arithmetic
// ---------------------------------------------------------------------------

describe("evaluate — arithmetic", () => {
  it("adds two numbers", () => {
    expect(evaluate("3 + 4", {})).toBe(7);
  });

  it("subtracts", () => {
    expect(evaluate("10 - 3", {})).toBe(7);
  });

  it("multiplies", () => {
    expect(evaluate("3 * 4", {})).toBe(12);
  });

  it("respects precedence: * before +", () => {
    expect(evaluate("2 + 3 * 4", {})).toBe(14);
  });

  it("handles parentheses", () => {
    expect(evaluate("(2 + 3) * 4", {})).toBe(20);
  });

  it("handles unary minus", () => {
    expect(evaluate("-5", {})).toBe(-5);
  });
});

// ---------------------------------------------------------------------------
// Comparisons
// ---------------------------------------------------------------------------

describe("evaluate — comparisons", () => {
  it(">=", () => {
    expect(evaluate("5 >= 3", {})).toBe(true);
    expect(evaluate("3 >= 5", {})).toBe(false);
    expect(evaluate("5 >= 5", {})).toBe(true);
  });

  it("<=", () => {
    expect(evaluate("3 <= 5", {})).toBe(true);
  });

  it(">", () => {
    expect(evaluate("5 > 3", {})).toBe(true);
    expect(evaluate("5 > 5", {})).toBe(false);
  });

  it("<", () => {
    expect(evaluate("3 < 5", {})).toBe(true);
  });

  it("==", () => {
    expect(evaluate("5 == 5", {})).toBe(true);
    expect(evaluate("5 == 3", {})).toBe(false);
  });

  it("!=", () => {
    expect(evaluate("5 != 3", {})).toBe(true);
    expect(evaluate("5 != 5", {})).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Boolean logic
// ---------------------------------------------------------------------------

describe("evaluate — boolean logic", () => {
  it("&&", () => {
    expect(evaluate("true && true", {})).toBe(true);
    expect(evaluate("true && false", {})).toBe(false);
  });

  it("||", () => {
    expect(evaluate("false || true", {})).toBe(true);
    expect(evaluate("false || false", {})).toBe(false);
  });

  it("!", () => {
    expect(evaluate("!true", {})).toBe(false);
    expect(evaluate("!false", {})).toBe(true);
  });

  it("==> (implies)", () => {
    expect(evaluate("true ==> true", {})).toBe(true);
    expect(evaluate("true ==> false", {})).toBe(false);
    expect(evaluate("false ==> false", {})).toBe(true);
    expect(evaluate("false ==> true", {})).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Identifiers (m.field references)
// ---------------------------------------------------------------------------

describe("evaluate — identifiers", () => {
  it("resolves m.value", () => {
    expect(evaluate("m.value", { "m.value": 10 })).toBe(10);
  });

  it("resolves param name", () => {
    expect(evaluate("amount", { amount: 50 })).toBe(50);
  });

  it("throws on unknown identifier", () => {
    expect(() => evaluate("unknown", {})).toThrow('Unknown identifier "unknown"');
  });
});

// ---------------------------------------------------------------------------
// if/then/else
// ---------------------------------------------------------------------------

describe("evaluate — if/then/else", () => {
  it("returns then-branch when condition is true", () => {
    expect(evaluate("if true then 1 else 2", {})).toBe(1);
  });

  it("returns else-branch when condition is false", () => {
    expect(evaluate("if false then 1 else 2", {})).toBe(2);
  });

  it("handles nested if/then/else", () => {
    expect(evaluate("if false then 1 else if true then 2 else 3", {})).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Real IR expressions
// ---------------------------------------------------------------------------

describe("evaluate — real IR expressions", () => {
  it("m.value + 1", () => {
    const env = buildEnv({ value: 5 });
    expect(evaluate("m.value + 1", env)).toBe(6);
  });

  it("m.value - 1", () => {
    const env = buildEnv({ value: 5 });
    expect(evaluate("m.value - 1", env)).toBe(4);
  });

  it("m.value >= 0 (invariant check)", () => {
    expect(evaluate("m.value >= 0", buildEnv({ value: 5 }))).toBe(true);
    expect(evaluate("m.value >= 0", buildEnv({ value: -1 }))).toBe(false);
  });

  it("m.balance + amount (parameterized)", () => {
    const env = buildEnv({ balance: 100 }, { amount: 50 });
    expect(evaluate("m.balance + amount", env)).toBe(150);
  });

  it("if m.balance - amount < 0 then 0 else m.balance - amount", () => {
    const env1 = buildEnv({ balance: 10 }, { amount: 50 });
    expect(
      evaluate("if m.balance - amount < 0 then 0 else m.balance - amount", env1),
    ).toBe(0);

    const env2 = buildEnv({ balance: 100 }, { amount: 50 });
    expect(
      evaluate("if m.balance - amount < 0 then 0 else m.balance - amount", env2),
    ).toBe(50);
  });

  it("m.frozen ==> m.balance > 0", () => {
    expect(
      evaluate("m.frozen ==> m.balance > 0", buildEnv({ frozen: true, balance: 100 })),
    ).toBe(true);
    expect(
      evaluate("m.frozen ==> m.balance > 0", buildEnv({ frozen: true, balance: 0 })),
    ).toBe(false);
    expect(
      evaluate("m.frozen ==> m.balance > 0", buildEnv({ frozen: false, balance: 0 })),
    ).toBe(true);
  });

  it("(m.value >= 0) && (m.value <= 100)", () => {
    expect(
      evaluate("(m.value >= 0) && (m.value <= 100)", buildEnv({ value: 50 })),
    ).toBe(true);
    expect(
      evaluate("(m.value >= 0) && (m.value <= 100)", buildEnv({ value: 150 })),
    ).toBe(false);
  });

  it("m.value < 0 (normalization condition)", () => {
    expect(evaluate("m.value < 0", buildEnv({ value: -1 }))).toBe(true);
    expect(evaluate("m.value < 0", buildEnv({ value: 0 }))).toBe(false);
  });
});
