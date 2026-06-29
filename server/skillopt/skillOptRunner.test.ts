/**
 * skillOptRunner.test.ts — Tests for the SkillOpt optimization loop
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { writeFileSync, mkdirSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { runSkillOpt, type SkillOptConfig } from "./skillOptRunner";

// ─── Mocks ────────────────────────────────────────────────────────────────────

// Mock multiLLM — controls LLM-generated candidates
vi.mock("../_core/multiLLM", () => ({
  invokeMultiLLM: vi.fn().mockResolvedValue({
    choices: [
      {
        message: {
          content:
            "Improved instruction: Extract SPECIFIC, VERIFIABLE claims with entity names and measurable values. Return JSON array.",
        },
      },
    ],
  }),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(() => {
  tmpDir = join(tmpdir(), `skillopt-runner-test-${Date.now()}`);
  mkdirSync(tmpDir, { recursive: true });
});

afterEach(() => {
  if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true });
  vi.clearAllMocks();
});

function writeGroundTruth(filename: string, count: number): string {
  const path = join(tmpDir, filename);
  const lines = Array.from({ length: count }, (_, i) => ({
    claimText: `Protein ${i} binds receptor ${i} with Kd of ${i + 1} nM.`,
    expectedVerdict: ["Supported", "Contradicted", "Ambiguous"][i % 3],
    expectedConfidenceMin: 0.6,
    expectedConfidenceMax: 1.0,
    humanReviewed: true,
  }));
  writeFileSync(path, lines.map(l => JSON.stringify(l)).join("\n") + "\n");
  return path;
}

function baseConfig(overrides: Partial<SkillOptConfig> = {}): SkillOptConfig {
  return {
    instructionSet: "claim_extraction",
    groundTruthPath: join(tmpDir, "gt.jsonl"),
    targetF1: 0.85,
    maxIterations: 3,
    budgetUsd: 1.0,
    candidateCount: 3,
    outputDir: tmpDir,
    persist: false,
    ...overrides,
  };
}

// ─── runSkillOpt ──────────────────────────────────────────────────────────────

describe("runSkillOpt", () => {
  it("returns a SkillOptResult with required fields", async () => {
    writeGroundTruth("gt.jsonl", 20);
    const result = await runSkillOpt(baseConfig());
    expect(result).toHaveProperty("instructionSet", "claim_extraction");
    expect(result).toHaveProperty("finalF1");
    expect(result).toHaveProperty("iterations");
    expect(result).toHaveProperty("convergenceReason");
    expect(result).toHaveProperty("durationMs");
    expect(result).toHaveProperty("costUsd");
    expect(typeof result.finalF1).toBe("number");
    expect(typeof result.iterations).toBe("number");
    expect(typeof result.convergenceReason).toBe("string");
    expect(typeof result.durationMs).toBe("number");
  });

  it("respects maxIterations limit", async () => {
    writeGroundTruth("gt.jsonl", 20);
    const result = await runSkillOpt(baseConfig({ maxIterations: 2, targetF1: 0.99 }));
    expect(result.iterations).toBeLessThanOrEqual(2);
  });

  it("runs without ground truth file (heuristic mode)", async () => {
    // Non-existent ground truth → heuristic evaluation
    const result = await runSkillOpt(
      baseConfig({
        groundTruthPath: join(tmpDir, "nonexistent.jsonl"),
        maxIterations: 2,
      })
    );
    expect(result).toHaveProperty("finalF1");
    expect(result.iterations).toBeGreaterThanOrEqual(1);
  });

  it("sets convergenceReason=target_reached when target is already met", async () => {
    writeGroundTruth("gt.jsonl", 20);
    // Very low target — should converge on first iteration
    const result = await runSkillOpt(baseConfig({ targetF1: 0.0, maxIterations: 5 }));
    expect(result.convergenceReason).toBe("target_reached");
  });

  it("sets convergenceReason=max_iterations when target is unreachable", async () => {
    writeGroundTruth("gt.jsonl", 20);
    const result = await runSkillOpt(
      baseConfig({ targetF1: 0.99, maxIterations: 2 })
    );
    // With only 2 iterations and a very high target, should hit max_iterations or no_improvement
    expect(["max_iterations", "no_improvement", "consecutive_plateau", "budget_exhausted"]).toContain(result.convergenceReason);
    expect(result.iterations).toBeLessThanOrEqual(2);
  });

  it("does not write to disk when persist=false", async () => {
    writeGroundTruth("gt.jsonl", 20);
    const outputDir = join(tmpDir, "output");
    mkdirSync(outputDir, { recursive: true });
    await runSkillOpt(baseConfig({ persist: false, outputDir, maxIterations: 1 }));
    // No instruction file should be written
    const { readdirSync } = await import("fs");
    const files = readdirSync(outputDir);
    expect(files.filter(f => f.endsWith(".txt"))).toHaveLength(0);
  });

  it("works for evidence_lookup instruction set", async () => {
    writeGroundTruth("gt.jsonl", 20);
    const result = await runSkillOpt(
      baseConfig({ instructionSet: "evidence_lookup", maxIterations: 1 })
    );
    expect(result.instructionSet).toBe("evidence_lookup");
  });

  it("works for confidence_scoring instruction set", async () => {
    writeGroundTruth("gt.jsonl", 20);
    const result = await runSkillOpt(
      baseConfig({ instructionSet: "confidence_scoring", maxIterations: 1 })
    );
    expect(result.instructionSet).toBe("confidence_scoring");
  });

  it("durationMs is a positive number", async () => {
    writeGroundTruth("gt.jsonl", 5);
    const result = await runSkillOpt(baseConfig({ maxIterations: 1 }));
    expect(result.durationMs).toBeGreaterThan(0);
  });
});
