import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

vi.mock("./db", () => ({ getClaimById: vi.fn() }));
vi.mock("./claimProvenanceService", () => ({
  getChain: vi.fn(),
  summarize: vi.fn(),
}));

import { getClaimById } from "./db";
import { getChain, summarize } from "./claimProvenanceService";
import { registerClaimProvenanceRoute } from "./claimProvenanceRoute";

function buildApp() {
  const app = express();
  app.use(express.json());
  registerClaimProvenanceRoute(app);
  return app;
}

const mockChain = [
  {
    id: 1,
    claimId: 42,
    documentId: 7,
    step: "extraction",
    actor: "extractionEngine",
    inputSnapshot: null,
    outputSnapshot: null,
    durationMs: 120,
    success: true,
    errorMsg: null,
    createdAt: new Date("2026-01-01T10:00:00Z"),
  },
  {
    id: 2,
    claimId: 42,
    documentId: 7,
    step: "evidence_lookup",
    actor: "pubmedAdapter",
    inputSnapshot: null,
    outputSnapshot: null,
    durationMs: 340,
    success: true,
    errorMsg: null,
    createdAt: new Date("2026-01-01T10:00:01Z"),
  },
];

const mockSummary = {
  claimId: 42,
  totalSteps: 2,
  successfulSteps: 2,
  failedSteps: 0,
  totalDurationMs: 460,
  actors: ["extractionEngine", "pubmedAdapter"],
};

describe("GET /api/v2/claims/:id/provenance", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 400 for non-numeric id", async () => {
    const res = await request(buildApp()).get("/api/v2/claims/abc/provenance");
    expect(res.status).toBe(400);
  });

  it("returns 404 when claim does not exist", async () => {
    (getClaimById as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const res = await request(buildApp()).get("/api/v2/claims/999/provenance");
    expect(res.status).toBe(404);
  });

  it("returns chain and summary", async () => {
    (getClaimById as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 42 });
    (getChain as ReturnType<typeof vi.fn>).mockResolvedValue(mockChain);
    (summarize as ReturnType<typeof vi.fn>).mockReturnValue(mockSummary);
    const res = await request(buildApp()).get("/api/v2/claims/42/provenance");
    expect(res.status).toBe(200);
    expect(res.body.data.chain).toHaveLength(2);
    expect(res.body.data.summary).toMatchObject({
      totalSteps: 2,
      successfulSteps: 2,
    });
  });

  it("chain entries have required fields", async () => {
    (getClaimById as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 42 });
    (getChain as ReturnType<typeof vi.fn>).mockResolvedValue(mockChain);
    (summarize as ReturnType<typeof vi.fn>).mockReturnValue(mockSummary);
    const res = await request(buildApp()).get("/api/v2/claims/42/provenance");
    const entry = res.body.data.chain[0];
    expect(entry).toHaveProperty("step");
    expect(entry).toHaveProperty("actor");
    expect(entry).toHaveProperty("success");
    expect(entry).toHaveProperty("durationMs");
  });

  it("returns empty chain for claim with no provenance steps", async () => {
    (getClaimById as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 42 });
    (getChain as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (summarize as ReturnType<typeof vi.fn>).mockReturnValue({
      claimId: 42,
      totalSteps: 0,
      successfulSteps: 0,
      failedSteps: 0,
      totalDurationMs: 0,
      actors: [],
    });
    const res = await request(buildApp()).get("/api/v2/claims/42/provenance");
    expect(res.status).toBe(200);
    expect(res.body.data.chain).toHaveLength(0);
    expect(res.body.data.summary.totalSteps).toBe(0);
  });
});
