import { describe, it, expect } from "vitest";
import {
  validateIR,
  fromDiscoverySchema,
  fromLegacyMachine,
  validateStateMachineSchema,
  type StateMachineIR,
  type StateMachineSchema,
} from "./state-machine-schema.js";

// ---------------------------------------------------------------------------
// Helpers — minimal valid objects to build from
// ---------------------------------------------------------------------------

function validIR(overrides: Partial<StateMachineIR> = {}): StateMachineIR {
  return {
    name: "counter",
    description: "A simple counter",
    stateFields: [{ name: "value", type: "int" }],
    initialValues: [{ field: "value", value: 0 }],
    actions: [
      {
        name: "increment",
        params: [],
        effects: [{ field: "value", expression: "m.value + 1" }],
      },
    ],
    invariants: [
      {
        name: "non-negative",
        description: "value >= 0",
        expression: "m.value >= 0",
        source: "annotation",
        confidence: 1.0,
      },
    ],
    normalization: [],
    ...overrides,
  };
}

function validSchema(
  overrides: Partial<StateMachineSchema> = {},
): StateMachineSchema {
  return {
    name: "counter",
    description: "A simple counter",
    sourceFile: "src/counter.ts",
    discoveryPattern: "single-field-switch-reducer",
    initialState: { value: 0 },
    actions: [{ name: "increment", delta: 1 }],
    invariants: [
      {
        name: "non-negative",
        description: "value >= 0",
        expression: "m.value >= 0",
      },
    ],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// validateIR
// ---------------------------------------------------------------------------

describe("validateIR", () => {
  it("returns empty array for valid IR", () => {
    expect(validateIR(validIR())).toEqual([]);
  });

  it("reports error when name is empty", () => {
    const errors = validateIR(validIR({ name: "  " }));
    expect(errors).toContain("Machine name is required.");
  });

  it("reports error when there are no state fields", () => {
    const errors = validateIR(
      validIR({ stateFields: [], initialValues: [] }),
    );
    expect(errors).toContain("At least one state field is required.");
  });

  it("reports error when initial value references unknown field", () => {
    const errors = validateIR(
      validIR({
        initialValues: [
          { field: "value", value: 0 },
          { field: "nonexistent", value: 42 },
        ],
      }),
    );
    expect(errors).toContain(
      'Initial value references unknown field "nonexistent".',
    );
  });

  it("reports error when a state field has no initial value", () => {
    const errors = validateIR(
      validIR({
        stateFields: [
          { name: "value", type: "int" },
          { name: "flag", type: "bool" },
        ],
        initialValues: [{ field: "value", value: 0 }],
      }),
    );
    expect(errors).toContain('State field "flag" has no initial value.');
  });

  it("reports error when there are no actions", () => {
    const errors = validateIR(validIR({ actions: [] }));
    expect(errors).toContain("At least one action is required.");
  });

  it("reports error when an action effect references unknown field", () => {
    const errors = validateIR(
      validIR({
        actions: [
          {
            name: "bad-action",
            params: [],
            effects: [{ field: "missing", expression: "m.missing + 1" }],
          },
        ],
      }),
    );
    expect(errors).toContain(
      'Action "bad-action" has effect on unknown field "missing".',
    );
  });

  it("reports error when there are no invariants", () => {
    const errors = validateIR(validIR({ invariants: [] }));
    expect(errors).toContain("At least one invariant is required.");
  });

  it("reports error when normalization rule references unknown field", () => {
    const errors = validateIR(
      validIR({
        normalization: [
          { field: "ghost", condition: "m.ghost < 0", value: "0" },
        ],
      }),
    );
    expect(errors).toContain(
      'Normalization rule references unknown field "ghost".',
    );
  });

  it("returns multiple errors at once", () => {
    const errors = validateIR(
      validIR({
        name: "",
        stateFields: [],
        initialValues: [],
        actions: [],
        invariants: [],
      }),
    );
    expect(errors.length).toBeGreaterThanOrEqual(4);
    expect(errors).toContain("Machine name is required.");
    expect(errors).toContain("At least one state field is required.");
    expect(errors).toContain("At least one action is required.");
    expect(errors).toContain("At least one invariant is required.");
  });

  it("validates IR with multiple state fields (int + bool)", () => {
    const ir = validIR({
      stateFields: [
        { name: "value", type: "int" },
        { name: "active", type: "bool" },
      ],
      initialValues: [
        { field: "value", value: 0 },
        { field: "active", value: true },
      ],
      actions: [
        {
          name: "activate",
          params: [],
          effects: [{ field: "active", expression: "true" }],
        },
      ],
    });
    expect(validateIR(ir)).toEqual([]);
  });

  it("validates IR with parameterized actions", () => {
    const ir = validIR({
      actions: [
        {
          name: "add",
          params: [{ name: "amount", type: "int" }],
          effects: [{ field: "value", expression: "m.value + amount" }],
        },
      ],
    });
    expect(validateIR(ir)).toEqual([]);
  });

  it("accepts normalization rule that references a known field", () => {
    const ir = validIR({
      normalization: [
        { field: "value", condition: "m.value < 0", value: "0" },
      ],
    });
    expect(validateIR(ir)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// fromDiscoverySchema
// ---------------------------------------------------------------------------

describe("fromDiscoverySchema", () => {
  it("converts name, description, sourceFile, and discoveryPattern", () => {
    const ir = fromDiscoverySchema(validSchema());
    expect(ir.name).toBe("counter");
    expect(ir.description).toBe("A simple counter");
    expect(ir.sourceFile).toBe("src/counter.ts");
    expect(ir.discoveryPattern).toBe("single-field-switch-reducer");
  });

  it("creates a single 'value' state field with type 'int'", () => {
    const ir = fromDiscoverySchema(validSchema());
    expect(ir.stateFields).toEqual([{ name: "value", type: "int" }]);
  });

  it("preserves the initial value from the schema", () => {
    const ir = fromDiscoverySchema(
      validSchema({ initialState: { value: 42 } }),
    );
    expect(ir.initialValues).toEqual([{ field: "value", value: 42 }]);
  });

  it("converts positive delta to 'm.value + N' expression", () => {
    const ir = fromDiscoverySchema(
      validSchema({ actions: [{ name: "inc", delta: 5 }] }),
    );
    expect(ir.actions[0].effects[0].expression).toBe("m.value + 5");
  });

  it("converts negative delta to 'm.value - N' expression", () => {
    const ir = fromDiscoverySchema(
      validSchema({ actions: [{ name: "dec", delta: -3 }] }),
    );
    expect(ir.actions[0].effects[0].expression).toBe("m.value - 3");
  });

  it("converts zero delta to 'm.value + 0' expression", () => {
    const ir = fromDiscoverySchema(
      validSchema({ actions: [{ name: "noop", delta: 0 }] }),
    );
    expect(ir.actions[0].effects[0].expression).toBe("m.value + 0");
  });

  it("sets invariant source to 'annotation' and confidence to 1.0", () => {
    const ir = fromDiscoverySchema(validSchema());
    for (const inv of ir.invariants) {
      expect(inv.source).toBe("annotation");
      expect(inv.confidence).toBe(1.0);
    }
  });

  it("includes default normalization rule (m.value < 0 → 0)", () => {
    const ir = fromDiscoverySchema(validSchema());
    expect(ir.normalization).toEqual([
      { field: "value", condition: "m.value < 0", value: "0" },
    ]);
  });

  it("converts multiple actions correctly", () => {
    const ir = fromDiscoverySchema(
      validSchema({
        actions: [
          { name: "increment", delta: 1 },
          { name: "decrement", delta: -1 },
          { name: "add-five", delta: 5, description: "Add 5" },
        ],
      }),
    );
    expect(ir.actions).toHaveLength(3);
    expect(ir.actions[0].name).toBe("increment");
    expect(ir.actions[0].effects[0].expression).toBe("m.value + 1");
    expect(ir.actions[1].name).toBe("decrement");
    expect(ir.actions[1].effects[0].expression).toBe("m.value - 1");
    expect(ir.actions[2].name).toBe("add-five");
    expect(ir.actions[2].description).toBe("Add 5");
    expect(ir.actions[2].effects[0].expression).toBe("m.value + 5");
  });

  it("converts multiple invariants correctly", () => {
    const ir = fromDiscoverySchema(
      validSchema({
        invariants: [
          {
            name: "non-negative",
            description: "value >= 0",
            expression: "m.value >= 0",
          },
          {
            name: "bounded",
            description: "value <= 100",
            expression: "m.value <= 100",
          },
        ],
      }),
    );
    expect(ir.invariants).toHaveLength(2);
    expect(ir.invariants[0].name).toBe("non-negative");
    expect(ir.invariants[0].expression).toBe("m.value >= 0");
    expect(ir.invariants[1].name).toBe("bounded");
    expect(ir.invariants[1].expression).toBe("m.value <= 100");
  });

  it("produces valid IR (passes validateIR)", () => {
    const ir = fromDiscoverySchema(validSchema());
    expect(validateIR(ir)).toEqual([]);
  });

  it("sets empty params array on each action", () => {
    const ir = fromDiscoverySchema(
      validSchema({
        actions: [{ name: "inc", delta: 1 }],
      }),
    );
    expect(ir.actions[0].params).toEqual([]);
  });

  it("maps action effects to the 'value' field", () => {
    const ir = fromDiscoverySchema(validSchema());
    for (const action of ir.actions) {
      for (const effect of action.effects) {
        expect(effect.field).toBe("value");
      }
    }
  });
});

// ---------------------------------------------------------------------------
// fromLegacyMachine
// ---------------------------------------------------------------------------

describe("fromLegacyMachine", () => {
  const validLegacy = {
    name: "legacy-counter",
    description: "A legacy counter",
    initialState: { value: 10 },
    actions: [
      { name: "increment", delta: 1 },
      { name: "decrement", delta: -2 },
    ],
    invariants: [
      {
        name: "non-negative",
        description: "value >= 0",
        expression: "m.value >= 0",
      },
    ],
  };

  it("converts name and description", () => {
    const ir = fromLegacyMachine(validLegacy);
    expect(ir.name).toBe("legacy-counter");
    expect(ir.description).toBe("A legacy counter");
  });

  it("does not set sourceFile or discoveryPattern", () => {
    const ir = fromLegacyMachine(validLegacy);
    expect(ir.sourceFile).toBeUndefined();
    expect(ir.discoveryPattern).toBeUndefined();
  });

  it("preserves the initial value", () => {
    const ir = fromLegacyMachine(validLegacy);
    expect(ir.initialValues).toEqual([{ field: "value", value: 10 }]);
  });

  it("converts positive delta correctly", () => {
    const ir = fromLegacyMachine(validLegacy);
    const inc = ir.actions.find((a) => a.name === "increment")!;
    expect(inc.effects[0].expression).toBe("m.value + 1");
  });

  it("converts negative delta correctly", () => {
    const ir = fromLegacyMachine(validLegacy);
    const dec = ir.actions.find((a) => a.name === "decrement")!;
    expect(dec.effects[0].expression).toBe("m.value - 2");
  });

  it("converts invariants with source 'annotation' and confidence 1.0", () => {
    const ir = fromLegacyMachine(validLegacy);
    expect(ir.invariants[0].source).toBe("annotation");
    expect(ir.invariants[0].confidence).toBe(1.0);
    expect(ir.invariants[0].expression).toBe("m.value >= 0");
  });

  it("creates a single 'value' state field with type 'int'", () => {
    const ir = fromLegacyMachine(validLegacy);
    expect(ir.stateFields).toEqual([{ name: "value", type: "int" }]);
  });

  it("includes default normalization rule", () => {
    const ir = fromLegacyMachine(validLegacy);
    expect(ir.normalization).toEqual([
      { field: "value", condition: "m.value < 0", value: "0" },
    ]);
  });

  it("produces valid IR (passes validateIR)", () => {
    const ir = fromLegacyMachine(validLegacy);
    expect(validateIR(ir)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// validateStateMachineSchema
// ---------------------------------------------------------------------------

describe("validateStateMachineSchema", () => {
  it("does not throw for a valid schema", () => {
    expect(() => validateStateMachineSchema(validSchema())).not.toThrow();
  });

  it("throws when name is empty", () => {
    expect(() =>
      validateStateMachineSchema(validSchema({ name: "  " })),
    ).toThrow("Machine name is required.");
  });

  it("throws when description is empty", () => {
    expect(() =>
      validateStateMachineSchema(validSchema({ description: "" })),
    ).toThrow("Machine description is required.");
  });

  it("throws when sourceFile is empty", () => {
    expect(() =>
      validateStateMachineSchema(validSchema({ sourceFile: "   " })),
    ).toThrow("Source file is required.");
  });

  it("throws when there are no actions", () => {
    expect(() =>
      validateStateMachineSchema(validSchema({ actions: [] })),
    ).toThrow("At least one action is required.");
  });

  it("throws when there are no invariants", () => {
    expect(() =>
      validateStateMachineSchema(validSchema({ invariants: [] })),
    ).toThrow("At least one invariant is required.");
  });
});
