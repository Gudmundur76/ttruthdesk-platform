/**
 * backfillEmbeddingsRoute.test.ts — Sprint 0 Fix 4
 * Tests for backfillMissingEmbeddings() and POST /api/scheduled/backfill-embeddings
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  mockGetDb: vi.fn(),
  mockFetch: vi.fn(),
}));

vi.mock("./db", () => ({ getDb: mocks.mockGetDb }));
vi.mock("./logger", () => ({
  logger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  errData: vi.fn((e: unknown) => ({ err: String(e) })),
}));

// Stub global fetch
vi.stubGlobal("fetch", mocks.mockFetch);

import express from "express";
import request from "supertest";
import {
  backfillMissingEmbeddings,
  registerBackfillEmbeddingsRoute,
} from "./backfillEmbeddingsRoute";

// ─── DB helpers ───────────────────────────────────────────────────────────────

/**
 * Build a minimal Drizzle-like mock that handles the two query patterns:
 *   1. db.select({claimId}).from(claimEmbeddings)  → existingIds array
 *   2. db.select({id,claimText}).from(claims).where(...).limit(...).offset(...) → claim rows
 *
 * We use a call-count approach: first select() call = embeddings query,
 * subsequent calls = claims query.
 */
function makeDb(
  claimRows: Array<{ id: number; claimText: string }> = [],
  existingEmbeddingIds: number[] = []
) {
  let selectCallCount = 0;

  function makeChain(resolveValue: unknown) {
    const chain: Record<string, unknown> = {};
    // All methods return the chain for chaining, final method resolves
    chain.from = vi.fn().mockImplementation(() => {
      // If no further chaining expected, resolve here
      return Promise.resolve(resolveValue);
    });
    chain.where = vi.fn().mockReturnValue(chain);
    chain.limit = vi.fn().mockReturnValue(chain);
    chain.offset = vi.fn().mockResolvedValue(resolveValue);
    return chain;
  }

  const db: Record<string, unknown> = {};
  db.select = vi.fn().mockImplementation(() => {
    selectCallCount++;
    if (selectCallCount === 1) {
      // First call: existing embeddings query — db.select().from() resolves to existing IDs
      return makeChain(existingEmbeddingIds.map(id => ({ claimId: id })));
    }
    // Subsequent calls: claims query — .from().where().limit().offset() resolves to claimRows
    const chain: Record<string, unknown> = {};
    chain.from = vi.fn().mockReturnValue(chain);
    chain.where = vi.fn().mockReturnValue(chain);
    chain.limit = vi.fn().mockReturnValue(chain);
    chain.offset = vi.fn().mockResolvedValue(claimRows);
    return chain;
  });

  const insertChain: Record<string, unknown> = {};
  insertChain.values = vi.fn().mockReturnValue(insertChain);
  insertChain.onDuplicateKeyUpdate = vi
    .fn()
    .mockResolvedValue({ affectedRows: 1 });
  db.insert = vi.fn().mockReturnValue(insertChain);

  return db;
}

function makeEmbeddingResponse(vectors: number[][] = [[0.1, 0.2, 0.3]]) {
  return {
    ok: true,
    json: vi.fn().mockResolvedValue({
      data: vectors.map((embedding, i) => ({ index: i, embedding })),
    }),
  };
}

// ─── backfillMissingEmbeddings() ─────────────────────────────────────────────

describe("backfillMissingEmbeddings()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.BUILT_IN_FORGE_API_URL = "https://api.example.com";
    process.env.BUILT_IN_FORGE_API_KEY = "test-key";
  });

  it("returns zeros when DB is unavailable", async () => {
    mocks.mockGetDb.mockResolvedValue(null);
    const result = await backfillMissingEmbeddings({ limit: 10 });
    expect(result).toEqual({ processed: 0, inserted: 0, errors: 0 });
  });

  it("returns zeros when no claims need embedding", async () => {
    const db = makeDb([], []); // no claims to embed
    // Override second select to return empty claims
    let callCount = 0;
    (db.select as ReturnType<typeof vi.fn>).mockImplementation(() => {
      callCount++;
      const chain: Record<string, unknown> = {};
      if (callCount === 1) {
        // existing embeddings query
        chain.from = vi.fn().mockResolvedValue([]);
        chain.where = vi.fn().mockReturnValue(chain);
        chain.limit = vi.fn().mockReturnValue(chain);
        chain.offset = vi.fn().mockResolvedValue([]);
      } else {
        // claims query — empty
        chain.from = vi.fn().mockReturnValue(chain);
        chain.where = vi.fn().mockReturnValue(chain);
        chain.limit = vi.fn().mockReturnValue(chain);
        chain.offset = vi.fn().mockResolvedValue([]);
      }
      return chain;
    });
    mocks.mockGetDb.mockResolvedValue(db);
    const result = await backfillMissingEmbeddings({ limit: 10 });
    expect(result.processed).toBe(0);
    expect(result.inserted).toBe(0);
    expect(mocks.mockFetch).not.toHaveBeenCalled();
  });

  it("calls embeddings API and inserts for each claim", async () => {
    const claimRows = [
      { id: 1, claimText: "The earth is round" },
      { id: 2, claimText: "Water is wet" },
    ];
    let callCount = 0;
    const db: Record<string, unknown> = {};
    db.select = vi.fn().mockImplementation(() => {
      callCount++;
      const chain: Record<string, unknown> = {};
      if (callCount === 1) {
        // existing embeddings — none
        chain.from = vi.fn().mockResolvedValue([]);
      } else if (callCount === 2) {
        // first page of claims
        chain.from = vi.fn().mockReturnValue(chain);
        chain.where = vi.fn().mockReturnValue(chain);
        chain.limit = vi.fn().mockReturnValue(chain);
        chain.offset = vi.fn().mockResolvedValue(claimRows);
      } else {
        // subsequent pages — empty
        chain.from = vi.fn().mockReturnValue(chain);
        chain.where = vi.fn().mockReturnValue(chain);
        chain.limit = vi.fn().mockReturnValue(chain);
        chain.offset = vi.fn().mockResolvedValue([]);
      }
      return chain;
    });
    const insertChain: Record<string, unknown> = {};
    insertChain.values = vi.fn().mockReturnValue(insertChain);
    insertChain.onDuplicateKeyUpdate = vi
      .fn()
      .mockResolvedValue({ affectedRows: 1 });
    db.insert = vi.fn().mockReturnValue(insertChain);
    mocks.mockGetDb.mockResolvedValue(db);
    mocks.mockFetch.mockResolvedValue(
      makeEmbeddingResponse([
        [0.1, 0.2],
        [0.3, 0.4],
      ])
    );

    const result = await backfillMissingEmbeddings({ limit: 100 });
    expect(mocks.mockFetch).toHaveBeenCalledWith(
      "https://api.example.com/v1/embeddings",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer test-key" }),
      })
    );
    expect(result.inserted).toBe(2);
    expect(result.errors).toBe(0);
  });

  it("counts errors when embeddings API returns non-OK", async () => {
    const claimRows = [{ id: 1, claimText: "Test claim" }];
    let callCount = 0;
    const db: Record<string, unknown> = {};
    db.select = vi.fn().mockImplementation(() => {
      callCount++;
      const chain: Record<string, unknown> = {};
      if (callCount === 1) {
        chain.from = vi.fn().mockResolvedValue([]);
      } else if (callCount === 2) {
        chain.from = vi.fn().mockReturnValue(chain);
        chain.where = vi.fn().mockReturnValue(chain);
        chain.limit = vi.fn().mockReturnValue(chain);
        chain.offset = vi.fn().mockResolvedValue(claimRows);
      } else {
        chain.from = vi.fn().mockReturnValue(chain);
        chain.where = vi.fn().mockReturnValue(chain);
        chain.limit = vi.fn().mockReturnValue(chain);
        chain.offset = vi.fn().mockResolvedValue([]);
      }
      return chain;
    });
    const insertChain: Record<string, unknown> = {};
    insertChain.values = vi.fn().mockReturnValue(insertChain);
    insertChain.onDuplicateKeyUpdate = vi
      .fn()
      .mockResolvedValue({ affectedRows: 1 });
    db.insert = vi.fn().mockReturnValue(insertChain);
    mocks.mockGetDb.mockResolvedValue(db);
    mocks.mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      json: vi.fn().mockResolvedValue({}),
    });

    const result = await backfillMissingEmbeddings({ limit: 10 });
    expect(result.errors).toBeGreaterThan(0);
    expect(result.inserted).toBe(0);
  });
});

// ─── POST /api/scheduled/backfill-embeddings ─────────────────────────────────────

describe("registerBackfillEmbeddingsRoute — POST /api/scheduled/backfill-embeddings", () => {
  function makeApp() {
    const app = express();
    app.use(express.json());
    const requireOwnerOrAdmin = (
      _req: express.Request,
      _res: express.Response,
      next: () => void
    ) => next();
    registerBackfillEmbeddingsRoute(
      app as express.Express,
      requireOwnerOrAdmin
    );
    return app;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.BUILT_IN_FORGE_API_URL = "https://api.example.com";
    process.env.BUILT_IN_FORGE_API_KEY = "test-key";
  });

  it("returns 200 with result object on success", async () => {
    mocks.mockGetDb.mockResolvedValue(null); // DB unavailable → zeros result
    const app = makeApp();
    const res = await request(app)
      .post("/api/scheduled/backfill-embeddings")
      .send({ limit: 50 });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      ok: true,
      processed: 0,
      inserted: 0,
      errors: 0,
    });
  });

  it("accepts optional limit parameter", async () => {
    mocks.mockGetDb.mockResolvedValue(null);
    const app = makeApp();
    const res = await request(app)
      .post("/api/scheduled/backfill-embeddings")
      .send({ limit: 200 });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it("uses default limit when not provided", async () => {
    mocks.mockGetDb.mockResolvedValue(null);
    const app = makeApp();
    const res = await request(app)
      .post("/api/scheduled/backfill-embeddings")
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});
