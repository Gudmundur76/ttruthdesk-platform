import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { registerSubmitClaimRoute } from "./submitClaimRoute";

vi.mock("./db", () => ({
  createDocument: vi.fn().mockResolvedValue(9999),
  getUserByOpenId: vi.fn().mockResolvedValue({ id: 1 }),
  getDb: vi.fn().mockResolvedValue({
    insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) }),
    update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }) }),
  }),
}));
vi.mock("./analysisPipeline", () => ({ runAnalysisPipeline: vi.fn().mockResolvedValue(undefined) }));
vi.mock("./_core/env", () => ({ ENV: { ownerOpenId: "test_owner", siteOrigin: "https://truthdesk.claims" } }));
vi.mock("./autonomousLoop/eventBus", () => ({ publishEvent: vi.fn().mockResolvedValue(undefined) }));

function buildApp() {
  const app = express();
  app.use(express.json());
  registerSubmitClaimRoute(app);
  return app;
}

describe("POST /api/public/submit-claim", () => {
  it("returns 202 with documentId and statusUrl for a valid claim", async () => {
    const app = buildApp();
    const res = await request(app).post("/api/public/submit-claim").send({ claim_text: "Piscirickettsia salmonis is an intracellular bacterium responsible for SRS in Atlantic salmon." });
    expect(res.status).toBe(202);
    expect(res.body.ok).toBe(true);
    expect(res.body.documentId).toBe(9999);
    expect(res.body.statusUrl).toContain("/api/public/submit-claim/status/9999");
    expect(res.body.claimPageUrl).toContain("/claim/9999");
  });

  it("returns 400 when claim_text is missing", async () => {
    const app = buildApp();
    const res = await request(app).post("/api/public/submit-claim").send({});
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });

  it("returns 400 when claim_text is too short", async () => {
    const app = buildApp();
    const res = await request(app).post("/api/public/submit-claim").send({ claim_text: "Too short" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/20 characters/);
  });

  it("returns 400 when claim_text exceeds 2000 characters", async () => {
    const app = buildApp();
    const res = await request(app).post("/api/public/submit-claim").send({ claim_text: "A".repeat(2001) });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/2000 characters/);
  });

  it("accepts custom vertical_domain and source", async () => {
    const app = buildApp();
    const res = await request(app).post("/api/public/submit-claim").send({ claim_text: "Piscirickettsia salmonis is an intracellular bacterium responsible for SRS in Atlantic salmon.", vertical_domain: "salmon_biotech", source: "lovable" });
    expect(res.status).toBe(202);
    expect(res.body.ok).toBe(true);
  });
});

describe("GET /api/public/submit-claim/status/:id", () => {
  it("returns 400 for invalid document ID", async () => {
    const app = buildApp();
    const res = await request(app).get("/api/public/submit-claim/status/abc");
    expect(res.status).toBe(400);
  });
});
