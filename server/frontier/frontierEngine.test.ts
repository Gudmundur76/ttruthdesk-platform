/**
 * frontier/frontierEngine.test.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Unit tests for frontier/frontierEngine.ts — runFrontierEngine().
 * The engine orchestrates 5 stages; each is non-fatal on error.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockRunGapMapper, mockRankAllOpenGaps, mockPursueTopGaps, mockRunHypothesisGenerator, mockMarkStaleGaps } =
  vi.hoisted(() => ({
    mockRunGapMapper: vi.fn(),
    mockRankAllOpenGaps: vi.fn(),
    mockPursueTopGaps: vi.fn(),
    mockRunHypothesisGenerator: vi.fn(),
    mockMarkStaleGaps: vi.fn(),
  }));

vi.mock("./gapMapper", () => ({ runGapMapper: mockRunGapMapper, detectEvidenceGapForDocument: vi.fn() }));
vi.mock("./gapRanker", () => ({
  rankAllOpenGaps: mockRankAllOpenGaps,
  getTopGaps: vi.fn().mockResolvedValue([]),
  computePriorityScore: vi.fn(),
}));
vi.mock("./evidencePursuer", () => ({
  pursueTopGaps: mockPursueTopGaps,
  pursueGap: vi.fn(),
  closeGap: vi.fn(),
}));
vi.mock("./hypothesisGenerator", () => ({
  runHypothesisGenerator: mockRunHypothesisGenerator,
  recordHypothesisOutcome: vi.fn(),
}));
vi.mock("./uncertaintyTracker", () => ({
  markStaleGaps: mockMarkStaleGaps,
  getFrontierMetrics: vi.fn().mockResolvedValue({ totalGapsDetected: 0, closedVerified: 0, closedResolved: 0 }),
  getGapTimeline: vi.fn().mockResolvedValue([]),
}));

import { runFrontierEngine } from "./frontierEngine";

const defaultGapMapping = { structural: 0, evidence: 0, contradiction: 0, temporal: 0, total: 0, newGapsCreated: 2 };
const defaultHypothesis = { hypothesesGenerated: 1, queueItemsCreated: 1, hypotheses: [] };

describe("frontier/frontierEngine — runFrontierEngine()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRunGapMapper.mockResolvedValue(defaultGapMapping);
    mockRankAllOpenGaps.mockResolvedValue(5);
    mockPursueTopGaps.mockResolvedValue([{ gapId: 1, status: "evidence_found" }]);
    mockRunHypothesisGenerator.mockResolvedValue(defaultHypothesis);
    mockMarkStaleGaps.mockResolvedValue(3);
  });

  it("returns a FrontierEngineRunResult with all stage fields", async () => {
    const result = await runFrontierEngine();
    expect(result).toHaveProperty("gapMapping");
    expect(result).toHaveProperty("gapsRanked");
    expect(result).toHaveProperty("pursuitResults");
    expect(result).toHaveProperty("hypothesisGeneration");
    expect(result).toHaveProperty("staleGapsMarked");
    expect(result).toHaveProperty("durationMs");
  });

  it("reports correct counts from each stage", async () => {
    const result = await runFrontierEngine();
    expect(result.gapMapping.newGapsCreated).toBe(2);
    expect(result.gapsRanked).toBe(5);
    expect(result.pursuitResults).toHaveLength(1);
    expect(result.hypothesisGeneration.hypothesesGenerated).toBe(1);
    expect(result.staleGapsMarked).toBe(3);
  });

  it("durationMs is a positive number", async () => {
    const result = await runFrontierEngine();
    expect(result.durationMs).toBeGreaterThan(0);
  });

  it("continues when gap mapping fails (non-fatal)", async () => {
    mockRunGapMapper.mockRejectedValue(new Error("gap mapper error"));
    const result = await runFrontierEngine();
    expect(result.gapMapping.newGapsCreated).toBe(0);
    expect(result.gapsRanked).toBe(5); // other stages still run
  });

  it("continues when gap ranking fails (non-fatal)", async () => {
    mockRankAllOpenGaps.mockRejectedValue(new Error("ranking error"));
    const result = await runFrontierEngine();
    expect(result.gapsRanked).toBe(0);
    expect(result.pursuitResults).toHaveLength(1); // pursuit still runs
  });

  it("continues when evidence pursuit fails (non-fatal)", async () => {
    mockPursueTopGaps.mockRejectedValue(new Error("pursuit error"));
    const result = await runFrontierEngine();
    expect(result.pursuitResults).toHaveLength(0);
    expect(result.hypothesisGeneration.hypothesesGenerated).toBe(1); // hypothesis still runs
  });

  it("continues when hypothesis generation fails (non-fatal)", async () => {
    mockRunHypothesisGenerator.mockRejectedValue(new Error("hypothesis error"));
    const result = await runFrontierEngine();
    expect(result.hypothesisGeneration.hypothesesGenerated).toBe(0);
    expect(result.staleGapsMarked).toBe(3); // stale cleanup still runs
  });

  it("continues when stale gap cleanup fails (non-fatal)", async () => {
    mockMarkStaleGaps.mockRejectedValue(new Error("stale cleanup error"));
    const result = await runFrontierEngine();
    expect(result.staleGapsMarked).toBe(0);
    expect(result.gapsRanked).toBe(5); // other stages unaffected
  });
});
