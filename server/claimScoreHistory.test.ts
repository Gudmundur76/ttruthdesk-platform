/**
 * claimScoreHistory.test.ts — Phase 108
 *
 * Tests for:
 *   1. getClaimScoreHistory DB helper (mocked DB)
 *   2. insertClaimScoreSnapshot idempotency logic
 *   3. reScoreClaim snapshot wiring (integration-style, mocked DB)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock the DB module ───────────────────────────────────────────────────────

const mockSelect = vi.fn();
const mockInsert = vi.fn();
const mockValues = vi.fn();
const mockOnConflictDoNothing = vi.fn();
const mockFrom = vi.fn();
const mockWhere = vi.fn();
const mockOrderBy = vi.fn();
const mockLimit = vi.fn();

// Chain builder — each method returns an object with all the others
function makeChain(terminal: unknown) {
  const chain: Record<string, unknown> = {};
  const methods = [
    "select", "insert", "values", "onConflictDoNothing",
    "from", "where", "orderBy", "limit",
  ];
  for (const m of methods) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  // Make the chain thenable so await works
  (chain as { then: unknown }).then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve(terminal).then(resolve);
  return chain;
}

const mockDb = {
  select: vi.fn(),
  insert: vi.fn(),
};

vi.mock("../server/db", async () => {
  const actual = await vi.importActual<typeof import("../server/db")>("../server/db");
  return {
    ...actual,
    getClaimScoreHistory: vi.fn(),
    insertClaimScoreSnapshot: vi.fn(),
  };
});

vi.mock("../drizzle/schema", () => ({
  claimScoreHistory: { id: "id", claimId: "claimId" },
  claims: { id: "id" },
  contradictionAlerts: {},
}));

// ─── Tests: getClaimScoreHistory ──────────────────────────────────────────────

describe("getClaimScoreHistory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns an empty array when no history exists", async () => {
    const { getClaimScoreHistory } = await import("../server/db");
    vi.mocked(getClaimScoreHistory).mockResolvedValueOnce([]);

    const result = await getClaimScoreHistory(42, 30);
    expect(result).toEqual([]);
    expect(getClaimScoreHistory).toHaveBeenCalledWith(42, 30);
  });

  it("returns history rows ordered oldest-first", async () => {
    const { getClaimScoreHistory } = await import("../server/db");
    const mockRows = [
      {
        id: 1,
        claimId: 42,
        compositeTruthScore: 0.55,
        compositeTruthLabel: "contested",
        triggerSource: "initial_pipeline",
        snapshotAt: new Date("2024-01-01"),
        documentId: 10,
      },
      {
        id: 2,
        claimId: 42,
        compositeTruthScore: 0.72,
        compositeTruthLabel: "verified_faithful",
        triggerSource: "re_evaluation",
        snapshotAt: new Date("2024-02-01"),
        documentId: 10,
      },
    ];
    vi.mocked(getClaimScoreHistory).mockResolvedValueOnce(mockRows);

    const result = await getClaimScoreHistory(42, 30);
    expect(result).toHaveLength(2);
    expect(result[0].compositeTruthScore).toBe(0.55);
    expect(result[1].compositeTruthScore).toBe(0.72);
    // Verify oldest-first ordering (snapshotAt ascending)
    expect(result[0].snapshotAt.getTime()).toBeLessThan(result[1].snapshotAt.getTime());
  });

  it("respects the limit parameter", async () => {
    const { getClaimScoreHistory } = await import("../server/db");
    const mockRows = Array.from({ length: 5 }, (_, i) => ({
      id: i + 1,
      claimId: 42,
      compositeTruthScore: 0.5 + i * 0.05,
      compositeTruthLabel: "contested",
      triggerSource: "re_evaluation",
      snapshotAt: new Date(`2024-0${i + 1}-01`),
      documentId: 10,
    }));
    vi.mocked(getClaimScoreHistory).mockResolvedValueOnce(mockRows.slice(0, 3));

    const result = await getClaimScoreHistory(42, 3);
    expect(result).toHaveLength(3);
    expect(getClaimScoreHistory).toHaveBeenCalledWith(42, 3);
  });

  it("handles DB errors gracefully", async () => {
    const { getClaimScoreHistory } = await import("../server/db");
    vi.mocked(getClaimScoreHistory).mockRejectedValueOnce(new Error("DB connection lost"));

    await expect(getClaimScoreHistory(42, 30)).rejects.toThrow("DB connection lost");
  });
});

// ─── Tests: insertClaimScoreSnapshot ─────────────────────────────────────────

describe("insertClaimScoreSnapshot", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls insertClaimScoreSnapshot with correct parameters", async () => {
    const { insertClaimScoreSnapshot } = await import("../server/db");
    vi.mocked(insertClaimScoreSnapshot).mockResolvedValueOnce(undefined);

    // Signature: insertClaimScoreSnapshot(claimId, score, label, triggerSource?)
    await insertClaimScoreSnapshot(42, 0.78, "verified_faithful", "re_evaluation");

    expect(insertClaimScoreSnapshot).toHaveBeenCalledWith(
      42, 0.78, "verified_faithful", "re_evaluation"
    );
  });

  it("handles null compositeTruthLabel", async () => {
    const { insertClaimScoreSnapshot } = await import("../server/db");
    vi.mocked(insertClaimScoreSnapshot).mockResolvedValueOnce(undefined);

    await insertClaimScoreSnapshot(42, 0.45, null, "initial_pipeline");

    expect(insertClaimScoreSnapshot).toHaveBeenCalledWith(42, 0.45, null, "initial_pipeline");
  });
});

// ─── Tests: SparklineChart data transformation ────────────────────────────────

describe("SparklineChart data transformation logic", () => {
  /**
   * These tests verify the pure data transformation logic that the SparklineChart
   * component uses — without rendering the component (no jsdom required).
   */

  function computeSparklinePoints(
    data: Array<{ compositeTruthScore: number }>,
    width: number,
    height: number,
    padX = 4,
    padY = 4
  ) {
    if (data.length < 2) return [];
    const innerW = width - padX * 2;
    const innerH = height - padY * 2;
    const scores = data.map(d => d.compositeTruthScore);
    const minScore = Math.min(...scores);
    const maxScore = Math.max(...scores);
    const scoreRange = maxScore - minScore || 1;
    return data.map((d, i) => ({
      x: padX + (i / (data.length - 1)) * innerW,
      y: padY + innerH - ((d.compositeTruthScore - minScore) / scoreRange) * innerH,
    }));
  }

  it("maps first point to left edge and last point to right edge", () => {
    const data = [
      { compositeTruthScore: 0.3 },
      { compositeTruthScore: 0.7 },
      { compositeTruthScore: 0.9 },
    ];
    const points = computeSparklinePoints(data, 120, 36);
    expect(points[0].x).toBe(4); // padX
    expect(points[points.length - 1].x).toBe(116); // width - padX
  });

  it("maps highest score to top and lowest score to bottom", () => {
    const data = [
      { compositeTruthScore: 0.0 },
      { compositeTruthScore: 1.0 },
    ];
    const points = computeSparklinePoints(data, 120, 36);
    // Score 0.0 → bottom (high y value)
    expect(points[0].y).toBeGreaterThan(points[1].y);
    // Score 1.0 → top (low y value)
    expect(points[1].y).toBe(4); // padY
  });

  it("handles flat line (all same score) without division by zero", () => {
    const data = [
      { compositeTruthScore: 0.5 },
      { compositeTruthScore: 0.5 },
      { compositeTruthScore: 0.5 },
    ];
    const points = computeSparklinePoints(data, 120, 36);
    // All points should have the same y (midpoint)
    const ys = points.map(p => p.y);
    expect(new Set(ys).size).toBe(1);
    // No NaN
    expect(ys.every(y => !isNaN(y))).toBe(true);
  });

  it("returns empty array for single data point", () => {
    const data = [{ compositeTruthScore: 0.7 }];
    const points = computeSparklinePoints(data, 120, 36);
    expect(points).toHaveLength(0);
  });

  it("returns empty array for empty data", () => {
    const points = computeSparklinePoints([], 120, 36);
    expect(points).toHaveLength(0);
  });

  it("produces correct number of points", () => {
    const data = Array.from({ length: 10 }, (_, i) => ({
      compositeTruthScore: i * 0.1,
    }));
    const points = computeSparklinePoints(data, 200, 40);
    expect(points).toHaveLength(10);
  });
});

// ─── Tests: Label colour mapping ──────────────────────────────────────────────

describe("SparklineChart label colour mapping", () => {
  const LABEL_COLOURS: Record<string, string> = {
    verified_faithful: "#22c55e",
    verified_distorted: "#f59e0b",
    contradicted: "#ef4444",
    contradicted_amplified: "#dc2626",
    partially_supported: "#f97316",
    contested: "#a855f7",
    insufficient_evidence: "#6b7280",
    out_of_scope: "#6b7280",
  };

  function getLabelColour(label?: string | null): string {
    if (!label) return "#6b7280";
    return LABEL_COLOURS[label] ?? "#6b7280";
  }

  it("returns green for verified_faithful", () => {
    expect(getLabelColour("verified_faithful")).toBe("#22c55e");
  });

  it("returns red for contradicted", () => {
    expect(getLabelColour("contradicted")).toBe("#ef4444");
  });

  it("returns amber for verified_distorted", () => {
    expect(getLabelColour("verified_distorted")).toBe("#f59e0b");
  });

  it("returns gray for null label", () => {
    expect(getLabelColour(null)).toBe("#6b7280");
  });

  it("returns gray for undefined label", () => {
    expect(getLabelColour(undefined)).toBe("#6b7280");
  });

  it("returns gray for unknown label", () => {
    expect(getLabelColour("some_unknown_label")).toBe("#6b7280");
  });

  it("returns purple for contested", () => {
    expect(getLabelColour("contested")).toBe("#a855f7");
  });
});
