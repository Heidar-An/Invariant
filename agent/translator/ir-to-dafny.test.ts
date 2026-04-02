import { describe, it, expect } from "vitest";
import { translateIR } from "./ir-to-dafny.js";
import type { StateMachineIR } from "../contracts/state-machine-schema.js";
import { resolve } from "node:path";

const PROMPT_PATH = resolve(
  import.meta.dirname,
  "../prompts/translator.prompt.txt",
);
const TEMPLATE_PATH = resolve(
  import.meta.dirname,
  "../dafny/state_machine.template.dfy",
);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeCounterIR(): StateMachineIR {
  return {
    name: "NonNegativeCounter",
    description: "A counter that cannot go below zero",
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
        description: "value is always >= 0",
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

function makeMultiFieldIR(): StateMachineIR {
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
        name: "Deposit",
        params: [],
        effects: [{ field: "balance", expression: "m.balance + 50" }],
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

function makeParameterizedIR(): StateMachineIR {
  return {
    name: "Wallet",
    description: "Wallet with deposit and withdraw",
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
    normalization: [
      { field: "balance", condition: "m.balance < 0", value: "0" },
    ],
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("translateIR – mock provider", () => {
  // -------------------------------------------------------------------------
  // Basic NonNegativeCounter
  // -------------------------------------------------------------------------
  describe("NonNegativeCounter (basic)", () => {
    it("returns provider=mock and model=deterministic-template", async () => {
      const result = await translateIR({
        ir: makeCounterIR(),
        promptPath: PROMPT_PATH,
        templatePath: TEMPLATE_PATH,
        provider: "mock",
      });
      expect(result.provider).toBe("mock");
      expect(result.model).toBe("deterministic-template");
    });

    it("emits the module declaration", async () => {
      const { dafnySource } = await translateIR({
        ir: makeCounterIR(),
        promptPath: PROMPT_PATH,
        templatePath: TEMPLATE_PATH,
        provider: "mock",
      });
      expect(dafnySource).toContain("module NonNegativeCounter");
    });

    it("emits Model datatype with value field", async () => {
      const { dafnySource } = await translateIR({
        ir: makeCounterIR(),
        promptPath: PROMPT_PATH,
        templatePath: TEMPLATE_PATH,
        provider: "mock",
      });
      expect(dafnySource).toContain("datatype Model = Model(value: int)");
    });

    it("emits Action datatype with Increment and Decrement", async () => {
      const { dafnySource } = await translateIR({
        ir: makeCounterIR(),
        promptPath: PROMPT_PATH,
        templatePath: TEMPLATE_PATH,
        provider: "mock",
      });
      expect(dafnySource).toContain(
        "datatype Action = Increment | Decrement",
      );
    });

    it("emits ghost predicate Inv", async () => {
      const { dafnySource } = await translateIR({
        ir: makeCounterIR(),
        promptPath: PROMPT_PATH,
        templatePath: TEMPLATE_PATH,
        provider: "mock",
      });
      expect(dafnySource).toContain("ghost predicate Inv(m: Model)");
    });

    it("emits invariant body m.value >= 0", async () => {
      const { dafnySource } = await translateIR({
        ir: makeCounterIR(),
        promptPath: PROMPT_PATH,
        templatePath: TEMPLATE_PATH,
        provider: "mock",
      });
      expect(dafnySource).toContain("m.value >= 0");
    });

    it("emits function Init(): Model", async () => {
      const { dafnySource } = await translateIR({
        ir: makeCounterIR(),
        promptPath: PROMPT_PATH,
        templatePath: TEMPLATE_PATH,
        provider: "mock",
      });
      expect(dafnySource).toContain("function Init(): Model");
    });

    it("emits Model(0) as initial value", async () => {
      const { dafnySource } = await translateIR({
        ir: makeCounterIR(),
        promptPath: PROMPT_PATH,
        templatePath: TEMPLATE_PATH,
        provider: "mock",
      });
      expect(dafnySource).toContain("Model(0)");
    });

    it("emits function Apply(m: Model, a: Action): Model", async () => {
      const { dafnySource } = await translateIR({
        ir: makeCounterIR(),
        promptPath: PROMPT_PATH,
        templatePath: TEMPLATE_PATH,
        provider: "mock",
      });
      expect(dafnySource).toContain(
        "function Apply(m: Model, a: Action): Model",
      );
    });

    it("emits case Increment => Model(m.value + 1)", async () => {
      const { dafnySource } = await translateIR({
        ir: makeCounterIR(),
        promptPath: PROMPT_PATH,
        templatePath: TEMPLATE_PATH,
        provider: "mock",
      });
      expect(dafnySource).toContain(
        "case Increment => Model(m.value + 1)",
      );
    });

    it("emits case Decrement => Model(m.value - 1)", async () => {
      const { dafnySource } = await translateIR({
        ir: makeCounterIR(),
        promptPath: PROMPT_PATH,
        templatePath: TEMPLATE_PATH,
        provider: "mock",
      });
      expect(dafnySource).toContain(
        "case Decrement => Model(m.value - 1)",
      );
    });

    it("emits function Normalize(m: Model): Model", async () => {
      const { dafnySource } = await translateIR({
        ir: makeCounterIR(),
        promptPath: PROMPT_PATH,
        templatePath: TEMPLATE_PATH,
        provider: "mock",
      });
      expect(dafnySource).toContain("function Normalize(m: Model): Model");
    });

    it("emits normalization body: if m.value < 0 then Model(0) else m", async () => {
      const { dafnySource } = await translateIR({
        ir: makeCounterIR(),
        promptPath: PROMPT_PATH,
        templatePath: TEMPLATE_PATH,
        provider: "mock",
      });
      expect(dafnySource).toContain(
        "if m.value < 0 then Model(0) else m",
      );
    });

    it("emits lemma InitSatisfiesInv()", async () => {
      const { dafnySource } = await translateIR({
        ir: makeCounterIR(),
        promptPath: PROMPT_PATH,
        templatePath: TEMPLATE_PATH,
        provider: "mock",
      });
      expect(dafnySource).toContain("lemma InitSatisfiesInv()");
    });

    it("emits lemma StepPreservesInv(m: Model, a: Action)", async () => {
      const { dafnySource } = await translateIR({
        ir: makeCounterIR(),
        promptPath: PROMPT_PATH,
        templatePath: TEMPLATE_PATH,
        provider: "mock",
      });
      expect(dafnySource).toContain(
        "lemma StepPreservesInv(m: Model, a: Action)",
      );
    });

    it("requestText includes prompt text", async () => {
      const result = await translateIR({
        ir: makeCounterIR(),
        promptPath: PROMPT_PATH,
        templatePath: TEMPLATE_PATH,
        provider: "mock",
      });
      expect(result.requestText).toContain(
        "You translate a tiny reducer-style state-machine IR",
      );
    });

    it("requestText includes IR JSON", async () => {
      const ir = makeCounterIR();
      const result = await translateIR({
        ir,
        promptPath: PROMPT_PATH,
        templatePath: TEMPLATE_PATH,
        provider: "mock",
      });
      expect(result.requestText).toContain("State Machine IR:");
      expect(result.requestText).toContain('"name": "NonNegativeCounter"');
    });

    it("requestText includes the template", async () => {
      const result = await translateIR({
        ir: makeCounterIR(),
        promptPath: PROMPT_PATH,
        templatePath: TEMPLATE_PATH,
        provider: "mock",
      });
      expect(result.requestText).toContain("Reference Dafny template:");
      expect(result.requestText).toContain("__MODULE_NAME__");
    });

    it("responseText equals dafnySource for mock provider", async () => {
      const result = await translateIR({
        ir: makeCounterIR(),
        promptPath: PROMPT_PATH,
        templatePath: TEMPLATE_PATH,
        provider: "mock",
      });
      expect(result.responseText).toBe(result.dafnySource);
    });
  });

  // -------------------------------------------------------------------------
  // Multi-field state (balance + frozen)
  // -------------------------------------------------------------------------
  describe("multi-field state (BankAccount)", () => {
    it("emits Model with both fields", async () => {
      const { dafnySource } = await translateIR({
        ir: makeMultiFieldIR(),
        promptPath: PROMPT_PATH,
        templatePath: TEMPLATE_PATH,
        provider: "mock",
      });
      expect(dafnySource).toContain(
        "datatype Model = Model(balance: int, frozen: bool)",
      );
    });

    it("emits initial values for both fields", async () => {
      const { dafnySource } = await translateIR({
        ir: makeMultiFieldIR(),
        promptPath: PROMPT_PATH,
        templatePath: TEMPLATE_PATH,
        provider: "mock",
      });
      expect(dafnySource).toContain("Model(100, false)");
    });

    it("preserves unaffected fields in Deposit action", async () => {
      const { dafnySource } = await translateIR({
        ir: makeMultiFieldIR(),
        promptPath: PROMPT_PATH,
        templatePath: TEMPLATE_PATH,
        provider: "mock",
      });
      // Deposit only affects balance, so frozen should be m.frozen
      expect(dafnySource).toContain(
        "case Deposit => Model(m.balance + 50, m.frozen)",
      );
    });

    it("preserves unaffected fields in Freeze action", async () => {
      const { dafnySource } = await translateIR({
        ir: makeMultiFieldIR(),
        promptPath: PROMPT_PATH,
        templatePath: TEMPLATE_PATH,
        provider: "mock",
      });
      // Freeze only affects frozen, so balance should be m.balance
      expect(dafnySource).toContain(
        "case Freeze => Model(m.balance, true)",
      );
    });

    it("joins multiple invariants with &&", async () => {
      const { dafnySource } = await translateIR({
        ir: makeMultiFieldIR(),
        promptPath: PROMPT_PATH,
        templatePath: TEMPLATE_PATH,
        provider: "mock",
      });
      expect(dafnySource).toContain(
        "(m.balance >= 0) && (m.frozen ==> m.balance > 0)",
      );
    });

    it("emits Action variants for both actions", async () => {
      const { dafnySource } = await translateIR({
        ir: makeMultiFieldIR(),
        promptPath: PROMPT_PATH,
        templatePath: TEMPLATE_PATH,
        provider: "mock",
      });
      expect(dafnySource).toContain("datatype Action = Deposit | Freeze");
    });
  });

  // -------------------------------------------------------------------------
  // Parameterized actions
  // -------------------------------------------------------------------------
  describe("parameterized actions (Wallet)", () => {
    it("renders action with params as Deposit(amount: int)", async () => {
      const { dafnySource } = await translateIR({
        ir: makeParameterizedIR(),
        promptPath: PROMPT_PATH,
        templatePath: TEMPLATE_PATH,
        provider: "mock",
      });
      expect(dafnySource).toContain("Deposit(amount: int)");
    });

    it("renders Withdraw with params", async () => {
      const { dafnySource } = await translateIR({
        ir: makeParameterizedIR(),
        promptPath: PROMPT_PATH,
        templatePath: TEMPLATE_PATH,
        provider: "mock",
      });
      expect(dafnySource).toContain("Withdraw(amount: int)");
    });

    it("uses (..) for parameterized actions in Apply cases", async () => {
      const { dafnySource } = await translateIR({
        ir: makeParameterizedIR(),
        promptPath: PROMPT_PATH,
        templatePath: TEMPLATE_PATH,
        provider: "mock",
      });
      expect(dafnySource).toContain("case Deposit(..)");
      expect(dafnySource).toContain("case Withdraw(..)");
    });

    it("uses (..) for parameterized actions in proof cases", async () => {
      const { dafnySource } = await translateIR({
        ir: makeParameterizedIR(),
        promptPath: PROMPT_PATH,
        templatePath: TEMPLATE_PATH,
        provider: "mock",
      });
      // proof cases also use (..) pattern
      const proofMatches = dafnySource.match(/case Deposit\(\.\.\)/g);
      expect(proofMatches).not.toBeNull();
      // Should appear in both Apply and StepPreservesInv
      expect(proofMatches!.length).toBe(2);
    });

    it("emits action datatype with params in type signature", async () => {
      const { dafnySource } = await translateIR({
        ir: makeParameterizedIR(),
        promptPath: PROMPT_PATH,
        templatePath: TEMPLATE_PATH,
        provider: "mock",
      });
      expect(dafnySource).toContain(
        "datatype Action = Deposit(amount: int) | Withdraw(amount: int)",
      );
    });
  });

  // -------------------------------------------------------------------------
  // No normalization
  // -------------------------------------------------------------------------
  describe("no normalization", () => {
    it('Normalize returns "m" when normalization array is empty', async () => {
      const ir = makeMultiFieldIR(); // already has empty normalization
      expect(ir.normalization).toHaveLength(0);

      const { dafnySource } = await translateIR({
        ir,
        promptPath: PROMPT_PATH,
        templatePath: TEMPLATE_PATH,
        provider: "mock",
      });
      // The Normalize function should just return m
      expect(dafnySource).toMatch(
        /function Normalize\(m: Model\): Model \{\s*m\s*\}/,
      );
    });
  });

  // -------------------------------------------------------------------------
  // Multiple normalization rules
  // -------------------------------------------------------------------------
  describe("multiple normalization rules", () => {
    it("chains rules as nested if-then-else", async () => {
      const ir: StateMachineIR = {
        name: "Clamped",
        description: "Value clamped to [0, 100]",
        stateFields: [{ name: "value", type: "int" }],
        initialValues: [{ field: "value", value: 50 }],
        actions: [
          {
            name: "Set",
            params: [{ name: "v", type: "int" }],
            effects: [{ field: "value", expression: "v" }],
          },
        ],
        invariants: [
          {
            name: "InRange",
            description: "value between 0 and 100",
            expression: "m.value >= 0 && m.value <= 100",
            source: "annotation",
            confidence: 1.0,
          },
        ],
        normalization: [
          { field: "value", condition: "m.value < 0", value: "0" },
          { field: "value", condition: "m.value > 100", value: "100" },
        ],
      };

      const { dafnySource } = await translateIR({
        ir,
        promptPath: PROMPT_PATH,
        templatePath: TEMPLATE_PATH,
        provider: "mock",
      });

      // Second rule wraps the first: if ... then ... else (if ... then ... else m)
      expect(dafnySource).toContain("if m.value > 100 then Model(100)");
      expect(dafnySource).toContain("if m.value < 0 then Model(0) else m");
    });
  });

  // -------------------------------------------------------------------------
  // Special characters in name
  // -------------------------------------------------------------------------
  describe("special characters in name", () => {
    it("sanitizeIdentifier strips non-alphanumeric chars", async () => {
      const ir = makeCounterIR();
      ir.name = "My Counter!!@#$%";

      const { dafnySource } = await translateIR({
        ir,
        promptPath: PROMPT_PATH,
        templatePath: TEMPLATE_PATH,
        provider: "mock",
      });
      expect(dafnySource).toContain("module MyCounter");
      expect(dafnySource).not.toContain("!!");
      expect(dafnySource).not.toContain("@");
      expect(dafnySource).not.toContain("#");
    });

    it("handles name with spaces and hyphens", async () => {
      const ir = makeCounterIR();
      ir.name = "my-state machine";

      const { dafnySource } = await translateIR({
        ir,
        promptPath: PROMPT_PATH,
        templatePath: TEMPLATE_PATH,
        provider: "mock",
      });
      expect(dafnySource).toContain("module mystatemachine");
    });

    it("preserves underscores in name", async () => {
      const ir = makeCounterIR();
      ir.name = "my_counter_v2";

      const { dafnySource } = await translateIR({
        ir,
        promptPath: PROMPT_PATH,
        templatePath: TEMPLATE_PATH,
        provider: "mock",
      });
      expect(dafnySource).toContain("module my_counter_v2");
    });
  });

  // -------------------------------------------------------------------------
  // Multiple invariants
  // -------------------------------------------------------------------------
  describe("multiple invariants", () => {
    it("joins invariants with &&", async () => {
      const ir = makeCounterIR();
      ir.invariants.push({
        name: "Bounded",
        description: "value <= 100",
        expression: "m.value <= 100",
        source: "llm",
        confidence: 0.7,
      });

      const { dafnySource } = await translateIR({
        ir,
        promptPath: PROMPT_PATH,
        templatePath: TEMPLATE_PATH,
        provider: "mock",
      });
      expect(dafnySource).toContain(
        "(m.value >= 0) && (m.value <= 100)",
      );
    });

    it("wraps each invariant in parentheses", async () => {
      const ir = makeCounterIR();
      ir.invariants.push({
        name: "Bounded",
        description: "value <= 100",
        expression: "m.value <= 100",
        source: "llm",
        confidence: 0.7,
      });

      const { dafnySource } = await translateIR({
        ir,
        promptPath: PROMPT_PATH,
        templatePath: TEMPLATE_PATH,
        provider: "mock",
      });
      // Each expression is wrapped
      expect(dafnySource).toContain("(m.value >= 0)");
      expect(dafnySource).toContain("(m.value <= 100)");
    });

    it("handles three invariants", async () => {
      const ir = makeCounterIR();
      ir.invariants = [
        {
          name: "A",
          description: "a",
          expression: "m.value >= 0",
          source: "annotation",
          confidence: 1.0,
        },
        {
          name: "B",
          description: "b",
          expression: "m.value <= 100",
          source: "annotation",
          confidence: 1.0,
        },
        {
          name: "C",
          description: "c",
          expression: "m.value != 42",
          source: "llm",
          confidence: 0.5,
        },
      ];

      const { dafnySource } = await translateIR({
        ir,
        promptPath: PROMPT_PATH,
        templatePath: TEMPLATE_PATH,
        provider: "mock",
      });
      expect(dafnySource).toContain(
        "(m.value >= 0) && (m.value <= 100) && (m.value != 42)",
      );
    });
  });

  // -------------------------------------------------------------------------
  // Empty invariant list edge case
  // -------------------------------------------------------------------------
  describe("empty invariant list", () => {
    it('falls back to "true" when no invariants', async () => {
      const ir = makeCounterIR();
      ir.invariants = [];

      const { dafnySource } = await translateIR({
        ir,
        promptPath: PROMPT_PATH,
        templatePath: TEMPLATE_PATH,
        provider: "mock",
      });
      // The Inv predicate body should just be "true"
      expect(dafnySource).toMatch(/ghost predicate Inv\(m: Model\)\s*\{\s*true\s*\}/);
    });
  });

  // -------------------------------------------------------------------------
  // Additional edge cases
  // -------------------------------------------------------------------------
  describe("edge cases", () => {
    it("handles string type fields", async () => {
      const ir: StateMachineIR = {
        name: "NamedThing",
        description: "Has a string field",
        stateFields: [
          { name: "label", type: "string" },
          { name: "count", type: "int" },
        ],
        initialValues: [
          { field: "label", value: "hello" },
          { field: "count", value: 0 },
        ],
        actions: [
          {
            name: "Rename",
            params: [],
            effects: [
              { field: "label", expression: '"world"' },
            ],
          },
        ],
        invariants: [
          {
            name: "Positive",
            description: "count >= 0",
            expression: "m.count >= 0",
            source: "annotation",
            confidence: 1.0,
          },
        ],
        normalization: [],
      };

      const { dafnySource } = await translateIR({
        ir,
        promptPath: PROMPT_PATH,
        templatePath: TEMPLATE_PATH,
        provider: "mock",
      });
      expect(dafnySource).toContain("label: string, count: int");
    });

    it("handles bool type fields", async () => {
      const ir: StateMachineIR = {
        name: "Toggle",
        description: "Simple toggle",
        stateFields: [{ name: "on", type: "bool" }],
        initialValues: [{ field: "on", value: false }],
        actions: [
          {
            name: "TurnOn",
            params: [],
            effects: [{ field: "on", expression: "true" }],
          },
          {
            name: "TurnOff",
            params: [],
            effects: [{ field: "on", expression: "false" }],
          },
        ],
        invariants: [
          {
            name: "AlwaysValid",
            description: "trivially true",
            expression: "true",
            source: "annotation",
            confidence: 1.0,
          },
        ],
        normalization: [],
      };

      const { dafnySource } = await translateIR({
        ir,
        promptPath: PROMPT_PATH,
        templatePath: TEMPLATE_PATH,
        provider: "mock",
      });
      expect(dafnySource).toContain("datatype Model = Model(on: bool)");
      expect(dafnySource).toContain("case TurnOn => Model(true)");
      expect(dafnySource).toContain("case TurnOff => Model(false)");
    });

    it("handles single action with no effects", async () => {
      const ir = makeCounterIR();
      ir.actions = [
        {
          name: "Noop",
          params: [],
          effects: [],
        },
      ];

      const { dafnySource } = await translateIR({
        ir,
        promptPath: PROMPT_PATH,
        templatePath: TEMPLATE_PATH,
        provider: "mock",
      });
      // No effects means all fields preserve: Model(m.value)
      expect(dafnySource).toContain("case Noop => Model(m.value)");
    });

    it("handles action with multiple params", async () => {
      const ir: StateMachineIR = {
        name: "Transfer",
        description: "Transfer with from and to",
        stateFields: [{ name: "balance", type: "int" }],
        initialValues: [{ field: "balance", value: 0 }],
        actions: [
          {
            name: "Transfer",
            params: [
              { name: "amount", type: "int" },
              { name: "fee", type: "int" },
            ],
            effects: [
              {
                field: "balance",
                expression: "m.balance - amount - fee",
              },
            ],
          },
        ],
        invariants: [
          {
            name: "NonNeg",
            description: "non-negative",
            expression: "m.balance >= 0",
            source: "annotation",
            confidence: 1.0,
          },
        ],
        normalization: [],
      };

      const { dafnySource } = await translateIR({
        ir,
        promptPath: PROMPT_PATH,
        templatePath: TEMPLATE_PATH,
        provider: "mock",
      });
      expect(dafnySource).toContain("Transfer(amount: int, fee: int)");
      expect(dafnySource).toContain("case Transfer(..)");
    });

    it("normalization rule on unknown field is skipped", async () => {
      const ir = makeCounterIR();
      ir.normalization = [
        { field: "nonexistent", condition: "true", value: "0" },
      ];

      const { dafnySource } = await translateIR({
        ir,
        promptPath: PROMPT_PATH,
        templatePath: TEMPLATE_PATH,
        provider: "mock",
      });
      // Unknown field is skipped, so normalize returns just m
      expect(dafnySource).toMatch(
        /function Normalize\(m: Model\): Model \{\s*m\s*\}/,
      );
    });

    it("dafnySource is a non-empty string", async () => {
      const result = await translateIR({
        ir: makeCounterIR(),
        promptPath: PROMPT_PATH,
        templatePath: TEMPLATE_PATH,
        provider: "mock",
      });
      expect(typeof result.dafnySource).toBe("string");
      expect(result.dafnySource.length).toBeGreaterThan(0);
    });

    it("requestText is a non-empty string", async () => {
      const result = await translateIR({
        ir: makeCounterIR(),
        promptPath: PROMPT_PATH,
        templatePath: TEMPLATE_PATH,
        provider: "mock",
      });
      expect(typeof result.requestText).toBe("string");
      expect(result.requestText.length).toBeGreaterThan(0);
    });
  });

  // -------------------------------------------------------------------------
  // Mixed parameterized and non-parameterized actions
  // -------------------------------------------------------------------------
  describe("mixed parameterized and non-parameterized actions", () => {
    it("renders both styles correctly", async () => {
      const ir: StateMachineIR = {
        name: "MixedActions",
        description: "Mix of param and no-param actions",
        stateFields: [{ name: "count", type: "int" }],
        initialValues: [{ field: "count", value: 0 }],
        actions: [
          {
            name: "Reset",
            params: [],
            effects: [{ field: "count", expression: "0" }],
          },
          {
            name: "Add",
            params: [{ name: "n", type: "int" }],
            effects: [{ field: "count", expression: "m.count + n" }],
          },
        ],
        invariants: [
          {
            name: "NonNeg",
            description: "non-negative",
            expression: "m.count >= 0",
            source: "annotation",
            confidence: 1.0,
          },
        ],
        normalization: [],
      };

      const { dafnySource } = await translateIR({
        ir,
        promptPath: PROMPT_PATH,
        templatePath: TEMPLATE_PATH,
        provider: "mock",
      });
      expect(dafnySource).toContain(
        "datatype Action = Reset | Add(n: int)",
      );
      expect(dafnySource).toContain("case Reset => Model(0)");
      expect(dafnySource).toContain("case Add(..) => Model(m.count + n)");
    });
  });

  // -------------------------------------------------------------------------
  // Proof cases structure
  // -------------------------------------------------------------------------
  describe("proof cases", () => {
    it("emits assert Inv(Normalize(Apply(m, a))) for each action", async () => {
      const { dafnySource } = await translateIR({
        ir: makeCounterIR(),
        promptPath: PROMPT_PATH,
        templatePath: TEMPLATE_PATH,
        provider: "mock",
      });
      expect(dafnySource).toContain(
        "assert Inv(Normalize(Apply(m, a)))",
      );
    });

    it("has one proof case per action", async () => {
      const { dafnySource } = await translateIR({
        ir: makeCounterIR(),
        promptPath: PROMPT_PATH,
        templatePath: TEMPLATE_PATH,
        provider: "mock",
      });
      // Two actions = two assert lines
      const assertCount = (
        dafnySource.match(/assert Inv\(Normalize\(Apply\(m, a\)\)\)/g) || []
      ).length;
      expect(assertCount).toBe(2);
    });
  });

  // -------------------------------------------------------------------------
  // Ensures/requires in lemmas
  // -------------------------------------------------------------------------
  describe("lemma contracts", () => {
    it("InitSatisfiesInv ensures Inv(Init())", async () => {
      const { dafnySource } = await translateIR({
        ir: makeCounterIR(),
        promptPath: PROMPT_PATH,
        templatePath: TEMPLATE_PATH,
        provider: "mock",
      });
      expect(dafnySource).toContain("ensures Inv(Init())");
    });

    it("StepPreservesInv requires Inv(m)", async () => {
      const { dafnySource } = await translateIR({
        ir: makeCounterIR(),
        promptPath: PROMPT_PATH,
        templatePath: TEMPLATE_PATH,
        provider: "mock",
      });
      expect(dafnySource).toContain("requires Inv(m)");
    });

    it("StepPreservesInv ensures Inv(Normalize(Apply(m, a)))", async () => {
      const { dafnySource } = await translateIR({
        ir: makeCounterIR(),
        promptPath: PROMPT_PATH,
        templatePath: TEMPLATE_PATH,
        provider: "mock",
      });
      expect(dafnySource).toContain(
        "ensures Inv(Normalize(Apply(m, a)))",
      );
    });
  });
});
