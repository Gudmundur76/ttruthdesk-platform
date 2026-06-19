/**
 * directiveStore.test.ts — Unit tests for DirectiveStore
 * Covers FR-L3-23 through FR-L3-28
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  DirectiveStore,
  type FrontierDirective,
} from "./directiveStore";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeDirective(
  overrides: Partial<FrontierDirective> = {}
): FrontierDirective {
  const base = {
    directiveId: "dir-" + Math.random().toString(36).slice(2),
    type: "focus_gap" as const,
    targetGapId: "gap-1",
    ttlSeconds: 3600,
    createdAt: new Date(),
    ...overrides,
  };
  return { ...base, directiveType: base.type };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("DirectiveStore", () => {
  let store: DirectiveStore;

  beforeEach(() => {
    store = new DirectiveStore();
    vi.useRealTimers();
  });

  // ── add / size ──────────────────────────────────────────────────────────────

  it("starts empty", () => {
    expect(store.size()).toBe(0);
    expect(store.activeCount()).toBe(0);
  });

  it("adds a directive and increments size", () => {
    store.add(makeDirective());
    expect(store.size()).toBe(1);
  });

  it("ignores duplicate directiveIds", () => {
    const d = makeDirective({ directiveId: "dup-id" });
    store.add(d);
    store.add(d);
    expect(store.size()).toBe(1);
  });

  it("stores multiple distinct directives", () => {
    store.add(makeDirective({ directiveId: "a" }));
    store.add(makeDirective({ directiveId: "b" }));
    store.add(makeDirective({ directiveId: "c" }));
    expect(store.size()).toBe(3);
  });

  // ── getActive / TTL ─────────────────────────────────────────────────────────

  it("returns active directive within TTL", () => {
    store.add(makeDirective({ ttlSeconds: 3600 }));
    expect(store.getActive()).toHaveLength(1);
  });

  it("excludes expired directives (FR-L3-25)", () => {
    const expired = makeDirective({
      ttlSeconds: 1,
      createdAt: new Date(Date.now() - 5000), // 5 seconds ago, TTL=1s
    });
    store.add(expired);
    expect(store.getActive()).toHaveLength(0);
  });

  it("returns only non-expired directives when mixed", () => {
    const active = makeDirective({ directiveId: "active", ttlSeconds: 3600 });
    const expired = makeDirective({
      directiveId: "expired",
      ttlSeconds: 1,
      createdAt: new Date(Date.now() - 5000),
    });
    store.add(active);
    store.add(expired);
    const result = store.getActive();
    expect(result).toHaveLength(1);
    expect(result[0].directiveId).toBe("active");
  });

  it("directive at exact TTL boundary is expired", () => {
    const d = makeDirective({
      ttlSeconds: 10,
      createdAt: new Date(Date.now() - 10001), // just past TTL
    });
    store.add(d);
    expect(store.getActive()).toHaveLength(0);
  });

  it("activeCount reflects only non-expired directives", () => {
    store.add(makeDirective({ directiveId: "a", ttlSeconds: 3600 }));
    store.add(makeDirective({
      directiveId: "b",
      ttlSeconds: 1,
      createdAt: new Date(Date.now() - 5000),
    }));
    expect(store.activeCount()).toBe(1);
  });

  // ── clearConsumed ───────────────────────────────────────────────────────────

  it("clearConsumed removes all directives (FR-L3-28)", () => {
    store.add(makeDirective({ directiveId: "a" }));
    store.add(makeDirective({ directiveId: "b" }));
    store.clearConsumed();
    expect(store.size()).toBe(0);
    expect(store.activeCount()).toBe(0);
  });

  it("can add directives again after clearConsumed", () => {
    store.add(makeDirective({ directiveId: "a" }));
    store.clearConsumed();
    store.add(makeDirective({ directiveId: "b" }));
    expect(store.size()).toBe(1);
  });

  // ── applyDirectives — skip_mapping ─────────────────────────────────────────

  it("applyDirectives: skip_mapping sets skippedMapping=true", () => {
    store.add(makeDirective({ type: "skip_mapping" }));
    const effect = store.applyDirectives();
    expect(effect.skippedMapping).toBe(true);
  });

  it("applyDirectives: no skip_mapping → skippedMapping=false", () => {
    store.add(makeDirective({ type: "focus_gap", targetGapId: "g1" }));
    const effect = store.applyDirectives();
    expect(effect.skippedMapping).toBe(false);
  });

  // ── applyDirectives — focus_gap ────────────────────────────────────────────

  it("applyDirectives: focus_gap adds targetGapId to focusGapIds", () => {
    store.add(makeDirective({ type: "focus_gap", targetGapId: "gap-42" }));
    const effect = store.applyDirectives();
    expect(effect.focusGapIds).toContain("gap-42");
  });

  it("applyDirectives: multiple focus_gap directives compose additively", () => {
    store.add(makeDirective({ directiveId: "a", type: "focus_gap", targetGapId: "gap-1" }));
    store.add(makeDirective({ directiveId: "b", type: "focus_gap", targetGapId: "gap-2" }));
    const effect = store.applyDirectives();
    expect(effect.focusGapIds).toContain("gap-1");
    expect(effect.focusGapIds).toContain("gap-2");
  });

  it("applyDirectives: focus_gap without targetGapId is ignored", () => {
    store.add(makeDirective({ type: "focus_gap", targetGapId: undefined }));
    const effect = store.applyDirectives();
    expect(effect.focusGapIds).toHaveLength(0);
  });

  // ── applyDirectives — prioritize_hypotheses ────────────────────────────────

  it("applyDirectives: prioritize_hypotheses adds 2 to extraHypotheses", () => {
    store.add(makeDirective({ type: "prioritize_hypotheses" }));
    const effect = store.applyDirectives();
    expect(effect.extraHypotheses).toBe(2);
  });

  it("applyDirectives: two prioritize_hypotheses directives add 4", () => {
    store.add(makeDirective({ directiveId: "a", type: "prioritize_hypotheses" }));
    store.add(makeDirective({ directiveId: "b", type: "prioritize_hypotheses" }));
    const effect = store.applyDirectives();
    expect(effect.extraHypotheses).toBe(4);
  });

  // ── applyDirectives — deep_dive_entity ────────────────────────────────────

  it("applyDirectives: deep_dive_entity sets deepDiveEntityId", () => {
    store.add(makeDirective({ type: "deep_dive_entity", targetEntityId: "entity-99" }));
    const effect = store.applyDirectives();
    expect(effect.deepDiveEntityId).toBe("entity-99");
  });

  it("applyDirectives: no deep_dive → deepDiveEntityId is null", () => {
    store.add(makeDirective({ type: "focus_gap", targetGapId: "g1" }));
    const effect = store.applyDirectives();
    expect(effect.deepDiveEntityId).toBeNull();
  });

  it("applyDirectives: last deep_dive_entity wins when multiple present", () => {
    store.add(makeDirective({ directiveId: "a", type: "deep_dive_entity", targetEntityId: "entity-1" }));
    store.add(makeDirective({ directiveId: "b", type: "deep_dive_entity", targetEntityId: "entity-2" }));
    const effect = store.applyDirectives();
    expect(effect.deepDiveEntityId).toBe("entity-2");
  });

  // ── applyDirectives — directivesApplied count ─────────────────────────────

  it("applyDirectives: directivesApplied counts active directives", () => {
    store.add(makeDirective({ directiveId: "a", type: "focus_gap", targetGapId: "g1" }));
    store.add(makeDirective({ directiveId: "b", type: "skip_mapping" }));
    const effect = store.applyDirectives();
    expect(effect.directivesApplied).toBe(2);
  });

  it("applyDirectives: expired directives not counted in directivesApplied", () => {
    store.add(makeDirective({ directiveId: "active", ttlSeconds: 3600 }));
    store.add(makeDirective({
      directiveId: "expired",
      ttlSeconds: 1,
      createdAt: new Date(Date.now() - 5000),
    }));
    const effect = store.applyDirectives();
    expect(effect.directivesApplied).toBe(1);
  });

  // ── applyDirectives — empty store ─────────────────────────────────────────

  it("applyDirectives on empty store returns zero-effect", () => {
    const effect = store.applyDirectives();
    expect(effect.skippedMapping).toBe(false);
    expect(effect.focusGapIds).toHaveLength(0);
    expect(effect.deepDiveEntityId).toBeNull();
    expect(effect.extraHypotheses).toBe(0);
    expect(effect.directivesApplied).toBe(0);
  });

  // ── additive composition ───────────────────────────────────────────────────

  it("all four directive types compose correctly in one cycle", () => {
    store.add(makeDirective({ directiveId: "a", type: "skip_mapping" }));
    store.add(makeDirective({ directiveId: "b", type: "focus_gap", targetGapId: "gap-X" }));
    store.add(makeDirective({ directiveId: "c", type: "prioritize_hypotheses" }));
    store.add(makeDirective({ directiveId: "d", type: "deep_dive_entity", targetEntityId: "ent-Z" }));
    const effect = store.applyDirectives();
    expect(effect.skippedMapping).toBe(true);
    expect(effect.focusGapIds).toContain("gap-X");
    expect(effect.extraHypotheses).toBe(2);
    expect(effect.deepDiveEntityId).toBe("ent-Z");
    expect(effect.directivesApplied).toBe(4);
  });
});
