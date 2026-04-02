import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { buildIssueDraft } from "./issue-template.js";
import { getVerificationFindings, renderProofSummaryMarkdown, type VerificationReport } from "../reports/proof-summary.js";

type GitHubIssue = {
  number: number;
  title: string;
  body: string | null;
};

type GitHubContext = {
  token: string;
  repository: string;
  serverUrl: string;
  runId?: string;
};

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const reportPath = process.env.INVARIANT_REPORT_PATH ?? path.join(repoRoot, "artifacts/phase1/report.json");
const enableIssueFiling = process.env.INVARIANT_ENABLE_ISSUE_FILING === "true";
const dryRun = process.env.INVARIANT_DRY_RUN === "true";

async function main(): Promise<void> {
  if (!enableIssueFiling) {
    process.stdout.write("Issue filing disabled. Set INVARIANT_ENABLE_ISSUE_FILING=true to enable.\n");
    return;
  }

  const report = await readJson<VerificationReport>(reportPath);
  if (report.verification.status !== "failed") {
    process.stdout.write(`Issue filing skipped because verification status is ${report.verification.status}.\n`);
    return;
  }

  const findings = getVerificationFindings(report);
  if (findings.length === 0) {
    process.stdout.write("Issue filing skipped because there are no findings.\n");
    return;
  }

  const context = getGitHubContext();
  if (!context.token || !context.repository) {
    process.stdout.write("Issue filing skipped because GITHUB_TOKEN or GITHUB_REPOSITORY is unavailable.\n");
    return;
  }

  const githubContext = context as GitHubContext;

  const runUrl = githubContext.runId ? `${githubContext.serverUrl}/${githubContext.repository}/actions/runs/${githubContext.runId}` : undefined;
  for (const finding of findings) {
    const draft = buildIssueDraft({ report, finding, runUrl });

    if (dryRun) {
      process.stdout.write(`DRY RUN issue title: ${draft.title}\n`);
      process.stdout.write(`${draft.body}\n`);
      continue;
    }

    await ensureLabel(githubContext, "invariant");
    await ensureLabel(githubContext, "needs-human-triage");

    const existingIssue = await findOpenIssueByFingerprint(githubContext, draft.fingerprint);
    if (existingIssue) {
      await createIssueComment(
        githubContext,
        existingIssue.number,
        buildDuplicateComment(report, runUrl),
      );
      process.stdout.write(`Updated existing issue #${existingIssue.number} for fingerprint ${draft.fingerprint}.\n`);
      continue;
    }

    const createdIssue = await createIssue(githubContext, draft.title, draft.body, draft.labels);
    process.stdout.write(`Created issue #${createdIssue.number} for fingerprint ${draft.fingerprint}.\n`);
  }
}

function buildDuplicateComment(report: VerificationReport, runUrl?: string): string {
  const lines = [
    "A new CI run produced the same verification finding fingerprint.",
    "",
    renderProofSummaryMarkdown(report).trim(),
  ];

  if (runUrl) {
    lines.splice(2, 0, `Workflow run: [view run](${runUrl})`, "");
  }

  return `${lines.join("\n")}\n`;
}

function getGitHubContext(): {
  token: string | undefined;
  repository: string | undefined;
  serverUrl: string;
  runId: string | undefined;
} {
  return {
    token: process.env.GITHUB_TOKEN,
    repository: process.env.GITHUB_REPOSITORY,
    serverUrl: process.env.GITHUB_SERVER_URL ?? "https://github.com",
    runId: process.env.GITHUB_RUN_ID,
  };
}

async function ensureLabel(
  context: { token: string; repository: string },
  labelName: string,
): Promise<void> {
  const [owner, repo] = context.repository.split("/");
  const response = await githubRequest({
    context,
    method: "GET",
    path: `/repos/${owner}/${repo}/labels/${encodeURIComponent(labelName)}`,
    allowNotFound: true,
  });

  if (response.status !== 404) {
    return;
  }

  await githubRequest({
    context,
    method: "POST",
    path: `/repos/${owner}/${repo}/labels`,
    body: {
      name: labelName,
      color: labelName === "needs-human-triage" ? "fbca04" : "5319e7",
      description: labelName === "needs-human-triage" ? "Invariant finding awaiting human validation." : "Invariant verification finding.",
    },
  });
}

async function findOpenIssueByFingerprint(
  context: { token: string; repository: string },
  fingerprint: string,
): Promise<GitHubIssue | undefined> {
  const [owner, repo] = context.repository.split("/");
  const response = await githubRequest({
    context,
    method: "GET",
    path: `/repos/${owner}/${repo}/issues?state=open&per_page=100`,
  });

  const issues = (await response.json()) as GitHubIssue[];
  return issues.find((issue) => (issue.body ?? "").includes(`invariant-fingerprint:${fingerprint}`));
}

async function createIssue(
  context: { token: string; repository: string },
  title: string,
  body: string,
  labels: string[],
): Promise<GitHubIssue> {
  const [owner, repo] = context.repository.split("/");
  const response = await githubRequest({
    context,
    method: "POST",
    path: `/repos/${owner}/${repo}/issues`,
    body: { title, body, labels },
  });

  return (await response.json()) as GitHubIssue;
}

async function createIssueComment(
  context: { token: string; repository: string },
  issueNumber: number,
  body: string,
): Promise<void> {
  const [owner, repo] = context.repository.split("/");
  await githubRequest({
    context,
    method: "POST",
    path: `/repos/${owner}/${repo}/issues/${issueNumber}/comments`,
    body: { body },
  });
}

async function githubRequest(args: {
  context: { token: string; repository: string };
  method: "GET" | "POST";
  path: string;
  body?: unknown;
  allowNotFound?: boolean;
}): Promise<Response> {
  const response = await fetch(`https://api.github.com${args.path}`, {
    method: args.method,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${args.context.token}`,
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: args.body ? JSON.stringify(args.body) : undefined,
  });

  if (args.allowNotFound && response.status === 404) {
    return response;
  }

  if (!response.ok) {
    throw new Error(`GitHub request failed (${response.status}) for ${args.method} ${args.path}: ${await response.text()}`);
  }

  return response;
}

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, "utf8")) as T;
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
