import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  validateIR,
  type StateMachineIR,
} from "../contracts/state-machine-schema.js";

export type LlmDiscoveryResult =
  | {
      kind: "state-machine";
      provider: "claude";
      model: string;
      ir: StateMachineIR;
      requestText: string;
      responseText: string;
    }
  | {
      kind: "not-a-state-machine";
      provider: "claude";
      model: string;
      reason: string;
      requestText: string;
      responseText: string;
    };

type RawLlmDiscoveryResponse =
  | {
      kind: "state-machine";
      ir: StateMachineIR;
    }
  | {
      kind: "not-a-state-machine";
      reason: string;
    };

export async function discoverStateMachineWithLlm(args: {
  filePath: string;
  promptPath: string;
  apiKey: string;
}): Promise<LlmDiscoveryResult> {
  const model = "claude-sonnet-4-5";
  const prompt = await readFile(args.promptPath, "utf8");
  const sourceText = await readFile(args.filePath, "utf8");
  const relativeSourcePath = path.relative(process.cwd(), args.filePath);

  const requestText = [
    prompt,
    "",
    "File path:",
    relativeSourcePath,
    "",
    "TypeScript source:",
    sourceText,
  ].join("\n");

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": args.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 4000,
      messages: [{ role: "user", content: requestText }],
    }),
  });

  if (!response.ok) {
    throw new Error(
      `Claude discovery request failed with ${response.status}: ${await response.text()}`,
    );
  }

  const payload = (await response.json()) as {
    content: { type: string; text: string }[];
  };

  const outputText = payload.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();

  if (!outputText) {
    throw new Error("Claude discovery response did not contain any text blocks.");
  }

  const parsed = parseLlmDiscoveryResponse(outputText, args.filePath);
  const responseText = JSON.stringify(payload, null, 2);

  if (parsed.kind === "not-a-state-machine") {
    return {
      kind: "not-a-state-machine",
      provider: "claude",
      model,
      reason: parsed.reason,
      requestText,
      responseText,
    };
  }

  return {
    kind: "state-machine",
    provider: "claude",
    model,
    ir: parsed.ir,
    requestText,
    responseText,
  };
}

export function parseLlmDiscoveryResponse(
  rawText: string,
  filePath?: string,
): RawLlmDiscoveryResponse {
  const jsonText = sanitizeClaudeJsonOutput(rawText);
  const parsed = JSON.parse(jsonText) as Partial<RawLlmDiscoveryResponse>;

  if (parsed.kind === "not-a-state-machine") {
    if (typeof parsed.reason !== "string" || !parsed.reason.trim()) {
      throw new Error(
        "LLM discovery returned kind \"not-a-state-machine\" without a reason.",
      );
    }

    return {
      kind: "not-a-state-machine",
      reason: parsed.reason.trim(),
    };
  }

  if (parsed.kind !== "state-machine" || !parsed.ir) {
    throw new Error(
      "LLM discovery must return either { kind: \"state-machine\", ir: ... } or { kind: \"not-a-state-machine\", reason: ... }.",
    );
  }

  const ir = normalizeDiscoveredIR(parsed.ir, filePath);
  const errors = validateIR(ir);
  if (errors.length > 0) {
    throw new Error(`LLM discovery returned invalid IR:\n  ${errors.join("\n  ")}`);
  }

  return {
    kind: "state-machine",
    ir,
  };
}

function normalizeDiscoveredIR(
  ir: StateMachineIR,
  filePath: string | undefined,
): StateMachineIR {
  const normalized: StateMachineIR = {
    ...ir,
    sourceFile:
      ir.sourceFile && ir.sourceFile.trim()
        ? ir.sourceFile
        : filePath
          ? path.relative(process.cwd(), filePath)
          : undefined,
    discoveryPattern:
      ir.discoveryPattern && ir.discoveryPattern.trim()
        ? ir.discoveryPattern
        : "llm-claude-direct-ir",
  };

  if (!normalized.name.trim()) {
    throw new Error("LLM discovery returned an IR with an empty name.");
  }

  if (!normalized.description.trim()) {
    throw new Error("LLM discovery returned an IR with an empty description.");
  }

  return normalized;
}

function sanitizeClaudeJsonOutput(rawText: string): string {
  let text = rawText.trim();

  const fencedBlock = text.match(/^```(?:json)?\s*\n([\s\S]*?)\n```$/i);
  if (fencedBlock) {
    text = fencedBlock[1]!.trim();
  } else {
    text = text.replace(/^```(?:json)?\s*/i, "").replace(/\n```$/i, "").trim();
  }

  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    text = text.slice(firstBrace, lastBrace + 1);
  }

  if (!text.startsWith("{")) {
    throw new Error(
      "Claude discovery returned text that does not contain a JSON object.",
    );
  }

  return text;
}
