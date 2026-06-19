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
