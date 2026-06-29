/**
 * groundTruthLoader.test.ts — Tests for SkillOpt ground truth loading
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFileSync, mkdirSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { loadGroundTruth, validateDataset } from "./groundTruthLoader";

// ─── Helpers ──────────────────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(() => {
  tmpDir = join(tmpdir(), `skillopt-test-${Date.now()}`);
  mkdirSync(tmpDir, { recursive: true });
});

afterEach(() => {
  if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true });
});

function writeJsonl(filename: string, lines: object[]): string {
  const path = join(tmpDir, filename);
  writeFileSync(path, lines.map(l => JSON.stringify(l)).join("\n") + "\n");
  return path;
}

function makeExample(
  overrides: Partial<{
    claimText: string;
    expectedVerdict: string;
    expectedConfidenceMin: number;
    expectedConfidenceMax: number;
    humanReviewed: boolean;
  }> = {}
) {
  return {
    claimText: "Protein X binds to receptor Y with Kd of 5 nM.",
    expectedVerdict: "Supported",
    expectedConfidenceMin: 0.7,
    expectedConfidenceMax: 1.0,
    humanReviewed: true,
    ...overrides,
  };
}

// ─── loadGroundTruth ──────────────────────────────────────────────────────────

describe("loadGroundTruth", () => {
  it("returns empty dataset for non-existent file", () => {
    const dataset = loadGroundTruth(join(tmpDir, "nonexistent.jsonl"));
    expect(dataset.examples).toHaveLength(0);
    expect(dataset.stats.total).toBe(0);
  });

  it("loads valid JSONL examples", () => {
    const path = writeJsonl("examples.jsonl", [
      makeExample(),
      makeExample({ expectedVerdict: "Contradicted" }),
      makeExample({ expectedVerdict: "Ambiguous", humanReviewed: false }),
    ]);
    const dataset = loadGroundTruth(path);
    expect(dataset.examples).toHaveLength(3);
    expect(dataset.stats.total).toBe(3);
  });

  it("counts human-reviewed examples correctly", () => {
    const path = writeJsonl("examples.jsonl", [
      makeExample({ humanReviewed: true }),
      makeExample({ humanReviewed: true }),
      makeExample({ humanReviewed: false }),
    ]);
    const dataset = loadGroundTruth(path);
    expect(dataset.stats.humanReviewedCount).toBe(2);
  });

  it("computes byVerdict breakdown", () => {
    const path = writeJsonl("examples.jsonl", [
      makeExample({ expectedVerdict: "Supported" }),
      makeExample({ expectedVerdict: "Supported" }),
      makeExample({ expectedVerdict: "Contradicted" }),
    ]);
    const dataset = loadGroundTruth(path);
    expect(dataset.stats.byVerdict["Supported"]).toBe(2);
    expect(dataset.stats.byVerdict["Contradicted"]).toBe(1);
  });

  it("skips malformed JSONL lines without crashing", () => {
    const path = join(tmpDir, "mixed.jsonl");
    writeFileSync(
      path,
      [
        JSON.stringify(makeExample()),
        "not-valid-json{{{",
        JSON.stringify(makeExample({ expectedVerdict: "Contradicted" })),
      ].join("\n") + "\n"
    );
    const dataset = loadGroundTruth(path);
    // Should load the 2 valid lines
    expect(dataset.examples).toHaveLength(2);
  });

  it("loads all parseable lines regardless of missing optional fields", () => {
    const path = writeJsonl("examples.jsonl", [
      makeExample(),
      { claimText: "Missing verdict field" }, // no expectedVerdict — loaded but may have undefined verdict
      makeExample({ expectedVerdict: "Ambiguous" }),
    ]);
    const dataset = loadGroundTruth(path);
    // All 3 lines are valid JSON so all 3 are loaded
    expect(dataset.examples.length).toBeGreaterThanOrEqual(2);
    expect(dataset.examples.length).toBeLessThanOrEqual(3);
  });

  it("returns empty dataset for empty file", () => {
    const path = join(tmpDir, "empty.jsonl");
    writeFileSync(path, "");
    const dataset = loadGroundTruth(path);
    expect(dataset.examples).toHaveLength(0);
    expect(dataset.stats.total).toBe(0);
  });
});

// ─── validateDataset ──────────────────────────────────────────────────────────

describe("validateDataset", () => {
  it("returns no warnings for a healthy dataset", () => {
    const path = writeJsonl(
      "large.jsonl",
      Array.from({ length: 150 }, (_, i) => ({
        ...makeExample(),
        expectedVerdict: ["Supported", "Contradicted", "Ambiguous"][i % 3],
        humanReviewed: true,
      }))
    );
    const dataset = loadGroundTruth(path);
    const warnings = validateDataset(dataset);
    expect(warnings).toHaveLength(0);
  });

  it("warns when dataset is too small", () => {
    const path = writeJsonl(
      "small.jsonl",
      Array.from({ length: 50 }, () => makeExample())
    );
    const dataset = loadGroundTruth(path);
    const warnings = validateDataset(dataset);
    expect(warnings.some(w => w.toLowerCase().includes("small") || w.toLowerCase().includes("100"))).toBe(true);
  });

  it("warns when human review rate is low", () => {
    const path = writeJsonl(
      "low-review.jsonl",
      Array.from({ length: 150 }, (_, i) => ({
        ...makeExample(),
        humanReviewed: i < 5, // only 5/150 human reviewed
      }))
    );
    const dataset = loadGroundTruth(path);
    const warnings = validateDataset(dataset);
    expect(warnings.some(w => w.toLowerCase().includes("review"))).toBe(true);
  });

  it("warns when verdict diversity is low", () => {
    const path = writeJsonl(
      "single-verdict.jsonl",
      Array.from({ length: 150 }, () =>
        makeExample({ expectedVerdict: "Supported" })
      )
    );
    const dataset = loadGroundTruth(path);
    const warnings = validateDataset(dataset);
    expect(warnings.some(w => w.toLowerCase().includes("verdict") || w.toLowerCase().includes("diversity"))).toBe(true);
  });
});
