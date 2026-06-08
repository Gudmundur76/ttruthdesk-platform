/**
 * Tests for the paginated public claims API endpoint.
 * Tests the response shape, pagination headers, filter params, and error handling.
 * Uses vi.mock to avoid hitting the real database.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// Mock the db module before importing the route
vi.mock("./db", () => ({
  getPaginatedPublicClaims: vi.fn(),
  getVerifiedClaimsForPublicApi: vi.fn(),
  getClaimWithDocument: vi.fn(),
  getAllClaimIndexRows: vi.fn(),
}));

// Mock claimPageRoute so we don't need a real DB for JSON-LD generation
vi.mock("./claimPageRoute", () => ({
  buildClaimReviewJsonLd: vi.fn(() => ({
    claimReview: { "@type": "ClaimReview", claimReviewed: "mock claim" },
    faqPage: { "@type": "FAQPage", mainEntity: [] },
  })),
  registerClaimPageRoute: vi.fn(),
}));

import { registerClaimsRoutes } from "./claimsRoutes";
import * as db from "./db";
import * as claimPageRoute from "./claimPageRoute";

const makeApp = () => {
  const app = express();
  app.use(express.json());
  registerClaimsRoutes(app as any);
  return app;
};

const mockRow = {
  id: 1001,
  claimText: "The resolution of 2.1 Å was reported for PDB entry 1ABC",
  claimType: "resolution",
  extractedValue: "2.1",
  pdbId: "1ABC",
  verdict: "Supported",
  verdictRationale: "PDB record confirms 2.1 Å resolution",
  confidenceScore: 0.95,
  verdictMethod: "exact_match",
  pdbEvidenceUrl: "https://www.rcsb.org/structure/1ABC",
  createdAt: new Date("2024-01-15T10:00:00Z"),
  updatedAt: new Date("2024-01-15T10:00:00Z"),
  documentId: 42,
  documentTitle: "Structural analysis of protein X",
  verticalDomain: "structural_biology",
};

describe("GET /api/public/claims", () => {
  let app: ReturnType<typeof makeApp>;

  beforeEach(() => {
    vi.clearAllMocks();
    app = makeApp();
  });

  it("returns 200 with correct JSON shape on first page", async () => {
    vi.mocked(db.getPaginatedPublicClaims).mockResolvedValueOnce({
      rows: [mockRow],
      total: 1,
      totalPages: 1,
    });

    const res = await request(app)
      .get("/api/public/claims")
      .set("X-Forwarded-Proto", "https")
      .set("X-Forwarded-Host", "truthdesk.claims");

    expect(res.status).toBe(200);
    expect(res.body.page).toBe(1);
    expect(res.body.page_size).toBe(100);
    expect(res.body.total).toBe(1);
    expect(res.body.total_pages).toBe(1);
    expect(res.body.claims).toHaveLength(1);
    expect(res.body.claims[0].claim_id).toBe(1001);
    expect(res.body.claims[0].verdict).toBe("Supported");
    expect(res.body.claims[0].page_url).toContain("/claim/1001");
    expect(res.body.claims[0].audit_url).toContain("/audit/42#claim-1001");
  });

  it("sets RFC 5988 Link headers for multi-page results", async () => {
    vi.mocked(db.getPaginatedPublicClaims).mockResolvedValueOnce({
      rows: [mockRow],
      total: 250,
      totalPages: 3,
    });

    const res = await request(app)
      .get("/api/public/claims?page=2&page_size=100")
      .set("X-Forwarded-Proto", "https")
      .set("X-Forwarded-Host", "truthdesk.claims");

    expect(res.status).toBe(200);
    const link = res.headers["link"] as string;
    expect(link).toContain('rel="first"');
    expect(link).toContain('rel="prev"');
    expect(link).toContain('rel="next"');
    expect(link).toContain('rel="last"');
    expect(link).toContain('rel="describedby"');
  });

  it("sets X-Total-Count, X-Total-Pages, X-Page, X-Page-Size headers", async () => {
    vi.mocked(db.getPaginatedPublicClaims).mockResolvedValueOnce({
      rows: [mockRow],
      total: 3919,
      totalPages: 40,
    });

    const res = await request(app)
      .get("/api/public/claims?page=2&page_size=100")
      .set("X-Forwarded-Proto", "https")
      .set("X-Forwarded-Host", "truthdesk.claims");

    expect(res.headers["x-total-count"]).toBe("3919");
    expect(res.headers["x-total-pages"]).toBe("40");
    expect(res.headers["x-page"]).toBe("2");
    expect(res.headers["x-page-size"]).toBe("100");
  });

  it("passes verdict filter to db query", async () => {
    vi.mocked(db.getPaginatedPublicClaims).mockResolvedValueOnce({
      rows: [],
      total: 0,
      totalPages: 0,
    });

    await request(app)
      .get("/api/public/claims?verdict=Supported")
      .set("X-Forwarded-Proto", "https")
      .set("X-Forwarded-Host", "truthdesk.claims");

    expect(db.getPaginatedPublicClaims).toHaveBeenCalledWith(
      expect.objectContaining({ verdict: "Supported" })
    );
  });

  it("passes vertical filter to db query", async () => {
    vi.mocked(db.getPaginatedPublicClaims).mockResolvedValueOnce({
      rows: [],
      total: 0,
      totalPages: 0,
    });

    await request(app)
      .get("/api/public/claims?vertical=salmon_biotech")
      .set("X-Forwarded-Proto", "https")
      .set("X-Forwarded-Host", "truthdesk.claims");

    expect(db.getPaginatedPublicClaims).toHaveBeenCalledWith(
      expect.objectContaining({ vertical: "salmon_biotech" })
    );
  });

  it("passes claim_type filter to db query", async () => {
    vi.mocked(db.getPaginatedPublicClaims).mockResolvedValueOnce({
      rows: [],
      total: 0,
      totalPages: 0,
    });

    await request(app)
      .get("/api/public/claims?claim_type=pdb_id")
      .set("X-Forwarded-Proto", "https")
      .set("X-Forwarded-Host", "truthdesk.claims");

    expect(db.getPaginatedPublicClaims).toHaveBeenCalledWith(
      expect.objectContaining({ claimType: "pdb_id" })
    );
  });

  it("returns 400 for invalid updated_since date", async () => {
    const res = await request(app)
      .get("/api/public/claims?updated_since=not-a-date")
      .set("X-Forwarded-Proto", "https")
      .set("X-Forwarded-Host", "truthdesk.claims");

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("Invalid updated_since");
  });

  it("clamps page_size to max 500", async () => {
    vi.mocked(db.getPaginatedPublicClaims).mockResolvedValueOnce({
      rows: [],
      total: 0,
      totalPages: 0,
    });

    await request(app)
      .get("/api/public/claims?page_size=9999")
      .set("X-Forwarded-Proto", "https")
      .set("X-Forwarded-Host", "truthdesk.claims");

    expect(db.getPaginatedPublicClaims).toHaveBeenCalledWith(
      expect.objectContaining({ pageSize: 500 })
    );
  });

  it("defaults page to 1 for invalid page param", async () => {
    vi.mocked(db.getPaginatedPublicClaims).mockResolvedValueOnce({
      rows: [],
      total: 0,
      totalPages: 0,
    });

    await request(app)
      .get("/api/public/claims?page=abc")
      .set("X-Forwarded-Proto", "https")
      .set("X-Forwarded-Host", "truthdesk.claims");

    expect(db.getPaginatedPublicClaims).toHaveBeenCalledWith(
      expect.objectContaining({ page: 1 })
    );
  });

  it("returns CORS headers", async () => {
    vi.mocked(db.getPaginatedPublicClaims).mockResolvedValueOnce({
      rows: [],
      total: 0,
      totalPages: 0,
    });

    const res = await request(app)
      .get("/api/public/claims")
      .set("X-Forwarded-Proto", "https")
      .set("X-Forwarded-Host", "truthdesk.claims");

    expect(res.headers["access-control-allow-origin"]).toBe("*");
  });

  it("OPTIONS /api/public/claims returns 204", async () => {
    const res = await request(app)
      .options("/api/public/claims")
      .set("X-Forwarded-Proto", "https")
      .set("X-Forwarded-Host", "truthdesk.claims");

    expect(res.status).toBe(204);
  });

  it("includes $schema and generated_at in response", async () => {
    vi.mocked(db.getPaginatedPublicClaims).mockResolvedValueOnce({
      rows: [],
      total: 0,
      totalPages: 0,
    });

    const res = await request(app)
      .get("/api/public/claims")
      .set("X-Forwarded-Proto", "https")
      .set("X-Forwarded-Host", "truthdesk.claims");

    expect(res.body.$schema).toContain("claims.schema.json");
    expect(res.body.generated_at).toBeTruthy();
    expect(new Date(res.body.generated_at).getTime()).not.toBeNaN();
  });

  it("includes filters object reflecting active filters", async () => {
    vi.mocked(db.getPaginatedPublicClaims).mockResolvedValueOnce({
      rows: [],
      total: 0,
      totalPages: 0,
    });

    const res = await request(app)
      .get("/api/public/claims?verdict=Supported&vertical=structural_biology")
      .set("X-Forwarded-Proto", "https")
      .set("X-Forwarded-Host", "truthdesk.claims");

    expect(res.body.filters.verdict).toBe("Supported");
    expect(res.body.filters.vertical).toBe("structural_biology");
    expect(res.body.filters.claim_type).toBeNull();
    expect(res.body.filters.updated_since).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Single-claim endpoint tests
// ─────────────────────────────────────────────────────────────────────────────

const mockClaimRow = {
  claim: {
    id: 1001,
    claimText: "The resolution of 2.1 Å was reported for PDB entry 1ABC",
    claimType: "resolution",
    extractedValue: "2.1",
    pdbId: "1ABC",
    verdict: "Supported",
    verdictRationale: "PDB record confirms 2.1 Å resolution",
    confidenceScore: 0.95,
    verdictMethod: "exact_match",
    pdbEvidenceUrl: "https://www.rcsb.org/structure/1ABC",
    createdAt: new Date("2024-01-15T10:00:00Z"),
    updatedAt: new Date("2024-01-20T12:00:00Z"),
    documentId: 42,
    verticalDomain: "structural_biology",
  },
  document: {
    id: 42,
    title: "Structural analysis of protein X",
    createdAt: new Date("2024-01-10T08:00:00Z"),
  },
};

describe("GET /api/public/claims/:id", () => {
  let app: ReturnType<typeof makeApp>;

  beforeEach(() => {
    vi.clearAllMocks();
    app = makeApp();
  });

  it("returns 200 with correct JSON shape for a valid claim", async () => {
    vi.mocked(db.getClaimWithDocument).mockResolvedValueOnce(mockClaimRow as any);

    const res = await request(app)
      .get("/api/public/claims/1001")
      .set("X-Forwarded-Proto", "https")
      .set("X-Forwarded-Host", "truthdesk.claims");

    expect(res.status).toBe(200);
    expect(res.body.claim_id).toBe(1001);
    expect(res.body.document_id).toBe(42);
    expect(res.body.document_title).toBe("Structural analysis of protein X");
    expect(res.body.claim_text).toBe("The resolution of 2.1 Å was reported for PDB entry 1ABC");
    expect(res.body.verdict).toBe("Supported");
    expect(res.body.confidence_score).toBe(0.95);
    expect(res.body.pdb_id).toBe("1ABC");
    expect(Array.isArray(res.body.jsonld)).toBe(true);
    expect(res.body.jsonld).toHaveLength(2);
  });

  it("returns 404 when claim does not exist", async () => {
    vi.mocked(db.getClaimWithDocument).mockResolvedValueOnce(null);

    const res = await request(app)
      .get("/api/public/claims/99999")
      .set("X-Forwarded-Proto", "https")
      .set("X-Forwarded-Host", "truthdesk.claims");

    expect(res.status).toBe(404);
    expect(res.body.error).toBeTruthy();
  });

  it("returns 400 for a non-numeric claim ID", async () => {
    const res = await request(app)
      .get("/api/public/claims/not-a-number")
      .set("X-Forwarded-Proto", "https")
      .set("X-Forwarded-Host", "truthdesk.claims");

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("Invalid claim ID");
  });

  it("returns CORS headers on single-claim response", async () => {
    vi.mocked(db.getClaimWithDocument).mockResolvedValueOnce(mockClaimRow as any);

    const res = await request(app)
      .get("/api/public/claims/1001")
      .set("X-Forwarded-Proto", "https")
      .set("X-Forwarded-Host", "truthdesk.claims");

    expect(res.headers["access-control-allow-origin"]).toBe("*");
  });

  it("OPTIONS /api/public/claims/:id returns 204", async () => {
    const res = await request(app)
      .options("/api/public/claims/1001")
      .set("X-Forwarded-Proto", "https")
      .set("X-Forwarded-Host", "truthdesk.claims");

    expect(res.status).toBe(204);
  });

  it("sets Last-Modified header from claim updatedAt", async () => {
    vi.mocked(db.getClaimWithDocument).mockResolvedValueOnce(mockClaimRow as any);

    const res = await request(app)
      .get("/api/public/claims/1001")
      .set("X-Forwarded-Proto", "https")
      .set("X-Forwarded-Host", "truthdesk.claims");

    expect(res.headers["last-modified"]).toBeTruthy();
    // Should reflect the updatedAt date (2024-01-20)
    expect(res.headers["last-modified"]).toContain("2024");
  });

  it("includes collection, canonical, and describedby Link headers", async () => {
    vi.mocked(db.getClaimWithDocument).mockResolvedValueOnce(mockClaimRow as any);

    const res = await request(app)
      .get("/api/public/claims/1001")
      .set("X-Forwarded-Proto", "https")
      .set("X-Forwarded-Host", "truthdesk.claims");

    const link = res.headers["link"] ?? "";
    expect(link).toContain('rel="collection"');
    expect(link).toContain('rel="canonical"');
    expect(link).toContain('rel="describedby"');
  });

  it("calls buildClaimReviewJsonLd with the correct claim and document", async () => {
    vi.mocked(db.getClaimWithDocument).mockResolvedValueOnce(mockClaimRow as any);

    await request(app)
      .get("/api/public/claims/1001")
      .set("X-Forwarded-Proto", "https")
      .set("X-Forwarded-Host", "truthdesk.claims");

    expect(claimPageRoute.buildClaimReviewJsonLd).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1001 }),
      expect.objectContaining({ id: 42 }),
      expect.stringContaining("truthdesk.claims")
    );
  });

  it("includes page_url and audit_url in response body", async () => {
    vi.mocked(db.getClaimWithDocument).mockResolvedValueOnce(mockClaimRow as any);

    const res = await request(app)
      .get("/api/public/claims/1001")
      .set("X-Forwarded-Proto", "https")
      .set("X-Forwarded-Host", "truthdesk.claims");

    expect(res.body.page_url).toContain("/claim/1001");
    expect(res.body.audit_url).toContain("/audit/42");
    expect(res.body.audit_url).toContain("#claim-1001");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Lightweight claim index endpoint tests
// ─────────────────────────────────────────────────────────────────────────────

const mockIndexRows = [
  {
    id: 1001,
    verdict: "Supported",
    updatedAt: new Date("2024-01-20T12:00:00Z"),
    documentId: 42,
    verticalDomain: "structural_biology",
  },
  {
    id: 1002,
    verdict: "Contradicted",
    updatedAt: new Date("2024-01-21T09:00:00Z"),
    documentId: 43,
    verticalDomain: "salmon_biotech",
  },
];

describe("GET /api/public/claims/index.json", () => {
  let app: ReturnType<typeof makeApp>;

  beforeEach(() => {
    vi.clearAllMocks();
    app = makeApp();
  });

  it("returns 200 with correct JSON shape", async () => {
    vi.mocked(db.getAllClaimIndexRows).mockResolvedValueOnce(mockIndexRows as any);

    const res = await request(app)
      .get("/api/public/claims/index.json")
      .set("X-Forwarded-Proto", "https")
      .set("X-Forwarded-Host", "truthdesk.claims");

    expect(res.status).toBe(200);
    expect(res.body.count).toBe(2);
    expect(Array.isArray(res.body.claims)).toBe(true);
    expect(res.body.claims).toHaveLength(2);
    expect(res.body.generated_at).toBeTruthy();
    expect(res.body.description).toBeTruthy();
  });

  it("each index entry has id, verdict, vertical, url, and api_url", async () => {
    vi.mocked(db.getAllClaimIndexRows).mockResolvedValueOnce(mockIndexRows as any);

    const res = await request(app)
      .get("/api/public/claims/index.json")
      .set("X-Forwarded-Proto", "https")
      .set("X-Forwarded-Host", "truthdesk.claims");

    const first = res.body.claims[0];
    expect(first.id).toBe(1001);
    expect(first.verdict).toBe("Supported");
    expect(first.vertical).toBe("structural_biology");
    expect(first.document_id).toBe(42);
    expect(first.url).toContain("/claim/1001");
    expect(first.api_url).toContain("/api/public/claims/1001");
  });

  it("returns CORS headers", async () => {
    vi.mocked(db.getAllClaimIndexRows).mockResolvedValueOnce(mockIndexRows as any);

    const res = await request(app)
      .get("/api/public/claims/index.json")
      .set("X-Forwarded-Proto", "https")
      .set("X-Forwarded-Host", "truthdesk.claims");

    expect(res.headers["access-control-allow-origin"]).toBe("*");
  });

  it("returns X-Total-Count header", async () => {
    vi.mocked(db.getAllClaimIndexRows).mockResolvedValueOnce(mockIndexRows as any);

    const res = await request(app)
      .get("/api/public/claims/index.json")
      .set("X-Forwarded-Proto", "https")
      .set("X-Forwarded-Host", "truthdesk.claims");

    expect(res.headers["x-total-count"]).toBe("2");
  });

  it("OPTIONS /api/public/claims/index.json returns 204", async () => {
    const res = await request(app)
      .options("/api/public/claims/index.json")
      .set("X-Forwarded-Proto", "https")
      .set("X-Forwarded-Host", "truthdesk.claims");

    expect(res.status).toBe(204);
  });

  it("includes collection and describedby Link headers", async () => {
    vi.mocked(db.getAllClaimIndexRows).mockResolvedValueOnce(mockIndexRows as any);

    const res = await request(app)
      .get("/api/public/claims/index.json")
      .set("X-Forwarded-Proto", "https")
      .set("X-Forwarded-Host", "truthdesk.claims");

    const link = res.headers["link"] ?? "";
    expect(link).toContain('rel="collection"');
    expect(link).toContain('rel="describedby"');
  });
});

// ── Tests for GET /api/public/claims/search ──────────────────────────────────
describe("GET /api/public/claims/search", () => {
  let app: ReturnType<typeof makeApp>;

  beforeEach(() => {
    vi.clearAllMocks();
    app = makeApp();
  });

  it("returns 400 when q param is missing", async () => {
    const res = await request(app)
      .get("/api/public/claims/search")
      .set("X-Forwarded-Proto", "https")
      .set("X-Forwarded-Host", "truthdesk.claims");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Missing required parameter/);
    expect(res.body.example).toBeDefined();
  });

  it("returns 400 when q param is whitespace-only", async () => {
    const res = await request(app)
      .get("/api/public/claims/search?q=   ")
      .set("X-Forwarded-Proto", "https")
      .set("X-Forwarded-Host", "truthdesk.claims");
    expect(res.status).toBe(400);
  });

  it("returns 200 with correct shape when q is provided", async () => {
    vi.mocked(db.getPaginatedPublicClaims).mockResolvedValueOnce({
      rows: [mockRow],
      total: 1,
      totalPages: 1,
    });
    const res = await request(app)
      .get("/api/public/claims/search?q=Piscirickettsia")
      .set("X-Forwarded-Proto", "https")
      .set("X-Forwarded-Host", "truthdesk.claims");
    expect(res.status).toBe(200);
    expect(res.body.query).toBe("Piscirickettsia");
    expect(res.body.total_matches).toBe(1);
    expect(res.body.returned).toBe(1);
    expect(Array.isArray(res.body.claims)).toBe(true);
  });

  it("passes q to getPaginatedPublicClaims", async () => {
    vi.mocked(db.getPaginatedPublicClaims).mockResolvedValueOnce({
      rows: [],
      total: 0,
      totalPages: 0,
    });
    await request(app)
      .get("/api/public/claims/search?q=intracellular+bacterium")
      .set("X-Forwarded-Proto", "https")
      .set("X-Forwarded-Host", "truthdesk.claims");
    expect(db.getPaginatedPublicClaims).toHaveBeenCalledWith(
      expect.objectContaining({ q: "intracellular bacterium" })
    );
  });

  it("includes timeline_url in each claim item", async () => {
    vi.mocked(db.getPaginatedPublicClaims).mockResolvedValueOnce({
      rows: [mockRow],
      total: 1,
      totalPages: 1,
    });
    const res = await request(app)
      .get("/api/public/claims/search?q=resolution")
      .set("X-Forwarded-Proto", "https")
      .set("X-Forwarded-Host", "truthdesk.claims");
    expect(res.status).toBe(200);
    const claim = res.body.claims[0];
    expect(claim.timeline_url).toContain("/timeline?q=");
  });

  it("respects limit param (capped at 200)", async () => {
    vi.mocked(db.getPaginatedPublicClaims).mockResolvedValueOnce({
      rows: [],
      total: 0,
      totalPages: 0,
    });
    await request(app)
      .get("/api/public/claims/search?q=test&limit=500")
      .set("X-Forwarded-Proto", "https")
      .set("X-Forwarded-Host", "truthdesk.claims");
    expect(db.getPaginatedPublicClaims).toHaveBeenCalledWith(
      expect.objectContaining({ pageSize: 200 })
    );
  });

  it("returns CORS headers", async () => {
    vi.mocked(db.getPaginatedPublicClaims).mockResolvedValueOnce({
      rows: [],
      total: 0,
      totalPages: 0,
    });
    const res = await request(app)
      .get("/api/public/claims/search?q=test")
      .set("X-Forwarded-Proto", "https")
      .set("X-Forwarded-Host", "truthdesk.claims");
    expect(res.headers["access-control-allow-origin"]).toBe("*");
  });

  it("OPTIONS /api/public/claims/search returns 204", async () => {
    const res = await request(app)
      .options("/api/public/claims/search")
      .set("X-Forwarded-Proto", "https")
      .set("X-Forwarded-Host", "truthdesk.claims");
    expect(res.status).toBe(204);
  });
});

// ── Tests for ?q= filter on GET /api/public/claims ───────────────────────────
describe("GET /api/public/claims with ?q= filter", () => {
  let app: ReturnType<typeof makeApp>;

  beforeEach(() => {
    vi.clearAllMocks();
    app = makeApp();
  });

  it("passes q to getPaginatedPublicClaims when provided", async () => {
    vi.mocked(db.getPaginatedPublicClaims).mockResolvedValueOnce({
      rows: [mockRow],
      total: 1,
      totalPages: 1,
    });
    await request(app)
      .get("/api/public/claims?q=salmonis")
      .set("X-Forwarded-Proto", "https")
      .set("X-Forwarded-Host", "truthdesk.claims");
    expect(db.getPaginatedPublicClaims).toHaveBeenCalledWith(
      expect.objectContaining({ q: "salmonis" })
    );
  });

  it("includes q in filters object in response body", async () => {
    vi.mocked(db.getPaginatedPublicClaims).mockResolvedValueOnce({
      rows: [],
      total: 0,
      totalPages: 0,
    });
    const res = await request(app)
      .get("/api/public/claims?q=bacterium")
      .set("X-Forwarded-Proto", "https")
      .set("X-Forwarded-Host", "truthdesk.claims");
    expect(res.status).toBe(200);
    expect(res.body.filters.q).toBe("bacterium");
  });

  it("includes q in Link header pagination URLs", async () => {
    vi.mocked(db.getPaginatedPublicClaims).mockResolvedValueOnce({
      rows: [mockRow],
      total: 200,
      totalPages: 2,
    });
    const res = await request(app)
      .get("/api/public/claims?q=salmon&page=1")
      .set("X-Forwarded-Proto", "https")
      .set("X-Forwarded-Host", "truthdesk.claims");
    const link = res.headers["link"] ?? "";
    expect(link).toContain("q=salmon");
  });

  it("does not pass q when param is empty string", async () => {
    vi.mocked(db.getPaginatedPublicClaims).mockResolvedValueOnce({
      rows: [],
      total: 0,
      totalPages: 0,
    });
    await request(app)
      .get("/api/public/claims?q=")
      .set("X-Forwarded-Proto", "https")
      .set("X-Forwarded-Host", "truthdesk.claims");
    expect(db.getPaginatedPublicClaims).toHaveBeenCalledWith(
      expect.objectContaining({ q: undefined })
    );
  });
});
