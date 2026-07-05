import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";
import { registerPublicV1ClaimRoute } from "../server/publicV1ClaimRoute";
import * as db from "../server/db";
import { ENV } from "../server/_core/env";

vi.mock("../server/db");

describe("GET /api/v1/claim/:id", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.resetAllMocks();
    ENV.citationApiKey = "test-api-key";
    app = express();
    app.use(express.json());
    registerPublicV1ClaimRoute(app);
  });

  it("should return 503 if API key is not configured", async () => {
    ENV.citationApiKey = "";
    const res = await request(app).get("/api/v1/claim/123");
    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/API key not configured/);
  });

  it("should return 401 if Authorization header is missing", async () => {
    const res = await request(app).get("/api/v1/claim/123");
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/Missing or invalid/);
  });

  it("should return 403 if token is invalid", async () => {
    const res = await request(app)
      .get("/api/v1/claim/123")
      .set("Authorization", "Bearer wrong-key");
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("Invalid API key");
  });

  it("should return 400 if claim ID is not a number", async () => {
    const res = await request(app)
      .get("/api/v1/claim/abc")
      .set("Authorization", "Bearer test-api-key");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Invalid claim ID/);
  });

  it("should return 404 if claim does not exist", async () => {
    vi.mocked(db.getClaimWithDocument).mockResolvedValue(null);
    const res = await request(app)
      .get("/api/v1/claim/999")
      .set("Authorization", "Bearer test-api-key");
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Claim not found");
  });

  it("should return 200 with claim data when found", async () => {
    const mockClaim = {
      id: 123,
      documentId: 456,
      claimText: "Aspirin reduces cardiovascular risk",
      claimType: "pharmacology",
      verdict: "Supported",
      confidenceScore: 0.95,
      verdictRationale: "Multiple RCTs support this",
      proteinName: "COX-1",
      createdAt: new Date("2026-01-01T00:00:00Z"),
      updatedAt: new Date("2026-01-02T00:00:00Z"),
      pdbEvidenceCheckedAt: new Date("2026-01-03T00:00:00Z"),
      sourceRefs: '[{"pmid":"12345","doi":"10.1001/12345"}]',
    };

    const mockDocument = {
      id: 456,
      title: "Test Document",
    };

    const mockCitations = [
      {
        id: 789,
        claimId: 123,
        citationType: "supporting",
        passageText: "Aspirin was shown to reduce risk by 20%.",
        citationConfidence: 0.9,
        createdAt: new Date("2026-01-02T00:00:00Z"),
      },
    ];

    vi.mocked(db.getClaimWithDocument).mockResolvedValue({
      claim: mockClaim as any,
      document: mockDocument as any,
    });
    vi.mocked(db.getCitationsByClaimId).mockResolvedValue(mockCitations as any);

    const res = await request(app)
      .get("/api/v1/claim/123")
      .set("Authorization", "Bearer test-api-key");

    expect(res.status).toBe(200);
    expect(res.body.id).toBe("123");
    expect(res.body.claim).toBe("Aspirin reduces cardiovascular risk");
    expect(res.body.domain).toBe("pharmacology");
    expect(res.body.verdict.status).toBe("Supported");
    expect(res.body.verdict.confidenceScore).toBe(0.95);
    expect(res.body.entities.proteinName).toBe("COX-1");
    expect(res.body.evidence.sourceDocumentId).toBe("456");
    expect(res.body.evidence.sourceRefs).toHaveLength(1);
    expect(res.body.evidence.sourceRefs[0].pmid).toBe("12345");
    expect(res.body.evidence.citations).toHaveLength(1);
    expect(res.body.evidence.citations[0].passageText).toBe(
      "Aspirin was shown to reduce risk by 20%."
    );
    expect(res.body.timestamps.verifiedAt).toBe("2026-01-03T00:00:00.000Z");
  });
});
