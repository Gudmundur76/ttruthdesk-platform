/**
 * pipelineGuardian.test.ts — Pipeline Invariant Checks
 *
 * The guardian uses two query patterns:
 *   1. db.select(...).from(...).where(...).limit(n)  → rows[]
 *   2. db.select(...).from(...)                      → awaited directly (no .limit)
 *
 * Strategy: make every chain method return a new thenable-chain so that
 * `await db.select().from()` resolves to `rows`, while
 * `await db.select().from().where().limit(n)` also resolves to `rows`.
 *
 * CRITICAL: the db object itself must NOT be thenable (no .then property),
 * otherwise `mockGetDb.mockResolvedValue(db)` will unwrap it.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockGetDb } = vi.hoisted(() => ({ mockGetDb: vi.fn() }));
vi.mock("../db", () => ({ getDb: mockGetDb }));

import {
  runPipelineGuardian,
  type InvariantResult,
  type PipelineGuardianReport,
} from "./pipelineGuardian";

// ─── Mock builder ─────────────────────────────────────────────────────────────
/**
 * Returns a db-like object whose query chains resolve to `rows`.
 * The db object itself has NO .then property so Promise.resolve(db) keeps it as-is.
 */
function makeDb(rows: unknown[] = []) {
  // Each call to select() returns a fresh thenable chain
  function makeChain(resolveWith: unknown[]) {
    const p = Promise.resolve(resolveWith);
    const c: Record<string, unknown> = {};
    c.from = vi.fn().mockReturnValue(c);
    c.where = vi.fn().mockReturnValue(c);
    c.leftJoin = vi.fn().mockReturnValue(c);
    c.limit = vi.fn().mockResolvedValue(resolveWith);
    // Make chain thenable so `await chain` resolves to resolveWith
    c.then = (onfulfilled: unknown, onrejected: unknown) =>
      p.then(
        onfulfilled as Parameters<typeof p.then>[0],
        onrejected as Parameters<typeof p.then>[1]
      );
    c.catch = p.catch.bind(p);
    c.finally = p.finally.bind(p);
    return c;
  }

  // db itself must NOT be thenable
  const db = {
    select: vi.fn().mockImplementation(() => makeChain(rows)),
    // checkClaimOrphans uses db.execute(sql`...`) — return rows directly
    execute: vi.fn().mockResolvedValue(rows),
  };
  return db;
}

function expectShape(r: InvariantResult) {
  expect(typeof r.name).toBe("string");
  expect(["pass", "warn", "fail"]).toContain(r.status);
  expect(["info", "warning", "critical"]).toContain(r.severity);
}

function expectReport(r: PipelineGuardianReport) {
  expect(Array.isArray(r.invariants)).toBe(true);
  expect(["pass", "warn", "fail"]).toContain(r.overallStatus);
  expect(typeof r.failCount).toBe("number");
  expect(typeof r.warnCount).toBe("number");
  expect(typeof r.checkedAt).toBe("string");
}

// ─── DB unavailable ───────────────────────────────────────────────────────────
describe("pipelineGuardian — DB unavailable", () => {
  it("returns fail report with dbConnection invariant", async () => {
    mockGetDb.mockResolvedValue(null);
    const r = await runPipelineGuardian();
    expectReport(r);
    expect(r.overallStatus).toBe("fail");
    expect(r.invariants[0].name).toBe("dbConnection");
    expect(r.invariants[0].severity).toBe("critical");
  });
});

// ─── All pass (empty DB) ──────────────────────────────────────────────────────
describe("pipelineGuardian — all pass with empty DB", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns pass when all queries return empty arrays", async () => {
    mockGetDb.mockResolvedValue(makeDb([]));
    const r = await runPipelineGuardian();
    expectReport(r);
    expect(r.overallStatus).toBe("pass");
    expect(r.failCount).toBe(0);
    expect(r.warnCount).toBe(0);
    expect(r.invariants.length).toBeGreaterThanOrEqual(5);
    for (const inv of r.invariants) expectShape(inv);
  });
});

// ─── Report structure ─────────────────────────────────────────────────────────
describe("pipelineGuardian — report structure", () => {
  beforeEach(() => vi.clearAllMocks());

  it("checkedAt is a valid ISO date", async () => {
    mockGetDb.mockResolvedValue(makeDb([]));
    const r = await runPipelineGuardian();
    expect(() => new Date(r.checkedAt)).not.toThrow();
    expect(new Date(r.checkedAt).getTime()).toBeGreaterThan(0);
  });

  it("contains named invariants: stuckDocuments, claimOrphans, zeroClaimCompletions", async () => {
    mockGetDb.mockResolvedValue(makeDb([]));
    const r = await runPipelineGuardian();
    const names = r.invariants.map(i => i.name);
    expect(names).toContain("stuckDocuments");
    expect(names).toContain("claimOrphans");
    expect(names).toContain("zeroClaimCompletions");
  });

  it("failCount and warnCount are consistent with invariants array", async () => {
    mockGetDb.mockResolvedValue(makeDb([]));
    const r = await runPipelineGuardian();
    const actualFails = r.invariants.filter(i => i.status === "fail").length;
    const actualWarns = r.invariants.filter(i => i.status === "warn").length;
    expect(r.failCount).toBe(actualFails);
    expect(r.warnCount).toBe(actualWarns);
  });

  it("overallStatus is fail when DB is null (failCount=1)", async () => {
    mockGetDb.mockResolvedValue(null);
    const r = await runPipelineGuardian();
    expect(r.failCount).toBeGreaterThan(0);
    expect(r.overallStatus).toBe("fail");
  });
});

// ─── Stuck documents detection ────────────────────────────────────────────────
describe("pipelineGuardian — stuck documents", () => {
  beforeEach(() => vi.clearAllMocks());

  it("detects stuck documents when first select returns rows", async () => {
    let callCount = 0;

    function makeChain(resolveWith: unknown[]) {
      const p = Promise.resolve(resolveWith);
      const c: Record<string, unknown> = {};
      c.from = vi.fn().mockReturnValue(c);
      c.where = vi.fn().mockReturnValue(c);
      c.leftJoin = vi.fn().mockReturnValue(c);
      c.limit = vi.fn().mockResolvedValue(resolveWith);
      c.then = (onfulfilled: unknown, onrejected: unknown) =>
        p.then(
          onfulfilled as Parameters<typeof p.then>[0],
          onrejected as Parameters<typeof p.then>[1]
        );
      c.catch = p.catch.bind(p);
      c.finally = p.finally.bind(p);
      return c;
    }

    const db = {
      select: vi.fn().mockImplementation(() => {
        callCount++;
        // First call is stuckDocuments query → return 3 stuck docs
        if (callCount === 1)
          return makeChain([{ id: 1 }, { id: 2 }, { id: 3 }]);
        return makeChain([]);
      }),
    };

    mockGetDb.mockResolvedValue(db);
    const r = await runPipelineGuardian();
    expectReport(r);
    const stuck = r.invariants.find(i => i.name === "stuckDocuments");
    expect(stuck).toBeDefined();
    expect(["warn", "fail"]).toContain(stuck!.status);
  });
});
