/**
 * InventoryTracker — tracks product stock for an online store.
 *
 * Base version: restocking only (fulfillment not yet implemented).
 * Invariant: stock must never go negative.
 */

export const machineName = "InventoryTracker";

export const machineDescription =
  "Tracks product stock levels for an online store.";

export const initialState = {
  value: 0,
};

export const invariants = [
  {
    name: "StockNeverNegative",
    description: "Stock level must never drop below zero.",
    expression: "m.value >= 0",
  },
] as const;

export type InventoryAction =
  | { type: "Restock" }
  | { type: "BulkRestock" };

export function reducer(state: typeof initialState, action: InventoryAction) {
  switch (action.type) {
    case "Restock":
      return { value: state.value + 1 };
    case "BulkRestock":
      return { value: state.value + 10 };
    default:
      return state;
  }
}
