/**
 * pubmedIngestJob.test.ts
 * Unit tests for server/pubmedIngestJob.ts
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  mockGetAutoIngestedPaperByPmid: vi.fn(),
  mockUpsertAutoIngestedPaper: vi.fn(),
  mockRunAnalysisPipeline: vi.fn(),
}));

vi.mock("./db", () => ({
  getAutoIngestedPaperByPmid: mocks.mockGetAutoIngestedPaperByPmid,
  upsertAutoIngestedPaper: mocks.mockUpsertAutoIngestedPaper,
}));
vi.mock("./analysisPipeline", () => ({ runAnalysisPipeline: mocks.mockRunAnalysisPipeline }));
vi.mock("./_core/env", () => ({ ENV: { forgeApiKey: "secret-key" } }));
vi.mock("./logger", () => ({
  logger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  errData: vi.fn((e: unknown) => ({ err: String(e) })),
}));
vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
  ok: false,
  json: vi.fn().mockResolvedValue({}),
  text: vi.fn().mockResolvedValue(""),
}));

type ReqLike = { headers: Record<string, string> };
type ResLike = { status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> };

const makeReqRes = (headers: Record<string, string> = {}): { req: ReqLike; res: ResLike } => ({
  req: { headers },
  res: { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() },
});

describe("pubmedIngestJobHandler()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mocks.mockGetAutoIngestedPaperByPmid.mockResolvedValue(null);
    mocks.mockUpsertAutoIngestedPaper.mockResolvedValue(undefined);
    mocks.mockRunAnalysisPipeline.mockResolvedValue({ status: "complete" });
  });

  it("returns 401 when forge API key is set and token is wrong", async () => {
    const { pubmedIngestJobHandler } = await import("./pubmedIngestJob");
    const { req, res } = makeReqRes({ authorization: "Bearer wrong-key" });
    await pubmedIngestJobHandler(req as never, res as never);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("returns 200 with result when authorized", async () => {
    const { pubmedIngestJobHandler } = await import("./pubmedIngestJob");
    const { req, res } = makeReqRes({ authorization: "Bearer secret-key" });
    await pubmedIngestJobHandler(req as never, res as never);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      queriesRun: expect.any(Number),
    }));
  });

  it("returns 200 with queriesRun >= 1 when authorized (queries are hardcoded)", async () => {
    const { pubmedIngestJobHandler } = await import("./pubmedIngestJob");
    const { req, res } = makeReqRes({ authorization: "Bearer secret-key" });
    await pubmedIngestJobHandler(req as never, res as never);
    const jsonArg = vi.mocked(res.json).mock.calls[0][0] as Record<string, unknown>;
    expect(Number(jsonArg.queriesRun)).toBeGreaterThan(0);
  });
});
