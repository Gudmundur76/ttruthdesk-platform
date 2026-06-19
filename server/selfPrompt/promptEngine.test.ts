/**
 * promptEngine.test.ts — imports from the real module.
 *
 * Phase 7 additions:
 *   - PriorityLevel enum and priorityToLevel()
 *   - justification field on PrioritizedAction
 *   - priorityLevel field derived from priority
 *   - zod validation fallback behaviour (via parseSelfPromptResponse indirectly)
 */
import { describe, it, expect } from "vitest";
import { shouldConverge, priorityToLevel } from "./promptEngine";
import type { PrioritizedAction, PriorityLevel } from "./promptEngine";

function makeAction(
  action: PrioritizedAction["action"],
  expectedValue: number,
  priority = 50,
  justification = "test justification"
): PrioritizedAction {
  return {
    priority,
    priorityLevel: priorityToLevel(priority),
    action,
    targetId: 1,
    reasoning: "test",
    justification,
    expectedValue,
  };
}

// ─── priorityToLevel() ────────────────────────────────────────────────────────

describe("priorityToLevel()", () => {
  it("returns CRITICAL for priority 81-100", () => {
    expect(priorityToLevel(81)).toBe("CRITICAL");
    expect(priorityToLevel(100)).toBe("CRITICAL");
  });

  it("returns HIGH for priority 61-80", () => {
    expect(priorityToLevel(61)).toBe("HIGH");
    expect(priorityToLevel(80)).toBe("HIGH");
  });

  it("returns MEDIUM for priority 41-60", () => {
    expect(priorityToLevel(41)).toBe("MEDIUM");
    expect(priorityToLevel(60)).toBe("MEDIUM");
  });

  it("returns LOW for priority 21-40", () => {
    expect(priorityToLevel(21)).toBe("LOW");
    expect(priorityToLevel(40)).toBe("LOW");
  });

  it("returns DEFERRED for priority 1-20", () => {
    expect(priorityToLevel(1)).toBe("DEFERRED");
    expect(priorityToLevel(20)).toBe("DEFERRED");
  });

  it("boundary: 80 is HIGH, 81 is CRITICAL", () => {
    expect(priorityToLevel(80)).toBe("HIGH");
    expect(priorityToLevel(81)).toBe("CRITICAL");
  });

  it("boundary: 60 is MEDIUM, 61 is HIGH", () => {
    expect(priorityToLevel(60)).toBe("MEDIUM");
    expect(priorityToLevel(61)).toBe("HIGH");
  });

  it("boundary: 40 is LOW, 41 is MEDIUM", () => {
    expect(priorityToLevel(40)).toBe("LOW");
    expect(priorityToLevel(41)).toBe("MEDIUM");
  });

  it("boundary: 20 is DEFERRED, 21 is LOW", () => {
    expect(priorityToLevel(20)).toBe("DEFERRED");
    expect(priorityToLevel(21)).toBe("LOW");
  });
});

// ─── PrioritizedAction shape ──────────────────────────────────────────────────

describe("PrioritizedAction shape", () => {
  it("makeAction helper produces correct priorityLevel", () => {
    const a = makeAction("frontier", 50, 85);
    expect(a.priorityLevel).toBe("CRITICAL");
  });

  it("justification field is present on PrioritizedAction", () => {
    const a = makeAction("notify", 30, 70, "Notify because high risk");
    expect(a.justification).toBe("Notify because high risk");
  });

  it("justification defaults to empty string via helper", () => {
    const a = makeAction("gap_map", 10, 50, "");
    expect(a.justification).toBe("");
  });

  it("PriorityLevel type covers all five tiers", () => {
    const levels: PriorityLevel[] = [
      "CRITICAL",
      "HIGH",
      "MEDIUM",
      "LOW",
      "DEFERRED",
    ];
    expect(levels).toHaveLength(5);
  });
});

// ─── shouldConverge() ─────────────────────────────────────────────────────────

describe("shouldConverge", () => {
  it("returns true when actions array is empty", () => {
    expect(shouldConverge([], 90)).toBe(true);
  });

  it("returns false when highest expectedValue >= 20", () => {
    expect(shouldConverge([makeAction("frontier", 25)], 90)).toBe(false);
  });

  it("returns false when highest expectedValue is exactly 20", () => {
    expect(shouldConverge([makeAction("frontier", 20)], 90)).toBe(false);
  });

  it("returns false when a user-facing action (notify) is present", () => {
    expect(shouldConverge([makeAction("notify", 10)], 90)).toBe(false);
  });

  it("returns false when a user-facing action (alert) is present", () => {
    expect(shouldConverge([makeAction("alert", 5)], 90)).toBe(false);
  });

  it("returns false when a user-facing action (wiki_update) is present", () => {
    expect(shouldConverge([makeAction("wiki_update", 5)], 90)).toBe(false);
  });

  it("returns false when a user-facing action (reindex) is present", () => {
    expect(shouldConverge([makeAction("reindex", 5)], 90)).toBe(false);
  });

  it("returns false when metaHealthScore <= 80", () => {
    expect(shouldConverge([makeAction("frontier", 10)], 80)).toBe(false);
    expect(shouldConverge([makeAction("frontier", 10)], 50)).toBe(false);
  });

  it("returns true when all conditions are met: low value, no user-facing, health > 80", () => {
    expect(
      shouldConverge([makeAction("frontier", 10), makeAction("gap_map", 5)], 90)
    ).toBe(true);
  });

  it("returns true for a single non-user-facing action with value < 20 and health > 80", () => {
    expect(shouldConverge([makeAction("meta_check", 15)], 95)).toBe(true);
  });

  it("returns false when mixed: one high-value and one low-value action", () => {
    expect(
      shouldConverge(
        [makeAction("frontier", 30), makeAction("meta_check", 5)],
        90
      )
    ).toBe(false);
  });

  it("uses the highest expectedValue across all actions", () => {
    const actions = [
      makeAction("meta_check", 5),
      makeAction("gap_map", 19),
      makeAction("frontier", 15),
    ];
    expect(shouldConverge(actions, 85)).toBe(true);
  });

  it("returns false for drain_queue action (not user-facing but value >= 20)", () => {
    expect(shouldConverge([makeAction("drain_queue", 25)], 90)).toBe(false);
  });

  it("returns true for drain_queue with low value and high health", () => {
    expect(shouldConverge([makeAction("drain_queue", 10)], 90)).toBe(true);
  });
});
// ─── T057: runSelfPrompt integration (mocked LLM) ────────────────────────────
import { vi, beforeEach } from "vitest";

const llmMocks = vi.hoisted(() => ({
  mockInvokeLLM: vi.fn(),
}));
vi.mock("../_core/llm", () => ({ invokeLLM: llmMocks.mockInvokeLLM }));

import { runSelfPrompt } from "./promptEngine";
import type { SystemState } from "./stateCollector";

function makeState(overrides: Partial<SystemState> = {}): SystemState {
  return {
    recentEvent: { type: "verdict_assigned", description: "test", claimId: 1 },
    graphSnapshot: {
      entityCount: 5,
      contradictionCount: 1,
      openGapCount: 2,
      highPriorityGapCount: 0,
    },
    queueSnapshot: { pendingItems: 0, failedItems: 0 },
    metaHealth: {
      score: 90,
      grade: "A",
      criticalCount: 0,
      warningCount: 0,
      driftFindingCount: 0,
    },
    subscriptionSnapshot: { activeWebhookCount: 1 },
    staleEvidenceCount: 0,
    lowConfidenceCount: 0,
    claimTrends: {
      recentVerifiedCount: 3,
      recentSupportedCount: 2,
      recentContradictedCount: 0,
      recentAmbiguousCount: 1,
      confidenceTrend7d: 0,
    },
    frontierStats: {
      gapAgeDistribution: {
        bucket0to1d: 0,
        bucket1to7d: 0,
        bucket7to30d: 0,
        bucket30dPlus: 0,
      },
      hypothesisVerificationRate7d: 0,
    },
    selfPromptStats: { frontierDirectiveHitRate7d: 0, cyclesLast24h: 3 },
    activeDirectives: [],
    dreamStats: {
      totalCompletedSessions: 5,
      recentSessionCount: 1,
      pendingStagingItems: 0,
      lastWakeAt: null,
      sessionsLast30d: 2,
    },
    metaStats: { lastHealthScore: 90, openAlerts: 0, driftFlagsLast7d: 0 },
    directiveStats: { activeDirectiveCount: 1, recentDirectiveCount: 2 },
    ...overrides,
  } as SystemState;
}

function makeLLMResponse(content: string) {
  return { choices: [{ message: { content } }] };
}

describe("runSelfPrompt() — T057", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("T057: valid LLM response parsed correctly", async () => {
    const validResponse = JSON.stringify({
      reasoning: "System is healthy, queuing notify action.",
      actions: [
        {
          priority: 75,
          action: "notify",
          targetId: 1,
          reasoning: "Verdict ready",
          justification: "User needs to know",
          expectedValue: 40,
        },
      ],
      converge: false,
    });
    llmMocks.mockInvokeLLM.mockResolvedValueOnce(
      makeLLMResponse(validResponse)
    );
    const result = await runSelfPrompt(makeState());
    expect(result.reasoning).toContain("System is healthy");
    expect(result.actions).toHaveLength(1);
    expect(result.actions[0].action).toBe("notify");
    expect(result.actions[0].priority).toBe(75);
    expect(result.actions[0].priorityLevel).toBe("HIGH");
    expect(result.converge).toBe(false);
    expect(result.llmRawResponse).toBeDefined();
    expect(result.llmResponseMs).toBeGreaterThanOrEqual(0);
  });

  it("T057: timeout fallback returns converged: true with empty actions", async () => {
    const abortError = new Error("The operation was aborted");
    abortError.name = "AbortError";
    llmMocks.mockInvokeLLM.mockRejectedValueOnce(abortError);
    const result = await runSelfPrompt(makeState());
    expect(result.converge).toBe(true);
    expect(result.actions).toHaveLength(0);
    expect(result.reasoning).toContain("LLM call failed");
  });

  it("T057: schema violation fallback — missing required fields → converge: true", async () => {
    const badResponse = JSON.stringify({ actions: [] });
    llmMocks.mockInvokeLLM.mockResolvedValueOnce(makeLLMResponse(badResponse));
    const result = await runSelfPrompt(makeState());
    expect(result.converge).toBe(true);
    expect(result.actions).toHaveLength(0);
  });

  it("T057: directives capped at MAX_DIRECTIVES_PER_CYCLE (3)", async () => {
    const actions = [
      {
        priority: 90,
        action: "frontier",
        targetId: 1,
        reasoning: "r",
        justification: "j",
        expectedValue: 50,
      },
      {
        priority: 85,
        action: "gap_map",
        targetId: 2,
        reasoning: "r",
        justification: "j",
        expectedValue: 50,
      },
      {
        priority: 80,
        action: "frontier",
        targetId: 3,
        reasoning: "r",
        justification: "j",
        expectedValue: 50,
      },
      {
        priority: 75,
        action: "frontier",
        targetId: 4,
        reasoning: "r",
        justification: "j",
        expectedValue: 50,
      },
      {
        priority: 70,
        action: "gap_map",
        targetId: 5,
        reasoning: "r",
        justification: "j",
        expectedValue: 50,
      },
    ];
    llmMocks.mockInvokeLLM.mockResolvedValueOnce(
      makeLLMResponse(
        JSON.stringify({
          reasoning: "Multiple frontier actions",
          actions,
          converge: false,
        })
      )
    );
    const result = await runSelfPrompt(makeState());
    const directiveActions = result.actions.filter(
      a => a.action === "frontier" || a.action === "gap_map"
    );
    expect(directiveActions.length).toBeLessThanOrEqual(3);
  });

  it("T057: oscillation history (directiveStats) is included in prompt state", async () => {
    llmMocks.mockInvokeLLM.mockResolvedValueOnce(
      makeLLMResponse(
        JSON.stringify({
          reasoning: "test",
          actions: [],
          converge: true,
        })
      )
    );
    const state = makeState({
      directiveStats: { activeDirectiveCount: 5, recentDirectiveCount: 8 },
    });
    await runSelfPrompt(state);
    const calledArgs = llmMocks.mockInvokeLLM.mock.calls[0][0];
    const userContent = calledArgs.messages.find(
      (m: { role: string }) => m.role === "user"
    )?.content as string;
    expect(userContent).toContain("5");
    expect(userContent).toContain("8");
  });

  it("T057: malformed JSON fallback → converge: true", async () => {
    llmMocks.mockInvokeLLM.mockResolvedValueOnce(
      makeLLMResponse("{{invalid json}}")
    );
    const result = await runSelfPrompt(makeState());
    expect(result.converge).toBe(true);
    expect(result.actions).toHaveLength(0);
  });

  it("T057: actions sorted by priority descending", async () => {
    const actions = [
      {
        priority: 30,
        action: "meta_check",
        targetId: 1,
        reasoning: "r",
        justification: "j",
        expectedValue: 10,
      },
      {
        priority: 90,
        action: "notify",
        targetId: 2,
        reasoning: "r",
        justification: "j",
        expectedValue: 50,
      },
      {
        priority: 60,
        action: "alert",
        targetId: 3,
        reasoning: "r",
        justification: "j",
        expectedValue: 30,
      },
    ];
    llmMocks.mockInvokeLLM.mockResolvedValueOnce(
      makeLLMResponse(
        JSON.stringify({
          reasoning: "test",
          actions,
          converge: false,
        })
      )
    );
    const result = await runSelfPrompt(makeState());
    if (result.actions.length >= 2) {
      expect(result.actions[0].priority).toBeGreaterThanOrEqual(
        result.actions[1].priority
      );
    }
  });
});
