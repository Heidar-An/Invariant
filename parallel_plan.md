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
- Invariant enrichment is in place: annotation, file-based (`.invariants.json`), and LLM-proposed sources.
- The IR-to-Dafny translator exists at [agent/translator/ir-to-dafny.ts](agent/translator/ir-to-dafny.ts) with mock and Claude paths.
- GitHub issue drafting and posting now exist for current verification failures, with fingerprint-based deduplication and `needs-human-triage` labeling.
- Counterexample-driven findings from B3 are wired into the report pipeline and available for issue filing.
- Source-language replay now exists at [agent/replay/source-replay.ts](agent/replay/source-replay.ts), with a local entrypoint at [scripts/run-source-replay.ts](scripts/run-source-replay.ts).
- Repo-local configuration now exists at [invariant.config.ts](invariant.config.ts), and the verifier/replay/issue-posting scripts now consume it.

Not done yet:

- **LLM-based discovery** — the critical next step to support arbitrary TypeScript (not just reducers).
- No confidence scoring or production pilot rollout yet.
- Source-language replay exists, but it still needs to consume B3's finalized counterexample output directly.

## Person A — Pipeline & Integration

Owns: CI orchestration, GitHub integration, issue filing, replay infrastructure.

### A1: CI Workflow & Orchestration (Phase 1 partial)

- Status: completed for the Phase 1 sample pipeline.
- Done: built [.github/workflows/verify-state.yml](.github/workflows/verify-state.yml) to trigger on `push` and `pull_request`.
- Done: built [scripts/run-local-verifier.ts](scripts/run-local-verifier.ts) to orchestrate discovery, translation, `dafny verify`, and artifact capture.
- Done: configured artifact upload from CI for generated Dafny and raw verifier output.
- Done: swapped sample-machine loading for discovered IR from source.

### A2: State Logic Discovery (Phase 2 — pivoting to LLM)

- Status: AST-based path completed for reducer pattern; **now pivoting to LLM-based discovery**.
- Done: built [agent/discovery/discover-state-machine.ts](agent/discovery/discover-state-machine.ts) to extract one supported reducer/action pattern from source (retained as fast fallback).
- Done: wired discovery output into [agent/contracts/state-machine-schema.ts](agent/contracts/state-machine-schema.ts).
- Done: unsupported source shapes now fail with file/line-specific error messages.
- **Next: build `agent/discovery/llm-discovery.ts`** — send arbitrary TypeScript source to Claude, receive `StateMachineIR` directly. This replaces AST expansion as the primary strategy for supporting new code patterns.
- The LLM discovery prompt should instruct Claude to: identify state fields, transitions/actions, initial state, propose invariants, and flag if the code doesn't contain meaningful state machine logic.
- Add a user review/confirmation step for the LLM-generated IR before verification proceeds.

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

- Status: completed for the local replay engine; the remaining work is wiring B3's finalized trace output into the replay path.
- Done: built [agent/replay/source-replay.ts](agent/replay/source-replay.ts) to execute counterexample traces against the original reducer/state module.
- Done: built [scripts/run-source-replay.ts](scripts/run-source-replay.ts) as a local/CI entrypoint for replay artifacts.
- Done: replay emits structured status, invariant evaluations, step-by-step before/after state, and trace metadata for B's confidence scorer.
- Done: proof summaries can now surface attached source replay results once counterexample findings include them.
- **Depends on:** B3 trace output is now available; the next step is consuming it directly.

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

- Status: **implemented** — bounded search, Dafny witness encoding, and counterexample formatting are all in place.
- Done: built [agent/trace/eval.ts](agent/trace/eval.ts) — lightweight recursive-descent expression evaluator for the IR's infix language (arithmetic, comparisons, boolean logic, `if/then/else`, `m.field` references, params).
- Done: built [agent/trace/bounded-search.ts](agent/trace/bounded-search.ts) — BFS-based bounded search over action sequences (length `1..N`). Supports both **proof mode** (exhaustive reachable-state check) and **witness mode** (shortest violating trace). Handles parameterized actions via representative value sampling.
- Done: built [agent/trace/trace-to-dafny.ts](agent/trace/trace-to-dafny.ts) — encodes counterexample traces as Dafny witness lemmas (`!Inv(...)` assertions) for solver confirmation. Supports injection into existing generated Dafny modules.
- Done: built [agent/reports/counterexample.ts](agent/reports/counterexample.ts) — converts search results into `VerificationFinding[]` with `kind: "counterexample"`, populating `normalizedTrace`, `steps[]` (before/after states), and `failingInvariant` fields.
- Done: wired bounded search into [scripts/run-local-verifier.ts](scripts/run-local-verifier.ts) — search runs after IR enrichment, witness lemmas are injected into the Dafny source, and counterexample findings are included in the verification report.
- Output format: minimal action trace (arrow-separated) + exact failing invariant + serialized before/after states per step.

### B4: Confidence Scoring (Phase 5 partial)

- Status: not started.
- Build [agent/confidence/score.ts](agent/confidence/score.ts) to rank findings by: successful replay in source, invariant confidence level, translation coverage, unsupported construct handling.
- Define filing policy: auto-file only when coverage threshold met, trace replays in source, and failure is not explained by unsupported construct.
- Classify results as `proved safe`, `likely real bug`, or `needs review`.
- **Depends on:** replay results from A.

### B5: Pilot Verification (Phase 6 partial)

- Status: not started.
- Apply the agent to one real state module in the repo.
- Tune the proof boundary for the pilot module.
- Require human review of generated invariants until the invariant library matures.
- **Depends on:** config from A.

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
4. **During A4/B4:** A's replay results feed into B's confidence scorer. Agree on replay output shape.

---

## Timeline

```
Week   Person A (Pipeline)              Person B (Verification)
─────  ───────────────────────────────   ───────────────────────────────
 1     A1: CI workflow + orchestration   B1: Sample example + Dafny template
       ◄──────── sync: IR shape ───────►
 2     A2: Discovery module              B2: IR schema + invariant sources
       ◄──────── sync: integration ────►
 3     A3: Issue filing + dedup          B3: Trace search + counterexamples
       ◄──────── sync: trace format ───►
 4     A4: Source-language replay         B4: Confidence scoring
 5     A5: Config + rollout              B5: Pilot on real module
 6     A6: Caching + metrics             B6: Snapshot + golden tests
```

Approximately 60% parallel execution. The main serial bottleneck is the IR agreement in week 1.

## What Is Left Right Now

The immediate next work items, reprioritized around the LLM discovery pivot:

1. **Build LLM-based discovery (`agent/discovery/llm-discovery.ts`)** — the highest-impact change. Send arbitrary TypeScript to Claude, get back IR. This unblocks the tool for any stateful TypeScript, not just reducers.
2. **Add IR review/confirmation step** — let users inspect and approve the LLM-generated IR before verification runs, since the LLM may misidentify state or transitions.
3. **Broaden the IR beyond single-field state** as LLM discovery surfaces more complex state shapes.
4. Enrich issue bodies with real counterexample traces now that B3 output is available.
5. Wire B3's finalized counterexample output into source replay and then into B4 confidence scoring.
6. Move the rollout config from the sample reducer to one production-relevant pilot module once such a target is ready.
