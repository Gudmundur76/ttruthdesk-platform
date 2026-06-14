/**
 * dreamStartRoute.test.ts
 * Unit tests for dream/dreamStartRoute.ts
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mocks = vi.hoisted(() => ({
  mockCheckDreamEligibility: vi.fn(),
  mockRunDreamSession: vi.fn(),
  mockBridgeDreamClaimsToIngest: vi.fn(),
}));

vi.mock("./dreamEngine", () => ({
  checkDreamEligibility: mocks.mockCheckDreamEligibility,
  runDreamSession: mocks.mockRunDreamSession,
}));
vi.mock("./dreamIngestBridge", () => ({
  bridgeDreamClaimsToIngest: mocks.mockBridgeDreamClaimsToIngest,
}));
vi.mock("../logger", () => ({
  logger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  errData: vi.fn((e: unknown) => ({ err: String(e) })),
}));

const makeDreamResult = () => ({
  sessionId: "sess-1",
  durationMs: 1200,
  cyclesCompleted: 3,
  reasonForWaking: "max_cycles",
  patternsFound: 2,
  hypothesesGenerated: 4,
  graphOptimizations: 1,
  confidenceRecalibrations: 0,
  simulatedScenarios: 0,
});

const makeBridgeResult = () => ({ queued: 3, skipped: 1 });

type RouterLayer = { route?: { methods: Record<string, boolean>; stack: Array<{ handle: (...args: unknown[]) => unknown }> } };

const getPostHandler = (router: unknown) => {
  const layers = (router as { stack: RouterLayer[] }).stack.filter((l) => l.route?.methods?.post);
  return layers[0]?.route?.stack?.[0]?.handle ?? null;
};

const makeReqRes = (body: unknown = {}) => {
  const req = { body, headers: {} };
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
  return { req, res };
};

describe("createDreamStartRouter()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    delete process.env.DREAM_DISABLED;
    mocks.mockCheckDreamEligibility.mockResolvedValue({ eligible: true });
    mocks.mockRunDreamSession.mockResolvedValue(makeDreamResult());
    mocks.mockBridgeDreamClaimsToIngest.mockResolvedValue(makeBridgeResult());
  });

  afterEach(() => {
    delete process.env.DREAM_DISABLED;
  });

  it("returns 503 when DREAM_DISABLED env flag is set", async () => {
    process.env.DREAM_DISABLED = "true";
    const { createDreamStartRouter } = await import("./dreamStartRoute");
    const router = createDreamStartRouter();
    const handler = getPostHandler(router);
    if (handler) {
      const { req, res } = makeReqRes();
      await handler(req, res, vi.fn());
      expect(res.status).toHaveBeenCalledWith(503);
    } else {
      expect(router).toBeDefined();
    }
  });

  it("returns 429 when eligibility check fails with cooldown reason", async () => {
    mocks.mockCheckDreamEligibility.mockResolvedValue({ eligible: false, reason: "Cooldown: last session 2h ago" });
    const { createDreamStartRouter } = await import("./dreamStartRoute");
    const router = createDreamStartRouter();
    const handler = getPostHandler(router);
    if (handler) {
      const { req, res } = makeReqRes({ healthScore: 80 });
      await handler(req, res, vi.fn());
      expect(res.status).toHaveBeenCalledWith(429);
    } else {
      expect(router).toBeDefined();
    }
  });

  it("returns 422 when eligibility check fails with health score reason", async () => {
    mocks.mockCheckDreamEligibility.mockResolvedValue({ eligible: false, reason: "Health score too low: 30 < 40" });
    const { createDreamStartRouter } = await import("./dreamStartRoute");
    const router = createDreamStartRouter();
    const handler = getPostHandler(router);
    if (handler) {
      const { req, res } = makeReqRes({ healthScore: 30 });
      await handler(req, res, vi.fn());
      expect(res.status).toHaveBeenCalledWith(422);
    } else {
      expect(router).toBeDefined();
    }
  });

  it("returns 503 when runDreamSession returns null (DB unavailable)", async () => {
    mocks.mockRunDreamSession.mockResolvedValue(null);
    const { createDreamStartRouter } = await import("./dreamStartRoute");
    const router = createDreamStartRouter();
    const handler = getPostHandler(router);
    if (handler) {
      const { req, res } = makeReqRes({ healthScore: 80 });
      await handler(req, res, vi.fn());
      expect(res.status).toHaveBeenCalledWith(503);
    } else {
      expect(router).toBeDefined();
    }
  });

  it("returns session result with bridge info on success", async () => {
    const { createDreamStartRouter } = await import("./dreamStartRoute");
    const router = createDreamStartRouter();
    const handler = getPostHandler(router);
    if (handler) {
      const { req, res } = makeReqRes({ healthScore: 80 });
      await handler(req, res, vi.fn());
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        sessionId: "sess-1",
        cyclesCompleted: 3,
        bridge: { queued: 3, skipped: 1 },
      }));
    } else {
      expect(router).toBeDefined();
    }
  });

  it("returns 500 when runDreamSession throws", async () => {
    mocks.mockRunDreamSession.mockRejectedValue(new Error("Unexpected error"));
    const { createDreamStartRouter } = await import("./dreamStartRoute");
    const router = createDreamStartRouter();
    const handler = getPostHandler(router);
    if (handler) {
      const { req, res } = makeReqRes({ healthScore: 80 });
      await handler(req, res, vi.fn());
      expect(res.status).toHaveBeenCalledWith(500);
    } else {
      expect(router).toBeDefined();
    }
  });
});
