/**
 * siaHarnessRouter.test.ts
 * Unit tests for server/siaHarnessRouter.ts
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
  const db: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const method of ["select", "from", "where", "orderBy", "insert", "values"]) {
    db[method] = vi.fn().mockReturnValue(db);
  }
  db.limit = vi.fn().mockResolvedValue(rows);
  db.insert = vi.fn().mockReturnValue(db);
  db.values = vi.fn().mockResolvedValue(undefined);
  return db;
};

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

  it("recordGeneration throws FORBIDDEN for non-admin users", async () => {
    mocks.mockGetDb.mockResolvedValue(makeDb([]));
    const { siaHarnessRouter } = await import("./siaHarnessRouter");
    const caller = siaHarnessRouter.createCaller(makeCtx("user") as never);
    await expect(
      caller.recordGeneration({
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
      })
    ).rejects.toThrow(TRPCError);
  });

  it("recordGeneration throws INTERNAL_SERVER_ERROR when DB unavailable", async () => {
    mocks.mockGetDb.mockResolvedValue(null);
    const { siaHarnessRouter } = await import("./siaHarnessRouter");
    const caller = siaHarnessRouter.createCaller(makeCtx("admin") as never);
    await expect(
      caller.recordGeneration({
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
      })
    ).rejects.toThrow(TRPCError);
  });

  it("listGenerations throws FORBIDDEN for non-admin users", async () => {
    mocks.mockGetDb.mockResolvedValue(makeDb([]));
    const { siaHarnessRouter } = await import("./siaHarnessRouter");
    const caller = siaHarnessRouter.createCaller(makeCtx("user") as never);
    await expect(caller.listGenerations({ runId: "run-1" })).rejects.toThrow(TRPCError);
  });

  it("getBestScore throws FORBIDDEN for non-admin users", async () => {
    mocks.mockGetDb.mockResolvedValue(makeDb([]));
    const { siaHarnessRouter } = await import("./siaHarnessRouter");
    const caller = siaHarnessRouter.createCaller(makeCtx("user") as never);
    await expect(caller.getBestScore()).rejects.toThrow(TRPCError);
  });
});
