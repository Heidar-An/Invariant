import { defineInvariantConfig } from "./agent/config/schema.js";

export default defineInvariantConfig({
  defaultSourceFile: "agent/examples/non_negative_counter.reducer.ts",
  artifactsDir: "artifacts/phase2",
  replayArtifactsDir: "artifacts/replay",
  discoveryProvider: "auto",
  discoveryReview: {
    mode: "require",
    approvalEnvVar: "INVARIANT_APPROVE_LLM_DISCOVERY",
  },
  translatorProvider: "auto",
  proposeInvariants: false,
  defaults: {
    actionDepthBounds: {
      proofMaxDepth: 1,
      witnessMaxDepth: 4,
      replayMaxDepth: 4,
    },
    issueFiling: {
      mode: "disabled",
      requireHumanTriageLabel: true,
    },
    invariants: {
      enforce: [],
    },
  },
  rollout: {
    stage: "shadow",
    pilotTarget: "agent/examples/non_negative_counter.reducer.ts",
    requireHumanReviewForGeneratedInvariants: true,
    notes: [
      "Keep the proof boundary small and explicit while discovery only supports the initial reducer shape.",
      "Promote one production-relevant reducer to pilot after trace generation and source replay are wired into confidence scoring.",
      "Keep automatic issue creation disabled until replay-confirmed findings are available for the pilot target.",
    ],
  },
  targets: [
    {
      name: "non-negative-counter-sample",
      sourceFile: "agent/examples/non_negative_counter.reducer.ts",
      enabled: true,
      invariants: {
        enforce: ["ValueNeverNegative"],
      },
      actionDepthBounds: {
        proofMaxDepth: 1,
        witnessMaxDepth: 4,
        replayMaxDepth: 4,
      },
      issueFiling: {
        mode: "disabled",
      },
    },
  ],
});
