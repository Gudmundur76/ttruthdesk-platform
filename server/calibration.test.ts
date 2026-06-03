/**
 * Tests for calibration DB helpers in db.ts.
 *
 * Strategy: mock `drizzle-orm/mysql2` so that when `getDb()` calls
 * `drizzle(process.env.DATABASE_URL)` it returns our mock chain.
 *
 * getCalibrationStats makes TWO queries:
 *   1. .select().from().where(...).orderBy(...)  → terminal: orderBy
 *   2. .select().from().where(...)               → terminal: where
 *
 * getPredictionsForReview:
 *   .select().from().where().orderBy().limit()   → terminal: limit
 *
 * getPredictionById:
 *   .select().from().where().limit()             → terminal: limit
 *
 * updatePredictionModelValidation:
 *   .update().set().where()                      → terminal: where
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

let _mockDb: Record<string, unknown> | null = null;

vi.mock("drizzle-orm/mysql2", () => ({
  drizzle: () => _mockDb,
}));

// ─── Chain builders ───────────────────────────────────────────────────────────

/** Chain where `terminal` resolves with `resolveWith`, all others return `chain`. */
function makeSimpleChain(terminal: string, resolveWith: unknown) {
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "from", "where", "orderBy", "limit", "insert", "values", "update", "set"]) {
    chain[m] = m === terminal ? () => Promise.resolve(resolveWith) : () => chain;
  }
  return chain;
}

/**
 * Chain for getCalibrationStats:
 *   Query 1: .select().from().where().orderBy()  → resolves with `validatedRows`
 *   Query 2: .select().from().where()            → resolves with `pendingRows`
 *
 * `orderBy` resolves on first call; `where` resolves on second call.
 */
function makeCalibrationChain(validatedRows: unknown[], pendingRows: unknown[]) {
  let orderByCallCount = 0;
  let whereCallCount = 0;
  const chain: Record<string, unknown> = {};
  chain.select = () => chain;
  chain.from = () => chain;
  chain.where = () => {
    whereCallCount++;
    if (whereCallCount === 2) {
      // Second query: pending count — where is terminal
      return Promise.resolve(pendingRows);
    }
    // First query: where returns chain so orderBy can be called
    return chain;
  };
  chain.orderBy = () => {
    orderByCallCount++;
    // First query terminal
    return Promise.resolve(validatedRows);
  };
  chain.limit = () => Promise.resolve([]);
  return chain;
}

async function freshDb() {
  vi.resetModules();
  return import("./db");
}

// ─── getCalibrationStats ──────────────────────────────────────────────────────
describe("getCalibrationStats", () => {
  beforeEach(() => {
    _mockDb = null;
    vi.resetModules();
  });

  it("returns empty stats when DATABASE_URL is not set", async () => {
    const savedUrl = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    const db = await freshDb();
    const result = await db.getCalibrationStats();
    expect(result.totalValidated).toBe(0);
    expect(result.totalPending).toBe(0);
    expect(result.overallAccuracy).toBe(0);
    expect(result.buckets).toHaveLength(0);
    expect(result.byDay).toHaveLength(0);
    process.env.DATABASE_URL = savedUrl;
  });

  it("always returns 10 calibration buckets when there is data", async () => {
    process.env.DATABASE_URL = "mysql://test";
    const now = new Date("2025-03-01T10:00:00Z");
    const rows = [
      { id: 1, validationResult: "correct", prediction: { probability: 0.5 }, createdAt: now, validatedAt: now },
    ];
    _mockDb = makeCalibrationChain(rows, [{ count: 2 }]);
    const db = await freshDb();
    const result = await db.getCalibrationStats();
    expect(result.buckets).toHaveLength(10);
  });

  it("computes overallAccuracy correctly", async () => {
    process.env.DATABASE_URL = "mysql://test";
    const now = new Date("2025-03-01T10:00:00Z");
    const rows = [
      { id: 1, validationResult: "correct", prediction: { probability: 0.8 }, createdAt: now, validatedAt: now },
      { id: 2, validationResult: "correct", prediction: { probability: 0.7 }, createdAt: now, validatedAt: now },
      { id: 3, validationResult: "incorrect", prediction: { probability: 0.6 }, createdAt: now, validatedAt: now },
    ];
    _mockDb = makeCalibrationChain(rows, [{ count: 0 }]);
    const db = await freshDb();
    const result = await db.getCalibrationStats();
    expect(result.totalValidated).toBe(3);
    expect(result.overallAccuracy).toBeCloseTo(2 / 3, 3);
  });

  it("places predictions into correct probability buckets", async () => {
    process.env.DATABASE_URL = "mysql://test";
    const now = new Date("2025-03-01T10:00:00Z");
    const rows = [
      { id: 1, validationResult: "correct", prediction: { probability: 0.05 }, createdAt: now, validatedAt: now }, // bucket 0
      { id: 2, validationResult: "incorrect", prediction: { probability: 0.95 }, createdAt: now, validatedAt: now }, // bucket 9
    ];
    _mockDb = makeCalibrationChain(rows, [{ count: 0 }]);
    const db = await freshDb();
    const result = await db.getCalibrationStats();
    expect(result.buckets[0].total).toBe(1);
    expect(result.buckets[0].correct).toBe(1);
    expect(result.buckets[9].total).toBe(1);
    expect(result.buckets[9].incorrect).toBe(1);
  });

  it("groups accuracy by day", async () => {
    process.env.DATABASE_URL = "mysql://test";
    const d1 = new Date("2025-01-15T10:00:00Z");
    const d2 = new Date("2025-01-16T10:00:00Z");
    const rows = [
      { id: 1, validationResult: "correct", prediction: { probability: 0.7 }, createdAt: d1, validatedAt: d1 },
      { id: 2, validationResult: "incorrect", prediction: { probability: 0.7 }, createdAt: d1, validatedAt: d1 },
      { id: 3, validationResult: "correct", prediction: { probability: 0.6 }, createdAt: d2, validatedAt: d2 },
    ];
    _mockDb = makeCalibrationChain(rows, [{ count: 0 }]);
    const db = await freshDb();
    const result = await db.getCalibrationStats();
    expect(result.byDay).toHaveLength(2);
    const day1 = result.byDay.find((d) => d.date === "2025-01-15");
    expect(day1?.total).toBe(2);
    expect(day1?.correct).toBe(1);
    expect(day1?.accuracy).toBeCloseTo(0.5, 3);
  });

  it("reports totalPending from the count query", async () => {
    process.env.DATABASE_URL = "mysql://test";
    _mockDb = makeCalibrationChain([], [{ count: 7 }]);
    const db = await freshDb();
    const result = await db.getCalibrationStats();
    expect(result.totalPending).toBe(7);
  });

  it("computes calibration error per bucket", async () => {
    process.env.DATABASE_URL = "mysql://test";
    const now = new Date("2025-03-01T10:00:00Z");
    // All predictions in bucket 7 (0.7–0.8), midpoint 0.75
    const rows = [
      { id: 1, validationResult: "correct", prediction: { probability: 0.72 }, createdAt: now, validatedAt: now },
      { id: 2, validationResult: "correct", prediction: { probability: 0.78 }, createdAt: now, validatedAt: now },
    ];
    _mockDb = makeCalibrationChain(rows, [{ count: 0 }]);
    const db = await freshDb();
    const result = await db.getCalibrationStats();
    const b7 = result.buckets[7];
    expect(b7.total).toBe(2);
    expect(b7.actualRate).toBe(1); // both correct
    expect(b7.midpoint).toBeCloseTo(0.75, 2);
  });
});

// ─── getPredictionsForReview ──────────────────────────────────────────────────
describe("getPredictionsForReview", () => {
  beforeEach(() => {
    _mockDb = null;
    vi.resetModules();
  });

  it("returns empty array when db is unavailable", async () => {
    const savedUrl = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    const db = await freshDb();
    const result = await db.getPredictionsForReview();
    expect(result).toEqual([]);
    process.env.DATABASE_URL = savedUrl;
  });

  it("returns rows from the chain", async () => {
    process.env.DATABASE_URL = "mysql://test";
    const rows = [{ id: 1, validationResult: "pending" }];
    _mockDb = makeSimpleChain("limit", rows);
    const db = await freshDb();
    const result = await db.getPredictionsForReview(10);
    expect(result).toEqual(rows);
  });
});

// ─── getPredictionById ────────────────────────────────────────────────────────
describe("getPredictionById", () => {
  beforeEach(() => {
    _mockDb = null;
    vi.resetModules();
  });

  it("returns null when db is unavailable", async () => {
    const savedUrl = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    const db = await freshDb();
    const result = await db.getPredictionById(1);
    expect(result).toBeNull();
    process.env.DATABASE_URL = savedUrl;
  });

  it("returns null when no row found", async () => {
    process.env.DATABASE_URL = "mysql://test";
    _mockDb = makeSimpleChain("limit", []);
    const db = await freshDb();
    const result = await db.getPredictionById(999);
    expect(result).toBeNull();
  });

  it("returns the first row when found", async () => {
    process.env.DATABASE_URL = "mysql://test";
    const row = { id: 42, modelType: "claim_trajectory" };
    _mockDb = makeSimpleChain("limit", [row]);
    const db = await freshDb();
    const result = await db.getPredictionById(42);
    expect(result).toEqual(row);
  });
});

// ─── updatePredictionModelValidation ─────────────────────────────────────────
describe("updatePredictionModelValidation", () => {
  beforeEach(() => {
    _mockDb = null;
    vi.resetModules();
  });

  it("is a no-op when db is unavailable", async () => {
    const savedUrl = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    const db = await freshDb();
    await expect(db.updatePredictionModelValidation(1, "correct")).resolves.toBeUndefined();
    process.env.DATABASE_URL = savedUrl;
  });

  it("calls db.update().set().where() with correct args", async () => {
    process.env.DATABASE_URL = "mysql://test";
    const whereFn = vi.fn(() => Promise.resolve());
    const setFn = vi.fn(() => ({ where: whereFn }));
    const updateFn = vi.fn(() => ({ set: setFn }));
    _mockDb = { update: updateFn };
    const db = await freshDb();
    await db.updatePredictionModelValidation(7, "incorrect");
    expect(updateFn).toHaveBeenCalledOnce();
    expect(setFn).toHaveBeenCalledOnce();
    const setArg = setFn.mock.calls[0][0] as { validationResult: string; validatedAt: Date };
    expect(setArg.validationResult).toBe("incorrect");
    expect(setArg.validatedAt).toBeInstanceOf(Date);
    expect(whereFn).toHaveBeenCalledOnce();
  });
});
