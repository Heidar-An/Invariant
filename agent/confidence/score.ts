/**
 * B4: Confidence scoring for verification findings.
 *
 * Ranks each finding by combining signals from:
 *   - invariant source & confidence (human-written vs LLM-proposed)
 *   - bounded search coverage (explored states, depth reached)
 *   - translation provider (deterministic mock vs LLM)
 *   - Dafny solver confirmation (verified / failed / skipped)
 *   - source-language replay result (when available from A4)
 *
 * Each finding is classified as:
 *   - `proved-safe`  — invariant holds across all explored states
 *   - `likely-bug`   — high-confidence violation confirmed by multiple signals
 *   - `needs-review` — violation found but confidence is insufficient
 */

import type {
  VerificationFinding,
  VerificationReport,
  VerifyResult,
} from "../reports/proof-summary.js";
import type { SearchResult } from "../trace/bounded-search.js";
import type { StateMachineIR, Invariant } from "../contracts/state-machine-schema.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type FindingClassification = "proved-safe" | "likely-bug" | "needs-review";

export type FilingDecision = "auto-file" | "manual-review" | "suppress";

export type ReplayResult = {
  replayed: boolean;
  reproduced: boolean;
  error?: string;
};

export type ConfidenceBreakdown = {
  invariantConfidence: number;
  searchCoverage: number;
  translationQuality: number;
  solverAgreement: number;
  replayConfirmation: number;
};

export type ScoredFinding = {
  finding: VerificationFinding;
  score: number;
  classification: FindingClassification;
  filingDecision: FilingDecision;
  breakdown: ConfidenceBreakdown;
};

export type ConfidenceReport = {
  scoredFindings: ScoredFinding[];
  safeInvariants: string[];
  summary: ConfidenceSummary;
};

export type ConfidenceSummary = {
  totalInvariants: number;
  provedSafe: number;
  likelyBugs: number;
  needsReview: number;
  autoFileCount: number;
};

export type ScoringContext = {
  ir: StateMachineIR;
  searchResult: SearchResult;
  verifyResult: VerifyResult;
  translationProvider: string;
  replayResults?: Map<string, ReplayResult>;
};

// ---------------------------------------------------------------------------
// Weights (sum to 1.0)
// ---------------------------------------------------------------------------

const WEIGHTS = {
  invariantConfidence: 0.25,
  searchCoverage: 0.20,
  translationQuality: 0.15,
  solverAgreement: 0.25,
  replayConfirmation: 0.15,
} as const;

// ---------------------------------------------------------------------------
// Thresholds
// ---------------------------------------------------------------------------

const LIKELY_BUG_THRESHOLD = 0.7;
const AUTO_FILE_THRESHOLD = 0.8;

// ---------------------------------------------------------------------------
// Signal scoring functions
// ---------------------------------------------------------------------------

/**
 * Score based on the invariant's own confidence and source.
 * Human-written invariants (annotation/file) score higher because a
 * violation of a human-specified property is more meaningful.
 */
export function scoreInvariantConfidence(
  invariant: Invariant | undefined,
): number {
  if (!invariant) return 0.5;
  // Human-written invariants that are violated are high-signal findings
  return invariant.confidence;
}

/**
 * Score based on how thoroughly the bounded search explored the state space.
 * More explored states and deeper search = higher confidence in the result.
 */
export function scoreSearchCoverage(searchResult: SearchResult): number {
  const { explored, maxDepthReached } = searchResult;

  // Depth score: deeper search means more thorough exploration
  const depthScore = Math.min(maxDepthReached / 6, 1.0);

  // Volume score: log-scaled because 50k states is very thorough
  const volumeScore = Math.min(Math.log10(Math.max(explored, 1)) / Math.log10(50_000), 1.0);

  return 0.5 * depthScore + 0.5 * volumeScore;
}

/**
 * Score based on translation provider. Claude translation is more
 * faithful than the deterministic mock, which is template-based.
 */
export function scoreTranslationQuality(provider: string): number {
  switch (provider) {
    case "claude": return 1.0;
    case "mock": return 0.6;
    default: return 0.5;
  }
}

/**
 * Score based on whether the Dafny solver agrees with the finding.
 * If Dafny verification failed (couldn't prove the invariant), that
 * corroborates the counterexample. If verified, the counterexample
 * may be a false positive from the bounded search.
 */
export function scoreSolverAgreement(
  verifyResult: VerifyResult,
  findingKind: string,
): number {
  if (findingKind === "counterexample") {
    // For counterexamples: solver failure = agreement, verification = disagreement
    switch (verifyResult.status) {
      case "failed": return 1.0;   // solver also couldn't prove it — strong agreement
      case "verified": return 0.2; // solver proved it safe — counterexample may be spurious
      case "skipped": return 0.5;  // no solver data
    }
  }
  // For verification-failure findings (no counterexample trace)
  switch (verifyResult.status) {
    case "failed": return 0.8;
    case "verified": return 0.1;
    case "skipped": return 0.5;
  }
}

/**
 * Score based on source-language replay results (from A4).
 * When replay is available, it's the strongest signal.
 */
export function scoreReplayConfirmation(
  replay: ReplayResult | undefined,
): number {
  if (!replay) return 0.5; // no replay data — neutral
  if (!replay.replayed) return 0.4; // replay attempted but couldn't execute
  return replay.reproduced ? 1.0 : 0.1; // reproduced in source = very high confidence
}

// ---------------------------------------------------------------------------
// Core scoring
// ---------------------------------------------------------------------------

export function computeBreakdown(
  finding: VerificationFinding,
  ctx: ScoringContext,
): ConfidenceBreakdown {
  const invariant = ctx.ir.invariants.find(
    (inv) => inv.name === finding.invariantName,
  );

  const replay = finding.invariantName
    ? ctx.replayResults?.get(finding.invariantName)
    : undefined;

  return {
    invariantConfidence: scoreInvariantConfidence(invariant),
    searchCoverage: scoreSearchCoverage(ctx.searchResult),
    translationQuality: scoreTranslationQuality(ctx.translationProvider),
    solverAgreement: scoreSolverAgreement(ctx.verifyResult, finding.kind),
    replayConfirmation: scoreReplayConfirmation(replay),
  };
}

export function computeScore(breakdown: ConfidenceBreakdown): number {
  return (
    WEIGHTS.invariantConfidence * breakdown.invariantConfidence +
    WEIGHTS.searchCoverage * breakdown.searchCoverage +
    WEIGHTS.translationQuality * breakdown.translationQuality +
    WEIGHTS.solverAgreement * breakdown.solverAgreement +
    WEIGHTS.replayConfirmation * breakdown.replayConfirmation
  );
}

export function classify(score: number): FindingClassification {
  if (score >= LIKELY_BUG_THRESHOLD) return "likely-bug";
  return "needs-review";
}

export function decideFiling(
  score: number,
  replay: ReplayResult | undefined,
): FilingDecision {
  // Auto-file when score is high enough AND either replay confirmed or no replay available
  if (score >= AUTO_FILE_THRESHOLD) {
    if (!replay || replay.reproduced) return "auto-file";
    return "manual-review"; // replay ran but didn't reproduce — don't auto-file
  }
  if (score < 0.4) return "suppress";
  return "manual-review";
}

// ---------------------------------------------------------------------------
// Safe invariant detection
// ---------------------------------------------------------------------------

function findSafeInvariants(
  ir: StateMachineIR,
  findings: VerificationFinding[],
  verifyResult: VerifyResult,
): string[] {
  const violatedNames = new Set(
    findings
      .map((f) => f.invariantName)
      .filter((n): n is string => n !== undefined),
  );

  // An invariant is proved safe if:
  //   1. No counterexample was found by bounded search, AND
  //   2. Dafny verification succeeded (solver confirmed)
  if (verifyResult.status !== "verified") return [];

  return ir.invariants
    .filter((inv) => !violatedNames.has(inv.name))
    .map((inv) => inv.name);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Score all findings and produce a confidence report.
 */
export function scoreFindings(ctx: ScoringContext): ConfidenceReport {
  const findings = ctx.searchResult.counterexamples.length > 0
    ? buildFindingsFromCtx(ctx)
    : [];

  const scoredFindings: ScoredFinding[] = findings.map((finding) => {
    const breakdown = computeBreakdown(finding, ctx);
    const score = computeScore(breakdown);
    const replay = finding.invariantName
      ? ctx.replayResults?.get(finding.invariantName)
      : undefined;

    return {
      finding,
      score,
      classification: classify(score),
      filingDecision: decideFiling(score, replay),
      breakdown,
    };
  });

  const safeInvariants = findSafeInvariants(
    ctx.ir,
    findings,
    ctx.verifyResult,
  );

  // Mark safe invariants as proved-safe (they don't appear as findings,
  // so we just track them in the summary)
  const summary: ConfidenceSummary = {
    totalInvariants: ctx.ir.invariants.length,
    provedSafe: safeInvariants.length,
    likelyBugs: scoredFindings.filter((sf) => sf.classification === "likely-bug").length,
    needsReview: scoredFindings.filter((sf) => sf.classification === "needs-review").length,
    autoFileCount: scoredFindings.filter((sf) => sf.filingDecision === "auto-file").length,
  };

  return { scoredFindings, safeInvariants, summary };
}

/**
 * Reconstruct minimal findings from the scoring context.
 * (Avoids requiring callers to pass findings separately.)
 */
function buildFindingsFromCtx(ctx: ScoringContext): VerificationFinding[] {
  // Import dynamically would create a circular dep — inline minimal conversion
  return ctx.searchResult.counterexamples.map((trace) => ({
    kind: "counterexample" as const,
    title: `${trace.failingInvariant} violated`,
    explanation: `Bounded search found a ${trace.steps.length}-step violating trace.`,
    invariantName: trace.failingInvariant,
    normalizedTrace: ["init", ...trace.steps.map((s) => s.action)].join(" -> "),
  }));
}

/**
 * Render confidence report as markdown for inclusion in proof-summary output.
 */
export function renderConfidenceMarkdown(report: ConfidenceReport): string {
  const lines: string[] = [
    "## Confidence Scoring",
    "",
    `- Total invariants: ${report.summary.totalInvariants}`,
    `- Proved safe: ${report.summary.provedSafe}`,
    `- Likely bugs: ${report.summary.likelyBugs}`,
    `- Needs review: ${report.summary.needsReview}`,
    `- Auto-file: ${report.summary.autoFileCount}`,
    "",
  ];

  if (report.safeInvariants.length > 0) {
    lines.push("### Proved Safe");
    lines.push("");
    for (const name of report.safeInvariants) {
      lines.push(`- \`${name}\``);
    }
    lines.push("");
  }

  if (report.scoredFindings.length > 0) {
    lines.push("### Scored Findings");
    lines.push("");
    for (const sf of report.scoredFindings) {
      const pct = (sf.score * 100).toFixed(0);
      lines.push(
        `- **${sf.finding.invariantName ?? "unknown"}**: ` +
        `score=${pct}% → \`${sf.classification}\` (filing: \`${sf.filingDecision}\`)`,
      );
      lines.push(
        `  - invariant=${(sf.breakdown.invariantConfidence * 100).toFixed(0)}% ` +
        `search=${(sf.breakdown.searchCoverage * 100).toFixed(0)}% ` +
        `translation=${(sf.breakdown.translationQuality * 100).toFixed(0)}% ` +
        `solver=${(sf.breakdown.solverAgreement * 100).toFixed(0)}% ` +
        `replay=${(sf.breakdown.replayConfirmation * 100).toFixed(0)}%`,
      );
    }
    lines.push("");
  }

  return lines.join("\n");
}
