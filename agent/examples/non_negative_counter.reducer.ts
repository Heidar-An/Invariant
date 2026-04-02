export const machineName = "NonNegativeCounter";

export const machineDescription = "A tiny reducer-style state machine for the Phase 2 discovery slice.";

export const initialState = {
  value: 0,
};

export const invariants = [
  {
    name: "ValueNeverNegative",
    description: "The counter must never go below zero.",
    expression: "m.value >= 0",
  },
] as const;

export type CounterAction =
  | { type: "Increment" }
  | { type: "Decrement" };

export function reducer(state: typeof initialState, action: CounterAction) {
  switch (action.type) {
    case "Increment":
      return { value: state.value + 1 };
    case "Decrement":
      return { value: state.value - 1 };
    default:
      return state;
  }
}
