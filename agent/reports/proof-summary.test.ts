import { describe, it, expect } from "vitest";
import {
  getVerificationFindings,
  createFindingFingerprint,
  renderSummaryText,
  renderProofSummaryMarkdown,
  type VerificationReport,
  type VerificationFinding,
} from "./proof-summary.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeReport(overrides: Partial<VerificationReport> = {}): VerificationReport {
  return {
    machine: "AuthMachine",
    discoveryPattern: "login-flow",
    sourceFile: "src/auth.ts",
    provider: "anthropic",
    model: "claude-3-opus",
    generatedFile: "out/auth.dfy",
    verification: {
      status: "verified",
      exitCode: 0,
      stdout: "",
      stderr: "",
    },
    ...overrides,
  };
}

function makeFinding(overrides: Partial<VerificationFinding> = {}): VerificationFinding {
  return {
    kind: "verification-failure",
    title: "AuthMachine verification failed",
    explanation: "Invariant violated on transition login",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// getVerificationFindings
// ---------------------------------------------------------------------------

describe("getVerificationFindings", () => {
  it("returns explicit findings when present", () => {
    const findings = [makeFinding()];
    const report = makeReport({ findings });
    expect(getVerificationFindings(report)).toEqual(findings);
  });

  it("returns empty array for verified status with no findings", () => {
    const report = makeReport({ verification: { status: "verified", exitCode: 0, stdout: "", stderr: "" } });
    expect(getVerificationFindings(report)).toEqual([]);
  });

  it("returns empty array for skipped status with no findings", () => {
    const report = makeReport({ verification: { status: "skipped", exitCode: null, stdout: "", stderr: "" } });
    expect(getVerificationFindings(report)).toEqual([]);
  });

  it("generates synthetic finding for failed status with no findings", () => {
    const report = makeReport({
      verification: { status: "failed", exitCode: 1, stdout: "", stderr: "error: assertion violation" },
    });
    const result = getVerificationFindings(report);
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe("AuthMachine verification failed");
  });

  it("synthetic finding uses stderr for explanation", () => {
    const report = makeReport({
      verification: { status: "failed", exitCode: 1, stdout: "some stdout", stderr: "  stderr message  " },
    });
    const result = getVerificationFindings(report);
    expect(result[0].explanation).toBe("stderr message");
  });

  it("synthetic finding uses stdout when stderr is empty", () => {
    const report = makeReport({
      verification: { status: "failed", exitCode: 1, stdout: " stdout output ", stderr: "" },
    });
    const result = getVerificationFindings(report);
    expect(result[0].explanation).toBe("stdout output");
  });

  it("synthetic finding has default message when both stdout and stderr are empty", () => {
    const report = makeReport({
      verification: { status: "failed", exitCode: 1, stdout: "", stderr: "" },
    });
    const result = getVerificationFindings(report);
    expect(result[0].explanation).toBe("Dafny verification failed without additional output.");
  });

  it("synthetic finding kind is 'verification-failure'", () => {
    const report = makeReport({
      verification: { status: "failed", exitCode: 1, stdout: "", stderr: "err" },
    });
    const result = getVerificationFindings(report);
    expect(result[0].kind).toBe("verification-failure");
  });

  it("empty findings array treated same as undefined", () => {
    const report = makeReport({
      findings: [],
      verification: { status: "failed", exitCode: 1, stdout: "", stderr: "err" },
    });
    const result = getVerificationFindings(report);
    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe("verification-failure");
  });
});

// ---------------------------------------------------------------------------
// createFindingFingerprint
// ---------------------------------------------------------------------------

describe("createFindingFingerprint", () => {
  it("returns a 16 character hex string", () => {
    const fp = createFindingFingerprint(makeReport(), makeFinding());
    expect(fp).toMatch(/^[0-9a-f]{16}$/);
  });

  it("same inputs produce same fingerprint", () => {
    const report = makeReport();
    const finding = makeFinding();
    const fp1 = createFindingFingerprint(report, finding);
    const fp2 = createFindingFingerprint(report, finding);
    expect(fp1).toBe(fp2);
  });

  it("different machine names produce different fingerprints", () => {
    const finding = makeFinding();
    const fp1 = createFindingFingerprint(makeReport({ machine: "MachineA" }), finding);
    const fp2 = createFindingFingerprint(makeReport({ machine: "MachineB" }), finding);
    expect(fp1).not.toBe(fp2);
  });

  it("different source files produce different fingerprints", () => {
    const finding = makeFinding();
    const fp1 = createFindingFingerprint(makeReport({ sourceFile: "a.ts" }), finding);
    const fp2 = createFindingFingerprint(makeReport({ sourceFile: "b.ts" }), finding);
    expect(fp1).not.toBe(fp2);
  });

  it("different discovery patterns produce different fingerprints", () => {
    const finding = makeFinding();
    const fp1 = createFindingFingerprint(makeReport({ discoveryPattern: "pattern-a" }), finding);
    const fp2 = createFindingFingerprint(makeReport({ discoveryPattern: "pattern-b" }), finding);
    expect(fp1).not.toBe(fp2);
  });

  it("different finding kinds produce different fingerprints", () => {
    const report = makeReport();
    const fp1 = createFindingFingerprint(report, makeFinding({ kind: "verification-failure" }));
    const fp2 = createFindingFingerprint(report, makeFinding({ kind: "counterexample" }));
    expect(fp1).not.toBe(fp2);
  });

  it("uses finding.normalizedTrace when available", () => {
    const report = makeReport();
    const finding = makeFinding({
      normalizedTrace: "trace-on-finding",
      counterexample: { normalizedTrace: "trace-on-cx" },
    });
    // Changing finding.normalizedTrace should change fp
    const fp1 = createFindingFingerprint(report, finding);
    const fp2 = createFindingFingerprint(report, makeFinding({
      normalizedTrace: "different-trace",
      counterexample: { normalizedTrace: "trace-on-cx" },
    }));
    expect(fp1).not.toBe(fp2);
  });

  it("falls back to counterexample.normalizedTrace", () => {
    const report = makeReport();
    const finding = makeFinding({
      counterexample: { normalizedTrace: "cx-trace" },
    });
    // Should differ from the no-trace fallback
    const findingNoTrace = makeFinding({});
    const fp1 = createFindingFingerprint(report, finding);
    const fp2 = createFindingFingerprint(report, findingNoTrace);
    expect(fp1).not.toBe(fp2);
  });

  it("falls back to 'no-trace' when neither normalizedTrace is available", () => {
    const report = makeReport();
    const finding = makeFinding({});
    // Two findings with no trace should produce the same fp
    const fp1 = createFindingFingerprint(report, finding);
    const fp2 = createFindingFingerprint(report, makeFinding({}));
    expect(fp1).toBe(fp2);
  });

  it("uses finding.invariantName when available", () => {
    const report = makeReport();
    const fp1 = createFindingFingerprint(report, makeFinding({
      invariantName: "inv-a",
      counterexample: { failingInvariant: "inv-cx" },
    }));
    const fp2 = createFindingFingerprint(report, makeFinding({
      invariantName: "inv-b",
      counterexample: { failingInvariant: "inv-cx" },
    }));
    expect(fp1).not.toBe(fp2);
  });

  it("falls back to counterexample.failingInvariant", () => {
    const report = makeReport();
    const fp1 = createFindingFingerprint(report, makeFinding({
      counterexample: { failingInvariant: "cx-inv" },
    }));
    const fp2 = createFindingFingerprint(report, makeFinding({}));
    expect(fp1).not.toBe(fp2);
  });

  it("falls back to 'unknown-invariant'", () => {
    const report = makeReport();
    const fp1 = createFindingFingerprint(report, makeFinding({}));
    const fp2 = createFindingFingerprint(report, makeFinding({}));
    expect(fp1).toBe(fp2);
  });
});

// ---------------------------------------------------------------------------
// renderSummaryText
// ---------------------------------------------------------------------------

describe("renderSummaryText", () => {
  const report = makeReport({
    machine: "PaymentMachine",
    sourceFile: "src/payment.ts",
    discoveryPattern: "checkout-flow",
    provider: "openai",
    model: "gpt-4",
    generatedFile: "out/payment.dfy",
    verification: { status: "verified", exitCode: 0, stdout: "", stderr: "" },
  });
  const text = renderSummaryText(report);

  it("contains machine name", () => {
    expect(text).toContain("machine: PaymentMachine");
  });

  it("contains source_file", () => {
    expect(text).toContain("source_file: src/payment.ts");
  });

  it("contains discovery_pattern", () => {
    expect(text).toContain("discovery_pattern: checkout-flow");
  });

  it("contains provider", () => {
    expect(text).toContain("provider: openai");
  });

  it("contains model", () => {
    expect(text).toContain("model: gpt-4");
  });

  it("contains generated_file", () => {
    expect(text).toContain("generated_file: out/payment.dfy");
  });

  it("contains verification_status", () => {
    expect(text).toContain("verification_status: verified");
  });

  it("contains dafny_exit_code when present", () => {
    expect(text).toContain("dafny_exit_code: 0");
  });

  it("omits dafny_exit_code when exitCode is null", () => {
    const r = makeReport({ verification: { status: "skipped", exitCode: null, stdout: "", stderr: "" } });
    expect(renderSummaryText(r)).not.toContain("dafny_exit_code");
  });

  it("contains reason when present", () => {
    const r = makeReport({
      verification: { status: "skipped", exitCode: null, stdout: "", stderr: "", reason: "Timeout" },
    });
    expect(renderSummaryText(r)).toContain("reason: Timeout");
  });

  it("omits reason when not present", () => {
    expect(text).not.toContain("reason:");
  });

  it("ends with newline", () => {
    expect(text.endsWith("\n")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// renderProofSummaryMarkdown
// ---------------------------------------------------------------------------

describe("renderProofSummaryMarkdown", () => {
  it("contains '## Verification Summary' header", () => {
    const md = renderProofSummaryMarkdown(makeReport());
    expect(md).toContain("## Verification Summary");
  });

  it("contains machine in backticks", () => {
    const md = renderProofSummaryMarkdown(makeReport({ machine: "TestMachine" }));
    expect(md).toContain("`TestMachine`");
  });

  it("contains source file in backticks", () => {
    const md = renderProofSummaryMarkdown(makeReport({ sourceFile: "src/foo.ts" }));
    expect(md).toContain("`src/foo.ts`");
  });

  it("contains '## Findings' header", () => {
    const md = renderProofSummaryMarkdown(makeReport());
    expect(md).toContain("## Findings");
  });

  it("shows 'No verification findings' for verified report", () => {
    const md = renderProofSummaryMarkdown(makeReport());
    expect(md).toContain("No verification findings");
  });

  it("shows finding title as ### header for failed report", () => {
    const finding = makeFinding({ title: "Critical failure" });
    const report = makeReport({ findings: [finding] });
    const md = renderProofSummaryMarkdown(report);
    expect(md).toContain("### Critical failure");
  });

  it("shows finding explanation", () => {
    const finding = makeFinding({ explanation: "The invariant was violated" });
    const report = makeReport({ findings: [finding] });
    const md = renderProofSummaryMarkdown(report);
    expect(md).toContain("The invariant was violated");
  });

  it("shows invariant name when present", () => {
    const finding = makeFinding({ invariantName: "NoDoubleLogin" });
    const report = makeReport({ findings: [finding] });
    const md = renderProofSummaryMarkdown(report);
    expect(md).toContain("`NoDoubleLogin`");
  });

  it("shows normalized trace when present", () => {
    const finding = makeFinding({ normalizedTrace: "init->login->login" });
    const report = makeReport({ findings: [finding] });
    const md = renderProofSummaryMarkdown(report);
    expect(md).toContain("`init->login->login`");
  });

  it("shows counterexample replay steps when present", () => {
    const finding = makeFinding({
      counterexample: {
        steps: [
          { action: "login", beforeState: "LoggedOut", afterState: "LoggedIn" },
          { action: "login", beforeState: "LoggedIn", afterState: "Error" },
        ],
      },
    });
    const report = makeReport({ findings: [finding] });
    const md = renderProofSummaryMarkdown(report);
    expect(md).toContain("Counterexample replay:");
    expect(md).toContain("`login`");
    expect(md).toContain("`LoggedOut`");
    expect(md).toContain("`LoggedIn`");
    expect(md).toContain("`Error`");
  });

  it("contains exit code when present", () => {
    const report = makeReport({
      verification: { status: "failed", exitCode: 2, stdout: "", stderr: "err" },
      findings: [makeFinding()],
    });
    const md = renderProofSummaryMarkdown(report);
    expect(md).toContain("`2`");
  });

  it("contains reason when present", () => {
    const report = makeReport({
      verification: { status: "failed", exitCode: 1, stdout: "", stderr: "err", reason: "Timeout exceeded" },
      findings: [makeFinding()],
    });
    const md = renderProofSummaryMarkdown(report);
    expect(md).toContain("Timeout exceeded");
  });
});
