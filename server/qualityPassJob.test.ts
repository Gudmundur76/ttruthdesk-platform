/**
 * qualityPassJob.test.ts
 * Unit tests for server/qualityPassJob.ts
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  mockGetDb: vi.fn(),
  mockNotifyOwner: vi.fn(),
  mockInvokeLLM: vi.fn(),
}));

vi.mock("./db", () => ({
  getDb: mocks.mockGetDb,
  getDraftDocuments: vi.fn().mockResolvedValue([]),
  getVerifiedClaimsForDocument: vi.fn().mockResolvedValue([]),
}));
vi.mock("./_core/notification", () => ({ notifyOwner: mocks.mockNotifyOwner }));
vi.mock("./_core/llm", () => ({ invokeLLM: mocks.mockInvokeLLM }));
vi.mock("./logger", () => ({
  logger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  errData: vi.fn((e: unknown) => ({ err: String(e) })),
}));

describe("runQualityPass()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.KIMI_API_KEY;
  });

  it("returns early with error when no LLM API key is configured", async () => {
    const { runQualityPass } = await import("./qualityPassJob");
    const result = await runQualityPass({ batchSize: 5, delayMs: 0 });
    expect(result.processed).toBe(0);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain("OPENROUTER_API_KEY");
  });

  it("returns result with processed=0 when no draft documents exist", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    const { getDraftDocuments } = await import("./db");
    vi.mocked(getDraftDocuments).mockResolvedValue([]);
    const { runQualityPass } = await import("./qualityPassJob");
    const result = await runQualityPass({ batchSize: 5, delayMs: 0 });
    expect(result.processed).toBe(0);
    expect(result.errors).toHaveLength(0);
  });
});

describe("qualityPassJobHandler()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.KIMI_API_KEY;
    delete process.env.BUILT_IN_FORGE_API_KEY;
    mocks.mockNotifyOwner.mockResolvedValue(true);
  });

  type ReqLike = { headers: Record<string, string>; body?: Record<string, unknown> };
  type ResLike = { status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> };

  const makeReqRes = (headers: Record<string, string> = {}, body: Record<string, unknown> = {}): { req: ReqLike; res: ResLike } => ({
    req: { headers, body },
    res: { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() },
  });

  it("returns 401 when forge API key is set and token is missing", async () => {
    process.env.BUILT_IN_FORGE_API_KEY = "secret-key";
    const { qualityPassJobHandler } = await import("./qualityPassJob");
    const { req, res } = makeReqRes({ authorization: "Bearer wrong-key" });
    await qualityPassJobHandler(req as never, res as never);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("returns 200 with result when authorized (no LLM key → error in result)", async () => {
    process.env.BUILT_IN_FORGE_API_KEY = "secret-key";
    const { qualityPassJobHandler } = await import("./qualityPassJob");
    const { req, res } = makeReqRes({ authorization: "Bearer secret-key" }, { batchSize: "1", delayMs: "0" });
    await qualityPassJobHandler(req as never, res as never);
    expect(res.json).toHaveBeenCalled();
    const jsonArg = vi.mocked(res.json).mock.calls[0][0] as Record<string, unknown>;
    expect(jsonArg).toHaveProperty("processed");
  });
});
