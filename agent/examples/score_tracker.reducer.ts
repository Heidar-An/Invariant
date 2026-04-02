/**
 * ScoreTracker — a pilot reducer for B5 verification.
 *
 * Models a game score that can increase or decrease by various amounts.
 * Exercises multiple actions with different deltas and multiple invariants
 * with varying proof difficulty.
 *
 * Invariants:
 *   - ScoreNeverNegative: should hold if the game prevents overspending,
 *     but the reducer does NOT guard against it — violation expected.
 *   - ScoreWithinBounds: score <= 1000 — unreachable within small bounded
 *     search depths, requires deeper exploration.
 */

export const machineName = "ScoreTracker";

export const machineDescription =
  "A game score tracker with multiple gain/loss actions and competing invariants.";

export const initialState = {
  value: 0,
};

export const invariants = [
  {
    name: "ScoreNeverNegative",
    description: "The score must never drop below zero.",
    expression: "m.value >= 0",
  },
  {
    name: "ScoreWithinBounds",
    description: "The score must stay at or below 1000.",
    expression: "m.value <= 1000",
  },
] as const;

export type ScoreAction =
  | { type: "GainSmall" }
  | { type: "GainBig" }
  | { type: "LoseSmall" }
  | { type: "LoseBig" };

export function reducer(state: typeof initialState, action: ScoreAction) {
  switch (action.type) {
    case "GainSmall":
      return { value: state.value + 1 };
    case "GainBig":
      return { value: state.value + 10 };
    case "LoseSmall":
      return { value: state.value - 1 };
    case "LoseBig":
      return { value: state.value - 5 };
    default:
      return state;
  }
}
