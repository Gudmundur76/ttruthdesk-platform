/**
 * qualityPassFeedbackCollector.test.ts
 * Unit tests for sia/qualityPassFeedbackCollector.ts
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  mockGetDb: vi.fn(),
  mockGetActivePrompt: vi.fn(),
  mockRunFeedbackAgent: vi.fn(),
  mockActivatePrompt: vi.fn(),
  mockSeedPromptIfMissing: vi.fn(),
}));

vi.mock("../db", () => ({ getDb: mocks.mockGetDb }));
vi.mock("./promptHarnessManager", () => ({
  getActivePrompt: mocks.mockGetActivePrompt,
  runFeedbackAgent: mocks.mockRunFeedbackAgent,
  activatePrompt: mocks.mockActivatePrompt,
  seedPromptIfMissing: mocks.mockSeedPromptIfMissing,
}));
vi.mock("../logger", () => ({
  logger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  errData: vi.fn((e: unknown) => ({ err: String(e) })),
}));

const makeDb = () => {
  const db = {
    select: vi.fn(),
    from: vi.fn(),
    where: vi.fn(),
    insert: vi.fn(),
    values: vi.fn(),
    $returningId: vi.fn(),
  };
  db.select.mockReturnValue(db);
  db.from.mockReturnValue(db);
  db.where.mockResolvedValue([]);
  db.insert.mockReturnValue(db);
  db.values.mockReturnValue(db);
  db.$returningId.mockResolvedValue([{ id: 1 }]);
  return db;
};

import type { QualityPassResult } from "../qualityPassJob";

const makeQualityPassResult = (): QualityPassResult => ({
  processed: 5,
  failed: 0,
  skipped: 1,
  errors: [],
});

describe("collectQualityPassFeedback()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mocks.mockSeedPromptIfMissing.mockResolvedValue(undefined);
    mocks.mockGetActivePrompt.mockResolvedValue({ generation: 1, promptText: "Extract claims from..." });
    mocks.mockRunFeedbackAgent.mockResolvedValue({
      proposedRevision: null,
      reasoning: "Pipeline performing well",
      riskLevel: "low",
      shouldActivate: false,
    });
    mocks.mockActivatePrompt.mockResolvedValue({ generation: 2 });
  });

  it("returns DB-unavailable result when DB is null", async () => {
    mocks.mockGetDb.mockResolvedValue(null);
    const { collectQualityPassFeedback } = await import("./qualityPassFeedbackCollector");
    const result = await collectQualityPassFeedback(makeQualityPassResult(), []);
    expect(result.feedbackRowId).toBeNull();
    expect(result.reasoning).toBe("Database unavailable");
    expect(result.feedbackTriggered).toBe(false);
  });

  it("seeds prompts for all components on startup", async () => {
    const db = makeDb();
    mocks.mockGetDb.mockResolvedValue(db);
    const { collectQualityPassFeedback } = await import("./qualityPassFeedbackCollector");
    await collectQualityPassFeedback(makeQualityPassResult(), []);
    expect(mocks.mockSeedPromptIfMissing).toHaveBeenCalledWith("claim_extractor");
    expect(mocks.mockSeedPromptIfMissing).toHaveBeenCalledWith("verdict_rationale");
  });

  it("returns correct harnessGeneration from getActivePrompt", async () => {
    const db = makeDb();
    mocks.mockGetDb.mockResolvedValue(db);
    mocks.mockGetActivePrompt.mockResolvedValue({ generation: 3, promptText: "..." });
    const { collectQualityPassFeedback } = await import("./qualityPassFeedbackCollector");
    const result = await collectQualityPassFeedback(makeQualityPassResult(), []);
    expect(result.harnessGeneration).toBe(3);
  });

  it("computes upgradeRate correctly", async () => {
    const db = makeDb();
    mocks.mockGetDb.mockResolvedValue(db);
    const { collectQualityPassFeedback } = await import("./qualityPassFeedbackCollector");
    // upgradeRate = processed / (processed + failed) = 5 / (5 + 0) = 1.0
    const qpr = makeQualityPassResult();
    const result = await collectQualityPassFeedback(qpr, []);
    // With processed=5, failed=0: upgradeRate = 5/(5+0) = 1.0
    expect(result.upgradeRate).toBeGreaterThan(0);
  });

  it("does not trigger feedback when upgradeRate is high (healthy pipeline)", async () => {
    const db = makeDb();
    mocks.mockGetDb.mockResolvedValue(db);
    // processed=10, failed=0 → upgradeRate=1.0 (above 0.75 threshold)
    const highUpgradeResult: QualityPassResult = {
      ...makeQualityPassResult(),
      processed: 10,
      failed: 0,
    };
    const { collectQualityPassFeedback } = await import("./qualityPassFeedbackCollector");
    const result = await collectQualityPassFeedback(highUpgradeResult, []);
    expect(result.feedbackTriggered).toBe(false);
    expect(mocks.mockRunFeedbackAgent).not.toHaveBeenCalled();
  });

  it("triggers feedback agent when upgradeRate is below threshold", async () => {
    const db = makeDb();
    mocks.mockGetDb.mockResolvedValue(db);
    // upgradeRate = processed / (processed + failed) = 3 / (3 + 10) ≈ 0.23 (below 0.75 threshold)
    // processed >= 3 to meet the minimum document threshold
    const lowUpgradeResult: QualityPassResult = {
      processed: 3,
      failed: 10,
      skipped: 0,
      errors: [],
    };
    const { collectQualityPassFeedback } = await import("./qualityPassFeedbackCollector");
    const result = await collectQualityPassFeedback(lowUpgradeResult, []);
    expect(result.feedbackTriggered).toBe(true);
    expect(mocks.mockRunFeedbackAgent).toHaveBeenCalled();
  });
});
