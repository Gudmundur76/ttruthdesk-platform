/**
 * predictionBackfillJob.test.ts
 * Unit tests for server/predictionBackfillJob.ts
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  mockAuthenticateRequest: vi.fn(),
  mockGetDb: vi.fn(),
  mockComputeClaimTrajectory: vi.fn(),
  mockSavePrediction: vi.fn(),
}));

vi.mock("./_core/sdk", () => ({
  sdk: { authenticateRequest: mocks.mockAuthenticateRequest },
}));
vi.mock("./db", () => ({ getDb: mocks.mockGetDb }));
vi.mock("./predictionEngine", () => ({
  computeClaimTrajectory: mocks.mockComputeClaimTrajectory,
  savePrediction: mocks.mockSavePrediction,
}));
vi.mock("./logger", () => ({
  logger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  errData: vi.fn((e: unknown) => ({ err: String(e) })),
}));

type ReqLike = { headers?: Record<string, string> };
type ResLike = { status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> };

const makeReqRes = (): { req: ReqLike; res: ResLike } => ({
  req: { headers: {} },
  res: { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() },
});

const makeDb = (claimsRows: unknown[] = [], predictedIds: unknown[] = []) => {
  let limitCallCount = 0;
  let whereCallCount = 0;
  const db: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const method of ["select", "from", "innerJoin"]) {
    db[method] = vi.fn().mockReturnValue(db);
  }
  // First query: select().from().innerJoin().where().limit() → claimsRows
  db.limit = vi.fn().mockImplementation(() => {
    limitCallCount++;
    return Promise.resolve(claimsRows);
  });
  // Second query: select().from().where() (no limit) → predictedIds
  db.where = vi.fn().mockImplementation(() => {
    whereCallCount++;
    if (whereCallCount === 1) {
      // First where() call is chained before limit() — return db for further chaining
      return db;
    }
    // Second where() call is the terminal for predictedClaimIds query
    return Promise.resolve(predictedIds);
  });
  return db;
};

describe("predictionBackfillHandler()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mocks.mockSavePrediction.mockResolvedValue(undefined);
  });

  it("returns 403 when request is not from cron", async () => {
    mocks.mockAuthenticateRequest.mockResolvedValue({ isCron: false });
    const { predictionBackfillHandler } = await import("./predictionBackfillJob");
    const { req, res } = makeReqRes();
    await predictionBackfillHandler(req as never, res as never);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("returns 500 when DB is unavailable", async () => {
    mocks.mockAuthenticateRequest.mockResolvedValue({ isCron: true });
    mocks.mockGetDb.mockResolvedValue(null);
    const { predictionBackfillHandler } = await import("./predictionBackfillJob");
    const { req, res } = makeReqRes();
    await predictionBackfillHandler(req as never, res as never);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: "db-unavailable" }));
  });

  it("returns ok:true with processed=0 when all claims already have predictions", async () => {
    mocks.mockAuthenticateRequest.mockResolvedValue({ isCron: true });
    const db = makeDb(
      [{ id: 1, userId: 10, verdict: "supported" }],
      [{ targetClaimId: 1 }] // already predicted
    );
    mocks.mockGetDb.mockResolvedValue(db);
    const { predictionBackfillHandler } = await import("./predictionBackfillJob");
    const { req, res } = makeReqRes();
    await predictionBackfillHandler(req as never, res as never);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ ok: true, processed: 0 }));
  });

  it("processes unpredicted claims and returns processed count", async () => {
    mocks.mockAuthenticateRequest.mockResolvedValue({ isCron: true });
    const db = makeDb(
      [{ id: 5, userId: 20, verdict: "supported" }],
      [] // no existing predictions
    );
    mocks.mockGetDb.mockResolvedValue(db);
    mocks.mockComputeClaimTrajectory.mockResolvedValue({
      baseRate: 0.7,
      factors: { evidence: 0.8 },
    });
    const { predictionBackfillHandler } = await import("./predictionBackfillJob");
    const { req, res } = makeReqRes();
    await predictionBackfillHandler(req as never, res as never);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ ok: true, processed: 1, errors: 0 }));
  });

  it("returns 500 on unexpected error", async () => {
    mocks.mockAuthenticateRequest.mockRejectedValue(new Error("Auth failed"));
    const { predictionBackfillHandler } = await import("./predictionBackfillJob");
    const { req, res } = makeReqRes();
    await predictionBackfillHandler(req as never, res as never);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});
