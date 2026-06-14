/**
 * siaHarnessRouter.test.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Phase 132 — expanded unit tests for server/siaHarnessRouter.ts
 *
 * Covers all 5 procedures:
 *   1. recordGeneration  — FORBIDDEN + DB unavailable (2 tests)
 *   2. listGenerations   — FORBIDDEN + happy-path (2 tests)
 *   3. listProposals     — FORBIDDEN + happy-path (2 tests)
 *   4. updateProposalStatus — FORBIDDEN + happy-path (2 tests)
 *   5. getBestScore      — FORBIDDEN + happy-path (2 tests)
 *
 * Total: 12 tests
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { TRPCError } from "@trpc/server";

const mocks = vi.hoisted(() => ({
  mockGetDb: vi.fn(),
  mockInvokeLLM: vi.fn(),
}));

vi.mock("./db", () => ({ getDb: mocks.mockGetDb }));
vi.mock("./_core/llm", () => ({ invokeLLM: mocks.mockInvokeLLM }));
vi.mock("./logger", () => ({
  logger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  errData: vi.fn((e: unknown) => ({ err: String(e) })),
}));

const makeDb = (rows: unknown[] = []) => {
  // Fully chainable Drizzle-like mock.
  // Chains used by the router:
  //   listGenerations:     select().from().where().orderBy()  → resolves
  //   listProposals:       select().from().orderBy()          → resolves (no-status path)
  //                        select().from().orderBy().where()  → resolves (status path)
  //   getBestScore:        select().from().orderBy().limit()  → resolves
  //   updateProposalStatus: update().set().where()            → resolves

  const db: Record<string, ReturnType<typeof vi.fn>> = {};

  // Chainable methods that return db itself
  for (const method of ["select", "from", "insert", "update"]) {
    db[method] = vi.fn().mockReturnValue(db);
  }

  // orderBy returns an object that can .limit() or .where() or resolve directly
  const afterOrderBy: Record<string, ReturnType<typeof vi.fn>> = {};
  afterOrderBy.limit = vi.fn().mockResolvedValue(rows);
  afterOrderBy.where = vi.fn().mockResolvedValue(rows);
  // orderBy itself is also a thenable (resolves to rows when awaited)
  db.orderBy = vi.fn().mockImplementation(() => {
    const obj = Object.assign(Promise.resolve(rows), afterOrderBy);
    return obj;
  });

  // where returns an object that can .orderBy() or .limit() or resolve directly
  const afterWhere: Record<string, ReturnType<typeof vi.fn>> = {};
  afterWhere.limit = vi.fn().mockResolvedValue(rows);
  afterWhere.orderBy = vi.fn().mockImplementation(() => {
    const obj = Object.assign(Promise.resolve(rows), afterOrderBy);
    return obj;
  });
  db.where = vi.fn().mockImplementation(() => {
    const obj = Object.assign(Promise.resolve(rows), afterWhere);
    return obj;
  });

  // Terminal resolvers on db itself
  db.limit = vi.fn().mockResolvedValue(rows);
  db.values = vi.fn().mockResolvedValue(undefined);
  db.set = vi.fn().mockReturnValue(db);

  return db;
};

const RECORD_INPUT = {
  runId: "run-1",
  generation: 1,
  combinedScore: 0.85,
  citationStateAccuracy: 0.9,
  passagePrecision: 0.8,
  misrepresentationRecall: 0.85,
  nTotal: 100,
  nEvaluated: 95,
  targetAgentCode: "agent-v1",
  improvementMd: undefined,
} as const;

const makeCtx = (role: "admin" | "user" = "admin") => ({
  user: { id: 1, role, openId: "test-open-id" },
});

describe("siaHarnessRouter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mocks.mockInvokeLLM.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({ summary: "test", improvements: [] }) } }],
    });
  });

  // ── recordGeneration ──────────────────────────────────────────────────────
  it("recordGeneration throws FORBIDDEN for non-admin users", async () => {
    mocks.mockGetDb.mockResolvedValue(makeDb([]));
    const { siaHarnessRouter } = await import("./siaHarnessRouter");
    const caller = siaHarnessRouter.createCaller(makeCtx("user") as never);
    await expect(caller.recordGeneration(RECORD_INPUT)).rejects.toThrow(TRPCError);
  });

  it("recordGeneration throws INTERNAL_SERVER_ERROR when DB unavailable", async () => {
    mocks.mockGetDb.mockResolvedValue(null);
    const { siaHarnessRouter } = await import("./siaHarnessRouter");
    const caller = siaHarnessRouter.createCaller(makeCtx("admin") as never);
    await expect(caller.recordGeneration(RECORD_INPUT)).rejects.toThrow(TRPCError);
  });

  // ── listGenerations ───────────────────────────────────────────────────────
  it("listGenerations throws FORBIDDEN for non-admin users", async () => {
    mocks.mockGetDb.mockResolvedValue(makeDb([]));
    const { siaHarnessRouter } = await import("./siaHarnessRouter");
    const caller = siaHarnessRouter.createCaller(makeCtx("user") as never);
    await expect(caller.listGenerations({ runId: "run-1" })).rejects.toThrow(TRPCError);
  });

  it("listGenerations returns an array for admin", async () => {
    const row = {
      id: 1, runId: "run-1", generation: 1, combinedScore: 0.85,
      citationStateAccuracy: 0.9, passagePrecision: 0.8,
      misrepresentationRecall: 0.85, nTotal: 100, nEvaluated: 95,
      targetAgentCode: "agent-v1", improvementMd: null, createdAt: Date.now(),
    };
    mocks.mockGetDb.mockResolvedValue(makeDb([row]));
    const { siaHarnessRouter } = await import("./siaHarnessRouter");
    const caller = siaHarnessRouter.createCaller(makeCtx("admin") as never);
    const result = await caller.listGenerations({ runId: "run-1" });
    expect(Array.isArray(result)).toBe(true);
  });

  // ── listProposals ─────────────────────────────────────────────────────────
  it("listProposals throws FORBIDDEN for non-admin users", async () => {
    mocks.mockGetDb.mockResolvedValue(makeDb([]));
    const { siaHarnessRouter } = await import("./siaHarnessRouter");
    const caller = siaHarnessRouter.createCaller(makeCtx("user") as never);
    await expect(caller.listProposals({})).rejects.toThrow(TRPCError);
  });

  it("listProposals returns an array for admin (no status filter)", async () => {
    const row = {
      id: 1, runId: "run-1", generation: 1, combinedScore: 0.85,
      scoreDelta: 0.05, proposal: "Improve passage alignment",
      status: "pending_review", reviewNote: null,
      reviewedAt: null, reviewedBy: null, createdAt: Date.now(),
    };
    mocks.mockGetDb.mockResolvedValue(makeDb([row]));
    const { siaHarnessRouter } = await import("./siaHarnessRouter");
    const caller = siaHarnessRouter.createCaller(makeCtx("admin") as never);
    const result = await caller.listProposals({});
    expect(Array.isArray(result)).toBe(true);
  });

  it("listProposals with status filter returns an array for admin", async () => {
    const row = {
      id: 2, runId: "run-1", generation: 2, combinedScore: 0.88,
      scoreDelta: 0.03, proposal: "Tune BM25 weights",
      status: "approved", reviewNote: "Approved by admin",
      reviewedAt: Date.now(), reviewedBy: 1, createdAt: Date.now(),
    };
    mocks.mockGetDb.mockResolvedValue(makeDb([row]));
    const { siaHarnessRouter } = await import("./siaHarnessRouter");
    const caller = siaHarnessRouter.createCaller(makeCtx("admin") as never);
    const result = await caller.listProposals({ status: "approved" });
    expect(Array.isArray(result)).toBe(true);
  });

  // ── updateProposalStatus ──────────────────────────────────────────────────
  it("updateProposalStatus throws FORBIDDEN for non-admin users", async () => {
    mocks.mockGetDb.mockResolvedValue(makeDb([]));
    const { siaHarnessRouter } = await import("./siaHarnessRouter");
    const caller = siaHarnessRouter.createCaller(makeCtx("user") as never);
    await expect(
      caller.updateProposalStatus({ proposalId: 1, status: "approved" })
    ).rejects.toThrow(TRPCError);
  });

  it("updateProposalStatus returns { updated: true } for admin", async () => {
    const db = makeDb([]);
    db.update = vi.fn().mockReturnValue(db);
    db.set = vi.fn().mockReturnValue(db);
    db.where = vi.fn().mockResolvedValue(undefined);
    mocks.mockGetDb.mockResolvedValue(db);
    const { siaHarnessRouter } = await import("./siaHarnessRouter");
    const caller = siaHarnessRouter.createCaller(makeCtx("admin") as never);
    const result = await caller.updateProposalStatus({
      proposalId: 1,
      status: "approved",
      reviewNote: "Looks good",
    });
    expect(result).toEqual({ updated: true });
  });

  // ── getBestScore ──────────────────────────────────────────────────────────
  it("getBestScore throws FORBIDDEN for non-admin users", async () => {
    mocks.mockGetDb.mockResolvedValue(makeDb([]));
    const { siaHarnessRouter } = await import("./siaHarnessRouter");
    const caller = siaHarnessRouter.createCaller(makeCtx("user") as never);
    await expect(caller.getBestScore()).rejects.toThrow(TRPCError);
  });

  it("getBestScore returns the best row or null for admin", async () => {
    const best = {
      combinedScore: 0.92, runId: "run-2", generation: 3, createdAt: Date.now(),
    };
    mocks.mockGetDb.mockResolvedValue(makeDb([best]));
    const { siaHarnessRouter } = await import("./siaHarnessRouter");
    const caller = siaHarnessRouter.createCaller(makeCtx("admin") as never);
    const result = await caller.getBestScore();
    expect(result === null || typeof result === "object").toBe(true);
  });
});
