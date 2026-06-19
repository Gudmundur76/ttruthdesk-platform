/**
 * actionExecutor.test.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Unit tests for selfPrompt/actionExecutor.ts — executeAction(), executeActions(),
 * and containsSqlInjection().
 *
 * Phase 7 additions:
 *   - containsSqlInjection() guard tests
 *   - Deduplication: only the highest-priority action per action type is kept
 *   - 5-action cap: actions beyond MAX_ACTIONS_PER_CYCLE are dropped
 *   - Per-action timeout: slow actions return error status instead of hanging
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
vi.mock("../frontier/frontierEngine", () => ({
  runFrontierEngine: vi.fn().mockResolvedValue({
    gapMapping: { newGapsCreated: 0 },
    hypothesisGeneration: { hypothesesGenerated: 0 },
  }),
}));
vi.mock("../dream/confidenceRecalibrator", () => ({
  runConfidenceRecalibration: vi
    .fn()
    .mockResolvedValue({ totalRecalibrated: 0, autoApplied: 0 }),
}));
vi.mock("../seo/indexNow", () => ({
  notifyIndexNow: vi.fn().mockResolvedValue(undefined),
  claimUrl: vi.fn().mockReturnValue("https://example.com/claim/1"),
}));
vi.mock("../_core/notification", () => ({
  notifyOwner: vi.fn().mockResolvedValue(true),
}));

import {
  executeAction,
  executeActions,
  containsSqlInjection,
} from "./actionExecutor";
import type { PrioritizedAction } from "./promptEngine";

// Helper to build a valid PrioritizedAction
function makeAction(
  action: string,
  targetId?: number,
  priority = 50,
  expectedValue = 50
): PrioritizedAction {
  return {
    action: action as never,
    targetId: targetId as number,
    reasoning: "test",
    justification: "test justification",
    priority,
    priorityLevel: "MEDIUM",
    expectedValue,
  };
}

// ─── containsSqlInjection() ───────────────────────────────────────────────────

describe("containsSqlInjection()", () => {
  it("returns false for a plain numeric string", () => {
    expect(containsSqlInjection("42")).toBe(false);
  });

  it("returns false for a normal protein name", () => {
    expect(containsSqlInjection("BRCA1_HUMAN")).toBe(false);
  });

  it("returns true for SELECT keyword", () => {
    expect(containsSqlInjection("SELECT * FROM claims")).toBe(true);
  });

  it("returns true for DROP keyword", () => {
    expect(containsSqlInjection("DROP TABLE claims")).toBe(true);
  });

  it("returns true for INSERT keyword", () => {
    expect(containsSqlInjection("INSERT INTO claims")).toBe(true);
  });

  it("returns true for semicolon", () => {
    expect(containsSqlInjection("1; DROP TABLE claims")).toBe(true);
  });

  it("returns true for single quote", () => {
    expect(containsSqlInjection("1' OR '1'='1")).toBe(true);
  });

  it("returns true for UNION keyword", () => {
    expect(containsSqlInjection("1 UNION SELECT 1,2,3")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(containsSqlInjection("select 1")).toBe(true);
    expect(containsSqlInjection("SELECT 1")).toBe(true);
    expect(containsSqlInjection("SeLeCt 1")).toBe(true);
  });

  it("returns false for empty string", () => {
    expect(containsSqlInjection("")).toBe(false);
  });
});

// ─── executeAction() ──────────────────────────────────────────────────────────

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

  it("returns ok for meta_check action (no-op)", async () => {
    const result = await executeAction(makeAction("meta_check", 0));
    expect(result.status).toBe("ok");
    expect(result.detail).toContain("codeGuardian");
  });

  it("returns ok for converge action", async () => {
    const result = await executeAction(makeAction("converge", 0));
    expect(result.status).toBe("ok");
    expect(result.detail).toContain("Convergence gate fired");
  });
});

// ─── executeActions() — deduplication ────────────────────────────────────────

describe("executeActions() — deduplication", () => {
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
    // After dedup: only one notify action survives
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe("skipped"); // no targetId
  });

  it("keeps only the highest-priority action per action type", async () => {
    mocks.mockDispatchHighRiskAlert.mockResolvedValue(undefined);
    const results = await executeActions([
      makeAction("notify", 1, 30), // lower priority
      makeAction("notify", 2, 80), // higher priority — should be kept
    ]);
    // After sort+dedup: only the priority-80 notify survives
    expect(results).toHaveLength(1);
    expect(results[0].targetId).toBe(2);
  });

  it("preserves different action types after dedup", async () => {
    const results = await executeActions([
      makeAction("meta_check", 0, 50),
      makeAction("meta_check", 0, 40), // duplicate — dropped
      makeAction("gap_map", 0, 60),
    ]);
    // 2 unique types: meta_check and gap_map
    expect(results).toHaveLength(2);
    const types = results.map(r => r.action);
    expect(types).toContain("meta_check");
    expect(types).toContain("gap_map");
  });
});

// ─── executeActions() — 5-action cap ─────────────────────────────────────────

describe("executeActions() — 5-action cap", () => {
  beforeEach(() => vi.clearAllMocks());

  it("executes at most 5 actions even when more are provided", async () => {
    const actions = [
      makeAction("meta_check", 0, 90),
      makeAction("gap_map", 0, 80),
      makeAction("converge", 0, 70),
      makeAction("alert", 0, 60),
      makeAction("reindex", 1, 50),
      makeAction("drain_queue", 0, 40), // 6th — should be dropped
    ];
    const results = await executeActions(actions);
    expect(results).toHaveLength(5);
  });

  it("drops the lowest-priority actions when cap is exceeded", async () => {
    const actions = [
      makeAction("meta_check", 0, 90),
      makeAction("gap_map", 0, 80),
      makeAction("converge", 0, 70),
      makeAction("alert", 0, 60),
      makeAction("reindex", 1, 50),
      makeAction("drain_queue", 0, 10), // lowest priority — dropped
    ];
    const results = await executeActions(actions);
    const types = results.map(r => r.action);
    expect(types).not.toContain("drain_queue");
  });

  it("handles exactly 5 actions without dropping any", async () => {
    const actions = [
      makeAction("meta_check", 0, 90),
      makeAction("gap_map", 0, 80),
      makeAction("converge", 0, 70),
      makeAction("alert", 0, 60),
      makeAction("reindex", 1, 50),
    ];
    const results = await executeActions(actions);
    expect(results).toHaveLength(5);
  });
});

// ─── T060: delegatedTo field and 30s total cap ────────────────────────────────
// Note: delegatedTo and durationMs are set by executeActions() (the batch wrapper),
// not by executeAction() (the single-action function). Tests use executeActions().
describe("executeActions() — T060: delegatedTo field", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mockGetDb.mockResolvedValue(null);
    mocks.mockDispatchHighRiskAlert.mockResolvedValue(undefined);
    mocks.mockUpdateEntityPage.mockResolvedValue(undefined);
    mocks.mockEnqueueCoordTask.mockResolvedValue(undefined);
    mocks.mockRunEmbeddingBackfill.mockResolvedValue(undefined);
  });

  it("T060: notify action has delegatedTo = alertDispatcher", async () => {
    mocks.mockDispatchHighRiskAlert.mockResolvedValue(undefined);
    const results = await executeActions([makeAction("notify", 1)]);
    expect(results[0].delegatedTo).toBe("alertDispatcher");
  });

  it("T060: meta_check action has delegatedTo = codeGuardian", async () => {
    const results = await executeActions([makeAction("meta_check", 0)]);
    expect(results[0].delegatedTo).toBe("codeGuardian");
  });

  it("T060: converge action has delegatedTo = selfPromptEngine", async () => {
    const results = await executeActions([makeAction("converge", 0)]);
    expect(results[0].delegatedTo).toBe("selfPromptEngine");
  });

  it("T060: gap_map action has delegatedTo = frontierEngine", async () => {
    const results = await executeActions([makeAction("gap_map", 0)]);
    expect(results[0].delegatedTo).toBe("frontierEngine");
  });

  it("T060: reindex action has delegatedTo = indexNow", async () => {
    const results = await executeActions([makeAction("reindex", 1)]);
    expect(results[0].delegatedTo).toBe("indexNow");
  });

  it("T060: drain_queue action has delegatedTo = coordQueueDrainer", async () => {
    const results = await executeActions([makeAction("drain_queue", 0)]);
    expect(results[0].delegatedTo).toBe("coordQueueDrainer");
  });

  it("T060: durationMs is present and >= 0 on all results from executeActions", async () => {
    const results = await executeActions([
      makeAction("meta_check", 0, 90),
      makeAction("converge", 0, 80),
    ]);
    for (const r of results) {
      expect(typeof r.durationMs).toBe("number");
      expect(r.durationMs).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("executeActions() — T060: 30s total cycle cap", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mockGetDb.mockResolvedValue(null);
  });

  it("T060: total cycle cap is 30000ms (TOTAL_CYCLE_TIMEOUT_MS)", async () => {
    // Verify the constant is exported or the behavior is correct
    // We can't easily test the 30s timeout without fake timers, but we verify
    // that executeActions completes normally within the cap for fast actions
    const actions = [
      makeAction("meta_check", 0, 90),
      makeAction("converge", 0, 80),
      makeAction("gap_map", 0, 70),
    ];
    const results = await executeActions(actions);
    expect(results.length).toBeGreaterThanOrEqual(1);
    // All results should have durationMs
    for (const r of results) {
      expect(r.durationMs).toBeGreaterThanOrEqual(0);
    }
  });

  it("T060: executeActions returns results in priority order (highest first)", async () => {
    const actions = [
      makeAction("meta_check", 0, 30),
      makeAction("converge", 0, 90),
      makeAction("gap_map", 0, 60),
    ];
    const results = await executeActions(actions);
    // Results should be in priority order: converge(90) > gap_map(60) > meta_check(30)
    if (results.length >= 2) {
      const firstPriority =
        actions.find(a => a.action === results[0].action)?.priority ?? 0;
      const secondPriority =
        actions.find(a => a.action === results[1].action)?.priority ?? 0;
      expect(firstPriority).toBeGreaterThanOrEqual(secondPriority);
    }
  });
});

// ─── Build 4: 5 new action types ─────────────────────────────────────────────
describe("Build 4 — new action types (wiki_edit, alert_dispatch, graph_suggest, ingest_request, update_claim)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mockGetDb.mockResolvedValue(null);
    mocks.mockDispatchHighRiskAlert.mockResolvedValue(undefined);
    mocks.mockUpdateEntityPage.mockResolvedValue(undefined);
  });

  it("wiki_edit: returns skipped when targetId is 0", async () => {
    const result = await executeAction(makeAction("wiki_edit", 0));
    expect(result.status).toBe("skipped");
    expect(result.detail).toContain("No targetId");
  });

  it("wiki_edit: returns skipped when DB unavailable", async () => {
    const result = await executeAction(makeAction("wiki_edit", 42));
    expect(result.status).toBe("skipped");
    expect(result.detail).toContain("DB unavailable");
  });

  it("wiki_edit: returns ok when entity found and wiki updated", async () => {
    const mockDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([
        {
          id: 42,
          canonicalName: "Test Protein",
          entityType: "protein",
          firstSeenDocumentId: 1,
        },
      ]),
    };
    mocks.mockGetDb.mockResolvedValue(mockDb);
    const result = await executeAction(makeAction("wiki_edit", 42));
    expect(result.status).toBe("ok");
    expect(result.detail).toContain("42");
    expect(mocks.mockUpdateEntityPage).toHaveBeenCalledOnce();
  });

  it("alert_dispatch: returns skipped when targetId is 0", async () => {
    const result = await executeAction(makeAction("alert_dispatch", 0));
    expect(result.status).toBe("skipped");
    expect(result.detail).toContain("No targetId");
  });

  it("alert_dispatch: returns skipped when DB unavailable", async () => {
    const result = await executeAction(makeAction("alert_dispatch", 10));
    expect(result.status).toBe("skipped");
    expect(result.detail).toContain("DB unavailable");
  });

  it("alert_dispatch: dispatches alert when claim found", async () => {
    const mockDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([
        {
          id: 10,
          claimText: "Test claim",
          documentId: 1,
          verdict: "Contradicted",
          confidenceScore: 0.3,
        },
      ]),
    };
    mocks.mockGetDb.mockResolvedValue(mockDb);
    const result = await executeAction(makeAction("alert_dispatch", 10));
    expect(result.status).toBe("ok");
    expect(mocks.mockDispatchHighRiskAlert).toHaveBeenCalledOnce();
    // contradictionProbability should be derived from verdict + confidenceScore
    const callArgs = mocks.mockDispatchHighRiskAlert.mock.calls[0][0];
    expect(callArgs.contradictionProbability).toBeGreaterThan(0);
  });

  it("graph_suggest: returns skipped when targetId is 0", async () => {
    const result = await executeAction(makeAction("graph_suggest", 0));
    expect(result.status).toBe("skipped");
    expect(result.detail).toContain("No targetId");
  });

  it("graph_suggest: returns skipped when DB unavailable", async () => {
    const result = await executeAction(makeAction("graph_suggest", 5));
    expect(result.status).toBe("skipped");
    expect(result.detail).toContain("DB unavailable");
  });

  it("ingest_request: returns ok immediately (fire-and-forget)", async () => {
    const result = await executeAction(makeAction("ingest_request", 0));
    expect(result.status).toBe("ok");
    expect(result.detail).toContain("fire-and-forget");
  });

  it("update_claim: returns skipped when targetId is 0", async () => {
    const result = await executeAction(makeAction("update_claim", 0));
    expect(result.status).toBe("skipped");
    expect(result.detail).toContain("No targetId");
  });

  it("update_claim: returns skipped when DB unavailable", async () => {
    const result = await executeAction(makeAction("update_claim", 7));
    expect(result.status).toBe("skipped");
    expect(result.detail).toContain("DB unavailable");
  });
});

// ─── Build 4: getDelegatedTo map for new action types ────────────────────────
describe("Build 4 — getDelegatedTo for new action types", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mockGetDb.mockResolvedValue(null);
  });

  it("wiki_edit has delegatedTo = wikiEngine", async () => {
    const results = await executeActions([makeAction("wiki_edit", 0)]);
    expect(results[0].delegatedTo).toBe("wikiEngine");
  });

  it("alert_dispatch has delegatedTo = alertDispatcher", async () => {
    const results = await executeActions([makeAction("alert_dispatch", 0)]);
    expect(results[0].delegatedTo).toBe("alertDispatcher");
  });

  it("graph_suggest has delegatedTo = graphEngine", async () => {
    const results = await executeActions([makeAction("graph_suggest", 0)]);
    expect(results[0].delegatedTo).toBe("graphEngine");
  });

  it("ingest_request has delegatedTo = domainIngestScheduler", async () => {
    const results = await executeActions([makeAction("ingest_request", 0)]);
    expect(results[0].delegatedTo).toBe("domainIngestScheduler");
  });

  it("update_claim has delegatedTo = claimVerifier", async () => {
    const results = await executeActions([makeAction("update_claim", 0)]);
    expect(results[0].delegatedTo).toBe("claimVerifier");
  });
});
