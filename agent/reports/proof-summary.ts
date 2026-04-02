import { createHash } from "node:crypto";

import type { SourceReplayResult } from "../replay/source-replay.js";

export type VerificationStatus = "verified" | "failed" | "skipped";

export type VerifyResult = {
  status: VerificationStatus;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  reason?: string;
};

export type VerificationCounterexample = {
  failingInvariant?: string;
  normalizedTrace?: string;
  steps?: Array<{
    action: string;
    beforeState?: string;
    afterState?: string;
  }>;
  sourceReplay?: SourceReplayResult;
};

export type VerificationFinding = {
  kind: "verification-failure" | "counterexample";
  title: string;
  explanation: string;
  invariantName?: string;
  normalizedTrace?: string;
  counterexample?: VerificationCounterexample;
};

export type VerificationReport = {
  machine: string;
  discoveryPattern: string;
  sourceFile: string;
  provider: string;
  model: string;
  generatedFile: string;
  verification: VerifyResult;
  findings?: VerificationFinding[];
};

export function getVerificationFindings(report: VerificationReport): VerificationFinding[] {
  if (report.findings && report.findings.length > 0) {
    return report.findings;
  }

  if (report.verification.status !== "failed") {
    return [];
  }

  return [
    {
      kind: "verification-failure",
      title: `${report.machine} verification failed`,
      explanation: report.verification.stderr.trim() || report.verification.stdout.trim() || "Dafny verification failed without additional output.",
    },
  ];
}

export function createFindingFingerprint(report: VerificationReport, finding: VerificationFinding): string {
  const normalizedTrace = finding.normalizedTrace ?? finding.counterexample?.normalizedTrace ?? "no-trace";
  const invariantName = finding.invariantName ?? finding.counterexample?.failingInvariant ?? "unknown-invariant";
  const raw = [
    report.machine,
    report.sourceFile,
    report.discoveryPattern,
    finding.kind,
    invariantName,
    normalizedTrace,
  ].join("|");

  return createHash("sha256").update(raw).digest("hex").slice(0, 16);
}

export function renderSummaryText(report: VerificationReport): string {
  const lines = [
    `machine: ${report.machine}`,
    `source_file: ${report.sourceFile}`,
    `discovery_pattern: ${report.discoveryPattern}`,
    `provider: ${report.provider}`,
    `model: ${report.model}`,
    `generated_file: ${report.generatedFile}`,
    `verification_status: ${report.verification.status}`,
  ];

  if (report.verification.exitCode !== null) {
    lines.push(`dafny_exit_code: ${report.verification.exitCode}`);
  }

  if (report.verification.reason) {
    lines.push(`reason: ${report.verification.reason}`);
  }

  return `${lines.join("\n")}\n`;
}

export function renderProofSummaryMarkdown(report: VerificationReport): string {
  const findings = getVerificationFindings(report);
  const lines = [
    "## Verification Summary",
    "",
    `- Machine: \`${report.machine}\``,
    `- Source file: \`${report.sourceFile}\``,
    `- Discovery pattern: \`${report.discoveryPattern}\``,
    `- Translator provider: \`${report.provider}\``,
    `- Translator model: \`${report.model}\``,
    `- Generated Dafny: \`${report.generatedFile}\``,
    `- Verification status: \`${report.verification.status}\``,
  ];

  if (report.verification.exitCode !== null) {
    lines.push(`- Dafny exit code: \`${report.verification.exitCode}\``);
  }

  if (report.verification.reason) {
    lines.push(`- Reason: ${report.verification.reason}`);
  }

  lines.push("", "## Findings", "");

  if (findings.length === 0) {
    lines.push("- No verification findings were emitted.");
  } else {
    for (const finding of findings) {
      lines.push(`### ${finding.title}`, "");
      lines.push(finding.explanation, "");

      const normalizedTrace = finding.normalizedTrace ?? finding.counterexample?.normalizedTrace;
      if (finding.invariantName) {
        lines.push(`- Invariant: \`${finding.invariantName}\``);
      }
      if (normalizedTrace) {
        lines.push(`- Normalized trace: \`${normalizedTrace}\``);
      }

      const steps = finding.counterexample?.steps ?? [];
      if (steps.length > 0) {
        lines.push("", "Counterexample replay:");
        for (const step of steps) {
          lines.push(`- \`${step.action}\` | before: \`${step.beforeState ?? "unknown"}\` | after: \`${step.afterState ?? "unknown"}\``);
        }
      }

      const sourceReplay = finding.counterexample?.sourceReplay;
      if (sourceReplay) {
        lines.push(
          "",
          `- Source replay status: \`${sourceReplay.status}\``,
          `- Source replay trace: \`${sourceReplay.normalizedTrace}\``,
        );

        if (sourceReplay.targetInvariant) {
          lines.push(`- Source replay target invariant: \`${sourceReplay.targetInvariant}\``);
        }

        if (sourceReplay.failedInvariantNames.length > 0) {
          lines.push(`- Source replay failed invariants: \`${sourceReplay.failedInvariantNames.join(", ")}\``);
        }

        if (sourceReplay.error) {
          lines.push(`- Source replay error: ${sourceReplay.error}`);
        }
      }

      lines.push("");
    }
  }

  return `${lines.join("\n")}\n`;
}
