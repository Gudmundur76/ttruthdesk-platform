/**
 * discoveryLoopJob.test.ts
 * Unit tests for server/discoveryLoopJob.ts
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  mockGetDb: vi.fn(),
  mockPublishEvent: vi.fn(),
}));

vi.mock("./db", () => ({ getDb: mocks.mockGetDb }));
vi.mock("./autonomousLoop/eventBus", () => ({ publishEvent: mocks.mockPublishEvent }));
vi.mock("./logger", () => ({
  logger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  errData: vi.fn((e: unknown) => ({ err: String(e) })),
}));
vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
  ok: true,
  json: vi.fn().mockResolvedValue({ resultList: { result: [] } }),
  text: vi.fn().mockResolvedValue(""),
}));

describe("computeSignalDensity()", () => {
  it("returns 0 for text with no biomedical signals", async () => {
    const { computeSignalDensity } = await import("./discoveryLoopJob");
    const result = computeSignalDensity("The weather is nice today.");
    expect(result).toBe(0);
  });

  it("counts multiple signals in biomedical text", async () => {
    const { computeSignalDensity } = await import("./discoveryLoopJob");
    const text = "Crystal structure of collagen with binding affinity IC50 measurement";
    const result = computeSignalDensity(text);
    expect(result).toBeGreaterThan(2);
  });

  it("detects PDB ID pattern", async () => {
    const { computeSignalDensity } = await import("./discoveryLoopJob");
    const result = computeSignalDensity("The protein structure 1ABC was resolved by cryo-EM");
    expect(result).toBeGreaterThan(0);
  });

  it("detects salmon/aquaculture signals", async () => {
    const { computeSignalDensity } = await import("./discoveryLoopJob");
    const result = computeSignalDensity("Atlantic salmon omega-3 fatty acid collagen hydrolysate");
    expect(result).toBeGreaterThan(3);
  });

  it("detects clinical trial signals", async () => {
    const { computeSignalDensity } = await import("./discoveryLoopJob");
    const result = computeSignalDensity("A randomized controlled clinical trial with p<0.05 and 95% confidence interval");
    expect(result).toBeGreaterThan(2);
  });
});

describe("CLAIM_SIGNALS array", () => {
  it("contains at least 60 signal patterns", async () => {
    const { CLAIM_SIGNALS } = await import("./discoveryLoopJob");
    expect(CLAIM_SIGNALS.length).toBeGreaterThan(60);
  });

  it("all entries are RegExp instances", async () => {
    const { CLAIM_SIGNALS } = await import("./discoveryLoopJob");
    for (const signal of CLAIM_SIGNALS) {
      expect(signal).toBeInstanceOf(RegExp);
    }
  });
});

describe("handleDiscoveryLoop()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mocks.mockGetDb.mockResolvedValue(null); // no DB
    mocks.mockPublishEvent.mockResolvedValue(1);
  });

  it("returns 401 when forge API key is set and token is missing", async () => {
    process.env.BUILT_IN_FORGE_API_KEY = "secret";
    const { handleDiscoveryLoop } = await import("./discoveryLoopJob");
    const req = { headers: { authorization: "Bearer wrong" } };
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
    await handleDiscoveryLoop(req as never, res as never);
    expect(res.status).toHaveBeenCalledWith(401);
    delete process.env.BUILT_IN_FORGE_API_KEY;
  });
});
