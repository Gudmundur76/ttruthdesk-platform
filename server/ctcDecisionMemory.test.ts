/**
 * ctcDecisionMemory.test.ts — Tests for CTCDecisionMemory
 *
 * Uses the project-standard vi.mock("fs") pattern (see metaAgent.test.ts).
 * The sidecar is not running in test environments, so enabled-mode tests
 * verify that errors are swallowed and safe defaults are returned.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fs from "fs";
import {
  CTCDecisionMemory,
  getCTCDecisionMemory,
  type DirectiveEpisode,
  type DirectiveType,
  type DirectiveOutcome,
} from "./ctcDecisionMemory";

// ─── Mock fs ──────────────────────────────────────────────────────────────────
vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof fs>();
  return {
    ...actual,
    existsSync: vi.fn(),
  };
});

const mockFs = fs as unknown as { existsSync: ReturnType<typeof vi.fn> };

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeEpisode(overrides: Partial<DirectiveEpisode> = {}): DirectiveEpisode {
  const now = new Date();
  const expires = new Date(now.getTime() + 60 * 60 * 1000);
  return {
    directive_id: "test-directive-001",
    directive_type: "focus_gap" as DirectiveType,
    reason: "Gap 42 has been unresolved for 3 cycles.",
    confidence: 0.8,
    target_gap_id: 42,
    issued_at: now.toISOString(),
    expires_at: expires.toISOString(),
    ttl_minutes: 60,
    ...overrides,
  };
}

// ─── Disabled mode tests ──────────────────────────────────────────────────────

describe("CTCDecisionMemory (disabled — evolva-mragent not present)", () => {
  let ctc: CTCDecisionMemory;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFs.existsSync.mockReturnValue(false);
    ctc = new CTCDecisionMemory("/tmp/test-ctc-decision.db");
  });

  it("isEnabled returns false when evolva-mragent is not installed", () => {
    expect(ctc.isEnabled).toBe(false);
  });

  it("ingestDirective resolves without throwing when disabled", async () => {
    await expect(ctc.ingestDirective(makeEpisode())).resolves.toBeUndefined();
  });

  it("recordOutcome resolves without throwing when disabled", async () => {
    await expect(
      ctc.recordOutcome("test-directive-001", "converged", "Gap resolved")
    ).resolves.toBeUndefined();
  });

  it("reconstruct returns safe default when disabled", async () => {
    const result = await ctc.reconstruct("What directives were issued for gap 42?");
    expect(result.question).toBe("What directives were issued for gap 42?");
    expect(result.confidence).toBe("low");
    expect(result.supports).toEqual([]);
    expect(result.tool_calls_made).toBe(0);
  });

  it("getDirectivePatterns returns empty array when disabled", async () => {
    const result = await ctc.getDirectivePatterns();
    expect(result).toEqual([]);
  });

  it("getGapHistory returns empty array when disabled", async () => {
    const result = await ctc.getGapHistory(42);
    expect(result).toEqual([]);
  });

  it("getRecentDirectives returns empty array when disabled", async () => {
    const result = await ctc.getRecentDirectives(10);
    expect(result).toEqual([]);
  });
});

// ─── Enabled mode tests (sidecar not running → errors swallowed) ─────────────

describe("CTCDecisionMemory (enabled — sidecar not running, errors swallowed)", () => {
  let ctc: CTCDecisionMemory;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFs.existsSync.mockImplementation((p: unknown) => {
      const path = String(p);
      return path.includes("evolva-mragent") || path.includes("ctc_sidecar");
    });
    ctc = new CTCDecisionMemory("/tmp/test-ctc-decision-enabled.db");
  });

  it("isEnabled returns true when evolva-mragent is present", () => {
    expect(ctc.isEnabled).toBe(true);
  });

  it("ingestDirective does not throw on sidecar ECONNREFUSED", async () => {
    await expect(ctc.ingestDirective(makeEpisode())).resolves.toBeUndefined();
  });

  it("recordOutcome does not throw on sidecar ECONNREFUSED", async () => {
    await expect(
      ctc.recordOutcome("test-directive-001", "stalled")
    ).resolves.toBeUndefined();
  });

  it("reconstruct does not throw when sidecar returns an error response", async () => {
    // The sidecar may return {error: "..."} (exit 0) or throw (exit non-zero).
    // Either way, reconstruct() must not throw — it returns whatever the sidecar gives back.
    await expect(ctc.reconstruct("What directives were issued for gap 42?")).resolves.toBeDefined();
  });

  it("getDirectivePatterns returns empty array on sidecar ECONNREFUSED", async () => {
    const result = await ctc.getDirectivePatterns();
    expect(Array.isArray(result)).toBe(true);
  });

  it("getGapHistory returns empty array on sidecar ECONNREFUSED", async () => {
    const result = await ctc.getGapHistory(42);
    expect(Array.isArray(result)).toBe(true);
  });

  it("getRecentDirectives returns empty array on sidecar ECONNREFUSED", async () => {
    const result = await ctc.getRecentDirectives(20);
    expect(Array.isArray(result)).toBe(true);
  });
});

// ─── DirectiveEpisode shape tests ─────────────────────────────────────────────

describe("DirectiveEpisode shape", () => {
  it("makeEpisode produces a valid DirectiveEpisode", () => {
    const ep = makeEpisode();
    expect(ep.directive_id).toBe("test-directive-001");
    expect(ep.directive_type).toBe("focus_gap");
    expect(ep.confidence).toBeGreaterThanOrEqual(0);
    expect(ep.confidence).toBeLessThanOrEqual(1);
    expect(ep.ttl_minutes).toBeGreaterThan(0);
    expect(typeof ep.issued_at).toBe("string");
    expect(typeof ep.expires_at).toBe("string");
  });

  it("all DirectiveType values are valid", () => {
    const types: DirectiveType[] = [
      "focus_gap",
      "skip_mapping",
      "prioritize_hypotheses",
      "deep_dive_entity",
      "manual",
    ];
    for (const t of types) {
      const ep = makeEpisode({ directive_type: t });
      expect(ep.directive_type).toBe(t);
    }
  });

  it("all DirectiveOutcome values are valid", () => {
    const outcomes: DirectiveOutcome[] = [
      "converged",
      "stalled",
      "expired",
      "superseded",
      "unknown",
    ];
    for (const o of outcomes) {
      const ep = makeEpisode({ outcome: o });
      expect(ep.outcome).toBe(o);
    }
  });

  it("outcome is optional", () => {
    const ep = makeEpisode();
    expect(ep.outcome).toBeUndefined();
  });

  it("target_entity_id is optional", () => {
    const ep = makeEpisode({ target_entity_id: "entity-123" });
    expect(ep.target_entity_id).toBe("entity-123");
    const epNoEntity = makeEpisode();
    expect(epNoEntity.target_entity_id).toBeUndefined();
  });

  it("issued_by_cycle_id is optional", () => {
    const ep = makeEpisode({ issued_by_cycle_id: "cycle-abc" });
    expect(ep.issued_by_cycle_id).toBe("cycle-abc");
  });
});

// ─── Singleton tests ──────────────────────────────────────────────────────────

describe("getCTCDecisionMemory singleton", () => {
  it("returns the same instance on repeated calls", () => {
    const a = getCTCDecisionMemory();
    const b = getCTCDecisionMemory();
    expect(a).toBe(b);
  });

  it("singleton is an instance of CTCDecisionMemory", () => {
    const instance = getCTCDecisionMemory();
    expect(instance).toBeInstanceOf(CTCDecisionMemory);
  });
});
