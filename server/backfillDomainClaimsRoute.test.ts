/**
 * backfillDomainClaimsRoute.test.ts
 * Tests for backfillDomainClaims() and POST /api/admin/backfill-domain-claims
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  mockGetDb: vi.fn(),
  mockExtractClaims: vi.fn(),
  mockInferDomainFromText: vi.fn(),
}));

vi.mock("./db", () => ({ getDb: mocks.mockGetDb }));
vi.mock("./claimExtractor", () => ({ extractClaims: mocks.mockExtractClaims }));
vi.mock("./domainInference", () => ({ inferDomainFromText: mocks.mockInferDomainFromText }));
vi.mock("./logger", () => ({
  logger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  errData: vi.fn((e: unknown) => ({ err: String(e) })),
}));

import express from "express";
import request from "supertest";
import {
  backfillDomainClaims,
  registerBackfillDomainClaimsRoute,
} from "./backfillDomainClaimsRoute";

// ─── DB chain builder ─────────────────────────────────────────────────────────
function makeDb(
  zeroClaims: Array<{ id: number; rawText: string | null; verticalDomain: string | null; title: string | null }> = [],
  existingClaims: Array<{ id: number }> = []
) {
  const db: Record<string, unknown> = {};
  let selectCallCount = 0;

  db.select = vi.fn().mockImplementation(() => {
    selectCallCount++;
    const chain: Record<string, unknown> = {};
    chain.from = vi.fn().mockReturnValue(chain);
    chain.where = vi.fn().mockReturnValue(chain);
    chain.orderBy = vi.fn().mockReturnValue(chain);
    chain.limit = vi.fn().mockReturnValue(chain);

    if (selectCallCount === 1) {
      // First call: fetch zero-claim documents
      chain.limit = vi.fn().mockResolvedValue(zeroClaims);
    } else {
      // Subsequent calls: check existing claims per document
      chain.limit = vi.fn().mockResolvedValue(existingClaims);
    }
    return chain;
  });

  const insertChain: Record<string, unknown> = {};
  insertChain.values = vi.fn().mockResolvedValue({ affectedRows: 1 });
  db.insert = vi.fn().mockReturnValue(insertChain);

  const updateChain: Record<string, unknown> = {};
  updateChain.set = vi.fn().mockReturnValue(updateChain);
  updateChain.where = vi.fn().mockResolvedValue({ affectedRows: 1 });
  db.update = vi.fn().mockReturnValue(updateChain);

  return db;
}

function makeApp() {
  const app = express();
  app.use(express.json());
  const requireOwnerOrAdmin = (
    _req: express.Request,
    _res: express.Response,
    next: () => void
  ) => next();
  registerBackfillDomainClaimsRoute(
    app as express.Express,
    requireOwnerOrAdmin as express.RequestHandler
  );
  return app;
}

// ─── backfillDomainClaims() ───────────────────────────────────────────────────
describe("backfillDomainClaims()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("returns zeros when DB is unavailable", async () => {
    mocks.mockGetDb.mockResolvedValue(null);
    const { backfillDomainClaims } = await import("./backfillDomainClaimsRoute");
    const result = await backfillDomainClaims();
    expect(result).toEqual({
      examined: 0,
      alreadyHasClaims: 0,
      extracted: 0,
      claimsInserted: 0,
      errors: 0,
      domainBreakdown: {},
    });
  });

  it("returns zeros when no zero-claim documents exist", async () => {
    const db = makeDb([]);
    mocks.mockGetDb.mockResolvedValue(db);
    const { backfillDomainClaims } = await import("./backfillDomainClaimsRoute");
    const result = await backfillDomainClaims();
    expect(result.examined).toBe(0);
    expect(result.extracted).toBe(0);
  });

  it("skips documents that already have claims", async () => {
    const doc = { id: 1, rawText: "protein text", verticalDomain: null, title: null };
    const db = makeDb([doc], [{ id: 100 }]); // existing claim found
    mocks.mockGetDb.mockResolvedValue(db);
    const { backfillDomainClaims } = await import("./backfillDomainClaimsRoute");
    const result = await backfillDomainClaims();
    expect(result.examined).toBe(1);
    expect(result.alreadyHasClaims).toBe(1);
    expect(result.extracted).toBe(0);
  });

  it("extracts and inserts claims for zero-claim documents", async () => {
    const doc = { id: 2, rawText: "HIV protease inhibitor text", verticalDomain: null, title: null };
    const db = makeDb([doc], []); // no existing claims
    mocks.mockGetDb.mockResolvedValue(db);
    mocks.mockInferDomainFromText.mockReturnValue("hiv_protease");
    mocks.mockExtractClaims.mockResolvedValue([
      {
        claimText: "Darunavir IC50 0.003 nM",
        claimType: "bioactivity",
        extractedValue: "0.003 nM",
        domainFields: {},
        pdbId: null,
        proteinName: "HIV-1 protease",
        experimentalMethod: null,
        resolution: null,
        organism: null,
        ligand: "Darunavir",
      },
    ]);
    const { backfillDomainClaims } = await import("./backfillDomainClaimsRoute");
    const result = await backfillDomainClaims();
    expect(result.examined).toBe(1);
    expect(result.extracted).toBe(1);
    expect(result.claimsInserted).toBe(1);
    expect(result.domainBreakdown["hiv_protease"]).toBe(1);
  });

  it("skips document when extraction returns 0 claims", async () => {
    const doc = { id: 3, rawText: "vague text", verticalDomain: null, title: null };
    const db = makeDb([doc], []);
    mocks.mockGetDb.mockResolvedValue(db);
    mocks.mockInferDomainFromText.mockReturnValue("biomedical_general");
    mocks.mockExtractClaims.mockResolvedValue([]);
    const { backfillDomainClaims } = await import("./backfillDomainClaimsRoute");
    const result = await backfillDomainClaims();
    expect(result.examined).toBe(1);
    expect(result.extracted).toBe(0);
    expect(result.claimsInserted).toBe(0);
  });

  it("counts errors when extraction throws", async () => {
    const doc = { id: 4, rawText: "text", verticalDomain: null, title: null };
    const db = makeDb([doc], []);
    mocks.mockGetDb.mockResolvedValue(db);
    mocks.mockInferDomainFromText.mockReturnValue("structural_biology");
    mocks.mockExtractClaims.mockRejectedValue(new Error("LLM timeout"));
    const { backfillDomainClaims } = await import("./backfillDomainClaimsRoute");
    const result = await backfillDomainClaims();
    expect(result.examined).toBe(1);
    expect(result.errors).toBe(1);
    expect(result.extracted).toBe(0);
  });

  it("dry-run mode does not insert claims", async () => {
    const doc = { id: 5, rawText: "protein text", verticalDomain: null, title: null };
    const db = makeDb([doc], []);
    mocks.mockGetDb.mockResolvedValue(db);
    mocks.mockInferDomainFromText.mockReturnValue("structural_biology");
    mocks.mockExtractClaims.mockResolvedValue([
      { claimText: "test", claimType: "protein_name", extractedValue: null, domainFields: {}, pdbId: null, proteinName: null, experimentalMethod: null, resolution: null, organism: null, ligand: null },
    ]);
    const { backfillDomainClaims } = await import("./backfillDomainClaimsRoute");
    const result = await backfillDomainClaims({ dryRun: true });
    expect(result.examined).toBe(1);
    // In dry-run, we track domain breakdown but don't insert
    expect(db.insert).not.toHaveBeenCalled();
    expect(result.claimsInserted).toBe(0);
  });

  it("uses rawText for domain inference, falls back to title", async () => {
    const doc = { id: 6, rawText: null, verticalDomain: null, title: "Clinical trial for drug X" };
    const db = makeDb([doc], []);
    mocks.mockGetDb.mockResolvedValue(db);
    mocks.mockInferDomainFromText.mockReturnValue("clinical_trial");
    mocks.mockExtractClaims.mockResolvedValue([]);
    const { backfillDomainClaims } = await import("./backfillDomainClaimsRoute");
    await backfillDomainClaims();
    // inferDomainFromText should be called with the title since rawText is null
    expect(mocks.mockInferDomainFromText).toHaveBeenCalledWith("Clinical trial for drug X");
  });

  it("respects the limit option", async () => {
    const docs = Array.from({ length: 5 }, (_, i) => ({
      id: i + 1,
      rawText: `text ${i}`,
      verticalDomain: null,
      title: null,
    }));
    const db = makeDb(docs, []);
    mocks.mockGetDb.mockResolvedValue(db);
    mocks.mockInferDomainFromText.mockReturnValue("biomedical_general");
    mocks.mockExtractClaims.mockResolvedValue([]);
    const { backfillDomainClaims } = await import("./backfillDomainClaimsRoute");
    const result = await backfillDomainClaims({ limit: 5 });
    expect(result.examined).toBe(5);
  });

  it("builds domainBreakdown correctly across multiple documents", async () => {
    const docs = [
      { id: 10, rawText: "structural text", verticalDomain: null, title: null },
      { id: 11, rawText: "clinical text", verticalDomain: null, title: null },
      { id: 12, rawText: "structural text 2", verticalDomain: null, title: null },
    ];
    let selectCallCount = 0;
    const db: Record<string, unknown> = {};
    db.select = vi.fn().mockImplementation(() => {
      selectCallCount++;
      const chain: Record<string, unknown> = {};
      chain.from = vi.fn().mockReturnValue(chain);
      chain.where = vi.fn().mockReturnValue(chain);
      chain.orderBy = vi.fn().mockReturnValue(chain);
      if (selectCallCount === 1) {
        chain.limit = vi.fn().mockResolvedValue(docs);
      } else {
        chain.limit = vi.fn().mockResolvedValue([]);
      }
      return chain;
    });
    const insertChain: Record<string, unknown> = {};
    insertChain.values = vi.fn().mockResolvedValue({ affectedRows: 1 });
    db.insert = vi.fn().mockReturnValue(insertChain);
    const updateChain: Record<string, unknown> = {};
    updateChain.set = vi.fn().mockReturnValue(updateChain);
    updateChain.where = vi.fn().mockResolvedValue({ affectedRows: 1 });
    db.update = vi.fn().mockReturnValue(updateChain);
    mocks.mockGetDb.mockResolvedValue(db);

    mocks.mockInferDomainFromText
      .mockReturnValueOnce("structural_biology")
      .mockReturnValueOnce("clinical_trial")
      .mockReturnValueOnce("structural_biology");
    mocks.mockExtractClaims.mockResolvedValue([
      { claimText: "claim", claimType: "pdb_id", extractedValue: null, domainFields: {}, pdbId: null, proteinName: null, experimentalMethod: null, resolution: null, organism: null, ligand: null },
    ]);

    const { backfillDomainClaims } = await import("./backfillDomainClaimsRoute");
    const result = await backfillDomainClaims();
    expect(result.domainBreakdown["structural_biology"]).toBe(2);
    expect(result.domainBreakdown["clinical_trial"]).toBe(1);
  });
});

// ─── POST /api/admin/backfill-domain-claims ───────────────────────────────────
describe("registerBackfillDomainClaimsRoute — POST /api/admin/backfill-domain-claims", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("returns 200 with result on success (DB unavailable → zeros)", async () => {
    mocks.mockGetDb.mockResolvedValue(null);
    const app = makeApp();
    const res = await request(app)
      .post("/api/admin/backfill-domain-claims")
      .send({ limit: 10 });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.examined).toBe(0);
  });

  it("returns 400 when limit is out of range (0)", async () => {
    const app = makeApp();
    const res = await request(app)
      .post("/api/admin/backfill-domain-claims")
      .send({ limit: 0 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/limit must be between/i);
  });

  it("returns 400 when limit exceeds 500", async () => {
    const app = makeApp();
    const res = await request(app)
      .post("/api/admin/backfill-domain-claims")
      .send({ limit: 501 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/limit must be between/i);
  });

  it("returns 400 when limit is not a number", async () => {
    const app = makeApp();
    const res = await request(app)
      .post("/api/admin/backfill-domain-claims")
      .send({ limit: "abc" });
    expect(res.status).toBe(400);
  });

  it("uses default limit when not provided", async () => {
    mocks.mockGetDb.mockResolvedValue(null);
    const app = makeApp();
    const res = await request(app)
      .post("/api/admin/backfill-domain-claims")
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it("passes dryRun=true when requested", async () => {
    mocks.mockGetDb.mockResolvedValue(null);
    const app = makeApp();
    const res = await request(app)
      .post("/api/admin/backfill-domain-claims")
      .send({ dryRun: true });
    expect(res.status).toBe(200);
    expect(res.body.dryRun).toBe(true);
  });

  it("passes dryRun=false by default", async () => {
    mocks.mockGetDb.mockResolvedValue(null);
    const app = makeApp();
    const res = await request(app)
      .post("/api/admin/backfill-domain-claims")
      .send({ limit: 5 });
    expect(res.status).toBe(200);
    expect(res.body.dryRun).toBe(false);
  });

  it("accepts dryRun as string 'true'", async () => {
    mocks.mockGetDb.mockResolvedValue(null);
    const app = makeApp();
    const res = await request(app)
      .post("/api/admin/backfill-domain-claims")
      .send({ dryRun: "true" });
    expect(res.status).toBe(200);
    expect(res.body.dryRun).toBe(true);
  });

  it("returns result fields in response", async () => {
    mocks.mockGetDb.mockResolvedValue(null);
    const app = makeApp();
    const res = await request(app)
      .post("/api/admin/backfill-domain-claims")
      .send({ limit: 20 });
    expect(res.body).toMatchObject({
      ok: true,
      examined: expect.any(Number),
      alreadyHasClaims: expect.any(Number),
      extracted: expect.any(Number),
      claimsInserted: expect.any(Number),
      errors: expect.any(Number),
    });
  });
});
