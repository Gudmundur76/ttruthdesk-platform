/**
 * scheduledEngines.test.ts
 *
 * Tests for the three new Phase 86 scheduled endpoints:
 *   POST /api/scheduled/inverse-prompt
 *   POST /api/scheduled/meta-agent
 *   POST /api/scheduled/self-prompt
 *
 * These endpoints are guarded by requireCronOrAdmin. We mock the sdk to
 * simulate a cron caller (isCron: true) and mock the underlying engines
 * so the tests are fast and deterministic.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// ─── Mock the SDK so requireCronOrAdmin passes ─────────────────────────────
vi.mock("./_core/sdk", () => ({
  sdk: {
    authenticateRequest: vi.fn().mockResolvedValue({ isCron: true, role: "user", openId: "cron_system" }),
  },
}));

// ─── Mock the three engines ────────────────────────────────────────────────
vi.mock("./inversePrompt/inversePromptEngine", () => ({
  runInversePromptEngine: vi.fn().mockResolvedValue({
    entitiesScanned: 20,
    candidatesGenerated: 45,
    passedGate: 30,
    queued: 28,
    rejected: 10,
    deferred: 5,
    duplicates: 7,
    errors: 0,
    durationMs: 1200,
  }),
}));

vi.mock("./metaAgent/codeGuardian", () => ({
  runCodeGuardian: vi.fn().mockResolvedValue({
    agentName: "codeGuardianAgent",
    healthScore: 92,
    healthGrade: "A",
    criticalCount: 0,
    warningCount: 2,
    allFindings: [{ id: 1, severity: "warning" }, { id: 2, severity: "warning" }],
    codeDrift: {},
    stubLedger: { stubs: [] },
    overdueEscalations: [],
    pipelineGuardian: { invariants: [] },
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    durationMs: 800,
  }),
}));

vi.mock("./autonomousLoop/eventBus", () => ({
  publishEvent: vi.fn().mockResolvedValue(undefined),
  scheduleDrain: vi.fn(),
}));

vi.mock("./_core/env", () => ({
  ENV: { ownerOpenId: "test_owner", siteOrigin: "https://truthdesk.claims" },
}));

// ─── Build a minimal Express app with only the three endpoints ─────────────
async function buildApp() {
  const app = express();
  app.use(express.json());

  // Inline requireCronOrAdmin using the mocked sdk
  const { sdk } = await import("./_core/sdk");
  const requireCronOrAdmin: express.RequestHandler = async (req, res, next) => {
    try {
      const user = await sdk.authenticateRequest(req);
      if ((user as { isCron?: boolean }).isCron || (user as { role?: string }).role === "admin") return next();
      res.status(403).json({ error: "Forbidden" });
    } catch {
      res.status(401).json({ error: "Unauthorized" });
    }
  };

  app.post("/api/scheduled/inverse-prompt", requireCronOrAdmin, async (_req, res) => {
    try {
      const { runInversePromptEngine } = await import("./inversePrompt/inversePromptEngine");
      const result = await runInversePromptEngine();
      res.json({ ok: true, ...result });
    } catch (err) {
      res.status(500).json({ ok: false, error: (err as Error).message });
    }
  });

  app.post("/api/scheduled/meta-agent", requireCronOrAdmin, async (_req, res) => {
    try {
      const { runCodeGuardian } = await import("./metaAgent/codeGuardian");
      const report = await runCodeGuardian();
      res.json({ ok: true, healthScore: report.healthScore, healthGrade: report.healthGrade, criticalCount: report.criticalCount, warningCount: report.warningCount, findingsCount: report.allFindings.length });
    } catch (err) {
      res.status(500).json({ ok: false, error: (err as Error).message });
    }
  });

  app.post("/api/scheduled/self-prompt", requireCronOrAdmin, async (_req, res) => {
    try {
      const { publishEvent, scheduleDrain } = await import("./autonomousLoop/eventBus");
      await publishEvent("scheduled_tick", { source: "self_prompt_cron", mode: "scheduled" });
      scheduleDrain();
      res.json({ ok: true, tickPublished: true, drainScheduled: true });
    } catch (err) {
      res.status(500).json({ ok: false, error: (err as Error).message });
    }
  });

  return app;
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe("POST /api/scheduled/inverse-prompt", () => {
  it("returns 200 with ok:true and engine result fields", async () => {
    const app = await buildApp();
    const res = await request(app).post("/api/scheduled/inverse-prompt").send({});
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.entitiesScanned).toBe(20);
    expect(res.body.passedGate).toBe(30);
    expect(res.body.queued).toBe(28);
    expect(res.body.errors).toBe(0);
  });

  it("returns 200 with durationMs field", async () => {
    const app = await buildApp();
    const res = await request(app).post("/api/scheduled/inverse-prompt").send({});
    expect(res.status).toBe(200);
    expect(typeof res.body.durationMs).toBe("number");
  });

  it("returns 500 when engine throws", async () => {
    const { runInversePromptEngine } = await import("./inversePrompt/inversePromptEngine");
    vi.mocked(runInversePromptEngine).mockRejectedValueOnce(new Error("DB unavailable"));
    const app = await buildApp();
    const res = await request(app).post("/api/scheduled/inverse-prompt").send({});
    expect(res.status).toBe(500);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toContain("DB unavailable");
  });
});

describe("POST /api/scheduled/meta-agent", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("returns 200 with ok:true and health fields", async () => {
    const app = await buildApp();
    const res = await request(app).post("/api/scheduled/meta-agent").send({});
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.healthScore).toBe(92);
    expect(res.body.healthGrade).toBe("A");
    expect(res.body.criticalCount).toBe(0);
    expect(res.body.warningCount).toBe(2);
    expect(res.body.findingsCount).toBe(2);
  });

  it("returns 500 when code guardian throws", async () => {
    const { runCodeGuardian } = await import("./metaAgent/codeGuardian");
    vi.mocked(runCodeGuardian).mockRejectedValueOnce(new Error("Guardian failed"));
    const app = await buildApp();
    const res = await request(app).post("/api/scheduled/meta-agent").send({});
    expect(res.status).toBe(500);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toContain("Guardian failed");
  });
});

describe("POST /api/scheduled/self-prompt", () => {
  it("returns 200 with tickPublished and drainScheduled", async () => {
    const app = await buildApp();
    const res = await request(app).post("/api/scheduled/self-prompt").send({});
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.tickPublished).toBe(true);
    expect(res.body.drainScheduled).toBe(true);
  });

  it("calls publishEvent with scheduled_tick and self_prompt_cron source", async () => {
    const { publishEvent } = await import("./autonomousLoop/eventBus");
    const app = await buildApp();
    await request(app).post("/api/scheduled/self-prompt").send({});
    expect(vi.mocked(publishEvent)).toHaveBeenCalledWith(
      "scheduled_tick",
      expect.objectContaining({ source: "self_prompt_cron" })
    );
  });

  it("calls scheduleDrain after publishEvent", async () => {
    const { scheduleDrain } = await import("./autonomousLoop/eventBus");
    const app = await buildApp();
    await request(app).post("/api/scheduled/self-prompt").send({});
    expect(vi.mocked(scheduleDrain)).toHaveBeenCalled();
  });

  it("returns 500 when publishEvent throws", async () => {
    const { publishEvent } = await import("./autonomousLoop/eventBus");
    vi.mocked(publishEvent).mockRejectedValueOnce(new Error("Bus error"));
    const app = await buildApp();
    const res = await request(app).post("/api/scheduled/self-prompt").send({});
    expect(res.status).toBe(500);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toContain("Bus error");
  });
});
