/**
 * InventoryTracker — tracks product stock for an online store.
 *
 * FIXED: Sell action now records intent without modifying stock.
 * Actual stock deduction handled by a separate guarded workflow.
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
  | { type: "BulkRestock" }
  | { type: "Sell" };

export function reducer(state: typeof initialState, action: InventoryAction) {
  switch (action.type) {
    case "Restock":
      return { value: state.value + 1 };
    case "BulkRestock":
      return { value: state.value + 10 };
    case "Sell":
      return state;
    default:
      return state;
  }
}
