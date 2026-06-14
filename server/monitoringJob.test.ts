/**
 * monitoringJob.test.ts
 * Unit tests for server/monitoringJob.ts
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  mockAuthenticateRequest: vi.fn(),
  mockGetAllActiveMonitoringJobs: vi.fn(),
  mockGetDocumentById: vi.fn(),
  mockInsertMonitoringItems: vi.fn(),
  mockInvokeLLM: vi.fn(),
  mockNotifyIndexNow: vi.fn(),
  mockReportUrl: vi.fn(),
}));

vi.mock("./_core/sdk", () => ({
  sdk: { authenticateRequest: mocks.mockAuthenticateRequest },
}));
vi.mock("./db", () => ({
  insertMonitoringItems: mocks.mockInsertMonitoringItems,
  getAllActiveMonitoringJobs: mocks.mockGetAllActiveMonitoringJobs,
  getDocumentById: mocks.mockGetDocumentById,
}));
vi.mock("./_core/llm", () => ({ invokeLLM: mocks.mockInvokeLLM }));
vi.mock("./seo/indexNow", () => ({
  notifyIndexNow: mocks.mockNotifyIndexNow,
  reportUrl: mocks.mockReportUrl,
}));
vi.mock("./logger", () => ({
  logger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  errData: vi.fn((e: unknown) => ({ err: String(e) })),
}));

// Also mock fetch for PubMed/BioRxiv calls
vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
  ok: true,
  json: vi.fn().mockResolvedValue({ resultList: { result: [] } }),
}));

type ReqLike = { headers?: Record<string, string> };
type ResLike = { status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> };

const makeReqRes = (): { req: ReqLike; res: ResLike } => ({
  req: { headers: {} },
  res: { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() },
});

describe("monitoringJobHandler()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mocks.mockInsertMonitoringItems.mockResolvedValue(undefined);
    mocks.mockNotifyIndexNow.mockResolvedValue(undefined);
    mocks.mockReportUrl.mockResolvedValue(undefined);
  });

  it("returns 403 when request is not from cron", async () => {
    mocks.mockAuthenticateRequest.mockResolvedValue({ isCron: false, userId: 1 });
    mocks.mockGetAllActiveMonitoringJobs.mockResolvedValue([]);
    const { monitoringJobHandler } = await import("./monitoringJob");
    const { req, res } = makeReqRes();
    await monitoringJobHandler(req as never, res as never);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("returns 200 with totalInserted=0 when no monitoring jobs exist", async () => {
    mocks.mockAuthenticateRequest.mockResolvedValue({ isCron: true, userId: 0 });
    mocks.mockGetAllActiveMonitoringJobs.mockResolvedValue([]);
    const { monitoringJobHandler } = await import("./monitoringJob");
    const { req, res } = makeReqRes();
    await monitoringJobHandler(req as never, res as never);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      itemsInserted: 0,
      ok: true,
    }));
  });

  it("skips documents that no longer exist in DB", async () => {
    mocks.mockAuthenticateRequest.mockResolvedValue({ isCron: true, userId: 0 });
    mocks.mockGetAllActiveMonitoringJobs.mockResolvedValue([
      { documentId: 999 },
    ]);
    mocks.mockGetDocumentById.mockResolvedValue(null); // doc not found
    const { monitoringJobHandler } = await import("./monitoringJob");
    const { req, res } = makeReqRes();
    await monitoringJobHandler(req as never, res as never);
    expect(mocks.mockInsertMonitoringItems).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ itemsInserted: 0 }));
  });

  it("returns 500 when an unexpected error occurs", async () => {
    mocks.mockAuthenticateRequest.mockRejectedValue(new Error("Auth service down"));
    const { monitoringJobHandler } = await import("./monitoringJob");
    const { req, res } = makeReqRes();
    await monitoringJobHandler(req as never, res as never);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});
