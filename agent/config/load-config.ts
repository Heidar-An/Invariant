import path from "node:path";
import { fileURLToPath } from "node:url";

import invariantConfig from "../../invariant.config.js";
import type {
  ActionDepthBounds,
  InvariantRepoConfig,
  InvariantSelectionPolicy,
  InvariantTargetConfig,
  IssueFilingMode,
  IssueFilingPolicy,
  TranslatorProviderSetting,
} from "./schema.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export type ResolvedInvariantTargetConfig = {
  name: string;
  sourceFile: string;
  sourceFileRelative: string;
  enabled: boolean;
  invariants: InvariantSelectionPolicy;
  actionDepthBounds: ActionDepthBounds;
  issueFiling: IssueFilingPolicy;
};

export type ResolvedInvariantRepoConfig = Omit<
  InvariantRepoConfig,
  "defaultSourceFile" | "artifactsDir" | "replayArtifactsDir" | "targets"
> & {
  defaultSourceFile: string;
  defaultSourceFileRelative: string;
  artifactsDir: string;
  artifactsDirRelative: string;
  replayArtifactsDir: string;
  replayArtifactsDirRelative: string;
  targets: ResolvedInvariantTargetConfig[];
};

export function resolveInvariantConfig(): ResolvedInvariantRepoConfig {
  const defaults = invariantConfig.defaults;

  return {
    ...invariantConfig,
    defaultSourceFile: resolveRepoPath(invariantConfig.defaultSourceFile),
    defaultSourceFileRelative: toRelativeRepoPath(invariantConfig.defaultSourceFile),
    artifactsDir: resolveRepoPath(invariantConfig.artifactsDir),
    artifactsDirRelative: toRelativeRepoPath(invariantConfig.artifactsDir),
    replayArtifactsDir: resolveRepoPath(invariantConfig.replayArtifactsDir),
    replayArtifactsDirRelative: toRelativeRepoPath(invariantConfig.replayArtifactsDir),
    targets: invariantConfig.targets.map((target) => {
      const sourceFile = resolveRepoPath(target.sourceFile);

      return {
        name: target.name ?? path.basename(sourceFile, path.extname(sourceFile)),
        sourceFile,
        sourceFileRelative: path.relative(repoRoot, sourceFile),
        enabled: target.enabled ?? true,
        invariants: {
          enforce: target.invariants?.enforce ?? defaults.invariants.enforce,
        },
        actionDepthBounds: {
          proofMaxDepth:
            target.actionDepthBounds?.proofMaxDepth ?? defaults.actionDepthBounds.proofMaxDepth,
          witnessMaxDepth:
            target.actionDepthBounds?.witnessMaxDepth ?? defaults.actionDepthBounds.witnessMaxDepth,
          replayMaxDepth:
            target.actionDepthBounds?.replayMaxDepth ?? defaults.actionDepthBounds.replayMaxDepth,
        },
        issueFiling: {
          mode: target.issueFiling?.mode ?? defaults.issueFiling.mode,
          requireHumanTriageLabel:
            target.issueFiling?.requireHumanTriageLabel
            ?? defaults.issueFiling.requireHumanTriageLabel,
        },
      };
    }),
  };
}

export function resolveTargetConfig(
  sourceFile: string | undefined,
  config: ResolvedInvariantRepoConfig = resolveInvariantConfig(),
): ResolvedInvariantTargetConfig {
  if (sourceFile) {
    const resolvedSourceFile = resolveRepoPath(sourceFile);
    const configured = config.targets.find((target) => target.sourceFile === resolvedSourceFile);
    if (configured) {
      return configured;
    }

    return {
      name: path.basename(resolvedSourceFile, path.extname(resolvedSourceFile)),
      sourceFile: resolvedSourceFile,
      sourceFileRelative: path.relative(repoRoot, resolvedSourceFile),
      enabled: true,
      invariants: config.defaults.invariants,
      actionDepthBounds: config.defaults.actionDepthBounds,
      issueFiling: config.defaults.issueFiling,
    };
  }

  const enabledTarget = config.targets.find((target) => target.enabled);
  if (enabledTarget) {
    return enabledTarget;
  }

  return resolveTargetConfig(config.defaultSourceFile, config);
}

export function resolveTranslatorProviderSetting(
  configured: TranslatorProviderSetting,
  apiKeyPresent: boolean,
): "mock" | "claude" {
  if (configured === "mock" || configured === "claude") {
    return configured;
  }

  return apiKeyPresent ? "claude" : "mock";
}

export function resolveIssueFilingMode(args: {
  envEnabled?: string;
  envDryRun?: string;
  configuredMode: IssueFilingMode;
}): IssueFilingMode {
  const dryRunOverride = parseBooleanEnv(args.envDryRun);
  if (dryRunOverride === true) {
    return "dry-run";
  }

  const enabledOverride = parseBooleanEnv(args.envEnabled);
  if (enabledOverride === true) {
    return "create";
  }
  if (enabledOverride === false) {
    return "disabled";
  }

  return args.configuredMode;
}

export function parseBooleanEnv(value: string | undefined): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "true") {
    return true;
  }
  if (normalized === "false") {
    return false;
  }

  return undefined;
}

export function getRepoRoot(): string {
  return repoRoot;
}

function resolveRepoPath(filePath: string): string {
  return path.isAbsolute(filePath)
    ? path.normalize(filePath)
    : path.resolve(repoRoot, filePath);
}

function toRelativeRepoPath(filePath: string): string {
  return path.relative(repoRoot, resolveRepoPath(filePath));
}
