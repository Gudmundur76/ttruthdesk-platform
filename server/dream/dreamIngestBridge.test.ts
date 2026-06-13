/**
 * dreamIngestBridge.test.ts — Phase 127
 * ─────────────────────────────────────────────────────────────────────────────
 * Tests for:
 *   1. dreamIngestBridge — picks up dream-originated generated_claims and
 *      enqueues them to coordQueue for evidence pursuit
 *   2. POST /api/v2/dream/start guardrails:
 *      - Rate limit: 1 session per 6h
 *      - Confidence threshold: system health ≥ 40
 *      - Kill switch: DREAM_DISABLED env flag
 *      - Audit log: dreamSessions.manualTrigger = true
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import {
  bridgeDreamClaimsToIngest,
  getDreamIngestStats,
} from "./dreamIngestBridge";
import { createDreamStartRouter } from "./dreamStartRoute";

// ─── Mocks ────────────────────────────────────────────────────────────────────
vi.mock("../db", () => ({ getDb: vi.fn() }));
vi.mock("./dreamEngine", () => ({
  checkDreamEligibility: vi.fn(),
  runDreamSession: vi.fn(),
}));

import { getDb } from "../db";
import { checkDreamEligibility, runDreamSession } from "./dreamEngine";

const mockGetDb = vi.mocked(getDb);
const mockCheckEligibility = vi.mocked(checkDreamEligibility);
const mockRunDreamSession = vi.mocked(runDreamSession);

const mockDb = {
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
};

function makeSelectChain(rows: unknown[]) {
  return {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(rows),
  };
}

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use("/dream", createDreamStartRouter());
  return app;
}

// ─── dreamIngestBridge ────────────────────────────────────────────────────────
describe("bridgeDreamClaimsToIngest", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockGetDb.mockResolvedValue(mockDb as never);
  });

  it("returns zero counts when no pending dream claims exist", async () => {
    mockDb.select.mockReturnValue(makeSelectChain([]));

    const result = await bridgeDreamClaimsToIngest();

    expect(result.processed).toBe(0);
    expect(result.queued).toBe(0);
    expect(result.skipped).toBe(0);
  });

  it("enqueues a pending dream claim to coordQueue", async () => {
    const claim = {
      id: 1,
      claimText: "BRCA1 is homologous to RAD51",
      claimType: "general_molecular",
      inferenceType: "homology_projection",
      requiredSources: ["rcsb_pdb"],
      sourceQuery: "BRCA1 RAD51 homology",
      passedGate: true,
      status: "pending",
      priority: 50,
    };
    mockDb.select.mockReturnValue(makeSelectChain([claim]));
    const insertChain = { values: vi.fn().mockResolvedValue([{ insertId: 42 }]) };
    mockDb.insert.mockReturnValue(insertChain);
    const updateChain = { set: vi.fn().mockReturnThis(), where: vi.fn().mockResolvedValue(undefined) };
    mockDb.update.mockReturnValue(updateChain);

    const result = await bridgeDreamClaimsToIngest();

    expect(result.processed).toBe(1);
    expect(result.queued).toBe(1);
    expect(result.skipped).toBe(0);
    expect(mockDb.insert).toHaveBeenCalled();
    expect(mockDb.update).toHaveBeenCalled();
  });

  it("skips claims that did not pass the verifiability gate", async () => {
    const claim = {
      id: 2,
      claimText: "Protein X is homologous to Protein Y",
      claimType: "general_molecular",
      inferenceType: "homology_projection",
      requiredSources: [],
      sourceQuery: null,
      passedGate: false,
      status: "pending",
      priority: 50,
    };
    mockDb.select.mockReturnValue(makeSelectChain([claim]));

    const result = await bridgeDreamClaimsToIngest();

    expect(result.processed).toBe(1);
    expect(result.queued).toBe(0);
    expect(result.skipped).toBe(1);
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it("returns stats with bridgedAt timestamp", async () => {
    mockDb.select.mockReturnValue(makeSelectChain([]));

    const result = await bridgeDreamClaimsToIngest();

    expect(result.bridgedAt).toBeInstanceOf(Date);
  });

  it("handles DB unavailable gracefully", async () => {
    mockGetDb.mockResolvedValue(null as never);

    const result = await bridgeDreamClaimsToIngest();

    expect(result.processed).toBe(0);
    expect(result.error).toMatch(/database/i);
  });
});

describe("getDreamIngestStats", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockGetDb.mockResolvedValue(mockDb as never);
  });

  it("returns pending and queued counts", async () => {
    // getDreamIngestStats awaits at .where() (no .limit() call)
    function makeWhereChain(rows: unknown[]) {
      return {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue(rows),
        limit: vi.fn().mockResolvedValue(rows),
      };
    }
    mockDb.select
      .mockReturnValueOnce(makeWhereChain(new Array(5).fill({ id: 1 })))
      .mockReturnValueOnce(makeWhereChain(new Array(12).fill({ id: 2 })));

    const stats = await getDreamIngestStats();

    expect(stats.pendingDreamClaims).toBe(5);
    expect(stats.queuedDreamClaims).toBe(12);
  });
});

// ─── POST /api/v2/dream/start ─────────────────────────────────────────────────
describe("POST /dream/start — guardrails", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockGetDb.mockResolvedValue(mockDb as never);
    delete process.env.DREAM_DISABLED;
  });

  it("returns 503 when DREAM_DISABLED env flag is set", async () => {
    process.env.DREAM_DISABLED = "true";
    const app = makeApp();
    const res = await request(app).post("/dream/start").send({});
    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/disabled/i);
  });

  it("returns 429 when system is not eligible (rate limit)", async () => {
    mockCheckEligibility.mockResolvedValue({
      eligible: false,
      reason: "Last session ended 2 hours ago (cooldown: 6h)",
    });

    const app = makeApp();
    const res = await request(app).post("/dream/start").send({ healthScore: 80 });
    expect(res.status).toBe(429);
    expect(res.body.error).toMatch(/cooldown/i);
  });

  it("returns 422 when health score is below threshold", async () => {
    mockCheckEligibility.mockResolvedValue({
      eligible: false,
      reason: "Health score 25 below minimum 40",
    });

    const app = makeApp();
    const res = await request(app).post("/dream/start").send({ healthScore: 25 });
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/health/i);
  });

  it("returns 200 with session result when eligible", async () => {
    mockCheckEligibility.mockResolvedValue({
      eligible: true,
      reason: "System is ready",
    });
    mockRunDreamSession.mockResolvedValue({
      sessionId: 42,
      durationMs: 1200,
      cyclesCompleted: 5,
      reasonForWaking: "max_cycles",
      patternsFound: 3,
      hypothesesGenerated: 2,
      graphOptimizations: 8,
      confidenceRecalibrations: 15,
      simulatedScenarios: 4,
    });

    const app = makeApp();
    const res = await request(app).post("/dream/start").send({ healthScore: 80 });
    expect(res.status).toBe(200);
    expect(res.body.sessionId).toBe(42);
    expect(res.body.cyclesCompleted).toBe(5);
  });

  it("returns 500 when runDreamSession throws", async () => {
    mockCheckEligibility.mockResolvedValue({
      eligible: true,
      reason: "System is ready",
    });
    mockRunDreamSession.mockRejectedValue(new Error("DB write failed"));

    const app = makeApp();
    const res = await request(app).post("/dream/start").send({ healthScore: 80 });
    expect(res.status).toBe(500);
  });

  it("returns 503 when runDreamSession returns null (DB unavailable)", async () => {
    mockCheckEligibility.mockResolvedValue({
      eligible: true,
      reason: "System is ready",
    });
    mockRunDreamSession.mockResolvedValue(null);

    const app = makeApp();
    const res = await request(app).post("/dream/start").send({ healthScore: 80 });
    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/unavailable/i);
  });
});
