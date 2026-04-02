# Invariant

An always-on CI agent that watches your GitHub pushes, automatically translates your app's state logic into Dafny, runs formal verification, and files a GitHub issue with a mathematical proof of any bug it finds, including a concrete counterexample showing exactly which sequence of actions breaks your invariants.

## What It Does

Invariant is a GitHub Actions-driven verifier for stateful application logic.
On each run, it takes TypeScript source that contains stateful logic, derives a typed intermediate representation, translates that IR into Dafny, runs verification, searches for short counterexample traces, and emits artifacts that explain what happened.

When verification fails, the project can also draft or post a GitHub issue with:

- the invariant that failed
- a proof-oriented summary of the verifier result
- a normalized action trace
- serialized before/after state snapshots for each step
- links back to the CI run artifacts

## How The Pipeline Works

1. GitHub Actions triggers on `push` and `pull_request`.
2. The discovery step analyzes source code and extracts a state-machine-style IR.
3. Invariants are collected from source, repo files, and optionally an LLM-assisted proposal path.
4. The canonical IR is translated into Dafny.
5. A bounded trace search looks for the shortest witness that violates an invariant.
6. Dafny verifies the generated model and proof obligations.
7. The run writes artifacts, a proof summary, and, on push runs, can post or update a deduplicated GitHub issue.

## Current Status

The repository currently implements a narrow but working vertical slice:

- CI runs on GitHub Actions and uploads verification artifacts
- source code is translated through `source -> discovery schema -> canonical IR -> Dafny`
- bounded counterexample generation is wired into the verifier
- issue drafting/posting exists with fingerprint-based deduplication
- source-language replay exists as a separate step

The project direction is now more general than the original reducer-only framing: the goal is to support arbitrary TypeScript with meaningful stateful logic, using LLM-based discovery as the primary path and the current AST-based reducer discovery as a fast fallback. Today, though, the shipped implementation is still the narrow vertical slice: the default target is the sample reducer in `agent/examples/non_negative_counter.reducer.ts`, and the existing discovery code still only supports the initial reducer pattern.

## Local Development

Install dependencies:

```bash
npm install
```

Core checks:

```bash
npm test
npm run typecheck
```

Run the local verifier:

```bash
npm run verify:local
```

Replay a saved counterexample trace against the source implementation:

```bash
npm run replay:local
```

To run the full local verifier with Dafny enabled, you need:

- Node.js
- .NET 8
- Z3
- Dafny available on `PATH`

If `ANTHROPIC_API_KEY` is set, the translator can use Claude; otherwise the repository falls back to the deterministic mock translation path for local development.

## Configuration

Repository-local behavior lives in `invariant.config.ts`. That config controls:

- which source file is targeted
- which invariants are enforced
- bounded search depth
- artifact directories
- issue filing mode and rollout stage

The current rollout is intentionally conservative: the sample target is in a shadow-stage configuration, generated invariants still require human review, and automatic issue creation remains guarded by config and CI environment settings.

## Discovery Strategy

Invariant is moving toward a more agnostic discovery model:

- primary direction: send arbitrary TypeScript to an LLM and have it produce IR directly
- current fallback: AST-based discovery for the existing reducer pattern
- shared downstream pipeline: the same IR, Dafny translation, bounded search, replay, and issue filing flow

That shift is what makes the project broader than "Redux reducer verification." The verifier is intended to work on any code that really behaves like a state machine, while still being able to say "this is not a meaningful state machine" when the source does not fit.

## Main Entry Points

- `scripts/run-local-verifier.ts`: end-to-end local verification pipeline
- `scripts/run-source-replay.ts`: replay a counterexample against the source reducer
- `.github/workflows/verify-state.yml`: CI workflow
- `agent/discovery/discover-state-machine.ts`: current AST-based discovery fallback for the supported reducer shape
- `agent/contracts/state-machine-schema.ts`: canonical IR and validation
- `agent/translator/ir-to-dafny.ts`: IR-to-Dafny translation
- `agent/github/post-issue.ts`: GitHub issue posting and deduplication

## Project Direction

Invariant is aiming toward a workflow where a normal code push can produce something much more actionable than "tests failed": a machine-checked proof obligation, a concrete counterexample trace, and an automatically filed issue that explains the bug in terms of the state machine your code actually implements.