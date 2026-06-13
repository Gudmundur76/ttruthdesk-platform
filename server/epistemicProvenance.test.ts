/**
 * epistemicProvenance.test.ts — Phase 121
 *
 * RED tests for the Epistemic Provenance Chain:
 *   - getDistortionChain(claimId) — ordered hop array from citationEdges
 *   - getSemanticNeighbours(claimId, limit) — top-N from graphClaimEdges
 *   - buildProvenanceResult() — assembles the full provenance object
 *   - GET /api/public/provenance/:claimId — 200 / 404 / 400 HTTP endpoint
 *   - get_provenance MCP tool — returns full provenance object
 *
 * All DB calls are mocked — no real DB required.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// ─── Mock DB layer ────────────────────────────────────────────────────────────
vi.mock("./db", () => ({
  getClaimById: vi.fn(),
}));

// ─── Mock drizzle/schema (for table references in the service) ────────────────
vi.mock("../drizzle/schema", () => ({
  citationEdges: { originalClaimId: "originalClaimId", hopNumber: "hopNumber" },
  graphClaimEdges: {
    sourceClaimId: "sourceClaimId",
    targetClaimId: "targetClaimId",
    relationType: "relationType",
    weight: "weight",
  },
  claims: { id: "id" },
}));

// ─── Mock drizzle-orm operators ───────────────────────────────────────────────
vi.mock("drizzle-orm", () => ({
  eq: vi.fn((col: unknown, val: unknown) => ({ col, val, op: "eq" })),
  or: vi.fn((...args: unknown[]) => ({ args, op: "or" })),
  desc: vi.fn((col: unknown) => ({ col, op: "desc" })),
  asc: vi.fn((col: unknown) => ({ col, op: "asc" })),
  inArray: vi.fn((col: unknown, vals: unknown) => ({ col, vals, op: "inArray" })),
}));

import {
  getDistortionChain,
  getSemanticNeighbours,
  buildProvenanceResult,
  registerProvenanceRoute,
  PROVENANCE_TOOLS_MANIFEST,
} from "./epistemicProvenance";
import * as db from "./db";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const MOCK_CLAIM = {
  id: 42,
  claimText: "PDB entry 1ABC has resolution 2.1 Å",
  verdict: "Supported",
  confidenceScore: 0.92,
  createdAt: new Date("2024-01-15T10:00:00Z"),
  updatedAt: new Date("2024-01-20T12:00:00Z"),
};

const MOCK_DISTORTION_HOPS = [
  {
    id: 1,
    originalClaimId: 42,
    hopNumber: 1,
    sourcePmid: "12345678",
    sourceTitle: "Original paper",
    targetPmid: "87654321",
    targetTitle: "Citing paper A",
    targetDoi: "10.1093/nar/abc001",
    distortionScore: 0.1,
    distortionType: "faithful",
    distortionRationale: "Faithful reproduction of claim",
    citingClaimText: "PDB 1ABC resolution is 2.1 Å",
    detectedAt: new Date("2024-02-01T00:00:00Z"),
    analysisStatus: "complete",
    sourceDocId: null,
    targetDocId: null,
    originalClaimText: "PDB entry 1ABC has resolution 2.1 Å",
  },
  {
    id: 2,
    originalClaimId: 42,
    hopNumber: 2,
    sourcePmid: "87654321",
    sourceTitle: "Citing paper A",
    targetPmid: "11111111",
    targetTitle: "Citing paper B",
    targetDoi: null,
    distortionScore: 0.45,
    distortionType: "amplification",
    distortionRationale: "Claim was amplified to include broader scope",
    citingClaimText: "All PDB structures have sub-2.5 Å resolution",
    detectedAt: new Date("2024-02-05T00:00:00Z"),
    analysisStatus: "complete",
    sourceDocId: null,
    targetDocId: null,
    originalClaimText: "PDB entry 1ABC has resolution 2.1 Å",
  },
];

const MOCK_NEIGHBOUR_EDGES = [
  {
    id: 10,
    sourceClaimId: 42,
    targetClaimId: 55,
    relationType: "semantic_similar",
    weight: 0.91,
    createdAt: new Date("2024-01-16T00:00:00Z"),
  },
  {
    id: 11,
    sourceClaimId: 99,
    targetClaimId: 42,
    relationType: "semantic_similar",
    weight: 0.83,
    createdAt: new Date("2024-01-17T00:00:00Z"),
  },
];

// ─── Mock getDb for service tests ─────────────────────────────────────────────
const mockSelect = vi.fn();
const mockFrom = vi.fn();
const mockWhere = vi.fn();
const mockOrderBy = vi.fn();
const mockLimit = vi.fn();

function buildMockDb(returnValue: unknown[]) {
  // getDistortionChain: .select().from().where().orderBy() — must be awaitable
  // getSemanticNeighbours: .select().from().where().orderBy().limit() — must be awaitable
  mockLimit.mockResolvedValue(returnValue);
  mockOrderBy.mockReturnValue({ limit: mockLimit, then: (resolve: (v: unknown) => unknown) => resolve(returnValue) });
  mockWhere.mockReturnValue({ orderBy: mockOrderBy, limit: mockLimit });
  mockFrom.mockReturnValue({ where: mockWhere });
  mockSelect.mockReturnValue({ from: mockFrom });
  return { select: mockSelect };
}

vi.mock("./db", async (importOriginal) => {
  const original = await importOriginal<typeof import("./db")>();
  return {
    ...original,
    getDb: vi.fn(),
    getClaimById: vi.fn(),
  };
});

// ─── getDistortionChain ───────────────────────────────────────────────────────

describe("getDistortionChain", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns empty array when DB is unavailable", async () => {
    const { getDb } = await import("./db");
    vi.mocked(getDb).mockResolvedValue(null as any);
    const result = await getDistortionChain(42);
    expect(result).toEqual([]);
  });

  it("returns ordered hops for a valid claimId", async () => {
    const { getDb } = await import("./db");
    const mockDb = buildMockDb(MOCK_DISTORTION_HOPS);
    vi.mocked(getDb).mockResolvedValue(mockDb as any);

    const result = await getDistortionChain(42);
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(2);
  });

  it("maps hop fields correctly", async () => {
    const { getDb } = await import("./db");
    const mockDb = buildMockDb(MOCK_DISTORTION_HOPS);
    vi.mocked(getDb).mockResolvedValue(mockDb as any);

    const result = await getDistortionChain(42);
    const hop1 = result[0];
    expect(hop1.hopNumber).toBe(1);
    expect(hop1.distortionType).toBe("faithful");
    expect(hop1.distortionScore).toBe(0.1);
    expect(hop1.targetPmid).toBe("87654321");
    expect(hop1.targetTitle).toBe("Citing paper A");
  });

  it("returns hops in ascending hop order", async () => {
    const { getDb } = await import("./db");
    const mockDb = buildMockDb(MOCK_DISTORTION_HOPS);
    vi.mocked(getDb).mockResolvedValue(mockDb as any);

    const result = await getDistortionChain(42);
    const hopNumbers = result.map((h) => h.hopNumber);
    for (let i = 1; i < hopNumbers.length; i++) {
      expect(hopNumbers[i]).toBeGreaterThanOrEqual(hopNumbers[i - 1]);
    }
  });

  it("returns empty array when no hops found", async () => {
    const { getDb } = await import("./db");
    const mockDb = buildMockDb([]);
    vi.mocked(getDb).mockResolvedValue(mockDb as any);

    const result = await getDistortionChain(42);
    expect(result).toEqual([]);
  });
});

// ─── getSemanticNeighbours ────────────────────────────────────────────────────

describe("getSemanticNeighbours", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns empty array when DB is unavailable", async () => {
    const { getDb } = await import("./db");
    vi.mocked(getDb).mockResolvedValue(null as any);
    const result = await getSemanticNeighbours(42, 5);
    expect(result).toEqual([]);
  });

  it("returns neighbour edges for a valid claimId", async () => {
    const { getDb } = await import("./db");
    const mockDb = buildMockDb(MOCK_NEIGHBOUR_EDGES);
    vi.mocked(getDb).mockResolvedValue(mockDb as any);

    const result = await getSemanticNeighbours(42, 10);
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(2);
  });

  it("includes both source→target and target→source edges", async () => {
    const { getDb } = await import("./db");
    const mockDb = buildMockDb(MOCK_NEIGHBOUR_EDGES);
    vi.mocked(getDb).mockResolvedValue(mockDb as any);

    const result = await getSemanticNeighbours(42, 10);
    const neighbourIds = result.map((n) => n.neighbourClaimId);
    expect(neighbourIds).toContain(55);
    expect(neighbourIds).toContain(99);
  });

  it("includes weight field on each neighbour", async () => {
    const { getDb } = await import("./db");
    const mockDb = buildMockDb(MOCK_NEIGHBOUR_EDGES);
    vi.mocked(getDb).mockResolvedValue(mockDb as any);

    const result = await getSemanticNeighbours(42, 10);
    for (const n of result) {
      expect(typeof n.weight).toBe("number");
      expect(n.weight).toBeGreaterThanOrEqual(0);
      expect(n.weight).toBeLessThanOrEqual(1);
    }
  });

  it("respects the limit parameter", async () => {
    const { getDb } = await import("./db");
    // Return only 1 edge to simulate limit=1
    const mockDb = buildMockDb([MOCK_NEIGHBOUR_EDGES[0]]);
    vi.mocked(getDb).mockResolvedValue(mockDb as any);

    const result = await getSemanticNeighbours(42, 1);
    expect(result.length).toBeLessThanOrEqual(1);
  });

  it("returns empty array when no neighbours found", async () => {
    const { getDb } = await import("./db");
    const mockDb = buildMockDb([]);
    vi.mocked(getDb).mockResolvedValue(mockDb as any);

    const result = await getSemanticNeighbours(42, 5);
    expect(result).toEqual([]);
  });
});

// ─── buildProvenanceResult ────────────────────────────────────────────────────

describe("buildProvenanceResult", () => {
  it("assembles a full provenance object", () => {
    const hops = [
      {
        hopNumber: 1,
        targetPmid: "87654321",
        targetTitle: "Citing paper A",
        targetDoi: "10.1093/nar/abc001",
        distortionScore: 0.1,
        distortionType: "faithful" as const,
        distortionRationale: "Faithful",
        citingClaimText: "PDB 1ABC resolution is 2.1 Å",
        detectedAt: new Date("2024-02-01T00:00:00Z"),
      },
    ];
    const neighbours = [
      { neighbourClaimId: 55, weight: 0.91, relationType: "semantic_similar" as const },
    ];

    const result = buildProvenanceResult(42, hops, neighbours);

    expect(result.claimId).toBe(42);
    expect(Array.isArray(result.distortionChain)).toBe(true);
    expect(result.distortionChain).toHaveLength(1);
    expect(Array.isArray(result.semanticNeighbours)).toBe(true);
    expect(result.semanticNeighbours).toHaveLength(1);
    expect(typeof result.generatedAt).toBe("string");
  });

  it("includes maxDistortionScore derived from hops", () => {
    const hops = [
      {
        hopNumber: 1,
        targetPmid: "aaa",
        targetTitle: "Paper A",
        targetDoi: null,
        distortionScore: 0.2,
        distortionType: "faithful" as const,
        distortionRationale: "",
        citingClaimText: null,
        detectedAt: new Date(),
      },
      {
        hopNumber: 2,
        targetPmid: "bbb",
        targetTitle: "Paper B",
        targetDoi: null,
        distortionScore: 0.7,
        distortionType: "amplification" as const,
        distortionRationale: "",
        citingClaimText: null,
        detectedAt: new Date(),
      },
    ];
    const result = buildProvenanceResult(42, hops, []);
    expect(result.maxDistortionScore).toBeCloseTo(0.7);
  });

  it("returns maxDistortionScore of 0 when no hops", () => {
    const result = buildProvenanceResult(42, [], []);
    expect(result.maxDistortionScore).toBe(0);
    expect(result.distortionChain).toHaveLength(0);
    expect(result.semanticNeighbours).toHaveLength(0);
  });

  it("includes hopCount field", () => {
    const hops = [
      {
        hopNumber: 1,
        targetPmid: "aaa",
        targetTitle: "Paper A",
        targetDoi: null,
        distortionScore: 0.1,
        distortionType: "faithful" as const,
        distortionRationale: "",
        citingClaimText: null,
        detectedAt: new Date(),
      },
    ];
    const result = buildProvenanceResult(42, hops, []);
    expect(result.hopCount).toBe(1);
  });
});

// ─── PROVENANCE_TOOLS_MANIFEST ────────────────────────────────────────────────

describe("PROVENANCE_TOOLS_MANIFEST", () => {
  it("exports exactly one tool descriptor", () => {
    expect(PROVENANCE_TOOLS_MANIFEST).toHaveLength(1);
  });

  it("tool name is get_provenance", () => {
    expect(PROVENANCE_TOOLS_MANIFEST[0].name).toBe("get_provenance");
  });

  it("tool has description and inputSchema", () => {
    const tool = PROVENANCE_TOOLS_MANIFEST[0];
    expect(typeof tool.description).toBe("string");
    expect(tool.description.length).toBeGreaterThan(10);
    expect(typeof tool.inputSchema).toBe("object");
  });

  it("inputSchema requires claim_id", () => {
    const schema = PROVENANCE_TOOLS_MANIFEST[0].inputSchema as unknown as {
      required: string[];
      properties: Record<string, unknown>;
    };
    expect(schema.required).toContain("claim_id");
    expect("claim_id" in schema.properties).toBe(true);
  });

  it("inputSchema has optional limit field", () => {
    const schema = PROVENANCE_TOOLS_MANIFEST[0].inputSchema as unknown as {
      properties: Record<string, unknown>;
    };
    expect("limit" in schema.properties).toBe(true);
  });
});

// ─── HTTP Route: GET /api/public/provenance/:claimId ─────────────────────────

describe("GET /api/public/provenance/:claimId", () => {
  let app: ReturnType<typeof express>;

  beforeEach(() => {
    vi.clearAllMocks();
    app = express();
    app.use(express.json());
    registerProvenanceRoute(app as any);
  });

  it("returns 400 for a non-numeric claimId", async () => {
    const res = await request(app).get("/api/public/provenance/not-a-number");
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });

  it("returns 404 when claim does not exist", async () => {
    vi.mocked(db.getClaimById).mockResolvedValueOnce(null as any);
    const { getDb } = await import("./db");
    vi.mocked(getDb).mockResolvedValue(buildMockDb([]) as any);

    const res = await request(app).get("/api/public/provenance/99999");
    expect(res.status).toBe(404);
    expect(res.body.error).toBeTruthy();
  });

  it("returns 200 with provenance shape for a valid claimId", async () => {
    vi.mocked(db.getClaimById).mockResolvedValueOnce(MOCK_CLAIM as any);
    const { getDb } = await import("./db");
    vi.mocked(getDb).mockResolvedValue(buildMockDb([]) as any);

    const res = await request(app).get("/api/public/provenance/42");
    expect(res.status).toBe(200);
    expect(typeof res.body.claim_id).toBe("number");
    expect(res.body.claim_id).toBe(42);
    expect(Array.isArray(res.body.distortion_chain)).toBe(true);
    expect(Array.isArray(res.body.semantic_neighbours)).toBe(true);
    expect(typeof res.body.generated_at).toBe("string");
  });

  it("returns CORS headers", async () => {
    vi.mocked(db.getClaimById).mockResolvedValueOnce(MOCK_CLAIM as any);
    const { getDb } = await import("./db");
    vi.mocked(getDb).mockResolvedValue(buildMockDb([]) as any);

    const res = await request(app).get("/api/public/provenance/42");
    expect(res.headers["access-control-allow-origin"]).toBe("*");
  });

  it("responds to OPTIONS preflight with 204", async () => {
    const res = await request(app).options("/api/public/provenance/42");
    expect(res.status).toBe(204);
  });

  it("returns max_distortion_score field", async () => {
    vi.mocked(db.getClaimById).mockResolvedValueOnce(MOCK_CLAIM as any);
    const { getDb } = await import("./db");
    vi.mocked(getDb).mockResolvedValue(buildMockDb([]) as any);

    const res = await request(app).get("/api/public/provenance/42");
    expect(res.status).toBe(200);
    expect(typeof res.body.max_distortion_score).toBe("number");
  });

  it("returns hop_count field", async () => {
    vi.mocked(db.getClaimById).mockResolvedValueOnce(MOCK_CLAIM as any);
    const { getDb } = await import("./db");
    vi.mocked(getDb).mockResolvedValue(buildMockDb([]) as any);

    const res = await request(app).get("/api/public/provenance/42");
    expect(res.status).toBe(200);
    expect(typeof res.body.hop_count).toBe("number");
  });
});
