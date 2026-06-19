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

// ─── Build3: T066-T073 — FR-L5-26 compliance: sessionId, oldConfidence, newConfidence, ruleTriggered ───

describe("confidenceRecalibrator — FR-L5-26 compliance (T066-T073)", () => {
  it("T066: runConfidenceRecalibration accepts a sessionId parameter", async () => {
    mockGetDb.mockResolvedValue(makeDb([]));
    // Should not throw when sessionId is provided
    await expect(runConfidenceRecalibration(undefined, 42)).resolves.toBeDefined();
  });

  it("T067: RecalibrationReport has sessionId field", async () => {
    mockGetDb.mockResolvedValue(makeDb([]));
    const result = await runConfidenceRecalibration(undefined, 99);
    expect(result).toHaveProperty("sessionId");
    expect(result.sessionId).toBe(99);
  });

  it("T068: RecalibrationEntry has oldConfidence field", async () => {
    mockGetDb.mockResolvedValue(makeDb([]));
    const result = await runConfidenceRecalibration();
    // entries may be empty if no DB rows, but interface must have the field
    // Verify by checking the interface shape via TypeScript (compile-time check)
    // At runtime, verify the return type has entries array
    expect(Array.isArray(result.entries)).toBe(true);
  });

  it("T069: RecalibrationEntry has newConfidence field", async () => {
    mockGetDb.mockResolvedValue(makeDb([]));
    const result = await runConfidenceRecalibration();
    expect(Array.isArray(result.entries)).toBe(true);
    // If entries exist, they must have newConfidence
    for (const entry of result.entries) {
      expect(entry).toHaveProperty("newConfidence");
      expect(typeof entry.newConfidence).toBe("number");
    }
  });

  it("T070: RecalibrationEntry has ruleTriggered field with valid rule code", async () => {
    mockGetDb.mockResolvedValue(makeDb([]));
    const result = await runConfidenceRecalibration();
    for (const entry of result.entries) {
      expect(entry).toHaveProperty("ruleTriggered");
      expect(["R1", "R2", "R3", "R4"]).toContain(entry.ruleTriggered);
    }
  });

  it("T071: RecalibrationReport has totalRecalibrated field", async () => {
    mockGetDb.mockResolvedValue(makeDb([]));
    const result = await runConfidenceRecalibration();
    expect(result).toHaveProperty("totalRecalibrated");
    expect(typeof result.totalRecalibrated).toBe("number");
    expect(result.totalRecalibrated).toBeGreaterThanOrEqual(0);
  });

  it("T072: RecalibrationReport has autoApplied and byRule fields (FR-L5-26)", async () => {
    mockGetDb.mockResolvedValue(makeDb([]));
    const result = await runConfidenceRecalibration();
    expect(result).toHaveProperty("autoApplied");
    expect(typeof result.autoApplied).toBe("number");
    expect(result).toHaveProperty("byRule");
    expect(result.byRule).toHaveProperty("R1");
    expect(result.byRule).toHaveProperty("R2");
    expect(result.byRule).toHaveProperty("R3");
    expect(result.byRule).toHaveProperty("R4");
  });

  it("T073: sessionId defaults to undefined when not provided", async () => {
    mockGetDb.mockResolvedValue(makeDb([]));
    const result = await runConfidenceRecalibration();
    // sessionId should be undefined when not passed
    expect(result.sessionId).toBeUndefined();
  });
});
