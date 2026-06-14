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
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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

// ─── wikiStaleness DB error path (lines 249-250, 257) ────────────────────────────
// All 7 invariants run in parallel (Promise.all), so we cannot rely on
// call order or table-reference tricks (the module is already imported).
// The simplest reliable approach: make ALL db.select() chains reject.
// Every invariant that uses select() will hit its own catch path, which
// means wikiStaleness (lines 248-250, 252-257) will definitely be covered.
describe("pipelineGuardian — wikiStaleness DB error path", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reports wikiStaleness as warn with dbError when select throws (lines 249-250, 257)", async () => {
    // checkWikiStaleness is the ONLY invariant that calls:
    //   db.select({ id: wikiPages.id, updatedAt: wikiPages.updatedAt }).from(wikiPages)
    // It is also the only select() call whose column spec includes an 'updatedAt' key.
    // We detect this by inspecting the columns argument and return a throwing chain for it.
    // All other select() calls get a normal resolving chain.
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
    function makeThrowingChain() {
      const p = Promise.reject(new Error("wiki DB error"));
      const c: Record<string, unknown> = {};
      c.from = vi.fn().mockReturnValue(c);
      c.where = vi.fn().mockReturnValue(c);
      c.leftJoin = vi.fn().mockReturnValue(c);
      c.limit = vi.fn().mockRejectedValue(new Error("wiki DB error"));
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
      // Detect the wikiStaleness select by the presence of 'updatedAt' in the columns spec
      select: vi.fn().mockImplementation((cols: unknown) => {
        const isWikiSelect =
          cols !== null &&
          typeof cols === "object" &&
          "updatedAt" in (cols as Record<string, unknown>);
        return isWikiSelect ? makeThrowingChain() : makeChain([]);
      }),
      execute: vi.fn().mockResolvedValue([]),
    };
    mockGetDb.mockResolvedValue(db);
    const r = await runPipelineGuardian();
    const wiki = r.invariants.find(i => i.name === "wikiStaleness");
    expect(wiki).toBeDefined();
    // DB error → warn with dbError in details
    expect(wiki!.status).toBe("warn");
    expect(wiki!.details).toHaveProperty("dbError");
  });
});

// ─── lowConfidenceClaims lowCount > 100 warn path (line 345-346) ────────────────────
describe("pipelineGuardian — lowConfidenceClaims lowCount > 100", () => {
  beforeEach(() => vi.clearAllMocks());

  it("warns when lowCount > 100 even if ratio is below threshold (line 345-346)", async () => {
    // lowCount = 101, totalScored = 10000 → ratio = 0.0101 (below 0.2 threshold)
    // but lowCount > 100 → warn
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
    // runPipelineGuardian calls invariants in order:
    // 1. stuckDocuments (select+leftJoin+where+limit)
    // 2. wikiStaleness (select+from → direct await)
    // 3. claimOrphans (execute)
    // 4. zeroClaimCompletions (select+from+where+limit)
    // 5. stalePdbEvidence (Promise.all of 2 select+from+where chains)
    // 6. lowConfidenceClaims (Promise.all of 2 select+from+where chains)
    // 7. modelValidationRate (select+from+where)
    // We need calls 6 and 7 (lowConfidenceClaims first select) to return cnt=101 and 10000
    const db = {
      select: vi.fn().mockImplementation(() => {
        callCount++;
        // Calls 1 (stuckDocuments), 2 (wikiStaleness), 4 (zeroClaimCompletions),
        // 5+6 (stalePdbEvidence), 8 (modelValidationRate) → return []
        // Calls 7 (lowConf first) → return [{ cnt: 101 }]
        // Call 8 (lowConf second / total) → return [{ cnt: 10000 }]
        if (callCount === 7) return makeChain([{ cnt: 101 }]);
        if (callCount === 8) return makeChain([{ cnt: 10000 }]);
        return makeChain([]);
      }),
      execute: vi.fn().mockResolvedValue([]),
    };
    mockGetDb.mockResolvedValue(db);
    const r = await runPipelineGuardian();
    const lowConf = r.invariants.find(i => i.name === "lowConfidenceClaims");
    expect(lowConf).toBeDefined();
    expect(lowConf!.status).toBe("warn");
  });
});
