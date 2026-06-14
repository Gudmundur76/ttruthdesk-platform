/**
 * coordRoundTrip.test.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Unit tests for coordRoundTrip.ts.
 * The function: insert → select+limit(dequeue) → update(claim) → update(complete)
 *               → select(status check) → delete(cleanup)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  mockGetDb: vi.fn(),
}));

vi.mock("./db", () => ({ getDb: mocks.mockGetDb }));

import { coordRoundTrip } from "./coordRoundTrip";

/** Build a db mock where select().from().where().limit() and select().from().where() both work */
function makeDb(limitResult: unknown[], statusResult: unknown[]) {
  let limitCallCount = 0;
  let selectCallCount = 0;

  const limitFn = vi.fn().mockImplementation(() => {
    limitCallCount++;
    return Promise.resolve(limitResult);
  });

  const whereFn = vi.fn().mockImplementation(() => {
    // If limit is called next → dequeue path; otherwise → status check path
    return {
      limit: limitFn,
      // Awaiting .where() directly (status check, no .limit)
      then: (resolve: (v: unknown) => void) => {
        selectCallCount++;
        resolve(statusResult);
      },
    };
  });

  return {
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockResolvedValue([{ insertId: 99 }]),
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: whereFn,
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    then: undefined,
  };
}

describe("coordRoundTrip()", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns success=true when all steps pass", async () => {
    const db = makeDb(
      [{ id: 99, status: "pending" }],  // dequeue result
      [{ id: 99, status: "completed" }] // status check result
    );
    mocks.mockGetDb.mockResolvedValue(db);
    const result = await coordRoundTrip({ vertical: "structural_biology" });
    expect(result.success).toBe(true);
    expect(result.finalStatus).toBe("completed");
    expect(result.taskId).toBeDefined();
    expect(result.totalMs).toBeGreaterThanOrEqual(0);
  });

  it("returns success=false when DB is unavailable", async () => {
    mocks.mockGetDb.mockResolvedValue(null);
    const result = await coordRoundTrip({ vertical: "structural_biology" });
    expect(result.success).toBe(false);
    expect(result.error).toBe("Database unavailable");
  });

  it("returns success=false when dequeue returns no item", async () => {
    const db = makeDb([], []); // empty dequeue
    mocks.mockGetDb.mockResolvedValue(db);
    const result = await coordRoundTrip({ vertical: "structural_biology" });
    expect(result.success).toBe(false);
    expect(result.error).toContain("Dequeue returned no item");
  });

  it("result contains all timing fields", async () => {
    const db = makeDb(
      [{ id: 99, status: "pending" }],
      [{ id: 99, status: "completed" }]
    );
    mocks.mockGetDb.mockResolvedValue(db);
    const result = await coordRoundTrip({ vertical: "structural_biology" });
    expect(result).toHaveProperty("enqueueMs");
    expect(result).toHaveProperty("dequeueMs");
    expect(result).toHaveProperty("completeMs");
    expect(result).toHaveProperty("statusMs");
    expect(result).toHaveProperty("totalMs");
  });

  it("handles DB insert error gracefully", async () => {
    const db = {
      insert: vi.fn().mockReturnThis(),
      values: vi.fn().mockRejectedValue(new Error("insert failed")),
      then: undefined,
    };
    mocks.mockGetDb.mockResolvedValue(db);
    const result = await coordRoundTrip({ vertical: "structural_biology" });
    expect(result.success).toBe(false);
    expect(result.error).toContain("insert failed");
  });

  it("accepts optional pmid and doi fields", async () => {
    const db = makeDb(
      [{ id: 99, status: "pending" }],
      [{ id: 99, status: "completed" }]
    );
    mocks.mockGetDb.mockResolvedValue(db);
    const result = await coordRoundTrip({
      vertical: "clinical_trials",
      pmid: "12345678",
      doi: "10.1000/xyz123",
    });
    expect(result.taskId).toBeDefined();
  });
});
