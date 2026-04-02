/**
 * Invariant IR — the typed intermediate representation that sits between
 * source-language discovery and Dafny generation.
 *
 * Design goals:
 *   1. Language-agnostic: nothing here ties to JS/TS syntax.
 *   2. Serializable: the whole IR round-trips through JSON so CI artifacts
 *      can snapshot it.
 *   3. Sufficient for Dafny: every field maps directly to a Dafny construct
 *      so the translator never needs to "guess."
 */

// ---------------------------------------------------------------------------
// Primitive field types the IR understands.  Keep this set small — every new
// type must have a known Dafny mapping.
// ---------------------------------------------------------------------------

export type FieldType = "int" | "bool" | "string";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export type StateField = {
  name: string;
  type: FieldType;
  description?: string;
};

export type InitialValue = {
  field: string;
  value: number | boolean | string;
};

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export type ActionParam = {
  name: string;
  type: FieldType;
};

/**
 * A single transition expression describes how one state field changes when
 * this action fires.  `expression` is a string in a minimal infix language
 * that the Dafny emitter can translate 1-to-1:
 *
 *   "m.value + delta"
 *   "true"
 *   "if m.balance - amount < 0 then 0 else m.balance - amount"
 */
export type TransitionEffect = {
  field: string;
  expression: string;
};

export type Action = {
  name: string;
  description?: string;
  params: ActionParam[];
  effects: TransitionEffect[];
};

// ---------------------------------------------------------------------------
// Invariants
// ---------------------------------------------------------------------------

export type InvariantSource = "annotation" | "file" | "llm";

export type Invariant = {
  name: string;
  description: string;
  /** Boolean expression over `m: Model` in the same infix language. */
  expression: string;
  source: InvariantSource;
  /** Confidence 0–1 assigned by the proposer (1.0 for human-written). */
  confidence: number;
};

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

/**
 * A normalization rule clamps or adjusts a field after every transition.
 * `condition` is a boolean expression; when true, `field` is set to `value`.
 */
export type NormalizationRule = {
  field: string;
  condition: string;
  value: string;
};

// ---------------------------------------------------------------------------
// Top-level IR
// ---------------------------------------------------------------------------

export type StateMachineIR = {
  name: string;
  description: string;
  /** Original source file path (relative), set by discovery. */
  sourceFile?: string;
  /** Discovery pattern that produced this IR, if any. */
  discoveryPattern?: string;
  stateFields: StateField[];
  initialValues: InitialValue[];
  actions: Action[];
  invariants: Invariant[];
  normalization: NormalizationRule[];
};

// ---------------------------------------------------------------------------
// Person A's discovery output types (kept for discovery module compat)
// ---------------------------------------------------------------------------

export type StateMachineAction = {
  name: string;
  delta: number;
  description?: string;
};

export type StateMachineInvariant = {
  name: string;
  description: string;
  expression: string;
};

export type StateMachineSchema = {
  name: string;
  description: string;
  sourceFile: string;
  discoveryPattern: "single-field-switch-reducer";
  initialState: {
    value: number;
  };
  actions: StateMachineAction[];
  invariants: StateMachineInvariant[];
};

export function validateStateMachineSchema(machine: StateMachineSchema): void {
  if (!machine.name.trim()) {
    throw new Error("Machine name is required.");
  }

  if (!machine.description.trim()) {
    throw new Error("Machine description is required.");
  }

  if (!machine.sourceFile.trim()) {
    throw new Error("Source file is required.");
  }

  if (machine.actions.length === 0) {
    throw new Error("At least one action is required.");
  }

  if (machine.invariants.length === 0) {
    throw new Error("At least one invariant is required.");
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function validateIR(ir: StateMachineIR): string[] {
  const errors: string[] = [];
  const fieldNames = new Set(ir.stateFields.map((f) => f.name));

  if (!ir.name.trim()) {
    errors.push("Machine name is required.");
  }

  if (ir.stateFields.length === 0) {
    errors.push("At least one state field is required.");
  }

  for (const init of ir.initialValues) {
    if (!fieldNames.has(init.field)) {
      errors.push(`Initial value references unknown field "${init.field}".`);
    }
  }

  for (const field of ir.stateFields) {
    if (!ir.initialValues.some((iv) => iv.field === field.name)) {
      errors.push(`State field "${field.name}" has no initial value.`);
    }
  }

  if (ir.actions.length === 0) {
    errors.push("At least one action is required.");
  }

  for (const action of ir.actions) {
    for (const effect of action.effects) {
      if (!fieldNames.has(effect.field)) {
        errors.push(
          `Action "${action.name}" has effect on unknown field "${effect.field}".`,
        );
      }
    }
  }

  if (ir.invariants.length === 0) {
    errors.push("At least one invariant is required.");
  }

  for (const rule of ir.normalization) {
    if (!fieldNames.has(rule.field)) {
      errors.push(
        `Normalization rule references unknown field "${rule.field}".`,
      );
    }
  }

  return errors;
}

/**
 * Convert Person A's discovery output (StateMachineSchema) into the
 * canonical IR so the rest of the pipeline works uniformly.
 */
export function fromDiscoverySchema(schema: StateMachineSchema): StateMachineIR {
  return {
    name: schema.name,
    description: schema.description,
    sourceFile: schema.sourceFile,
    discoveryPattern: schema.discoveryPattern,
    stateFields: [{ name: "value", type: "int" }],
    initialValues: [{ field: "value", value: schema.initialState.value }],
    actions: schema.actions.map((a) => ({
      name: a.name,
      description: a.description,
      params: [],
      effects: [
        {
          field: "value",
          expression:
            a.delta >= 0
              ? `m.value + ${a.delta}`
              : `m.value - ${Math.abs(a.delta)}`,
        },
      ],
    })),
    invariants: schema.invariants.map((inv) => ({
      name: inv.name,
      description: inv.description,
      expression: inv.expression,
      source: "annotation" as const,
      confidence: 1.0,
    })),
    normalization: [],
  };
}

/**
 * Convert a Phase 1 sample machine JSON into the new IR so the old format
 * keeps working during migration.
 */
export function fromLegacyMachine(legacy: {
  name: string;
  description: string;
  initialState: { value: number };
  actions: { name: string; delta: number; description?: string }[];
  invariants: { name: string; description: string; expression: string }[];
}): StateMachineIR {
  return {
    name: legacy.name,
    description: legacy.description,
    stateFields: [{ name: "value", type: "int" }],
    initialValues: [{ field: "value", value: legacy.initialState.value }],
    actions: legacy.actions.map((a) => ({
      name: a.name,
      description: a.description,
      params: [],
      effects: [
        {
          field: "value",
          expression:
            a.delta >= 0
              ? `m.value + ${a.delta}`
              : `m.value - ${Math.abs(a.delta)}`,
        },
      ],
    })),
    invariants: legacy.invariants.map((inv) => ({
      name: inv.name,
      description: inv.description,
      expression: inv.expression,
      source: "annotation" as const,
      confidence: 1.0,
    })),
    normalization: [],
  };
}
