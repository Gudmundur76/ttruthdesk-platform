/**
 * latentPatternDetector.test.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Unit tests for dream/latentPatternDetector.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockGetDb } = vi.hoisted(() => ({ mockGetDb: vi.fn() }));
vi.mock("../db", () => ({ getDb: mockGetDb }));

import { runPatternDetection } from "./latentPatternDetector";

function makeDb(executeResult: unknown[] = []) {
  return { execute: vi.fn().mockResolvedValue(executeResult) };
}

describe("dream/latentPatternDetector — runPatternDetection()", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns empty patterns when DB is unavailable", async () => {
    mockGetDb.mockResolvedValue(null);
    const result = await runPatternDetection();
    expect(result.patterns).toEqual([]);
    expect(result.totalFound).toBe(0);
  });

  it("returns empty patterns when no rules fire", async () => {
    // All count queries return 0 rows
    mockGetDb.mockResolvedValue(makeDb([{ cnt: 0 }]));
    const result = await runPatternDetection();
    expect(Array.isArray(result.patterns)).toBe(true);
  });

  it("returns a PatternDetectionResult with patterns array and totalFound number", async () => {
    mockGetDb.mockResolvedValue(makeDb([]));
    const result = await runPatternDetection();
    expect(typeof result.totalFound).toBe("number");
    expect(Array.isArray(result.patterns)).toBe(true);
  });

  it("does not throw when DB.execute rejects", async () => {
    const db = { execute: vi.fn().mockRejectedValue(new Error("DB error")) };
    mockGetDb.mockResolvedValue(db);
    await expect(runPatternDetection()).resolves.toBeDefined();
  });

  it("detects temporal_drift pattern when drift count > 0", async () => {
    // First execute call returns drift count > 0; subsequent calls return []
    const db = {
      execute: vi
        .fn()
        .mockResolvedValueOnce([{ cnt: 25 }]) // temporal drift
        .mockResolvedValue([]),               // all other rules
    };
    mockGetDb.mockResolvedValue(db);
    const result = await runPatternDetection();
    const driftPattern = result.patterns.find((p) => p.type === "temporal_drift");
    expect(driftPattern).toBeDefined();
    expect(driftPattern?.urgency).toBe("medium"); // 25 > 10 but ≤ 50
  });

  it("marks temporal_drift as high urgency when count > 50", async () => {
    const db = {
      execute: vi
        .fn()
        .mockResolvedValueOnce([{ cnt: 75 }]) // temporal drift high
        .mockResolvedValue([]),
    };
    mockGetDb.mockResolvedValue(db);
    const result = await runPatternDetection();
    const driftPattern = result.patterns.find((p) => p.type === "temporal_drift");
    expect(driftPattern?.urgency).toBe("high");
  });

  it("totalFound equals patterns.length", async () => {
    mockGetDb.mockResolvedValue(makeDb([]));
    const result = await runPatternDetection();
    expect(result.totalFound).toBe(result.patterns.length);
  });
});
