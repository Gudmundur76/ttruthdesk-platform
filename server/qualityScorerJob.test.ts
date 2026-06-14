/**
 * qualityScorerJob.test.ts
 * Unit tests for server/qualityScorerJob.ts
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  mockRunQualityScorerJob: vi.fn(),
  mockLogCronRun: vi.fn(),
}));

vi.mock("./claimQualityScorer", () => ({ runQualityScorerJob: mocks.mockRunQualityScorerJob }));
vi.mock("./cronRunLogger", () => ({ logCronRun: mocks.mockLogCronRun }));
vi.mock("./logger", () => ({
  logger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  errData: vi.fn((e: unknown) => ({ err: String(e) })),
}));
vi.mock("./_core/env", () => ({ ENV: { HEARTBEAT_SECRET: "correct-secret", forgeApiKey: "" } }));

type ReqLike = { headers: Record<string, string> };
type ResLike = { status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> };

const makeReqRes = (headers: Record<string, string> = {}): { req: ReqLike; res: ResLike } => ({
  req: { headers },
  res: { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() },
});

describe("qualityScorerJobHandler()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mocks.mockLogCronRun.mockResolvedValue(undefined);
  });

  it("returns 401 when heartbeat secret is set and header is wrong", async () => {
    const { qualityScorerJobHandler } = await import("./qualityScorerJob");
    const { req, res } = makeReqRes({ "x-heartbeat-secret": "wrong-secret" });
    await qualityScorerJobHandler(req as never, res as never);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("returns 200 with scored count when job succeeds", async () => {
    mocks.mockRunQualityScorerJob.mockResolvedValue({ scored: 15, errors: 0 });
    const { qualityScorerJobHandler } = await import("./qualityScorerJob");
    const { req, res } = makeReqRes({ "x-heartbeat-secret": "correct-secret" });
    await qualityScorerJobHandler(req as never, res as never);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      ok: true,
      scored: 15,
      errors: 0,
    }));
  });

  it("returns 500 when job throws an error", async () => {
    mocks.mockRunQualityScorerJob.mockRejectedValue(new Error("DB connection failed"));
    const { qualityScorerJobHandler } = await import("./qualityScorerJob");
    const { req, res } = makeReqRes({ "x-heartbeat-secret": "correct-secret" });
    await qualityScorerJobHandler(req as never, res as never);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ ok: false }));
  });

  it("calls logCronRun with ok status on success", async () => {
    mocks.mockRunQualityScorerJob.mockResolvedValue({ scored: 5, errors: 1 });
    const { qualityScorerJobHandler } = await import("./qualityScorerJob");
    const { req, res } = makeReqRes({ "x-heartbeat-secret": "correct-secret" });
    await qualityScorerJobHandler(req as never, res as never);
    expect(mocks.mockLogCronRun).toHaveBeenCalledWith(
      "quality-scorer-6h",
      "ok",
      expect.any(Number),
      expect.stringContaining("5")
    );
  });
});
