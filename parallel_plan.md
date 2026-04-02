# Parallel Work Plan

Two-person split of the CI verifier agent build. After a brief kickoff alignment on the IR shape, the pipeline/integration track and the verification/core-logic track run mostly in parallel.

## Person A — Pipeline & Integration

Owns: CI orchestration, GitHub integration, issue filing, replay infrastructure.

### A1: CI Workflow & Orchestration (Phase 1 partial)

- Build [.github/workflows/verify-state.yml](.github/workflows/verify-state.yml) to trigger on `push` and `pull_request`.
- Build [scripts/run-local-verifier.ts](scripts/run-local-verifier.ts) to orchestrate discovery, translation, `dafny verify`, and result capture.
- Configure artifact upload from CI for generated Dafny and raw verifier output.
- **Depends on:** agrees on IR shape with B.

### A2: State Logic Discovery (Phase 2 partial)

- Build [agent/discovery/](agent/discovery/) to extract candidate reducer/action code from supported patterns.
- Wire discovery output into the IR schema defined by B.
- Reject unsupported state logic with a clear explanation.
- **Depends on:** IR schema from B.

### A3: GitHub Issue Filing (Phase 4)

- Build [agent/github/issue-template.ts](agent/github/issue-template.ts) for title/body generation.
- Build [agent/github/post-issue.ts](agent/github/post-issue.ts) using `GITHUB_TOKEN` in Actions.
- Build [agent/reports/proof-summary.ts](agent/reports/proof-summary.ts) to summarize verified/failed obligations.
- Implement deduplication by invariant + normalized trace.
- Mark issues as `needs-human-triage` until source replay confirms the failure.
- **Depends on:** counterexample output format from B.

### A4: Source-Language Replay (Phase 5 partial)

- Build [agent/replay/](agent/replay/) to execute counterexample traces against the original reducer/state module.
- Output structured replay results for B's confidence scorer.
- **Depends on:** trace format from B.

### A5: Repo Config & Rollout (Phase 6 partial)

- Build [invariant.config.ts](invariant.config.ts) for repo-local configuration: target files, invariants to enforce, action-depth bounds, issue filing policy.
- Define rollout strategy for pilot integration.

### A6: CI Hardening & Metrics (Phase 7 partial)

- Cache Dafny toolchain and generated artifacts in CI.
- Track metrics: proof pass rate, translation failure rate, false positive rate, median CI time.
- Add optional PR comments summarizing proof coverage deltas.

---

## Person B — Verification & Core Logic

Owns: Dafny translation, IR definition, proof obligations, counterexample generation, confidence scoring.

### B1: Sample Example & Dafny Template (Phase 1 partial)

- Create [agent/examples/](agent/examples/) with one intentionally small reducer-style state machine.
- Write [agent/prompts/translator.md](agent/prompts/translator.md) for the LLM prompt contract.
- Build [agent/dafny/](agent/dafny/) with a minimal reusable Dafny template for domain logic and proof obligations.
- **Depends on:** agrees on IR shape with A.

### B2: IR Schema & Invariant Sources (Phase 2 partial)

- Define [agent/contracts/state-machine-schema.ts](agent/contracts/state-machine-schema.ts): `State`, `Action`, `Init`, transition function, invariants, normalization rules.
- Build [agent/invariants/](agent/invariants/) for invariant sources: explicit annotations, repo-local invariant files, LLM-proposed drafts.
- Implement the two-step translation pipeline: source code -> typed IR -> Dafny.

### B3: Counterexample Trace Generation (Phase 3)

- Build [agent/trace/](agent/trace/) for bounded action-sequence search over the extracted IR (length `1..N`).
- Build [agent/trace/trace-to-dafny.ts](agent/trace/trace-to-dafny.ts) to encode candidate traces and failing postconditions.
- Build [agent/reports/counterexample.ts](agent/reports/counterexample.ts) to turn solver output into a human-readable replay.
- Implement both proof mode (prove invariants for all transitions) and witness mode (bounded search for shortest violating trace).
- Output format: minimal action trace + exact failing invariant + serialized before/after states.

### B4: Confidence Scoring (Phase 5 partial)

- Build [agent/confidence/score.ts](agent/confidence/score.ts) to rank findings by: successful replay in source, invariant confidence level, translation coverage, unsupported construct handling.
- Define filing policy: auto-file only when coverage threshold met, trace replays in source, and failure is not explained by unsupported construct.
- Classify results as `proved safe`, `likely real bug`, or `needs review`.
- **Depends on:** replay results from A.

### B5: Pilot Verification (Phase 6 partial)

- Apply the agent to one real state module in the repo.
- Tune the proof boundary for the pilot module.
- Require human review of generated invariants until the invariant library matures.
- **Depends on:** config from A.

### B6: Verification Tests (Phase 7 partial)

- Snapshot tests for the IR and generated Dafny.
- Golden counterexample tests using given-when-then function names.

---

## Sync Points

These are the moments where A and B must align before continuing.

1. **Kickoff (before A1/B1):** Agree on the IR shape — `State`, `Action`, `Init`, transition function, invariant format. This unblocks both tracks.
2. **After A2/B2:** A's discovery output must produce B's IR schema. Quick integration check.
3. **After A3/B3:** A's issue formatter consumes B's counterexample format. Agree on the trace + report JSON contract.
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
