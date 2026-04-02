import { describe, it, expect } from "vitest";
import { buildIssueDraft } from "./issue-template.js";
import type {
  VerificationFinding,
  VerificationReport,
} from "../reports/proof-summary.js";

function makeReport(overrides: Partial<VerificationReport> = {}): VerificationReport {
  return {
    machine: "OrderMachine",
    discoveryPattern: "order/*.ts",
    sourceFile: "src/order/machine.ts",
    provider: "anthropic",
    model: "claude-opus-4-20250514",
    generatedFile: "out/OrderMachine.dfy",
    verification: {
      status: "failed",
      exitCode: 1,
      stdout: "",
      stderr: "invariant violation",
    },
    ...overrides,
  };
}

function makeFinding(overrides: Partial<VerificationFinding> = {}): VerificationFinding {
  return {
    kind: "verification-failure",
    title: "State invariant violated",
    explanation: "The invariant X >= 0 does not hold after transition Y.",
    ...overrides,
  };
}

describe("buildIssueDraft", () => {
  // ── Title ──────────────────────────────────────────────────────────

  describe("title", () => {
    it("formats title without invariant name as [Invariant] MachineName", () => {
      const draft = buildIssueDraft({
        report: makeReport(),
        finding: makeFinding(),
      });
      expect(draft.title).toBe("[Invariant] OrderMachine");
    });

    it("formats title with invariant name as [Invariant] MachineName: InvariantName", () => {
      const draft = buildIssueDraft({
        report: makeReport(),
        finding: makeFinding({ invariantName: "BalanceNonNegative" }),
      });
      expect(draft.title).toBe("[Invariant] OrderMachine: BalanceNonNegative");
    });

    it("uses machine name only when finding has no invariantName", () => {
      const draft = buildIssueDraft({
        report: makeReport({ machine: "PaymentMachine" }),
        finding: makeFinding({ invariantName: undefined }),
      });
      expect(draft.title).toBe("[Invariant] PaymentMachine");
    });

    it("reflects the report machine name", () => {
      const draft = buildIssueDraft({
        report: makeReport({ machine: "AuthMachine" }),
        finding: makeFinding(),
      });
      expect(draft.title).toContain("AuthMachine");
    });
  });

  // ── Labels ─────────────────────────────────────────────────────────

  describe("labels", () => {
    it('always includes "invariant"', () => {
      const draft = buildIssueDraft({
        report: makeReport(),
        finding: makeFinding(),
      });
      expect(draft.labels).toContain("invariant");
    });

    it('always includes "needs-human-triage"', () => {
      const draft = buildIssueDraft({
        report: makeReport(),
        finding: makeFinding(),
      });
      expect(draft.labels).toContain("needs-human-triage");
    });

    it("has exactly 2 labels", () => {
      const draft = buildIssueDraft({
        report: makeReport(),
        finding: makeFinding(),
      });
      expect(draft.labels).toHaveLength(2);
    });
  });

  // ── Fingerprint ────────────────────────────────────────────────────

  describe("fingerprint", () => {
    it("is a 16-character hex string", () => {
      const draft = buildIssueDraft({
        report: makeReport(),
        finding: makeFinding(),
      });
      expect(draft.fingerprint).toMatch(/^[0-9a-f]{16}$/);
    });

    it("is deterministic for the same inputs", () => {
      const args = { report: makeReport(), finding: makeFinding() };
      const a = buildIssueDraft(args);
      const b = buildIssueDraft(args);
      expect(a.fingerprint).toBe(b.fingerprint);
    });

    it("produces different fingerprints for different machines", () => {
      const a = buildIssueDraft({
        report: makeReport({ machine: "MachineA" }),
        finding: makeFinding(),
      });
      const b = buildIssueDraft({
        report: makeReport({ machine: "MachineB" }),
        finding: makeFinding(),
      });
      expect(a.fingerprint).not.toBe(b.fingerprint);
    });

    it("produces different fingerprints for different finding kinds", () => {
      const a = buildIssueDraft({
        report: makeReport(),
        finding: makeFinding({ kind: "verification-failure" }),
      });
      const b = buildIssueDraft({
        report: makeReport(),
        finding: makeFinding({ kind: "counterexample" }),
      });
      expect(a.fingerprint).not.toBe(b.fingerprint);
    });

    it("produces different fingerprints for different invariant names", () => {
      const a = buildIssueDraft({
        report: makeReport(),
        finding: makeFinding({ invariantName: "InvA" }),
      });
      const b = buildIssueDraft({
        report: makeReport(),
        finding: makeFinding({ invariantName: "InvB" }),
      });
      expect(a.fingerprint).not.toBe(b.fingerprint);
    });
  });

  // ── Body structure ─────────────────────────────────────────────────

  describe("body structure", () => {
    it("contains fingerprint HTML comment", () => {
      const draft = buildIssueDraft({
        report: makeReport(),
        finding: makeFinding(),
      });
      expect(draft.body).toMatch(/<!-- invariant-fingerprint:[0-9a-f]{16} -->/);
    });

    it("contains machine HTML comment", () => {
      const draft = buildIssueDraft({
        report: makeReport({ machine: "TestMachine" }),
        finding: makeFinding(),
      });
      expect(draft.body).toContain("<!-- invariant-machine:TestMachine -->");
    });

    it('contains "## Summary" header', () => {
      const draft = buildIssueDraft({
        report: makeReport(),
        finding: makeFinding(),
      });
      expect(draft.body).toContain("## Summary");
    });

    it('contains "## Finding" header', () => {
      const draft = buildIssueDraft({
        report: makeReport(),
        finding: makeFinding(),
      });
      expect(draft.body).toContain("## Finding");
    });

    it('contains "## Proof Summary" header', () => {
      const draft = buildIssueDraft({
        report: makeReport(),
        finding: makeFinding(),
      });
      expect(draft.body).toContain("## Proof Summary");
    });

    it('contains "## Notes" header', () => {
      const draft = buildIssueDraft({
        report: makeReport(),
        finding: makeFinding(),
      });
      expect(draft.body).toContain("## Notes");
    });

    it("contains triage note", () => {
      const draft = buildIssueDraft({
        report: makeReport(),
        finding: makeFinding(),
      });
      expect(draft.body).toContain("needs-human-triage");
      expect(draft.body).toContain("source replay confirms the failure");
    });

    it("ends with a newline", () => {
      const draft = buildIssueDraft({
        report: makeReport(),
        finding: makeFinding(),
      });
      expect(draft.body.endsWith("\n")).toBe(true);
    });
  });

  // ── Body finding details ───────────────────────────────────────────

  describe("body - finding details", () => {
    it("contains finding title", () => {
      const draft = buildIssueDraft({
        report: makeReport(),
        finding: makeFinding({ title: "Unique finding title here" }),
      });
      expect(draft.body).toContain("Unique finding title here");
    });

    it("contains finding explanation", () => {
      const draft = buildIssueDraft({
        report: makeReport(),
        finding: makeFinding({ explanation: "This is the explanation text." }),
      });
      expect(draft.body).toContain("This is the explanation text.");
    });

    it("contains invariant name when present", () => {
      const draft = buildIssueDraft({
        report: makeReport(),
        finding: makeFinding({ invariantName: "BalanceNonNegative" }),
      });
      expect(draft.body).toContain("`BalanceNonNegative`");
    });

    it("does not contain invariant line when invariantName is absent", () => {
      const draft = buildIssueDraft({
        report: makeReport(),
        finding: makeFinding({ invariantName: undefined }),
      });
      // The Finding section should not have an Invariant bullet
      const findingSection = draft.body.split("## Finding")[1].split("## Proof Summary")[0];
      expect(findingSection).not.toContain("- Invariant:");
    });

    it("contains normalized trace when present on finding", () => {
      const draft = buildIssueDraft({
        report: makeReport(),
        finding: makeFinding({ normalizedTrace: "init -> step1 -> step2" }),
      });
      expect(draft.body).toContain("`init -> step1 -> step2`");
    });

    it('shows "not available yet" when normalized trace is absent', () => {
      const draft = buildIssueDraft({
        report: makeReport(),
        finding: makeFinding({ normalizedTrace: undefined, counterexample: undefined }),
      });
      expect(draft.body).toContain("Normalized trace: not available yet");
    });

    it("contains run URL link when provided", () => {
      const url = "https://github.com/org/repo/actions/runs/12345";
      const draft = buildIssueDraft({
        report: makeReport(),
        finding: makeFinding(),
        runUrl: url,
      });
      expect(draft.body).toContain(`[view workflow run](${url})`);
    });

    it("omits run URL when not provided", () => {
      const draft = buildIssueDraft({
        report: makeReport(),
        finding: makeFinding(),
      });
      expect(draft.body).not.toContain("view workflow run");
      expect(draft.body).not.toContain("CI run:");
    });

    it("mentions the source file in summary", () => {
      const draft = buildIssueDraft({
        report: makeReport({ sourceFile: "src/auth/login.ts" }),
        finding: makeFinding(),
      });
      expect(draft.body).toContain("`src/auth/login.ts`");
    });

    it("mentions the machine name in summary text", () => {
      const draft = buildIssueDraft({
        report: makeReport({ machine: "CartMachine" }),
        finding: makeFinding(),
      });
      expect(draft.body).toContain("`CartMachine`");
    });
  });

  // ── Body counterexample ────────────────────────────────────────────

  describe("body - counterexample", () => {
    it("uses counterexample normalizedTrace when finding has no normalizedTrace", () => {
      const draft = buildIssueDraft({
        report: makeReport(),
        finding: makeFinding({
          normalizedTrace: undefined,
          counterexample: {
            normalizedTrace: "init -> badStep -> fail",
          },
        }),
      });
      expect(draft.body).toContain("`init -> badStep -> fail`");
      expect(draft.body).not.toContain("not available yet");
    });

    it("prefers finding normalizedTrace over counterexample normalizedTrace", () => {
      const draft = buildIssueDraft({
        report: makeReport(),
        finding: makeFinding({
          normalizedTrace: "finding-trace",
          counterexample: {
            normalizedTrace: "counterexample-trace",
          },
        }),
      });
      const findingSection = draft.body.split("## Finding")[1].split("## Proof Summary")[0];
      expect(findingSection).toContain("`finding-trace`");
    });

    it('shows "not available yet" when neither trace source exists', () => {
      const draft = buildIssueDraft({
        report: makeReport(),
        finding: makeFinding({
          normalizedTrace: undefined,
          counterexample: { failingInvariant: "SomeInv" },
        }),
      });
      const findingSection = draft.body.split("## Finding")[1].split("## Proof Summary")[0];
      expect(findingSection).toContain("not available yet");
    });
  });

  // ── Edge cases ─────────────────────────────────────────────────────

  describe("edge cases", () => {
    it("handles a very long machine name", () => {
      const longName = "A".repeat(300);
      const draft = buildIssueDraft({
        report: makeReport({ machine: longName }),
        finding: makeFinding(),
      });
      expect(draft.title).toBe(`[Invariant] ${longName}`);
      expect(draft.body).toContain(`<!-- invariant-machine:${longName} -->`);
    });

    it("handles finding with empty explanation", () => {
      const draft = buildIssueDraft({
        report: makeReport(),
        finding: makeFinding({ explanation: "" }),
      });
      expect(draft.body).toContain("- Explanation: ");
      // Should still produce a valid draft
      expect(draft.title).toBeTruthy();
      expect(draft.fingerprint).toMatch(/^[0-9a-f]{16}$/);
    });

    it("handles report with all optional fields populated", () => {
      const report = makeReport({
        machine: "FullMachine",
        verification: {
          status: "failed",
          exitCode: 4,
          stdout: "some stdout",
          stderr: "some stderr",
          reason: "assertion violation at line 42",
        },
        findings: [
          {
            kind: "counterexample",
            title: "Full finding",
            explanation: "Full explanation",
            invariantName: "CompleteInv",
            normalizedTrace: "init -> a -> b -> c",
            counterexample: {
              failingInvariant: "CompleteInv",
              normalizedTrace: "init -> a -> b -> c",
              steps: [
                { action: "a", beforeState: "s0", afterState: "s1" },
                { action: "b", beforeState: "s1", afterState: "s2" },
              ],
            },
          },
        ],
      });
      const finding = report.findings![0];
      const draft = buildIssueDraft({
        report,
        finding,
        runUrl: "https://github.com/org/repo/actions/runs/99999",
      });

      expect(draft.title).toBe("[Invariant] FullMachine: CompleteInv");
      expect(draft.labels).toEqual(["invariant", "needs-human-triage"]);
      expect(draft.fingerprint).toMatch(/^[0-9a-f]{16}$/);
      expect(draft.body).toContain("## Summary");
      expect(draft.body).toContain("## Finding");
      expect(draft.body).toContain("## Proof Summary");
      expect(draft.body).toContain("## Notes");
      expect(draft.body).toContain("`CompleteInv`");
      expect(draft.body).toContain("`init -> a -> b -> c`");
      expect(draft.body).toContain("view workflow run");
    });

    it("handles finding kind counterexample", () => {
      const draft = buildIssueDraft({
        report: makeReport(),
        finding: makeFinding({ kind: "counterexample" }),
      });
      // Should still produce a valid draft regardless of kind
      expect(draft.title).toBeTruthy();
      expect(draft.body).toContain("## Finding");
    });

    it("handles finding with counterexample steps but no trace", () => {
      const draft = buildIssueDraft({
        report: makeReport(),
        finding: makeFinding({
          normalizedTrace: undefined,
          counterexample: {
            steps: [
              { action: "deposit", beforeState: "{balance: 0}", afterState: "{balance: 100}" },
            ],
          },
        }),
      });
      // No trace available from either source
      const findingSection = draft.body.split("## Finding")[1].split("## Proof Summary")[0];
      expect(findingSection).toContain("not available yet");
    });

    it("fingerprint embedded in body matches returned fingerprint", () => {
      const draft = buildIssueDraft({
        report: makeReport(),
        finding: makeFinding(),
      });
      expect(draft.body).toContain(`<!-- invariant-fingerprint:${draft.fingerprint} -->`);
    });
  });
});
