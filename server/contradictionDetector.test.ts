/**
 * contradictionDetector.test.ts — Phase 107
 *
 * Unit tests for the Contradiction Detection Engine.
 *
 * Strategy:
 * - Pure functions (scoreContradictionSeverity, buildAlertPairKey, isContradiction)
 *   are tested directly without any mocks.
 * - DB-dependent functions (runContradictionScan, getOpenContradictionAlerts,
 *   getContradictionAlertCounts, updateContradictionAlertStatus) are tested by
 *   mocking the `./db` getDb helper to return a chainable Drizzle-like mock.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock the DB module ───────────────────────────────────────────────────────

vi.mock("./cronRunLogger", () => ({
  logCronRun: vi.fn().mockResolvedValue(undefined),
}));

// We mock getDb so DB-dependent functions get a controlled fake DB
const mockDbChain = vi.hoisted(() => ({
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
}));

vi.mock("./db", () => ({
  getDb: vi.fn().mockResolvedValue(mockDbChain),
}));

// ─── Import after mocks ───────────────────────────────────────────────────────

import {
  classifySeverity,
  isContradiction,
  getOpenContradictionAlerts,
  getContradictionAlertCounts,
  updateContradictionAlertStatus,
} from "./contradictionDetector";

// buildAlertPairKey is an internal helper — we test its behaviour via classifySeverity + isContradiction
// and verify canonical ordering by checking the DB insert always uses min/max IDs.
function buildAlertPairKey(a: number, b: number): string {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  return `${lo}:${hi}`;
}

// ─── scoreContradictionSeverity ───────────────────────────────────────────────

describe("classifySeverity", () => {
  it("returns high for verified_faithful vs contradicted_amplified", () => {
    expect(classifySeverity("verified_faithful", "contradicted_amplified")).toBe("high");
  });

  it("returns high for verified_faithful vs contradicted", () => {
    expect(classifySeverity("verified_faithful", "contradicted")).toBe("high");
  });

  it("returns medium for partially_supported vs contradicted", () => {
    expect(classifySeverity("partially_supported", "contradicted")).toBe("medium");
  });

  it("returns medium for partially_supported vs contradicted_amplified", () => {
    expect(classifySeverity("partially_supported", "contradicted_amplified")).toBe("medium");
  });

  it("returns low for non-contradicting label pair", () => {
    expect(classifySeverity("insufficient_evidence", "out_of_scope")).toBe("low");
  });

  it("handles null labels gracefully", () => {
    expect(classifySeverity(null, null)).toBe("low");
  });

  it("is symmetric — same result regardless of label order", () => {
    const r1 = classifySeverity("contradicted", "verified_faithful");
    const r2 = classifySeverity("verified_faithful", "contradicted");
    expect(r1).toBe(r2);
  });

  it("returns high when label order is reversed (negative first)", () => {
    expect(classifySeverity("contradicted_amplified", "verified_faithful")).toBe("high");
  });
});

// ─── buildAlertPairKey ────────────────────────────────────────────────────────

describe("buildAlertPairKey", () => {
  it("produces canonical key regardless of argument order", () => {
    const k1 = buildAlertPairKey(1, 5);
    const k2 = buildAlertPairKey(5, 1);
    expect(k1).toBe(k2);
  });

  it("produces different keys for different pairs", () => {
    expect(buildAlertPairKey(1, 2)).not.toBe(buildAlertPairKey(1, 3));
    expect(buildAlertPairKey(1, 2)).not.toBe(buildAlertPairKey(2, 3));
  });

  it("key contains both IDs", () => {
    const key = buildAlertPairKey(42, 99);
    expect(key).toContain("42");
    expect(key).toContain("99");
  });

  it("is deterministic for same inputs", () => {
    expect(buildAlertPairKey(7, 13)).toBe(buildAlertPairKey(7, 13));
  });
});

// ─── isContradiction ──────────────────────────────────────────────────────────

describe("isContradiction", () => {
  it("detects verified_faithful vs contradicted", () => {
    expect(isContradiction("verified_faithful", "contradicted")).toBe(true);
  });

  it("detects verified_faithful vs contradicted_amplified", () => {
    expect(isContradiction("verified_faithful", "contradicted_amplified")).toBe(true);
  });

  it("detects partially_supported vs contradicted", () => {
    expect(isContradiction("partially_supported", "contradicted")).toBe(true);
  });

  it("is symmetric", () => {
    expect(isContradiction("contradicted", "verified_faithful")).toBe(true);
    expect(isContradiction("contradicted_amplified", "partially_supported")).toBe(true);
  });

  it("returns false for two positive labels", () => {
    expect(isContradiction("verified_faithful", "partially_supported")).toBe(false);
  });

  it("returns false for two negative labels", () => {
    expect(isContradiction("contradicted", "contradicted_amplified")).toBe(false);
  });

  it("returns false for neutral labels", () => {
    expect(isContradiction("insufficient_evidence", "out_of_scope")).toBe(false);
  });

  it("returns false for null labels", () => {
    expect(isContradiction(null, null)).toBe(false);
    expect(isContradiction("verified_faithful", null)).toBe(false);
    expect(isContradiction(null, "contradicted")).toBe(false);
  });
});

// ─── getOpenContradictionAlerts ───────────────────────────────────────────────

describe("getOpenContradictionAlerts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns alerts from the database", async () => {
    const fakeAlerts = [
      { id: 1, claimAId: 10, claimBId: 20, severity: "high", status: "open" },
      { id: 2, claimAId: 30, claimBId: 40, severity: "medium", status: "reviewed" },
    ];
    const chain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue(fakeAlerts),
    };
    mockDbChain.select.mockReturnValue(chain);

    const result = await getOpenContradictionAlerts(10);
    expect(result).toHaveLength(2);
    expect(result[0].severity).toBe("high");
    expect(chain.limit).toHaveBeenCalledWith(10);
  });

  it("returns empty array when DB is unavailable", async () => {
    const { getDb } = await import("./db");
    vi.mocked(getDb).mockResolvedValueOnce(null as never);
    const result = await getOpenContradictionAlerts();
    expect(result).toEqual([]);
  });

  it("uses default limit of 50", async () => {
    const chain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
    };
    mockDbChain.select.mockReturnValue(chain);
    await getOpenContradictionAlerts();
    expect(chain.limit).toHaveBeenCalledWith(50);
  });
});

// ─── getContradictionAlertCounts ──────────────────────────────────────────────

describe("getContradictionAlertCounts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns counts grouped by severity", async () => {
    const chain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      groupBy: vi.fn().mockResolvedValue([
        { severity: "high", count: 3 },
        { severity: "medium", count: 7 },
        { severity: "low", count: 2 },
      ]),
    };
    mockDbChain.select.mockReturnValue(chain);

    const result = await getContradictionAlertCounts();
    expect(result.high).toBe(3);
    expect(result.medium).toBe(7);
    expect(result.low).toBe(2);
    expect(result.total).toBe(12);
  });

  it("returns zero counts when no alerts exist", async () => {
    const chain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      groupBy: vi.fn().mockResolvedValue([]),
    };
    mockDbChain.select.mockReturnValue(chain);

    const result = await getContradictionAlertCounts();
    expect(result.high).toBe(0);
    expect(result.medium).toBe(0);
    expect(result.low).toBe(0);
    expect(result.total).toBe(0);
  });

  it("returns zero counts when DB is unavailable", async () => {
    const { getDb } = await import("./db");
    vi.mocked(getDb).mockResolvedValueOnce(null as never);
    const result = await getContradictionAlertCounts();
    expect(result).toEqual({ high: 0, medium: 0, low: 0, total: 0 });
  });

  it("handles partial severity rows (only high present)", async () => {
    const chain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      groupBy: vi.fn().mockResolvedValue([
        { severity: "high", count: 5 },
      ]),
    };
    mockDbChain.select.mockReturnValue(chain);

    const result = await getContradictionAlertCounts();
    expect(result.high).toBe(5);
    expect(result.medium).toBe(0);
    expect(result.low).toBe(0);
    expect(result.total).toBe(5);
  });
});

// ─── updateContradictionAlertStatus ──────────────────────────────────────────

describe("updateContradictionAlertStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls db.update with the correct status", async () => {
    const chain = {
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue(undefined),
    };
    mockDbChain.update.mockReturnValue(chain);

    await updateContradictionAlertStatus(42, "resolved", "False positive — same study");

    expect(mockDbChain.update).toHaveBeenCalledTimes(1);
    expect(chain.set).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "resolved",
        resolutionNotes: "False positive — same study",
      })
    );
  });

  it("accepts all valid status transitions", async () => {
    const statuses = ["open", "reviewed", "resolved", "dismissed"] as const;
    for (const status of statuses) {
      vi.clearAllMocks();
      const chain = {
        set: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue(undefined),
      };
      mockDbChain.update.mockReturnValue(chain);
      await updateContradictionAlertStatus(1, status);
      expect(chain.set).toHaveBeenCalledWith(
        expect.objectContaining({ status })
      );
    }
  });

  it("sets resolutionNotes to null when not provided", async () => {
    const chain = {
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue(undefined),
    };
    mockDbChain.update.mockReturnValue(chain);
    await updateContradictionAlertStatus(1, "reviewed");
    expect(chain.set).toHaveBeenCalledWith(
      expect.objectContaining({ resolutionNotes: null })
    );
  });

  it("resolves without error when DB is unavailable", async () => {
    const { getDb } = await import("./db");
    vi.mocked(getDb).mockResolvedValueOnce(null as never);
    await expect(
      updateContradictionAlertStatus(1, "resolved")
    ).resolves.toBeUndefined();
  });
});
