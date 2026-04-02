import {
  createFindingFingerprint,
  renderProofSummaryMarkdown,
  type VerificationFinding,
  type VerificationReport,
} from "../reports/proof-summary.js";

export type IssueDraft = {
  title: string;
  body: string;
  labels: string[];
  fingerprint: string;
};

export function buildIssueDraft(args: {
  report: VerificationReport;
  finding: VerificationFinding;
  runUrl?: string;
}): IssueDraft {
  const fingerprint = createFindingFingerprint(args.report, args.finding);
  const title = buildIssueTitle(args.report, args.finding);
  const labels = ["invariant", "needs-human-triage"];

  const lines = [
    `<!-- invariant-fingerprint:${fingerprint} -->`,
    `<!-- invariant-machine:${args.report.machine} -->`,
    "## Summary",
    "",
    `Invariant found a verification problem for \`${args.report.machine}\` in \`${args.report.sourceFile}\`.`,
    "",
    "## Finding",
    "",
    `- Title: ${args.finding.title}`,
    `- Explanation: ${args.finding.explanation}`,
  ];

  if (args.finding.invariantName) {
    lines.push(`- Invariant: \`${args.finding.invariantName}\``);
  }

  const normalizedTrace = args.finding.normalizedTrace ?? args.finding.counterexample?.normalizedTrace;
  if (normalizedTrace) {
    lines.push(`- Normalized trace: \`${normalizedTrace}\``);
  } else {
    lines.push("- Normalized trace: not available yet");
  }

  if (args.runUrl) {
    lines.push(`- CI run: [view workflow run](${args.runUrl})`);
  }

  lines.push("", "## Proof Summary", "", renderProofSummaryMarkdown(args.report).trim(), "", "## Notes", "", "- This issue is marked `needs-human-triage` until source replay confirms the failure.");

  return {
    title,
    body: `${lines.join("\n")}\n`,
    labels,
    fingerprint,
  };
}

function buildIssueTitle(report: VerificationReport, finding: VerificationFinding): string {
  const invariantName = finding.invariantName ? `: ${finding.invariantName}` : "";
  return `[Invariant] ${report.machine}${invariantName}`;
}
