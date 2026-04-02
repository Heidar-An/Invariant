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
