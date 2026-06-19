/**
 * engine.test.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Unit tests for selfPrompt/engine.ts — runSelfPromptCycle()
 *
 * Phase 7 additions:
 *   - gateOverrode / gateReason fields in SelfPromptCycleResult
 *   - directivesPublished field in SelfPromptCycleResult
 *   - cycleCount parameter passed to runSelfPromptCycle
 *   - Global error boundary: unhandled throws return structured error result
 *   - Convergence gate integration: gate can override LLM convergence decision
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  mockCollectSystemState: vi.fn(),
  mockRunSelfPrompt: vi.fn(),
  mockExecuteActions: vi.fn(),
  mockApplyConvergenceGate: vi.fn(),
  mockPublishFrontierDirectives: vi.fn(),
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
vi.mock("./convergenceGate", () => ({
  applyConvergenceGate: mocks.mockApplyConvergenceGate,
}));
vi.mock("./directivePublisher", () => ({
  publishFrontierDirectives: mocks.mockPublishFrontierDirectives,
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
  graphSnapshot: {
    entityCount: 10,
    contradictionCount: 2,
    openGapCount: 5,
    highPriorityGapCount: 1,
  },
  queueSnapshot: { pendingItems: 3, failedItems: 0 },
  metaHealth: {
    score: 85,
    grade: "B",
    criticalCount: 0,
    warningCount: 2,
    driftFindingCount: 0,
  },
  subscriptionSnapshot: { activeWebhookCount: 1 },
  staleEvidenceCount: 0,
  lowConfidenceCount: 1,
  claimTrends: {
    recentVerifiedCount: 5,
    recentSupportedCount: 3,
    recentContradictedCount: 1,
    recentAmbiguousCount: 1,
  },
  dreamStats: {
    totalCompletedSessions: 10,
    recentSessionCount: 2,
    pendingStagingItems: 0,
  },
  directiveStats: { activeDirectiveCount: 1, recentDirectiveCount: 1 },
};

const defaultGateResult = {
  converged: false,
  reason: "llm_not_converged",
  overridden: false,
};

describe("runSelfPromptCycle()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mockCollectSystemState.mockResolvedValue(mockState);
    mocks.mockRunSelfPrompt.mockResolvedValue({
      reasoning: "System is healthy, no actions needed",
      actions: [
        {
          action: "notify",
          targetId: 1,
          reasoning: "test",
          priority: 1,
          priorityLevel: "DEFERRED",
          justification: "test",
          expectedValue: 50,
        },
      ],
      converge: false,
    });
    mocks.mockApplyConvergenceGate.mockResolvedValue(defaultGateResult);
    mocks.mockExecuteActions.mockResolvedValue([
      { action: "notify", targetId: 1, status: "ok", detail: "dispatched" },
    ]);
    mocks.mockPublishFrontierDirectives.mockResolvedValue([]);
    // DB mock for logging
    const db = {
      insert: vi.fn().mockReturnThis(),
      values: vi.fn().mockResolvedValue([{ insertId: 42 }]),
      then: undefined,
    };
    mocks.mockGetDb.mockResolvedValue(db);
  });

  // ─── Basic cycle result ───────────────────────────────────────────────────

  it("returns a complete cycle result with all Phase 7 fields", async () => {
    const result = await runSelfPromptCycle(baseEvent);
    expect(result.eventType).toBe("verdict_assigned");
    expect(result.reasoning).toBe("System is healthy, no actions needed");
    expect(result.actionsGenerated).toBe(1);
    expect(result.actionsExecuted).toBe(1);
    expect(result.converged).toBe(false);
    expect(result.gateOverrode).toBe(false);
    expect(result.gateReason).toBe("llm_not_converged");
    expect(result.directivesPublished).toBe(0);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.error).toBeUndefined();
  });

  // ─── Convergence gate integration ────────────────────────────────────────

  it("executes no actions when gate returns converged=true", async () => {
    mocks.mockApplyConvergenceGate.mockResolvedValue({
      converged: true,
      reason: "llm_converged",
      overridden: false,
    });
    const result = await runSelfPromptCycle(baseEvent);
    expect(result.converged).toBe(true);
    expect(result.actionsExecuted).toBe(0);
    expect(mocks.mockExecuteActions).toHaveBeenCalledWith([]);
  });

  it("reflects gate override in result when gate overrides LLM", async () => {
    mocks.mockRunSelfPrompt.mockResolvedValue({
      reasoning: "Converged",
      actions: [],
      converge: true,
    });
    mocks.mockApplyConvergenceGate.mockResolvedValue({
      converged: false,
      reason: "insufficient_recent_cycles:1/2",
      overridden: true,
    });
    const result = await runSelfPromptCycle(baseEvent);
    expect(result.converged).toBe(false);
    expect(result.gateOverrode).toBe(true);
    expect(result.gateReason).toBe("insufficient_recent_cycles:1/2");
  });

  it("passes cycleCount to applyConvergenceGate", async () => {
    await runSelfPromptCycle(baseEvent, 5);
    expect(mocks.mockApplyConvergenceGate).toHaveBeenCalledWith(
      expect.objectContaining({ cycleCount: 5 })
    );
  });

  it("passes criticalCount and highPriorityGapCount to gate", async () => {
    await runSelfPromptCycle(baseEvent);
    expect(mocks.mockApplyConvergenceGate).toHaveBeenCalledWith(
      expect.objectContaining({
        openCriticalAlerts: 0,
        staleGapsWithNoDirective: 1,
      })
    );
  });

  it("defaults cycleCount to 0 when not provided", async () => {
    await runSelfPromptCycle(baseEvent);
    expect(mocks.mockApplyConvergenceGate).toHaveBeenCalledWith(
      expect.objectContaining({ cycleCount: 0 })
    );
  });

  // ─── Frontier directives ──────────────────────────────────────────────────

  it("publishes frontier directives for frontier actions", async () => {
    mocks.mockRunSelfPrompt.mockResolvedValue({
      reasoning: "Frontier needed",
      actions: [
        {
          action: "frontier",
          targetId: 7,
          reasoning: "gap needs attention",
          priority: 80,
          priorityLevel: "HIGH",
          justification: "high value gap",
          expectedValue: 60,
        },
      ],
      converge: false,
    });
    mocks.mockPublishFrontierDirectives.mockResolvedValue([
      { directiveId: "dir-1", directiveType: "focus_gap" },
    ]);
    const result = await runSelfPromptCycle(baseEvent);
    expect(result.directivesPublished).toBe(1);
    expect(mocks.mockPublishFrontierDirectives).toHaveBeenCalledOnce();
  });

  it("does not call publishFrontierDirectives when no frontier actions", async () => {
    mocks.mockRunSelfPrompt.mockResolvedValue({
      reasoning: "No frontier",
      actions: [
        {
          action: "notify",
          targetId: 1,
          reasoning: "r",
          priority: 50,
          priorityLevel: "MEDIUM",
          justification: "j",
          expectedValue: 30,
        },
      ],
      converge: false,
    });
    await runSelfPromptCycle(baseEvent);
    expect(mocks.mockPublishFrontierDirectives).not.toHaveBeenCalled();
  });

  it("directivesPublished is 0 when gate converges (no actions executed)", async () => {
    mocks.mockApplyConvergenceGate.mockResolvedValue({
      converged: true,
      reason: "llm_converged",
      overridden: false,
    });
    const result = await runSelfPromptCycle(baseEvent);
    expect(result.directivesPublished).toBe(0);
  });

  // ─── DB logging ───────────────────────────────────────────────────────────

  it("still returns a result when DB logging fails", async () => {
    mocks.mockGetDb.mockResolvedValue(null);
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
        {
          action: "notify",
          targetId: 1,
          reasoning: "r1",
          priority: 1,
          priorityLevel: "DEFERRED",
          justification: "j1",
          expectedValue: 5,
        },
        {
          action: "notify",
          targetId: 2,
          reasoning: "r2",
          priority: 2,
          priorityLevel: "DEFERRED",
          justification: "j2",
          expectedValue: 5,
        },
      ],
      converge: true,
    });
    mocks.mockApplyConvergenceGate.mockResolvedValue({
      converged: true,
      reason: "llm_converged",
      overridden: false,
    });
    const result = await runSelfPromptCycle(baseEvent);
    expect(result.actionsGenerated).toBe(2);
    expect(result.actionsExecuted).toBe(0);
  });

  // ─── Global error boundary ────────────────────────────────────────────────

  it("returns a structured error result when collectSystemState throws", async () => {
    mocks.mockCollectSystemState.mockRejectedValue(
      new Error("DB connection lost")
    );
    const result = await runSelfPromptCycle(baseEvent);
    expect(result.error).toBeDefined();
    expect(result.error).toContain("DB connection lost");
    expect(result.converged).toBe(true); // safe default on error
    expect(result.actionsGenerated).toBe(0);
    expect(result.actionsExecuted).toBe(0);
    expect(result.gateReason).toBe("error_boundary");
    expect(result.directivesPublished).toBe(0);
  });

  it("returns a structured error result when runSelfPrompt throws", async () => {
    mocks.mockRunSelfPrompt.mockRejectedValue(new Error("LLM timeout"));
    const result = await runSelfPromptCycle(baseEvent);
    expect(result.error).toContain("LLM timeout");
    expect(result.converged).toBe(true);
    expect(result.gateReason).toBe("error_boundary");
  });

  it("returns a structured error result when applyConvergenceGate throws", async () => {
    mocks.mockApplyConvergenceGate.mockRejectedValue(
      new Error("Gate DB error")
    );
    const result = await runSelfPromptCycle(baseEvent);
    expect(result.error).toContain("Gate DB error");
    expect(result.converged).toBe(true);
  });

  it("error result has eventType set correctly", async () => {
    mocks.mockCollectSystemState.mockRejectedValue(new Error("fail"));
    const result = await runSelfPromptCycle(baseEvent);
    expect(result.eventType).toBe("verdict_assigned");
  });

  it("error result has durationMs >= 0", async () => {
    mocks.mockCollectSystemState.mockRejectedValue(new Error("fail"));
    const result = await runSelfPromptCycle(baseEvent);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });
});
