/**
 * promptEngine.test.ts — imports from the real module.
 */
import { describe, it, expect } from "vitest";
import { shouldConverge } from "./promptEngine";
import type { PrioritizedAction } from "./promptEngine";

function makeAction(action: PrioritizedAction["action"], expectedValue: number): PrioritizedAction {
  return { priority: 50, action, targetId: 1, reasoning: "test", expectedValue };
}

describe("shouldConverge", () => {
  it("returns true when actions array is empty", () => { expect(shouldConverge([], 90)).toBe(true); });
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
    expect(shouldConverge([makeAction("frontier", 10), makeAction("gap_map", 5)], 90)).toBe(true);
  });
  it("returns true for a single non-user-facing action with value < 20 and health > 80", () => {
    expect(shouldConverge([makeAction("meta_check", 15)], 95)).toBe(true);
  });
  it("returns false when mixed: one high-value and one low-value action", () => {
    expect(shouldConverge([makeAction("frontier", 30), makeAction("meta_check", 5)], 90)).toBe(false);
  });
  it("uses the highest expectedValue across all actions", () => {
    const actions = [makeAction("meta_check", 5), makeAction("gap_map", 19), makeAction("frontier", 15)];
    expect(shouldConverge(actions, 85)).toBe(true);
  });
});
