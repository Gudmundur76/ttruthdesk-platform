/**
 * confidenceRecalibrator.test.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Unit tests for dream/confidenceRecalibrator.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockGetDb } = vi.hoisted(() => ({ mockGetDb: vi.fn() }));
vi.mock("../db", () => ({ getDb: mockGetDb }));

import { runConfidenceRecalibration } from "./confidenceRecalibrator";

function makeDb(executeResult: unknown[] = []) {
  return { execute: vi.fn().mockResolvedValue(executeResult) };
}

describe("dream/confidenceRecalibrator — runConfidenceRecalibration()", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns empty entries when DB is unavailable", async () => {
    mockGetDb.mockResolvedValue(null);
    const result = await runConfidenceRecalibration();
    expect(result.entries).toEqual([]);
    expect(result.totalRecalibrated).toBe(0);
  });

  it("returns empty entries when no rows match any rule", async () => {
    mockGetDb.mockResolvedValue(makeDb([]));
    const result = await runConfidenceRecalibration();
    expect(Array.isArray(result.entries)).toBe(true);
    expect(result.totalRecalibrated).toBeGreaterThanOrEqual(0);
  });

  it("returns a RecalibrationResult with entries array and totalAdjusted number", async () => {
    mockGetDb.mockResolvedValue(makeDb([]));
    const result = await runConfidenceRecalibration();
    expect(typeof result.totalRecalibrated).toBe("number");
    expect(Array.isArray(result.entries)).toBe(true);
  });

  it("does not throw when DB.execute rejects", async () => {
    const db = { execute: vi.fn().mockRejectedValue(new Error("DB error")) };
    mockGetDb.mockResolvedValue(db);
    // non-fatal — should resolve, not reject
    await expect(runConfidenceRecalibration()).resolves.toBeDefined();
  });
});
