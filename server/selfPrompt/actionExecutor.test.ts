/**
 * actionExecutor.test.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Unit tests for selfPrompt/actionExecutor.ts — executeAction() and executeActions()
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  mockGetDb: vi.fn(),
  mockDispatchHighRiskAlert: vi.fn(),
  mockUpdateEntityPage: vi.fn(),
  mockEnqueueCoordTask: vi.fn(),
  mockRunEmbeddingBackfill: vi.fn(),
}));

vi.mock("../db", () => ({ getDb: mocks.mockGetDb }));
vi.mock("../alertDispatcher", () => ({
  dispatchHighRiskAlert: mocks.mockDispatchHighRiskAlert,
}));
vi.mock("../wikiEngine", () => ({
  updateEntityPage: mocks.mockUpdateEntityPage,
}));
vi.mock("../coordQueueDrainer", () => ({
  drainCoordQueue: mocks.mockEnqueueCoordTask,
}));
vi.mock("../embeddingBackfillJob", () => ({
  runEmbeddingBackfill: mocks.mockRunEmbeddingBackfill,
}));
vi.mock("../frontier/frontierEngine", () => ({ runFrontierEngine: vi.fn().mockResolvedValue({}) }));
vi.mock("../dream/confidenceRecalibrator", () => ({ runConfidenceRecalibration: vi.fn().mockResolvedValue({}) }));
vi.mock("../seo/indexNow", () => ({ notifyIndexNow: vi.fn().mockResolvedValue(undefined), claimUrl: vi.fn().mockReturnValue("https://example.com/claim/1") }));
vi.mock("../_core/notification", () => ({ notifyOwner: vi.fn().mockResolvedValue(true) }));

import { executeAction, executeActions } from "./actionExecutor";

// Helper to build a valid PrioritizedAction
function makeAction(action: string, targetId?: number) {
  return {
    action: action as never,
    targetId: targetId as number,
    reasoning: "test",
    priority: 1,
    expectedValue: 50,
  };
}

describe("executeAction()", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns skipped when notify action has no targetId", async () => {
    const result = await executeAction(makeAction("notify", undefined));
    expect(result.status).toBe("skipped");
    expect(result.detail).toContain("No targetId");
  });

  it("dispatches webhook alert for notify action with targetId", async () => {
    mocks.mockDispatchHighRiskAlert.mockResolvedValue(undefined);
    const result = await executeAction(makeAction("notify", 42));
    expect(mocks.mockDispatchHighRiskAlert).toHaveBeenCalledOnce();
    expect(result.status).toBe("ok");
    expect(result.detail).toContain("42");
  });

  it("returns skipped for wiki_update when no targetId", async () => {
    const result = await executeAction(makeAction("wiki_update", undefined));
    expect(result.status).toBe("skipped");
  });

  it("returns skipped for wiki_update when DB unavailable", async () => {
    mocks.mockGetDb.mockResolvedValue(null);
    const result = await executeAction(makeAction("wiki_update", 1));
    expect(result.status).toBe("skipped");
    expect(result.detail).toContain("DB unavailable");
  });

  it("returns skipped for unknown action type", async () => {
    const result = await executeAction(makeAction("unknown_action", 1));
    expect(result.status).toBe("skipped");
    expect(result.detail).toContain("Unknown action type");
  });
});

describe("executeActions()", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns empty array for empty input", async () => {
    const results = await executeActions([]);
    expect(results).toEqual([]);
  });

  it("executes all actions and returns results", async () => {
    mocks.mockDispatchHighRiskAlert.mockResolvedValue(undefined);
    const results = await executeActions([
      makeAction("notify", undefined),
      makeAction("notify", undefined),
    ]);
    expect(results).toHaveLength(2);
    expect(results[0].status).toBe("skipped");
    expect(results[1].status).toBe("skipped");
  });
});
