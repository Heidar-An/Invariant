# Invariant Demo — Inventory Tracker

This demo shows Invariant catching a real bug via GitHub CI. You push a feature, the CI workflow runs formal verification with Dafny, finds a proof-based bug, and auto-files a GitHub issue with a concrete counterexample.

## Scenario

You're building an inventory management system. The repo starts with `Restock` and `BulkRestock` actions that only add stock — provably safe. During the demo, you push a new `Sell` feature that subtracts stock **without a guard**, allowing stock to go negative.

Invariant catches it automatically with:
- A concrete counterexample: `init(0) → Sell → stock = -5`
- A Dafny proof that the invariant `stock >= 0` cannot hold
- Source replay confirming the bug in the actual TypeScript code
- 83% confidence score → auto-files a GitHub issue

## Repo Setup (do this before the demo)

1. Create a new GitHub repo (e.g. `invariant-demo`)

2. Push this entire Invariant project to that repo

3. In the repo's GitHub Settings → Secrets, add:
   - `ANTHROPIC_API_KEY` — needed for LLM-based translation (optional; the tool falls back to a deterministic mock translator without it)

4. Make sure `invariant.config.ts` has `defaultSourceFile` pointing at the demo reducer:
   ```typescript
   defaultSourceFile: "demo/inventory.reducer.ts",
   ```

5. Make sure `demo/inventory.reducer.ts` is the **base (safe) version** — only `Restock(+1)` and `BulkRestock(+10)`.

6. Push to main. CI should run and pass (`verification_status: verified`). Confirm this before the demo.

## Demo Flow

### Step 1: Show the base code passes (already done in setup)

Show the audience:
- The green CI check on the repo
- The `demo/inventory.reducer.ts` file with its invariant: `m.value >= 0`
- Explain: "This reducer only adds stock, so the invariant trivially holds."

### Step 2: Push the buggy feature (FAILS)

Edit `demo/inventory.reducer.ts` to add the `Sell` action. Replace the file contents with:

```typescript
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
```

Commit and push:

```bash
git add demo/inventory.reducer.ts
git commit -m "feat: add Sell action for order fulfillment"
git push
```

CI will **fail**. Show the audience:
- The red CI check
- The CI artifacts: download and open `proof-graph.html` for the interactive state machine visualization
- The auto-filed GitHub issue with the counterexample trace:
  - **Trace**: `init → Sell` (stock goes from 0 to -5)
  - **Replay**: confirmed-violation
  - **Confidence**: 83%

### Step 3: Fix the bug and push (PASSES)

Edit `demo/inventory.reducer.ts` — change the `Sell` case to:

```typescript
    case "Sell":
      return state;  // Safe: records intent, actual deduction via guarded workflow
```

Commit and push:

```bash
git add demo/inventory.reducer.ts
git commit -m "fix: make Sell a safe no-op until guard logic is added"
git push
```

CI will **pass**. Show the audience:
- The green CI check
- The verification is formally proven safe by Dafny

## Running Locally (backup if CI is slow)

If you want to show results instantly without waiting for CI:

```bash
# Base (passes)
INVARIANT_SOURCE_FILE=demo/inventory.reducer.ts \
INVARIANT_OUTPUT_DIR=artifacts/demo-base \
npm run verify:local

# Buggy (fails — copy buggy version first)
cp demo/inventory-buggy.reducer.ts demo/inventory.reducer.ts
INVARIANT_SOURCE_FILE=demo/inventory.reducer.ts \
INVARIANT_OUTPUT_DIR=artifacts/demo-buggy \
npm run verify:local

# Fixed (passes — copy fixed version)
cp demo/inventory-fixed.reducer.ts demo/inventory.reducer.ts
INVARIANT_SOURCE_FILE=demo/inventory.reducer.ts \
INVARIANT_OUTPUT_DIR=artifacts/demo-fixed \
npm run verify:local

# Reset
git checkout demo/inventory.reducer.ts
```

Open `artifacts/demo-buggy/proof-graph.html` for the interactive visualization.
Open `artifacts/demo-buggy/proof-summary.md` for the full report.

## Reference Files

| File | Purpose |
|------|---------|
| `demo/inventory.reducer.ts` | **The file you edit during the demo** — starts safe |
| `demo/inventory-buggy.reducer.ts` | Reference: the buggy version (copy-paste source for Step 2) |
| `demo/inventory-fixed.reducer.ts` | Reference: the fixed version (copy-paste source for Step 3) |

## What Invariant Does Behind the Scenes

1. **Discovery** — Parses the TypeScript reducer, extracts state fields, actions, and invariants
2. **Translation** — Converts to a Dafny proof module with `Init`, `Apply`, and `Inv` predicates
3. **Bounded Search** — BFS over action sequences to find concrete counterexamples
4. **Dafny Verification** — Z3 solver proves (or disproves) that the invariant holds for ALL states
5. **Source Replay** — Replays the counterexample against actual TypeScript to confirm the bug
6. **Confidence Scoring** — Combines 5 signals (invariant source, search coverage, translation quality, solver agreement, replay confirmation)
7. **Issue Filing** — Auto-files a GitHub issue with the full proof summary, counterexample trace, and confidence breakdown
