/**
 * InventoryTracker — tracks product stock for an online store.
 *
 * NEW FEATURE: Added Sell action for order fulfillment.
 * BUG: Sell subtracts 5 units with no guard — starting from
 *      stock=0, a single Sell drops stock to -5!
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
      return { value: state.value - 5 };
    default:
      return state;
  }
}
