/**
 * domainIngestScheduler.test.ts
 *
 * Tests for the 5-domain autonomous ingest scheduler.
 * Validates domain configuration, result shape, and handler behaviour.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Request, Response } from "express";

// ── Mock dependencies ─────────────────────────────────────────────────────────
vi.mock("./db", () => ({
  upsertAutoIngestedPaper: vi.fn().mockResolvedValue(undefined),
  updateAutoIngestedPaperStatus: vi.fn().mockResolvedValue(undefined),
  getAutoIngestedPaperByPmid: vi.fn().mockResolvedValue(null),
  createDocument: vi.fn().mockResolvedValue(42),
}));

vi.mock("./analysisPipeline", () => ({
  runAnalysisPipeline: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./_core/env", () => ({
  ENV: { forgeApiKey: undefined },
}));

vi.mock("./logger", () => ({
  logger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
  errData: (e: unknown) => e,
}));

// ── Tests ─────────────────────────────────────────────────────────────────────
describe("DOMAIN_QUERIES configuration", () => {
  it("should export exactly 5 domain configurations", async () => {
    const { DOMAIN_QUERIES } = await import("./domainIngestScheduler");
    expect(DOMAIN_QUERIES).toHaveLength(5);
  });

  it("should cover biology, medicine, chemistry, physics, climate", async () => {
    const { DOMAIN_QUERIES } = await import("./domainIngestScheduler");
    const domains = DOMAIN_QUERIES.map(d => d.domain);
    expect(domains).toContain("biology");
    expect(domains).toContain("medicine");
    expect(domains).toContain("chemistry");
    expect(domains).toContain("physics");
    expect(domains).toContain("climate");
  });

  it("should have at least 2 queries per domain", async () => {
    const { DOMAIN_QUERIES } = await import("./domainIngestScheduler");
    for (const d of DOMAIN_QUERIES) {
      expect(d.queries.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("should have non-empty labels for all domains", async () => {
    const { DOMAIN_QUERIES } = await import("./domainIngestScheduler");
    for (const d of DOMAIN_QUERIES) {
      expect(d.label).toBeTruthy();
    }
  });
});

describe("domainIngestJobHandler", () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let jsonSpy: ReturnType<typeof vi.fn>;
  let statusSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    jsonSpy = vi.fn();
    statusSpy = vi.fn().mockReturnValue({ json: jsonSpy });
    mockReq = { headers: {} };
    mockRes = {
      json: jsonSpy,
      status: statusSpy,
    };
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should return 401 when forgeApiKey is set and token is wrong", async () => {
    const envMod = await import("./_core/env");
    (envMod.ENV as Record<string, unknown>).forgeApiKey = "secret-key";
    mockReq.headers = { authorization: "Bearer wrong-token" };

    const { domainIngestJobHandler } = await import("./domainIngestScheduler");
    await domainIngestJobHandler(mockReq as Request, mockRes as Response);

    expect(statusSpy).toHaveBeenCalledWith(401);
    // Reset
    (envMod.ENV as Record<string, unknown>).forgeApiKey = undefined;
  });

  it("should return ok:true with domain results when no auth required", async () => {
    // Mock fetch for PubMed API — returns empty result sets so no sleeps are triggered
    const mockFetch = vi.fn().mockResolvedValue({
      json: () =>
        Promise.resolve({
          esearchresult: { idlist: [] },
        }),
      text: () => Promise.resolve(""),
    });
    vi.stubGlobal("fetch", mockFetch);

    const { domainIngestJobHandler } = await import("./domainIngestScheduler");
    // Run handler and advance all timers concurrently
    const handlerPromise = domainIngestJobHandler(
      mockReq as Request,
      mockRes as Response
    );
    await vi.runAllTimersAsync();
    await handlerPromise;

    expect(jsonSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        ok: true,
        domains: expect.arrayContaining([
          expect.objectContaining({ domain: "biology" }),
          expect.objectContaining({ domain: "medicine" }),
          expect.objectContaining({ domain: "chemistry" }),
          expect.objectContaining({ domain: "physics" }),
          expect.objectContaining({ domain: "climate" }),
        ]),
        totals: expect.objectContaining({
          queriesRun: expect.any(Number),
          submitted: expect.any(Number),
          skipped: expect.any(Number),
        }),
        timestamp: expect.any(String),
      })
    );
    vi.unstubAllGlobals();
  }, 30000);

  it("should return 5 domain results with correct shape", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ esearchresult: { idlist: [] } }),
      text: () => Promise.resolve(""),
    });
    vi.stubGlobal("fetch", mockFetch);

    const { domainIngestJobHandler } = await import("./domainIngestScheduler");
    const handlerPromise = domainIngestJobHandler(
      mockReq as Request,
      mockRes as Response
    );
    await vi.runAllTimersAsync();
    await handlerPromise;

    const callArg = jsonSpy.mock.calls[0][0] as {
      domains: Array<{
        domain: string;
        queriesRun: number;
        submitted: number;
        skipped: number;
        errors: string[];
      }>;
    };
    expect(callArg.domains).toHaveLength(5);
    for (const d of callArg.domains) {
      expect(typeof d.domain).toBe("string");
      expect(typeof d.queriesRun).toBe("number");
      expect(typeof d.submitted).toBe("number");
      expect(typeof d.skipped).toBe("number");
      expect(Array.isArray(d.errors)).toBe(true);
    }
    vi.unstubAllGlobals();
  }, 30000);

  it("returns 200 when Authorization header matches CRON_SECRET", async () => {
    const envMod = await import("./_core/env");
    (envMod.ENV as Record<string, unknown>).cronSecret = "ingest-46";
    (envMod.ENV as Record<string, unknown>).forgeApiKey = "";
    mockReq.headers = { authorization: "Bearer ingest-46" };
    const mockFetch = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ esearchresult: { idlist: [] } }),
      text: () => Promise.resolve(""),
    });
    vi.stubGlobal("fetch", mockFetch);
    const { domainIngestJobHandler } = await import("./domainIngestScheduler");
    const handlerPromise = domainIngestJobHandler(mockReq as Request, mockRes as Response);
    await vi.runAllTimersAsync();
    await handlerPromise;
    expect(statusSpy).not.toHaveBeenCalledWith(401);
    expect(jsonSpy).toHaveBeenCalledWith(expect.objectContaining({ ok: true }));
    (envMod.ENV as Record<string, unknown>).cronSecret = "";
    (envMod.ENV as Record<string, unknown>).forgeApiKey = undefined;
    vi.unstubAllGlobals();
  }, 30000);

  it("returns 401 when CRON_SECRET is set and token does not match", async () => {
    const envMod = await import("./_core/env");
    (envMod.ENV as Record<string, unknown>).cronSecret = "ingest-46";
    (envMod.ENV as Record<string, unknown>).forgeApiKey = "";
    mockReq.headers = { authorization: "Bearer wrong-token" };
    const { domainIngestJobHandler } = await import("./domainIngestScheduler");
    await domainIngestJobHandler(mockReq as Request, mockRes as Response);
    expect(statusSpy).toHaveBeenCalledWith(401);
    (envMod.ENV as Record<string, unknown>).cronSecret = "";
    (envMod.ENV as Record<string, unknown>).forgeApiKey = undefined;
  });
});
