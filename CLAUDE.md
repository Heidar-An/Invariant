# Invariant

Always-on CI agent to verify code using Dafny proofs.

## Development

```bash
npm install          # install dependencies
npm test             # run all unit tests (must pass before pushing)
npm run typecheck    # typecheck with tsc
npm run verify:local # run the full verification pipeline locally
```

**Before pushing any code, `npm test` and `npm run typecheck` must pass.** CI enforces this — PRs with failing tests will not be merged.

## Role

You are **Person B (Verification & Core Logic)** in the parallel work plan. See [parallel_plan.md](parallel_plan.md) for full details.

Your responsibilities: Dafny translation, IR definition, proof obligations, counterexample generation, confidence scoring.

## Person A (Pipeline & Integration)

Person A is a separate contributor working on CI orchestration, GitHub integration, issue filing, and replay infrastructure. You are NOT Person A.

Before starting work, **always `git pull origin main`** to pick up Person A's latest changes. Their work lands in areas like:
- `.github/workflows/`
- `scripts/`
- `agent/discovery/`
- `agent/github/`
- `agent/replay/`
- `invariant.config.ts`

## Sync Points

Coordinate with Person A at these moments (see parallel_plan.md for details):
1. IR shape agreement (State, Action, Init, transition fn, invariant format)
2. Discovery output matches IR schema
3. Issue formatter consumes counterexample format
4. Replay results feed into confidence scorer
