# Parallel Work Plan

Two-person split of the CI verifier agent build. After a brief kickoff alignment on the IR shape, the pipeline/integration track and the verification/core-logic track run mostly in parallel.

## Strategic Pivot: LLM-Based Discovery

**We are shifting from AST-based discovery to LLM-powered discovery.** The original approach used rigid TypeScript AST parsing to extract state machines, which only worked for a single narrow reducer pattern. This fundamentally limited the tool to code written in a specific shape.

The new approach: **feed arbitrary TypeScript source files to Claude, which reads the code and outputs the IR directly.** This means:

- The tool works with **any TypeScript** that has stateful logic — classes, Redux stores, Zustand slices, React useReducer, Express handlers, plain objects with methods, etc.
- The existing AST-based discovery remains as a fast/free fallback for code that fits the reducer pattern.
- The IR schema, Dafny translation, bounded search, and everything downstream stays the same.
- Discovery becomes a prompt + API call instead of a brittle parser.

**Tradeoffs:** LLM discovery costs an API call per file, may misidentify state/transitions (so user review of the IR is important), and some code genuinely isn't a state machine (the LLM should say so). But the massive gain in scope is worth it.

## Current Status

Completed so far:

- Phase 1 vertical slice is implemented.
- CI workflow exists at [.github/workflows/verify-state.yml](.github/workflows/verify-state.yml) and triggers on `push` and `pull_request`.
- Local orchestration exists at [scripts/run-local-verifier.ts](scripts/run-local-verifier.ts).
- A reducer-style source example exists at [agent/examples/non_negative_counter.reducer.ts](agent/examples/non_negative_counter.reducer.ts).
- A formal IR schema exists at [agent/contracts/state-machine-schema.ts](agent/contracts/state-machine-schema.ts).
- AST-based discovery exists at [agent/discovery/discover-state-machine.ts](agent/discovery/discover-state-machine.ts) for the reducer pattern (retained as fallback).
- The translator contract exists at [agent/prompts/translator.prompt.txt](agent/prompts/translator.prompt.txt).
- A reusable Dafny template exists at [agent/dafny/state_machine.template.dfy](agent/dafny/state_machine.template.dfy).
- CI installs Node, .NET, Z3, and Dafny, runs the verifier, and uploads artifacts.
- The live LLM hook is wired for Claude via `ANTHROPIC_API_KEY`, with deterministic mock fallback when the key is absent.
- The translator LLM is **Claude Sonnet 4.5** (`claude-sonnet-4-5`). All LLM-driven translation (source → IR → Dafny) uses this model.
- The verifier now runs `source code → discovered schema → canonical IR → Dafny` for the initial example.
- LLM-based discovery now exists at [agent/discovery/llm-discovery.ts](agent/discovery/llm-discovery.ts), with AST fallback still retained in [agent/discovery/discover-state-machine.ts](agent/discovery/discover-state-machine.ts).
- LLM-generated IR review gating is now wired into [scripts/run-local-verifier.ts](scripts/run-local-verifier.ts), with discovery artifacts written for inspection before approval.
- Invariant enrichment is in place: annotation, file-based (`.invariants.json`), and LLM-proposed sources.
- The IR-to-Dafny translator exists at [agent/translator/ir-to-dafny.ts](agent/translator/ir-to-dafny.ts) with mock and Claude paths.
- GitHub issue drafting and posting now exist for current verification failures, with fingerprint-based deduplication and `needs-human-triage` labeling.
- Counterexample-driven findings from B3 are wired into the report pipeline and available for issue filing.
- Graph visualization now exists at [agent/visualize/graph.ts](agent/visualize/graph.ts) — generates `proof-graph.html` with interactive Mermaid.js diagrams of the state machine structure and counterexample traces.
- Source-language replay now exists at [agent/replay/source-replay.ts](agent/replay/source-replay.ts), with a local entrypoint at [scripts/run-source-replay.ts](scripts/run-source-replay.ts).
- Source-language replay now consumes B3 counterexample traces directly, emits [artifacts/phase2/source-replay-results.json](artifacts/phase2/source-replay-results.json), and attaches replay results to report findings.
- Repo-local configuration now exists at [invariant.config.ts](invariant.config.ts), and the verifier/replay/issue-posting scripts now consume it.

Not done yet:

- The new LLM discovery path still needs real-world prompt calibration on non-sample modules.
- CI hardening, metrics, and snapshot/golden verification coverage are still pending.
- Pilot validation now exists, but broader rollout beyond the sample/pilot modules is still ahead.

## Person A — Pipeline & Integration

Owns: CI orchestration, GitHub integration, issue filing, replay infrastructure.

### A1: CI Workflow & Orchestration (Phase 1 partial)

- Status: completed for the Phase 1 sample pipeline.
- Done: built [.github/workflows/verify-state.yml](.github/workflows/verify-state.yml) to trigger on `push` and `pull_request`.
- Done: built [scripts/run-local-verifier.ts](scripts/run-local-verifier.ts) to orchestrate discovery, translation, `dafny verify`, and artifact capture.
- Done: configured artifact upload from CI for generated Dafny and raw verifier output.
- Done: swapped sample-machine loading for discovered IR from source.

### A2: State Logic Discovery (Phase 2 — pivoting to LLM)

- Status: completed for the first LLM-based discovery path, with AST fallback retained.
- Done: built [agent/discovery/discover-state-machine.ts](agent/discovery/discover-state-machine.ts) to extract one supported reducer/action pattern from source (retained as fast fallback).
- Done: wired discovery output into [agent/contracts/state-machine-schema.ts](agent/contracts/state-machine-schema.ts).
- Done: unsupported source shapes now fail with file/line-specific error messages.
- Done: built [agent/discovery/llm-discovery.ts](agent/discovery/llm-discovery.ts) and [agent/prompts/discovery.prompt.txt](agent/prompts/discovery.prompt.txt) so Claude can read arbitrary TypeScript and return `StateMachineIR` directly.
- Done: wired discovery selection into [scripts/run-local-verifier.ts](scripts/run-local-verifier.ts) so the verifier prefers Claude discovery when configured and falls back to the reducer AST path when needed.
- Done: added a review/confirmation gate for LLM-generated IR, with discovery request/response artifacts written before verification proceeds.
- Remaining: calibrate the prompt against real stateful modules beyond the sample reducer and tighten the "not a state machine" decision boundary.

### A3: GitHub Issue Filing (Phase 4)

- Status: completed for current verifier failures, with richer issue content pending future counterexample output.
- Done: built [agent/github/issue-template.ts](agent/github/issue-template.ts) for title/body generation.
- Done: built [agent/github/post-issue.ts](agent/github/post-issue.ts) using `GITHUB_TOKEN` in Actions.
- Done: built [agent/reports/proof-summary.ts](agent/reports/proof-summary.ts) to summarize verified/failed obligations.
- Done: implemented fingerprint-based deduplication, using invariant + normalized trace when available and a safe fallback fingerprint otherwise.
- Done: issues are labeled `needs-human-triage` until source replay confirms the failure.
- Done: wired issue posting into [.github/workflows/verify-state.yml](.github/workflows/verify-state.yml) for `push` runs.
- Remaining: enrich issue bodies with real counterexample traces (B3 is now implemented — `VerificationFinding` with `kind: "counterexample"` is available).
- **Depends on:** B3 counterexample output format (now available).

### A4: Source-Language Replay (Phase 5 partial)

- Status: completed end-to-end for B3 counterexample traces.
- Done: built [agent/replay/source-replay.ts](agent/replay/source-replay.ts) to execute counterexample traces against the original reducer/state module.
- Done: built [scripts/run-source-replay.ts](scripts/run-source-replay.ts) as a local/CI entrypoint for replay artifacts.
- Done: replay emits structured status, invariant evaluations, step-by-step before/after state, and trace metadata for B's confidence scorer.
- Done: added direct conversion from B3 bounded-search traces into replay input, including param-bearing actions, normalized traces, and expected before/after states.
- Done: [scripts/run-local-verifier.ts](scripts/run-local-verifier.ts) now replays B3 counterexamples automatically and attaches `sourceReplay` results onto the emitted findings.
- Done: proof summaries and issue drafts now surface attached source replay results through the enriched report pipeline.
- **Depends on:** completed. B4 is the next consumer of replay results.

### A5: Repo Config & Rollout (Phase 6 partial)

- Status: completed for config scaffolding and rollout policy definition; pilot adoption still depends on B5 and a production-relevant target module.
- Done: built [invariant.config.ts](invariant.config.ts) for repo-local configuration covering target files, invariants to enforce, action-depth bounds, translator defaults, and issue filing policy.
- Done: built [agent/config/](agent/config/) loaders/schema so repo config resolves consistently across verifier, replay, and issue-posting scripts.
- Done: [scripts/run-local-verifier.ts](scripts/run-local-verifier.ts) now uses repo config for target selection, invariant enforcement, artifact paths, and invariant proposal defaults.
- Done: [scripts/run-source-replay.ts](scripts/run-source-replay.ts) now enforces per-target replay depth bounds from repo config.
- Done: [agent/github/post-issue.ts](agent/github/post-issue.ts) now reads per-target issue filing mode from repo config, while preserving env overrides.
- Done: defined the initial rollout policy in [invariant.config.ts](invariant.config.ts): stay in `shadow` stage, keep automatic issue creation disabled, and require human review of generated invariants before promoting a pilot target.

### A6: CI Hardening & Metrics (Phase 7 partial)

- Status: not started.
- Cache Dafny toolchain and generated artifacts in CI.
- Track metrics: proof pass rate, translation failure rate, false positive rate, median CI time.
- Add optional PR comments summarizing proof coverage deltas.

---

## Person B — Verification & Core Logic

Owns: Dafny translation, IR definition, proof obligations, counterexample generation, confidence scoring.

### B1: Sample Example & Dafny Template (Phase 1 partial)

- Status: completed for the Phase 1 sample path.
- Done: created [agent/examples/non_negative_counter.reducer.ts](agent/examples/non_negative_counter.reducer.ts) as the initial reducer-style source example.
- Done: wrote [agent/prompts/translator.prompt.txt](agent/prompts/translator.prompt.txt) for the LLM prompt contract.
- Done: built [agent/dafny/state_machine.template.dfy](agent/dafny/state_machine.template.dfy) as the reusable Dafny template for domain logic and proof obligations.
- Done: wired translator execution in [scripts/run-local-verifier.ts](scripts/run-local-verifier.ts) with Claude support via `ANTHROPIC_API_KEY`.
- Done: the pipeline now generates Dafny from discovered IR rather than the earlier sample-machine path.

### B2: IR Schema & Invariant Sources (Phase 2)

- Status: **implemented** — canonical IR, invariant loader, IR-driven translator, and discovery-to-IR conversion are all in place.
- Done: defined [agent/contracts/state-machine-schema.ts](agent/contracts/state-machine-schema.ts) with `StateMachineIR` as the canonical type covering `State`, `Action`, `Init`, transition effects, invariants, and normalization rules. Includes `validateIR()`, `fromDiscoverySchema()` (converts Person A's discovery output), and `fromLegacyMachine()` for backward compat.
- Done: built [agent/invariants/loader.ts](agent/invariants/loader.ts) supporting three invariant sources: annotation (inline), file (`.invariants.json`), and LLM-proposed (Claude Sonnet 4.5). Deduplication by expression.
- Done: built [agent/translator/ir-to-dafny.ts](agent/translator/ir-to-dafny.ts) with both deterministic (mock) and Claude Sonnet 4.5 translation paths. The mock path renders Dafny directly from the IR; the Claude path sends IR + prompt to the API.
- Done: updated [scripts/run-local-verifier.ts](scripts/run-local-verifier.ts) to integrate discovery → IR conversion → invariant enrichment → Dafny translation. Artifacts include both `discovered-machine.json` and `ir.json`.
- Remaining: broaden the IR beyond single-field state as discovery expands.

### B3: Counterexample Trace Generation (Phase 3)

- Status: **implemented** — bounded search, Dafny witness encoding, counterexample formatting, and graph visualization are all in place.
- Done: built [agent/trace/eval.ts](agent/trace/eval.ts) — lightweight recursive-descent expression evaluator for the IR's infix language (arithmetic, comparisons, boolean logic, `if/then/else`, `m.field` references, params).
- Done: built [agent/trace/bounded-search.ts](agent/trace/bounded-search.ts) — BFS-based bounded search over action sequences (length `1..N`). Supports both **proof mode** (exhaustive reachable-state check) and **witness mode** (shortest violating trace). Handles parameterized actions via representative value sampling.
- Done: built [agent/trace/trace-to-dafny.ts](agent/trace/trace-to-dafny.ts) — encodes counterexample traces as Dafny witness lemmas (`!Inv(...)` assertions) for solver confirmation. Supports injection into existing generated Dafny modules.
- Done: built [agent/reports/counterexample.ts](agent/reports/counterexample.ts) — converts search results into `VerificationFinding[]` with `kind: "counterexample"`, populating `normalizedTrace`, `steps[]` (before/after states), and `failingInvariant` fields.
- Done: built [agent/visualize/graph.ts](agent/visualize/graph.ts) — generates a self-contained HTML page (`proof-graph.html`) with Mermaid.js diagrams: state machine structure graph (fields, actions, invariants, normalization) and per-counterexample trace graphs (step-by-step state snapshots with violation highlighting). No npm dependencies (Mermaid loads from CDN).
- Done: wired bounded search and graph visualization into [scripts/run-local-verifier.ts](scripts/run-local-verifier.ts) — search runs after IR enrichment, witness lemmas are injected into the Dafny source, counterexample findings are included in the verification report, and `proof-graph.html` is generated in the artifacts directory.
- Output format: minimal action trace (arrow-separated) + exact failing invariant + serialized before/after states per step.
- Graph output: `proof-graph.html` in artifacts — open in browser to visualize the state machine and any counterexample traces.

### B4: Confidence Scoring (Phase 5 partial)

- Status: **implemented** — multi-signal scoring, classification, and filing decisions are all in place.
- Done: built [agent/confidence/score.ts](agent/confidence/score.ts) with 5-signal weighted scoring: invariant confidence (source & human-vs-LLM), search coverage (explored states, depth), translation quality (mock vs LLM provider), solver agreement (Dafny verify result), and replay confirmation (when available).
- Done: classification into `proved-safe`, `likely-bug`, or `needs-review` based on composite score thresholds.
- Done: filing decision logic (`auto-file`, `manual-review`, `suppress`) gated on classification + replay status.
- Done: `scoreFindings()` integrated into [scripts/run-local-verifier.ts](scripts/run-local-verifier.ts) — confidence scores and filing decisions are included in verification reports and `confidence.json` artifacts.
- Done: `renderConfidenceMarkdown()` for human-readable scoring breakdowns in proof summaries.
- Done: comprehensive test suite at [agent/confidence/score.test.ts](agent/confidence/score.test.ts).

### B5: Pilot Verification (Phase 6 partial)

- Status: **implemented** — pilot module created, pipeline validated end-to-end, proof boundaries tuned.
- Done: created [agent/examples/score_tracker.reducer.ts](agent/examples/score_tracker.reducer.ts) — a multi-action reducer with 4 actions (GainSmall +1, GainBig +10, LoseSmall -1, LoseBig -5) and 2 competing invariants (`ScoreNeverNegative`, `ScoreWithinBounds`).
- Done: created [agent/examples/score_tracker.invariants.json](agent/examples/score_tracker.invariants.json) — file-based invariant (`ScoreAboveFloor`) for testing the invariant enrichment pipeline.
- Done: added `score-tracker-pilot` target to [invariant.config.ts](invariant.config.ts) with tuned depth bounds (`witnessMaxDepth: 6`, `replayMaxDepth: 6`) and explicit invariant enforcement.
- Done: updated [invariant.config.ts](invariant.config.ts) `rollout.pilotTarget` to point at the score tracker.
- Done: removed hardcoded normalization rules from `fromDiscoverySchema()` and `fromLegacyMachine()` in [agent/contracts/state-machine-schema.ts](agent/contracts/state-machine-schema.ts) — normalization was silently clamping state and masking real violations.
- Tuning findings:
  - `ScoreNeverNegative`: violated by 1-step trace (`LoseSmall` from init), confidence score 80.3% → `likely-bug` / `auto-file`. Human-written invariant + solver agreement drive the high score.
  - `ScoreWithinBounds`: no counterexample within depth 6 (requires 100+ `GainBig` actions). This exercises the "safe but not provably safe" case — no violation found, but Dafny skipped so not `proved-safe` either.
  - `ScoreAboveFloor` (file invariant): enrichment pipeline loads it correctly; filtered by `enforce` policy in the pilot config.
- Human review: `rollout.requireHumanReviewForGeneratedInvariants` remains `true`.
- **Depends on:** config from A (now available).

### B6: Verification Tests (Phase 7 partial)

- Status: not started.
- Snapshot tests for the IR and generated Dafny.
- Golden counterexample tests using given-when-then function names.

---

## Sync Points

These are the moments where A and B must align before continuing.

1. **Kickoff (before A1/B1):** Completed for the first narrow reducer pattern. The next sync is about broadening the IR and supported discovery shapes rather than creating the first schema from scratch.
2. **After A2/B2:** ✅ Completed. A's discovery output (`StateMachineSchema`) is converted to B's canonical IR (`StateMachineIR`) via `fromDiscoverySchema()`. Integration verified.
3. **After A3/B3:** ✅ B3 implemented. Counterexample findings use `VerificationFinding` with `kind: "counterexample"`, `normalizedTrace` (arrow-separated), and `steps[]` with `beforeState`/`afterState`. A's issue formatter already renders these fields.
4. **During A4/B4:** ✅ Completed. Replay results are attached to counterexample findings as `counterexample.sourceReplay`, and B4's `ScoringContext` now consumes replay-derived confirmation signals in the verifier pipeline.

---

## Completion Status

```
Task   Description                       Status
─────  ───────────────────────────────   ──────────
A1     CI workflow + orchestration        ✅ Done
A2     Discovery (AST fallback)           ✅ Done
A3     Issue filing + dedup               ✅ Done
A4     Source-language replay              ✅ Done
A5     Config + rollout                   ✅ Done
A6     Caching + metrics                  ⬜ Not started
B1     Sample example + Dafny template    ✅ Done
B2     IR schema + invariant sources      ✅ Done
B3     Trace search + counterexamples     ✅ Done
B4     Confidence scoring                 ✅ Done
B5     Pilot on real module               ✅ Done
B6     Snapshot + golden tests            ⬜ Not started
```

## What Is Left Right Now

The only blocking item for demo day:

1. Exercise the new LLM discovery path on real non-sample TypeScript modules and refine the discovery prompt/approval flow.
2. **Broaden the IR beyond single-field state** as LLM discovery surfaces more complex state shapes.
3. Tighten issue output and proof-summary presentation around replay-confirmed counterexample details and confidence classifications.

Nice-to-have but not blocking:

4. One more compelling real-world example beyond the score-tracker pilot (auth state, shopping cart, form wizard) for demos.
5. A6/B6 hardening: CI caching, metrics, snapshot tests, and golden tests.
