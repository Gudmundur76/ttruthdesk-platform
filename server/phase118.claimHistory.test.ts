import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// ── mock db ──────────────────────────────────────────────────────────────────
vi.mock("./db", () => ({
  getDb: vi.fn(),
  getClaimById: vi.fn(),
}));

import { getDb, getClaimById } from "./db";

// ── mock schema ───────────────────────────────────────────────────────────────
vi.mock("../drizzle/schema", () => ({
  claimScoreHistory: { id: "id", claimId: "claimId", snapshotAt: "snapshotAt" },
  confidenceHistory: { id: "id", claimId: "claimId", recordedAt: "recordedAt" },
  claims: { id: "id" },
}));

// ── import the router factory (will be created) ───────────────────────────────
import { registerClaimHistoryRoute } from "./claimHistoryRoute";

function buildApp() {
  const app = express();
  app.use(express.json());
  registerClaimHistoryRoute(app);
  return app;
}

const mockScoreRows = [
  {
    id: 1,
    claimId: 42,
    compositeTruthScore: 0.72,
    compositeTruthLabel: "Partially Supported",
    triggerSource: "initial",
    snapshotAt: new Date("2026-01-01T10:00:00Z"),
  },
  {
    id: 2,
    claimId: 42,
    compositeTruthScore: 0.85,
    compositeTruthLabel: "Supported",
    triggerSource: "re-evaluation",
    snapshotAt: new Date("2026-01-15T10:00:00Z"),
  },
];

const mockConfidenceRows = [
  {
    id: 1,
    claimId: 42,
    documentId: 7,
    score: 0.65,
    trigger: "initial",
    flags: null,
    recordedAt: new Date("2026-01-01T09:00:00Z"),
  },
  {
    id: 2,
    claimId: 42,
    documentId: 7,
    score: 0.8,
    trigger: "quality_pass",
    flags: ["oc_enriched"],
    recordedAt: new Date("2026-01-10T09:00:00Z"),
  },
];

function mockDbChain(rows: unknown[]) {
  const chain = { from: vi.fn(), where: vi.fn(), orderBy: vi.fn() };
  chain.from.mockReturnValue(chain);
  chain.where.mockReturnValue(chain);
  chain.orderBy.mockResolvedValue(rows);
  return { select: vi.fn().mockReturnValue(chain) };
}

describe("GET /api/v2/claims/:id/history", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 for non-numeric id", async () => {
    (getClaimById as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 1 });
    const res = await request(buildApp()).get("/api/v2/claims/abc/history");
    expect(res.status).toBe(400);
  });

  it("returns 404 when claim does not exist", async () => {
    (getClaimById as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (getDb as ReturnType<typeof vi.fn>).mockReturnValue(mockDbChain([]));
    const res = await request(buildApp()).get("/api/v2/claims/999/history");
    expect(res.status).toBe(404);
  });

  it("returns scoreHistory and confidenceHistory arrays", async () => {
    (getClaimById as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 42 });
    const db1 = mockDbChain(mockScoreRows);
    const db2 = mockDbChain(mockConfidenceRows);
    let callCount = 0;
    (getDb as ReturnType<typeof vi.fn>).mockImplementation(() => {
      callCount++;
      return callCount === 1 ? db1 : db2;
    });
    const res = await request(buildApp()).get("/api/v2/claims/42/history");
    expect(res.status).toBe(200);
    expect(res.body.data.scoreHistory).toHaveLength(2);
    expect(res.body.data.confidenceHistory).toHaveLength(2);
  });

  it("scoreHistory entries have required fields", async () => {
    (getClaimById as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 42 });
    const db1 = mockDbChain(mockScoreRows);
    const db2 = mockDbChain(mockConfidenceRows);
    let callCount = 0;
    (getDb as ReturnType<typeof vi.fn>).mockImplementation(() => {
      callCount++;
      return callCount === 1 ? db1 : db2;
    });
    const res = await request(buildApp()).get("/api/v2/claims/42/history");
    const entry = res.body.data.scoreHistory[0];
    expect(entry).toHaveProperty("compositeTruthScore");
    expect(entry).toHaveProperty("compositeTruthLabel");
    expect(entry).toHaveProperty("triggerSource");
    expect(entry).toHaveProperty("snapshotAt");
  });

  it("confidenceHistory entries have required fields", async () => {
    (getClaimById as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 42 });
    const db1 = mockDbChain(mockScoreRows);
    const db2 = mockDbChain(mockConfidenceRows);
    let callCount = 0;
    (getDb as ReturnType<typeof vi.fn>).mockImplementation(() => {
      callCount++;
      return callCount === 1 ? db1 : db2;
    });
    const res = await request(buildApp()).get("/api/v2/claims/42/history");
    const entry = res.body.data.confidenceHistory[0];
    expect(entry).toHaveProperty("score");
    expect(entry).toHaveProperty("trigger");
    expect(entry).toHaveProperty("recordedAt");
  });
});
