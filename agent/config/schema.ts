export type TranslatorProviderSetting = "auto" | "mock" | "claude";
export type DiscoveryProviderSetting = "auto" | "ast" | "claude";
export type DiscoveryReviewMode = "off" | "require";

export type DiscoveryReviewPolicy = {
  mode: DiscoveryReviewMode;
  approvalEnvVar: string;
};

export type ActionDepthBounds = {
  proofMaxDepth: number;
  witnessMaxDepth: number;
  replayMaxDepth: number;
};

export type IssueFilingMode = "disabled" | "dry-run" | "create";

export type IssueFilingPolicy = {
  mode: IssueFilingMode;
  requireHumanTriageLabel: boolean;
};

export type InvariantSelectionPolicy = {
  enforce: string[];
};

export type RolloutStage = "sample" | "shadow" | "pilot";

export type RolloutStrategy = {
  stage: RolloutStage;
  pilotTarget?: string;
  requireHumanReviewForGeneratedInvariants: boolean;
  notes: string[];
};

export type InvariantTargetConfig = {
  name?: string;
  sourceFile: string;
  enabled?: boolean;
  invariants?: Partial<InvariantSelectionPolicy>;
  actionDepthBounds?: Partial<ActionDepthBounds>;
  issueFiling?: Partial<IssueFilingPolicy>;
};

export type InvariantRepoConfig = {
  defaultSourceFile: string;
  artifactsDir: string;
  replayArtifactsDir: string;
  discoveryProvider: DiscoveryProviderSetting;
  discoveryReview: DiscoveryReviewPolicy;
  translatorProvider: TranslatorProviderSetting;
  proposeInvariants: boolean;
  defaults: {
    actionDepthBounds: ActionDepthBounds;
    issueFiling: IssueFilingPolicy;
    invariants: InvariantSelectionPolicy;
  };
  rollout: RolloutStrategy;
  targets: InvariantTargetConfig[];
};

export function defineInvariantConfig(config: InvariantRepoConfig): InvariantRepoConfig {
  return config;
}
