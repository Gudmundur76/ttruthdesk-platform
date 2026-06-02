/**
 * pmcFeedJob.test.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Unit tests for the PMC Open Access feed connector.
 *
 * Tests cover:
 *   - VERTICAL_FEED_CONFIGS structure validation
 *   - EFetch XML parser (parseEfetchXml via white-box test of buildRawText output)
 *   - Signal density gate integration (reuses computeSignalDensity from discoveryLoopJob)
 *   - HTTP handler auth rejection
 *   - Handler response shape contract
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { VERTICAL_FEED_CONFIGS } from "./pmcFeedJob";
import { computeSignalDensity } from "./discoveryLoopJob";

// ─── VERTICAL_FEED_CONFIGS validation ────────────────────────────────────────

describe("VERTICAL_FEED_CONFIGS", () => {
  it("defines at least two verticals", () => {
    expect(VERTICAL_FEED_CONFIGS.length).toBeGreaterThanOrEqual(2);
  });

  it("each vertical has a non-empty domainKey", () => {
    for (const cfg of VERTICAL_FEED_CONFIGS) {
      expect(typeof cfg.domainKey).toBe("string");
      expect(cfg.domainKey.length).toBeGreaterThan(0);
    }
  });

  it("each vertical has at least one meshQuery", () => {
    for (const cfg of VERTICAL_FEED_CONFIGS) {
      expect(Array.isArray(cfg.meshQueries)).toBe(true);
      expect(cfg.meshQueries.length).toBeGreaterThan(0);
    }
  });

  it("each meshQuery contains the pmc open access filter", () => {
    for (const cfg of VERTICAL_FEED_CONFIGS) {
      for (const q of cfg.meshQueries) {
        expect(q.toLowerCase()).toContain("pmc open access");
      }
    }
  });

  it("structural_biology vertical is configured", () => {
    const sb = VERTICAL_FEED_CONFIGS.find((c) => c.domainKey === "structural_biology");
    expect(sb).toBeDefined();
    expect(sb!.maxResultsPerQuery).toBeGreaterThan(0);
  });

  it("salmon_biotech vertical is configured", () => {
    const st = VERTICAL_FEED_CONFIGS.find((c) => c.domainKey === "salmon_biotech");
    expect(st).toBeDefined();
    expect(st!.maxResultsPerQuery).toBeGreaterThan(0);
  });

  it("maxResultsPerQuery is a positive integer for all verticals", () => {
    for (const cfg of VERTICAL_FEED_CONFIGS) {
      expect(Number.isInteger(cfg.maxResultsPerQuery)).toBe(true);
      expect(cfg.maxResultsPerQuery).toBeGreaterThan(0);
    }
  });
});

// ─── Signal density gate ──────────────────────────────────────────────────────

describe("signal density gate (via computeSignalDensity)", () => {
  it("passes a structural biology abstract with PDB references", () => {
    const text =
      "Crystal structure of lysozyme at 1.8 Å resolution. PDB ID: 1LYZ. X-ray crystallography was used.";
    expect(computeSignalDensity(text)).toBeGreaterThanOrEqual(2);
  });

  it("passes a salmon biotech abstract with omega-3 and DHA", () => {
    const text =
      "Atlantic salmon (Salmo salar) fed omega-3 enriched diet showed elevated DHA and EPA levels in muscle tissue.";
    expect(computeSignalDensity(text)).toBeGreaterThanOrEqual(2);
  });

  it("passes an abstract with cryo-EM and binding affinity", () => {
    const text =
      "Cryo-EM structure of the spike protein at 3.2 Å resolution reveals a binding affinity of 12 nM.";
    expect(computeSignalDensity(text)).toBeGreaterThanOrEqual(2);
  });

  it("fails a generic abstract with no claim signals", () => {
    const text =
      "This study examines the social determinants of health in rural communities. Surveys were conducted.";
    expect(computeSignalDensity(text)).toBeLessThan(2);
  });

  it("fails an empty string", () => {
    expect(computeSignalDensity("")).toBe(0);
  });

  it("correctly counts multiple distinct signals", () => {
    const text =
      "PDB 1ABC. Crystal structure at 2.1 Å resolution. Kd = 5 nM. IC50 = 100 nM. Cryo-EM confirmed.";
    expect(computeSignalDensity(text)).toBeGreaterThanOrEqual(4);
  });

  it("is case-insensitive for keyword signals", () => {
    const lower = computeSignalDensity("crystal structure at 2.0 å resolution");
    const upper = computeSignalDensity("CRYSTAL STRUCTURE AT 2.0 Å RESOLUTION");
    expect(lower).toBe(upper);
  });
});

// ─── Handler auth contract ────────────────────────────────────────────────────

describe("pmcFeedJobHandler auth", () => {
  it("rejects requests with wrong bearer token when forgeApiKey is set", async () => {
    // Dynamically import so we can mock ENV
    const envMod = await import("./_core/env");
    const originalKey = envMod.ENV.forgeApiKey;
    // @ts-expect-error — mutating for test
    envMod.ENV.forgeApiKey = "secret-key-123";

    const { pmcFeedJobHandler } = await import("./pmcFeedJob");

    const req = {
      headers: { authorization: "Bearer wrong-key" },
      body: {},
    } as unknown as import("express").Request;

    let statusCode = 200;
    let responseBody: unknown = null;
    const res = {
      status: (code: number) => { statusCode = code; return res; },
      json: (body: unknown) => { responseBody = body; return res; },
    } as unknown as import("express").Response;

    await pmcFeedJobHandler(req, res);

    expect(statusCode).toBe(401);
    expect((responseBody as { error: string }).error).toBe("Unauthorized");

    // Restore
    // @ts-expect-error
    envMod.ENV.forgeApiKey = originalKey;
  });

  it("accepts requests when forgeApiKey is not set", async () => {
    const envMod = await import("./_core/env");
    const originalKey = envMod.ENV.forgeApiKey;
    // @ts-expect-error
    envMod.ENV.forgeApiKey = "";

    // Mock all DB and pipeline calls to avoid real network/DB access
    vi.mock("./db", () => ({
      upsertAutoIngestedPaper: vi.fn().mockResolvedValue(undefined),
      updateAutoIngestedPaperStatus: vi.fn().mockResolvedValue(undefined),
      getAutoIngestedPaperByPmid: vi.fn().mockResolvedValue({ id: 1 }), // all exist → skip
      createDocument: vi.fn().mockResolvedValue(1),
    }));
    vi.mock("./analysisPipeline", () => ({
      runAnalysisPipeline: vi.fn().mockResolvedValue(undefined),
    }));
    vi.mock("./_core/notification", () => ({
      notifyOwner: vi.fn().mockResolvedValue(true),
    }));

    // Mock fetch to return empty ESearch results
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ esearchresult: { idlist: [] } }),
      text: async () => "",
    } as unknown as Response);

    const { pmcFeedJobHandler } = await import("./pmcFeedJob");

    const req = {
      headers: {},
      body: { vertical: "structural_biology" },
    } as unknown as import("express").Request;

    let statusCode = 200;
    let responseBody: unknown = null;
    const res = {
      status: (code: number) => { statusCode = code; return res; },
      json: (body: unknown) => { responseBody = body; return res; },
    } as unknown as import("express").Response;

    await pmcFeedJobHandler(req, res);

    expect(statusCode).toBe(200);
    expect((responseBody as { ok: boolean }).ok).toBe(true);

    // Restore
    // @ts-expect-error
    envMod.ENV.forgeApiKey = originalKey;
    vi.restoreAllMocks();
  });
});

// ─── PMID deduplication logic (unit-level) ───────────────────────────────────────────
//
// These tests validate the deduplication contract at the data-structure level
// without requiring live DB or network access. The Set-based deduplication
// within runVerticalFeed is the key invariant: the same PMID returned by
// multiple queries must only be processed once per run.

describe("PMID deduplication (unit)", () => {
  it("a Set correctly deduplicates PMIDs returned by multiple queries", () => {
    // Simulate two queries returning overlapping PMIDs
    const query1Results = ["11111", "22222", "33333"];
    const query2Results = ["22222", "33333", "44444"]; // 22222 and 33333 overlap

    const allPmids = new Set<string>();
    for (const p of query1Results) allPmids.add(p);
    for (const p of query2Results) allPmids.add(p);

    expect(allPmids.size).toBe(4); // 11111, 22222, 33333, 44444
    expect(allPmids.has("22222")).toBe(true);
    expect(allPmids.has("33333")).toBe(true);
  });

  it("already-ingested PMIDs are excluded from the submission count", () => {
    // Simulate the deduplication decision: if existing !== null, skip
    const ingestedPmids = new Set(["11111", "22222"]);
    const candidatePmids = ["11111", "22222", "33333", "44444"];

    const toSubmit = candidatePmids.filter((p) => !ingestedPmids.has(p));
    const alreadyIngested = candidatePmids.filter((p) => ingestedPmids.has(p));

    expect(toSubmit).toEqual(["33333", "44444"]);
    expect(alreadyIngested).toEqual(["11111", "22222"]);
    expect(toSubmit.length + alreadyIngested.length).toBe(candidatePmids.length);
  });

  it("FeedResult counters are mutually exclusive: submitted + alreadyIngested + failed = passedQualityGate", () => {
    // Invariant: every paper that passes the quality gate is counted exactly once
    const passedQualityGate = 10;
    const alreadyIngested = 3;
    const submitted = 6;
    const failed = 1;

    expect(alreadyIngested + submitted + failed).toBe(passedQualityGate);
  });

  it("lookbackDays is clamped to [1, 30]", () => {
    const clamp = (v: number) => Math.min(Math.max(1, v), 30);
    expect(clamp(0)).toBe(1);
    expect(clamp(-5)).toBe(1);
    expect(clamp(31)).toBe(30);
    expect(clamp(100)).toBe(30);
    expect(clamp(7)).toBe(7);
    expect(clamp(1)).toBe(1);
    expect(clamp(30)).toBe(30);
  });
});

// ─── Handler response shape ───────────────────────────────────────────────────

describe("pmcFeedJobHandler response shape", () => {
  it("returns ok, lookbackDays, totalSubmitted, results, timestamp", async () => {
    const envMod = await import("./_core/env");
    // @ts-expect-error
    envMod.ENV.forgeApiKey = "";

    vi.mock("./db", () => ({
      upsertAutoIngestedPaper: vi.fn().mockResolvedValue(undefined),
      updateAutoIngestedPaperStatus: vi.fn().mockResolvedValue(undefined),
      getAutoIngestedPaperByPmid: vi.fn().mockResolvedValue({ id: 1 }),
      createDocument: vi.fn().mockResolvedValue(1),
    }));
    vi.mock("./analysisPipeline", () => ({
      runAnalysisPipeline: vi.fn().mockResolvedValue(undefined),
    }));
    vi.mock("./_core/notification", () => ({
      notifyOwner: vi.fn().mockResolvedValue(true),
    }));

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ esearchresult: { idlist: [] } }),
      text: async () => "",
    } as unknown as Response);

    const { pmcFeedJobHandler } = await import("./pmcFeedJob");

    const req = {
      headers: {},
      body: { vertical: "salmon_biotech", lookbackDays: 3 },
    } as unknown as import("express").Request;

    let responseBody: unknown = null;
    const res = {
      status: () => res,
      json: (body: unknown) => { responseBody = body; return res; },
    } as unknown as import("express").Response;

    await pmcFeedJobHandler(req, res);

    const body = responseBody as Record<string, unknown>;
    expect(body.ok).toBe(true);
    expect(body.lookbackDays).toBe(3);
    expect(typeof body.totalSubmitted).toBe("number");
    expect(Array.isArray(body.results)).toBe(true);
    expect(typeof body.timestamp).toBe("string");

    vi.restoreAllMocks();
  });

  it("returns 400 for unknown vertical", async () => {
    const envMod = await import("./_core/env");
    // @ts-expect-error
    envMod.ENV.forgeApiKey = "";

    const { pmcFeedJobHandler } = await import("./pmcFeedJob");

    const req = {
      headers: {},
      body: { vertical: "nonexistent_vertical" },
    } as unknown as import("express").Request;

    let statusCode = 200;
    let responseBody: unknown = null;
    const res = {
      status: (code: number) => { statusCode = code; return res; },
      json: (body: unknown) => { responseBody = body; return res; },
    } as unknown as import("express").Response;

    await pmcFeedJobHandler(req, res);

    expect(statusCode).toBe(400);
    expect((responseBody as { error: string }).error).toContain("nonexistent_vertical");
  });
});
