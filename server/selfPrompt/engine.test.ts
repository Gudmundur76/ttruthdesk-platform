/**
 * engine.test.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Unit tests for selfPrompt/engine.ts — runSelfPromptCycle()
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  mockCollectSystemState: vi.fn(),
  mockRunSelfPrompt: vi.fn(),
  mockExecuteActions: vi.fn(),
  mockGetDb: vi.fn(),
}));

vi.mock("./stateCollector", () => ({
  collectSystemState: mocks.mockCollectSystemState,
}));
vi.mock("./promptEngine", () => ({
  runSelfPrompt: mocks.mockRunSelfPrompt,
}));
vi.mock("./actionExecutor", () => ({
  executeActions: mocks.mockExecuteActions,
}));
vi.mock("../db", () => ({ getDb: mocks.mockGetDb }));

import { runSelfPromptCycle } from "./engine";
import type { SelfPromptEvent } from "./stateCollector";

const baseEvent: SelfPromptEvent = {
  type: "verdict_assigned",
  description: "Test verdict assigned",
  claimId: 1,
};

const mockState = {
  recentEvent: baseEvent,
  graphSnapshot: { entityCount: 10, contradictionCount: 2, openGapCount: 5, highPriorityGapCount: 1 },
  queueSnapshot: { pendingItems: 3, failedItems: 0 },
  metaHealth: { score: 85, grade: "B", criticalCount: 0, warningCount: 2 },
  subscriptionSnapshot: { activeWebhookCount: 1 },
  staleEvidenceCount: 0,
  lowConfidenceCount: 1,
};

describe("runSelfPromptCycle()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mockCollectSystemState.mockResolvedValue(mockState);
    mocks.mockRunSelfPrompt.mockResolvedValue({
      reasoning: "System is healthy, no actions needed",
      actions: [{ action: "notify", targetId: 1, reasoning: "test", priority: 1 }],
      converge: false,
    });
    mocks.mockExecuteActions.mockResolvedValue([
      { action: "notify", targetId: 1, status: "ok", detail: "dispatched" },
    ]);
    // DB mock for logging
    const db = {
      insert: vi.fn().mockReturnThis(),
      values: vi.fn().mockResolvedValue([{ insertId: 42 }]),
      then: undefined,
    };
    mocks.mockGetDb.mockResolvedValue(db);
  });

  it("returns a complete cycle result", async () => {
    const result = await runSelfPromptCycle(baseEvent);
    expect(result.eventType).toBe("verdict_assigned");
    expect(result.reasoning).toBe("System is healthy, no actions needed");
    expect(result.actionsGenerated).toBe(1);
    expect(result.actionsExecuted).toBe(1);
    expect(result.converged).toBe(false);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("executes no actions when converged=true", async () => {
    mocks.mockRunSelfPrompt.mockResolvedValue({
      reasoning: "Converged",
      actions: [{ action: "notify", targetId: 1, reasoning: "test", priority: 1 }],
      converge: true,
    });
    const result = await runSelfPromptCycle(baseEvent);
    expect(result.converged).toBe(true);
    expect(result.actionsExecuted).toBe(0);
    // executeActions should be called with empty array
    expect(mocks.mockExecuteActions).toHaveBeenCalledWith([]);
  });

  it("still returns a result when DB logging fails", async () => {
    mocks.mockGetDb.mockResolvedValue(null); // DB unavailable for logging
    const result = await runSelfPromptCycle(baseEvent);
    expect(result.cycleId).toBeNull();
    expect(result.actionsGenerated).toBe(1);
  });

  it("calls collectSystemState with the event", async () => {
    await runSelfPromptCycle(baseEvent);
    expect(mocks.mockCollectSystemState).toHaveBeenCalledWith(baseEvent);
  });

  it("calls runSelfPrompt with the collected state", async () => {
    await runSelfPromptCycle(baseEvent);
    expect(mocks.mockRunSelfPrompt).toHaveBeenCalledWith(mockState);
  });

  it("reports actionsGenerated from LLM output even when converged", async () => {
    mocks.mockRunSelfPrompt.mockResolvedValue({
      reasoning: "Converged",
      actions: [
        { action: "notify", targetId: 1, reasoning: "r1", priority: 1 },
        { action: "notify", targetId: 2, reasoning: "r2", priority: 2 },
      ],
      converge: true,
    });
    const result = await runSelfPromptCycle(baseEvent);
    expect(result.actionsGenerated).toBe(2);
    expect(result.actionsExecuted).toBe(0);
  });
});
