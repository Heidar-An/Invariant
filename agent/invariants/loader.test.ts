import { describe, it, expect, afterEach } from "vitest";
import { writeFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadFileInvariants, mergeInvariants } from "./loader.js";

// Helper to build an Invariant object
function inv(
  expression: string,
  source: "annotation" | "file" | "llm" = "annotation",
  opts: { name?: string; description?: string; confidence?: number } = {},
) {
  return {
    name: opts.name ?? `inv_${expression}`,
    description: opts.description ?? `desc for ${expression}`,
    expression,
    source,
    confidence: opts.confidence ?? 1.0,
  };
}

// ---------------------------------------------------------------------------
// loadFileInvariants
// ---------------------------------------------------------------------------

describe("loadFileInvariants", () => {
  const tempDir = path.join(tmpdir(), "invariant-loader-test-" + process.pid);
  const tempFile = path.join(tempDir, ".invariants.json");

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("returns empty array when file does not exist", async () => {
    const result = await loadFileInvariants("/tmp/does-not-exist-xyz.json");
    expect(result).toEqual([]);
  });

  it("loads invariants from a valid JSON file", async () => {
    await mkdir(tempDir, { recursive: true });
    await writeFile(
      tempFile,
      JSON.stringify({
        invariants: [
          {
            name: "non_negative",
            description: "balance is non-negative",
            expression: "m.balance >= 0",
          },
        ],
      }),
    );

    const result = await loadFileInvariants(tempFile);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      name: "non_negative",
      description: "balance is non-negative",
      expression: "m.balance >= 0",
      source: "file",
      confidence: 1.0,
    });
  });

  it("sets source to 'file' and confidence to 1.0 on every loaded invariant", async () => {
    await mkdir(tempDir, { recursive: true });
    await writeFile(
      tempFile,
      JSON.stringify({
        invariants: [
          { name: "a", description: "d1", expression: "m.a > 0" },
          { name: "b", description: "d2", expression: "m.b < 10" },
        ],
      }),
    );

    const result = await loadFileInvariants(tempFile);
    for (const inv of result) {
      expect(inv.source).toBe("file");
      expect(inv.confidence).toBe(1.0);
    }
  });

  it("loads multiple invariants", async () => {
    await mkdir(tempDir, { recursive: true });
    await writeFile(
      tempFile,
      JSON.stringify({
        invariants: [
          { name: "a", description: "d1", expression: "m.x > 0" },
          { name: "b", description: "d2", expression: "m.y > 0" },
          { name: "c", description: "d3", expression: "m.z > 0" },
        ],
      }),
    );

    const result = await loadFileInvariants(tempFile);
    expect(result).toHaveLength(3);
  });

  it("preserves name, description, and expression from the file", async () => {
    await mkdir(tempDir, { recursive: true });
    await writeFile(
      tempFile,
      JSON.stringify({
        invariants: [
          {
            name: "uniqueName",
            description: "a unique description",
            expression: "m.counter <= m.max",
          },
        ],
      }),
    );

    const result = await loadFileInvariants(tempFile);
    expect(result[0].name).toBe("uniqueName");
    expect(result[0].description).toBe("a unique description");
    expect(result[0].expression).toBe("m.counter <= m.max");
  });
});

// ---------------------------------------------------------------------------
// mergeInvariants
// ---------------------------------------------------------------------------

describe("mergeInvariants", () => {
  it("returns empty array when both inputs are empty", () => {
    expect(mergeInvariants([], [])).toEqual([]);
  });

  it("returns existing unchanged when additional is empty", () => {
    const existing = [inv("m.x > 0")];
    expect(mergeInvariants(existing, [])).toEqual(existing);
  });

  it("returns additional when existing is empty", () => {
    const additional = [inv("m.x > 0", "file")];
    expect(mergeInvariants([], additional)).toEqual(additional);
  });

  it("includes all invariants when there are no duplicates", () => {
    const existing = [inv("m.x > 0")];
    const additional = [inv("m.y > 0", "file")];
    const merged = mergeInvariants(existing, additional);
    expect(merged).toHaveLength(2);
    expect(merged[0].expression).toBe("m.x > 0");
    expect(merged[1].expression).toBe("m.y > 0");
  });

  it("deduplicates by expression, keeping the existing one", () => {
    const existing = [inv("m.x >= 0", "annotation", { name: "existing_inv" })];
    const additional = [inv("m.x >= 0", "file", { name: "additional_inv" })];
    const merged = mergeInvariants(existing, additional);
    expect(merged).toHaveLength(1);
    expect(merged[0].name).toBe("existing_inv");
    expect(merged[0].source).toBe("annotation");
  });

  it("filters multiple duplicates", () => {
    const existing = [inv("m.a > 0"), inv("m.b > 0")];
    const additional = [inv("m.a > 0", "file"), inv("m.b > 0", "file"), inv("m.c > 0", "file")];
    const merged = mergeInvariants(existing, additional);
    expect(merged).toHaveLength(3);
    expect(merged.map((i) => i.expression)).toEqual(["m.a > 0", "m.b > 0", "m.c > 0"]);
  });

  it("deduplicates when names differ but expression is the same", () => {
    const existing = [inv("m.balance >= 0", "annotation", { name: "alpha" })];
    const additional = [inv("m.balance >= 0", "file", { name: "beta" })];
    const merged = mergeInvariants(existing, additional);
    expect(merged).toHaveLength(1);
    expect(merged[0].name).toBe("alpha");
  });

  it("keeps both when names match but expressions differ", () => {
    const existing = [inv("m.x > 0", "annotation", { name: "same_name" })];
    const additional = [inv("m.x < 100", "file", { name: "same_name" })];
    const merged = mergeInvariants(existing, additional);
    expect(merged).toHaveLength(2);
    expect(merged[0].expression).toBe("m.x > 0");
    expect(merged[1].expression).toBe("m.x < 100");
  });

  it("preserves order: existing first, then additional in order", () => {
    const existing = [inv("e1"), inv("e2")];
    const additional = [inv("a1", "file"), inv("a2", "file"), inv("a3", "file")];
    const merged = mergeInvariants(existing, additional);
    expect(merged.map((i) => i.expression)).toEqual(["e1", "e2", "a1", "a2", "a3"]);
  });

  it("handles a large merge with partial overlap", () => {
    const existing = Array.from({ length: 10 }, (_, i) => inv(`m.f${i} > 0`));
    // additional has 5 overlapping (f0..f4) and 5 new (f10..f14)
    const additional = [
      ...Array.from({ length: 5 }, (_, i) => inv(`m.f${i} > 0`, "file")),
      ...Array.from({ length: 5 }, (_, i) => inv(`m.f${i + 10} > 0`, "file")),
    ];
    const merged = mergeInvariants(existing, additional);
    expect(merged).toHaveLength(15);
    // first 10 are the originals, next 5 are the new ones
    for (let i = 0; i < 10; i++) {
      expect(merged[i].expression).toBe(`m.f${i} > 0`);
      expect(merged[i].source).toBe("annotation");
    }
    for (let i = 0; i < 5; i++) {
      expect(merged[10 + i].expression).toBe(`m.f${i + 10} > 0`);
      expect(merged[10 + i].source).toBe("file");
    }
  });

  it("merges three sources sequentially with dedup at each step", () => {
    // Step 1: annotation invariants
    const annotations = [
      inv("m.x >= 0", "annotation"),
      inv("m.y >= 0", "annotation"),
    ];

    // Step 2: merge file invariants (one overlaps)
    const fileInvariants = [
      inv("m.y >= 0", "file"),   // duplicate
      inv("m.z >= 0", "file"),   // new
    ];
    const afterFile = mergeInvariants(annotations, fileInvariants);
    expect(afterFile).toHaveLength(3);
    // The m.y >= 0 should still be source "annotation"
    expect(afterFile.find((i) => i.expression === "m.y >= 0")!.source).toBe("annotation");

    // Step 3: merge LLM invariants (one overlaps with file, one with annotation)
    const llmInvariants = [
      inv("m.x >= 0", "llm", { confidence: 0.7 }),  // duplicate of annotation
      inv("m.z >= 0", "llm", { confidence: 0.7 }),  // duplicate of file
      inv("m.w >= 0", "llm", { confidence: 0.7 }),  // new
    ];
    const afterLlm = mergeInvariants(afterFile, llmInvariants);
    expect(afterLlm).toHaveLength(4);
    expect(afterLlm.map((i) => i.expression)).toEqual([
      "m.x >= 0",
      "m.y >= 0",
      "m.z >= 0",
      "m.w >= 0",
    ]);
    // annotation and file versions win over LLM
    expect(afterLlm.find((i) => i.expression === "m.x >= 0")!.source).toBe("annotation");
    expect(afterLlm.find((i) => i.expression === "m.z >= 0")!.source).toBe("file");
    expect(afterLlm.find((i) => i.expression === "m.w >= 0")!.source).toBe("llm");
  });
});
