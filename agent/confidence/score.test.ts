import { describe, it, expect } from "vitest";
import {
  scoreInvariantConfidence,
  scoreSearchCoverage,
  scoreTranslationQuality,
  scoreSolverAgreement,
  scoreReplayConfirmation,
  computeBreakdown,
  computeScore,
  classify,
  decideFiling,
  scoreFindings,
  renderConfidenceMarkdown,
  type ScoringContext,
  type ReplayResult,
  type ConfidenceBreakdown,
} from "./score.js";
import type { StateMachineIR, Invariant } from "../contracts/state-machine-schema.js";
import type { SearchResult } from "../trace/bounded-search.js";
import type { VerifyResult, VerificationFinding } from "../reports/proof-summary.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeInvariant(overrides: Partial<Invariant> = {}): Invariant {
  return {
    name: "NonNegative",
    description: "value >= 0",
    expression: "m.value >= 0",
    source: "annotation",
    confidence: 1.0,
    ...overrides,
  };
}

function makeIR(invariants: Invariant[] = [makeInvariant()]): StateMachineIR {
  return {
    name: "Counter",
    description: "test counter",
    stateFields: [{ name: "value", type: "int" }],
    initialValues: [{ field: "value", value: 0 }],
    actions: [
      {
        name: "Increment",
        params: [],
        effects: [{ field: "value", expression: "m.value + 1" }],
      },
      {
        name: "Decrement",
        params: [],
        effects: [{ field: "value", expression: "m.value - 1" }],
      },
    ],
    invariants,
    normalization: [],
  };
}

function makeSearchResult(overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    mode: "witness",
    explored: 100,
    maxDepthReached: 4,
    counterexamples: [
      {
        steps: [
          {
            action: "Decrement",
            params: {},
            beforeState: { value: 0 },
            afterState: { value: -1 },
          },
        ],
        failingInvariant: "NonNegative",
        finalState: { value: -1 },
      },
    ],
    ...overrides,
  };
}

function makeEmptySearchResult(): SearchResult {
  return {
    mode: "witness",
    explored: 500,
    maxDepthReached: 6,
    counterexamples: [],
  };
}

function makeVerifyResult(overrides: Partial<VerifyResult> = {}): VerifyResult {
  return {
    status: "failed",
    exitCode: 1,
    stdout: "",
    stderr: "verification failed",
    ...overrides,
  };
}

function makeScoringCtx(overrides: Partial<ScoringContext> = {}): ScoringContext {
  return {
    ir: makeIR(),
    searchResult: makeSearchResult(),
    verifyResult: makeVerifyResult(),
    translationProvider: "claude",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// scoreInvariantConfidence
// ---------------------------------------------------------------------------

describe("scoreInvariantConfidence", () => {
  it("returns invariant confidence for annotation source", () => {
    expect(scoreInvariantConfidence(makeInvariant({ confidence: 1.0 }))).toBe(1.0);
  });

  it("returns lower confidence for LLM-proposed invariants", () => {
    expect(scoreInvariantConfidence(makeInvariant({ source: "llm", confidence: 0.7 }))).toBe(0.7);
  });

  it("returns 0.5 when invariant is undefined", () => {
    expect(scoreInvariantConfidence(undefined)).toBe(0.5);
  });
});

// ---------------------------------------------------------------------------
// scoreSearchCoverage
// ---------------------------------------------------------------------------

describe("scoreSearchCoverage", () => {
  it("returns higher score for deeper exploration", () => {
    const shallow = scoreSearchCoverage(makeSearchResult({ maxDepthReached: 1, explored: 10 }));
    const deep = scoreSearchCoverage(makeSearchResult({ maxDepthReached: 6, explored: 10 }));
    expect(deep).toBeGreaterThan(shallow);
  });

  it("returns higher score for more explored states", () => {
    const few = scoreSearchCoverage(makeSearchResult({ explored: 5, maxDepthReached: 3 }));
    const many = scoreSearchCoverage(makeSearchResult({ explored: 10000, maxDepthReached: 3 }));
    expect(many).toBeGreaterThan(few);
  });

  it("caps at 1.0 for maximum exploration", () => {
    const result = scoreSearchCoverage(makeSearchResult({ explored: 50_000, maxDepthReached: 6 }));
    expect(result).toBeCloseTo(1.0, 1);
  });

  it("handles zero explored states", () => {
    const result = scoreSearchCoverage(makeSearchResult({ explored: 0, maxDepthReached: 0 }));
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// scoreTranslationQuality
// ---------------------------------------------------------------------------

describe("scoreTranslationQuality", () => {
  it("returns 1.0 for claude provider", () => {
    expect(scoreTranslationQuality("claude")).toBe(1.0);
  });

  it("returns 0.6 for mock provider", () => {
    expect(scoreTranslationQuality("mock")).toBe(0.6);
  });

  it("returns 0.5 for unknown provider", () => {
    expect(scoreTranslationQuality("other")).toBe(0.5);
  });
});

// ---------------------------------------------------------------------------
// scoreSolverAgreement
// ---------------------------------------------------------------------------

describe("scoreSolverAgreement", () => {
  it("returns 1.0 when solver fails and finding is counterexample", () => {
    expect(scoreSolverAgreement(makeVerifyResult({ status: "failed" }), "counterexample")).toBe(1.0);
  });

  it("returns 0.2 when solver verifies but counterexample exists", () => {
    expect(scoreSolverAgreement(makeVerifyResult({ status: "verified" }), "counterexample")).toBe(0.2);
  });

  it("returns 0.5 when solver is skipped", () => {
    expect(scoreSolverAgreement(makeVerifyResult({ status: "skipped" }), "counterexample")).toBe(0.5);
  });

  it("returns 0.8 for verification-failure with failed solver", () => {
    expect(scoreSolverAgreement(makeVerifyResult({ status: "failed" }), "verification-failure")).toBe(0.8);
  });
});

// ---------------------------------------------------------------------------
// scoreReplayConfirmation
// ---------------------------------------------------------------------------

describe("scoreReplayConfirmation", () => {
  it("returns 0.5 when no replay data", () => {
    expect(scoreReplayConfirmation(undefined)).toBe(0.5);
  });

  it("returns 1.0 when replay reproduced the bug", () => {
    expect(scoreReplayConfirmation({ replayed: true, reproduced: true })).toBe(1.0);
  });

  it("returns 0.1 when replay did NOT reproduce", () => {
    expect(scoreReplayConfirmation({ replayed: true, reproduced: false })).toBe(0.1);
  });

  it("returns 0.4 when replay could not execute", () => {
    expect(scoreReplayConfirmation({ replayed: false, reproduced: false })).toBe(0.4);
  });
});

// ---------------------------------------------------------------------------
// computeBreakdown
// ---------------------------------------------------------------------------

describe("computeBreakdown", () => {
  it("produces all five signal scores", () => {
    const finding: VerificationFinding = {
      kind: "counterexample",
      title: "NonNegative violated",
      explanation: "test",
      invariantName: "NonNegative",
    };
    const breakdown = computeBreakdown(finding, makeScoringCtx());
    expect(breakdown.invariantConfidence).toBeDefined();
    expect(breakdown.searchCoverage).toBeDefined();
    expect(breakdown.translationQuality).toBeDefined();
    expect(breakdown.solverAgreement).toBeDefined();
    expect(breakdown.replayConfirmation).toBeDefined();
  });

  it("uses invariant from IR matching finding name", () => {
    const inv = makeInvariant({ confidence: 0.8 });
    const ctx = makeScoringCtx({ ir: makeIR([inv]) });
    const finding: VerificationFinding = {
      kind: "counterexample",
      title: "test",
      explanation: "test",
      invariantName: "NonNegative",
    };
    expect(computeBreakdown(finding, ctx).invariantConfidence).toBe(0.8);
  });

  it("falls back to 0.5 when invariant name does not match", () => {
    const finding: VerificationFinding = {
      kind: "counterexample",
      title: "test",
      explanation: "test",
      invariantName: "UnknownInvariant",
    };
    expect(computeBreakdown(finding, makeScoringCtx()).invariantConfidence).toBe(0.5);
  });
});

// ---------------------------------------------------------------------------
// computeScore
// ---------------------------------------------------------------------------

describe("computeScore", () => {
  it("returns weighted sum of breakdown signals", () => {
    const breakdown: ConfidenceBreakdown = {
      invariantConfidence: 1.0,
      searchCoverage: 1.0,
      translationQuality: 1.0,
      solverAgreement: 1.0,
      replayConfirmation: 1.0,
    };
    expect(computeScore(breakdown)).toBeCloseTo(1.0, 5);
  });

  it("returns 0 when all signals are 0", () => {
    const breakdown: ConfidenceBreakdown = {
      invariantConfidence: 0,
      searchCoverage: 0,
      translationQuality: 0,
      solverAgreement: 0,
      replayConfirmation: 0,
    };
    expect(computeScore(breakdown)).toBe(0);
  });

  it("returns value between 0 and 1", () => {
    const breakdown: ConfidenceBreakdown = {
      invariantConfidence: 0.7,
      searchCoverage: 0.5,
      translationQuality: 0.6,
      solverAgreement: 0.8,
      replayConfirmation: 0.5,
    };
    const score = computeScore(breakdown);
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(1);
  });
});

// ---------------------------------------------------------------------------
// classify
// ---------------------------------------------------------------------------

describe("classify", () => {
  it("returns likely-bug for score >= 0.7", () => {
    expect(classify(0.7)).toBe("likely-bug");
    expect(classify(0.9)).toBe("likely-bug");
  });

  it("returns needs-review for score < 0.7", () => {
    expect(classify(0.69)).toBe("needs-review");
    expect(classify(0.3)).toBe("needs-review");
  });
});

// ---------------------------------------------------------------------------
// decideFiling
// ---------------------------------------------------------------------------

describe("decideFiling", () => {
  it("returns auto-file for high score with no replay", () => {
    expect(decideFiling(0.85, undefined)).toBe("auto-file");
  });

  it("returns auto-file for high score with confirmed replay", () => {
    expect(decideFiling(0.85, { replayed: true, reproduced: true })).toBe("auto-file");
  });

  it("returns manual-review for high score with non-reproducing replay", () => {
    expect(decideFiling(0.85, { replayed: true, reproduced: false })).toBe("manual-review");
  });

  it("returns suppress for very low score", () => {
    expect(decideFiling(0.2, undefined)).toBe("suppress");
  });

  it("returns manual-review for medium score", () => {
    expect(decideFiling(0.5, undefined)).toBe("manual-review");
  });
});

// ---------------------------------------------------------------------------
// scoreFindings (integration)
// ---------------------------------------------------------------------------

describe("scoreFindings", () => {
  it("returns scored findings for counterexamples", () => {
    const report = scoreFindings(makeScoringCtx());
    expect(report.scoredFindings).toHaveLength(1);
    expect(report.scoredFindings[0]!.score).toBeGreaterThan(0);
    expect(report.scoredFindings[0]!.classification).toBeDefined();
    expect(report.scoredFindings[0]!.filingDecision).toBeDefined();
  });

  it("returns empty findings when no counterexamples", () => {
    const ctx = makeScoringCtx({ searchResult: makeEmptySearchResult() });
    const report = scoreFindings(ctx);
    expect(report.scoredFindings).toHaveLength(0);
  });

  it("reports safe invariants when dafny verifies and no counterexamples", () => {
    const ctx = makeScoringCtx({
      searchResult: makeEmptySearchResult(),
      verifyResult: makeVerifyResult({ status: "verified", exitCode: 0 }),
    });
    const report = scoreFindings(ctx);
    expect(report.safeInvariants).toContain("NonNegative");
  });

  it("does not report safe invariants when dafny fails", () => {
    const ctx = makeScoringCtx({
      searchResult: makeEmptySearchResult(),
      verifyResult: makeVerifyResult({ status: "failed" }),
    });
    const report = scoreFindings(ctx);
    expect(report.safeInvariants).toHaveLength(0);
  });

  it("excludes violated invariants from safe list", () => {
    const ctx = makeScoringCtx({
      verifyResult: makeVerifyResult({ status: "verified", exitCode: 0 }),
    });
    const report = scoreFindings(ctx);
    // NonNegative is violated by the counterexample, so not safe
    expect(report.safeInvariants).not.toContain("NonNegative");
  });

  it("populates summary counts correctly", () => {
    const report = scoreFindings(makeScoringCtx());
    expect(report.summary.totalInvariants).toBe(1);
    expect(report.summary.provedSafe + report.summary.likelyBugs + report.summary.needsReview)
      .toBe(report.summary.totalInvariants);
  });

  it("uses replay results when provided", () => {
    const replayResults = new Map<string, ReplayResult>();
    replayResults.set("NonNegative", { replayed: true, reproduced: true });
    const ctx = makeScoringCtx({ replayResults });
    const report = scoreFindings(ctx);
    // With replay confirmation, score should be higher
    expect(report.scoredFindings[0]!.breakdown.replayConfirmation).toBe(1.0);
  });

  it("handles multiple invariants", () => {
    const invariants = [
      makeInvariant({ name: "NonNegative", confidence: 1.0 }),
      makeInvariant({ name: "BoundedAbove", expression: "m.value <= 100", confidence: 0.7, source: "llm" }),
    ];
    const searchResult: SearchResult = {
      mode: "witness",
      explored: 200,
      maxDepthReached: 5,
      counterexamples: [
        {
          steps: [{ action: "Decrement", params: {}, beforeState: { value: 0 }, afterState: { value: -1 } }],
          failingInvariant: "NonNegative",
          finalState: { value: -1 },
        },
        {
          steps: [
            { action: "Increment", params: {}, beforeState: { value: 99 }, afterState: { value: 100 } },
            { action: "Increment", params: {}, beforeState: { value: 100 }, afterState: { value: 101 } },
          ],
          failingInvariant: "BoundedAbove",
          finalState: { value: 101 },
        },
      ],
    };
    const ctx = makeScoringCtx({ ir: makeIR(invariants), searchResult });
    const report = scoreFindings(ctx);
    expect(report.scoredFindings).toHaveLength(2);
    // Human-written invariant should score higher than LLM-proposed
    const nonNeg = report.scoredFindings.find((sf) => sf.finding.invariantName === "NonNegative")!;
    const bounded = report.scoredFindings.find((sf) => sf.finding.invariantName === "BoundedAbove")!;
    expect(nonNeg.breakdown.invariantConfidence).toBeGreaterThan(bounded.breakdown.invariantConfidence);
  });
});

// ---------------------------------------------------------------------------
// renderConfidenceMarkdown
// ---------------------------------------------------------------------------

describe("renderConfidenceMarkdown", () => {
  it("includes section header", () => {
    const report = scoreFindings(makeScoringCtx());
    const md = renderConfidenceMarkdown(report);
    expect(md).toContain("## Confidence Scoring");
  });

  it("includes summary counts", () => {
    const report = scoreFindings(makeScoringCtx());
    const md = renderConfidenceMarkdown(report);
    expect(md).toContain("Total invariants: 1");
  });

  it("includes scored findings section when findings exist", () => {
    const report = scoreFindings(makeScoringCtx());
    const md = renderConfidenceMarkdown(report);
    expect(md).toContain("### Scored Findings");
    expect(md).toContain("NonNegative");
  });

  it("includes proved safe section when safe invariants exist", () => {
    const ctx = makeScoringCtx({
      searchResult: makeEmptySearchResult(),
      verifyResult: makeVerifyResult({ status: "verified", exitCode: 0 }),
    });
    const report = scoreFindings(ctx);
    const md = renderConfidenceMarkdown(report);
    expect(md).toContain("### Proved Safe");
    expect(md).toContain("NonNegative");
  });

  it("omits proved safe section when none are safe", () => {
    const report = scoreFindings(makeScoringCtx());
    const md = renderConfidenceMarkdown(report);
    expect(md).not.toContain("### Proved Safe");
  });
});
