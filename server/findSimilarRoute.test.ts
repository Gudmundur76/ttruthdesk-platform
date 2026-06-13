/**
 * findSimilarRoute.test.ts — Phase 124b
 *
 * Tests for:
 *   - GET /api/public/similar/:claimId  (HTTP route)
 *   - find_similar MCP tool #12
 *   - Staleness indicator (isStale = updatedAt > 90 days ago)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("./claimSimilarityEngine", () => ({
  findSimilarToClaimId: vi.fn(),
}));

vi.mock("./db", () => ({
  getClaimById: vi.fn(),
}));

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const NINETY_ONE_DAYS_AGO = new Date(Date.now() - 91 * 24 * 60 * 60 * 1000);
const THIRTY_DAYS_AGO = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

const FRESH_SIMILAR_CLAIM = {
  claimId: 2,
  documentId: 10,
  documentTitle: "Fresh Study",
  claimText: "Vitamin D reduces fracture risk",
  verdict: "Supported",
  confidenceScore: 0.88,
  similarity: 0.72,
};

const STALE_SIMILAR_CLAIM = {
  claimId: 3,
  documentId: 11,
  documentTitle: "Old Study",
  claimText: "Vitamin D prevents all bone disease",
  verdict: "Disputed",
  confidenceScore: 0.45,
  similarity: 0.65,
};

// ─── HTTP Route tests ─────────────────────────────────────────────────────────

describe("GET /api/public/similar/:claimId", () => {
  let app: express.Express;

  beforeEach(async () => {
    vi.resetAllMocks();
    app = express();
    app.use(express.json());

    const { registerFindSimilarRoute } = await import("./findSimilarRoute");
    registerFindSimilarRoute(app);

    const { findSimilarToClaimId } = await import("./claimSimilarityEngine");
    const { getClaimById } = await import("./db");

    vi.mocked(getClaimById).mockResolvedValue({
      id: 1,
      claimText: "Vitamin D improves bone health",
      verdict: "Supported",
      updatedAt: THIRTY_DAYS_AGO,
    } as never);

    vi.mocked(findSimilarToClaimId).mockResolvedValue([
      { ...FRESH_SIMILAR_CLAIM },
      { ...STALE_SIMILAR_CLAIM },
    ]);
  });

  it("returns 200 with similar claims for a valid claimId", async () => {
    const res = await request(app).get("/api/public/similar/1");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("claimId", 1);
    expect(res.body).toHaveProperty("similar");
    expect(Array.isArray(res.body.similar)).toBe(true);
    expect(res.body.similar).toHaveLength(2);
  });

  it("returns 400 for a non-numeric claimId", async () => {
    const res = await request(app).get("/api/public/similar/abc");
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("returns 404 when the source claim does not exist", async () => {
    const { getClaimById } = await import("./db");
    vi.mocked(getClaimById).mockResolvedValueOnce(null);
    const res = await request(app).get("/api/public/similar/999");
    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty("error");
  });

  it("respects topK query param", async () => {
    const { findSimilarToClaimId } = await import("./claimSimilarityEngine");
    const res = await request(app).get("/api/public/similar/1?topK=1");
    expect(res.status).toBe(200);
    const call = vi.mocked(findSimilarToClaimId).mock.calls[0];
    expect(call[1]).toMatchObject({ topK: 1 });
  });

  it("respects threshold query param", async () => {
    const { findSimilarToClaimId } = await import("./claimSimilarityEngine");
    const res = await request(app).get("/api/public/similar/1?threshold=0.8");
    expect(res.status).toBe(200);
    const call = vi.mocked(findSimilarToClaimId).mock.calls[0];
    expect(call[1]).toMatchObject({ threshold: 0.8 });
  });

  it("returns CORS headers", async () => {
    const res = await request(app).get("/api/public/similar/1");
    expect(res.headers["access-control-allow-origin"]).toBe("*");
  });

  it("returns empty similar array when no similar claims found", async () => {
    const { findSimilarToClaimId } = await import("./claimSimilarityEngine");
    vi.mocked(findSimilarToClaimId).mockResolvedValueOnce([]);
    const res = await request(app).get("/api/public/similar/1");
    expect(res.status).toBe(200);
    expect(res.body.similar).toHaveLength(0);
  });

  it("returns 500 on unexpected error", async () => {
    const { findSimilarToClaimId } = await import("./claimSimilarityEngine");
    vi.mocked(findSimilarToClaimId).mockImplementation(() => {
      throw new Error("DB exploded");
    });
    const res = await request(app).get("/api/public/similar/1");
    expect(res.status).toBe(500);
  });
});

// ─── Staleness indicator tests ────────────────────────────────────────────────

describe("findSimilarRoute staleness indicator", () => {
  let app: express.Express;

  beforeEach(async () => {
    vi.resetAllMocks();
    app = express();
    app.use(express.json());

    const { registerFindSimilarRoute } = await import("./findSimilarRoute");
    registerFindSimilarRoute(app);
  });

  it("marks source claim as stale when updatedAt > 90 days ago", async () => {
    const { getClaimById } = await import("./db");
    const { findSimilarToClaimId } = await import("./claimSimilarityEngine");
    vi.mocked(getClaimById).mockResolvedValue({
      id: 1,
      claimText: "old claim",
      verdict: "Supported",
      updatedAt: NINETY_ONE_DAYS_AGO,
    } as never);
    vi.mocked(findSimilarToClaimId).mockResolvedValue([]);
    const res = await request(app).get("/api/public/similar/1");
    expect(res.status).toBe(200);
    expect(res.body.sourceIsStale).toBe(true);
  });

  it("marks source claim as fresh when updatedAt <= 90 days ago", async () => {
    const { getClaimById } = await import("./db");
    const { findSimilarToClaimId } = await import("./claimSimilarityEngine");
    vi.mocked(getClaimById).mockResolvedValue({
      id: 1,
      claimText: "fresh claim",
      verdict: "Supported",
      updatedAt: THIRTY_DAYS_AGO,
    } as never);
    vi.mocked(findSimilarToClaimId).mockResolvedValue([]);
    const res = await request(app).get("/api/public/similar/1");
    expect(res.status).toBe(200);
    expect(res.body.sourceIsStale).toBe(false);
  });
});

// ─── MCP tool: find_similar ───────────────────────────────────────────────────

describe("FIND_SIMILAR_TOOLS_MANIFEST", () => {
  it("exports a manifest with name find_similar", async () => {
    const { FIND_SIMILAR_TOOLS_MANIFEST } = await import("./findSimilarRoute");
    expect(FIND_SIMILAR_TOOLS_MANIFEST).toHaveLength(1);
    expect(FIND_SIMILAR_TOOLS_MANIFEST[0].name).toBe("find_similar");
  });

  it("has required claim_id in inputSchema", async () => {
    const { FIND_SIMILAR_TOOLS_MANIFEST } = await import("./findSimilarRoute");
    const schema = FIND_SIMILAR_TOOLS_MANIFEST[0].inputSchema as Record<
      string,
      unknown
    >;
    expect(schema.required as string[]).toContain("claim_id");
  });
});

describe("toolFindSimilar (MCP handler)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns similar claims for a valid claim_id", async () => {
    const { getClaimById } = await import("./db");
    const { findSimilarToClaimId } = await import("./claimSimilarityEngine");
    vi.mocked(getClaimById).mockResolvedValue({
      id: 5,
      claimText: "test claim",
      verdict: "Supported",
      updatedAt: THIRTY_DAYS_AGO,
    } as never);
    vi.mocked(findSimilarToClaimId).mockResolvedValue([FRESH_SIMILAR_CLAIM]);

    const { toolFindSimilar } = await import("./findSimilarRoute");
    const result = (await toolFindSimilar({ claim_id: 5 })) as Record<
      string,
      unknown
    >;
    expect(result).toHaveProperty("claimId", 5);
    expect(result).toHaveProperty("similar");
    expect((result.similar as unknown[]).length).toBe(1);
    expect(result).toHaveProperty("sourceIsStale", false);
  });

  it("returns notFound=true when claim does not exist", async () => {
    const { getClaimById } = await import("./db");
    vi.mocked(getClaimById).mockResolvedValue(null);

    const { toolFindSimilar } = await import("./findSimilarRoute");
    const result = (await toolFindSimilar({ claim_id: 999 })) as Record<
      string,
      unknown
    >;
    expect(result).toHaveProperty("notFound", true);
  });

  it("throws on missing claim_id param", async () => {
    const { toolFindSimilar } = await import("./findSimilarRoute");
    await expect(toolFindSimilar({})).rejects.toThrow();
  });

  it("respects top_k and threshold params", async () => {
    const { getClaimById } = await import("./db");
    const { findSimilarToClaimId } = await import("./claimSimilarityEngine");
    vi.mocked(getClaimById).mockResolvedValue({
      id: 5,
      claimText: "test",
      verdict: "Supported",
      updatedAt: THIRTY_DAYS_AGO,
    } as never);
    vi.mocked(findSimilarToClaimId).mockResolvedValue([]);

    const { toolFindSimilar } = await import("./findSimilarRoute");
    await toolFindSimilar({ claim_id: 5, top_k: 3, threshold: 0.75 });
    const call = vi.mocked(findSimilarToClaimId).mock.calls[0];
    expect(call[1]).toMatchObject({ topK: 3, threshold: 0.75 });
  });
});
