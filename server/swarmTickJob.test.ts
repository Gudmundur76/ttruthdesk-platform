/**
 * swarmTickJob.test.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Unit tests for the Swarm Tick Job.
 * Tests: runSwarmTick() result shape, swarmTickHandler() HTTP responses.
 *
 * Agent functions are private — we mock their dependencies:
 *   - pmcFeedJobHandler (harvester)
 *   - qualityPassJobHandler (quality auditor)
 *   - compileDocumentToWiki (wiki compiler)
 *   - getDb (wiki compiler, monitoring scanner, backfill predictor)
 *   - predictionBackfillHandler (backfill predictor, dynamic import)
 *   - monitoringJobHandler (monitoring scanner, dynamic import)
 *   - runCodeGuardian (code guardian, dynamic import)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response } from "express";

// ─── Hoisted mocks ────────────────────────────────────────────────────────────
const { mockGetDb, mockPmcFeedJobHandler, mockQualityPassJobHandler, mockCompileDocumentToWiki } =
  vi.hoisted(() => ({
    mockGetDb: vi.fn(),
    mockPmcFeedJobHandler: vi.fn(),
    mockQualityPassJobHandler: vi.fn(),
    mockCompileDocumentToWiki: vi.fn(),
  }));

vi.mock("./db", () => ({ getDb: mockGetDb }));
vi.mock("./pmcFeedJob", () => ({ pmcFeedJobHandler: mockPmcFeedJobHandler }));
vi.mock("./qualityPassJob", () => ({ qualityPassJobHandler: mockQualityPassJobHandler }));
vi.mock("./wikiCompiler", () => ({ compileDocumentToWiki: mockCompileDocumentToWiki }));

// Dynamic imports used by backfill, monitoring, and codeGuardian agents
vi.mock("./predictionBackfillJob", () => ({
  predictionBackfillHandler: vi.fn().mockImplementation((_req, res) => {
    res.json({ processed: 0 });
  }),
}));
vi.mock("./monitoringJob", () => ({
  monitoringJobHandler: vi.fn().mockImplementation((_req, res) => {
    res.json({ scanned: 0 });
  }),
}));
vi.mock("./metaAgent/codeGuardian", () => ({
  runCodeGuardian: vi.fn().mockResolvedValue({
    healthScore: 95,
    healthGrade: "A",
    criticalCount: 0,
    warningCount: 2,
    stubLedger: { overdue: 0 },
  }),
}));

import { runSwarmTick, swarmTickHandler } from "./swarmTickJob";

// ─── Default setup ────────────────────────────────────────────────────────────
function setupDefaults() {
  // Harvester: pmcFeedJobHandler resolves with json response
  mockPmcFeedJobHandler.mockImplementation((_req: Request, res: Response) => {
    (res as unknown as { json: (d: unknown) => void }).json({ processed: 3 });
  });
  // Quality auditor: qualityPassJobHandler resolves
  mockQualityPassJobHandler.mockImplementation((_req: Request, res: Response) => {
    (res as unknown as { json: (d: unknown) => void }).json({ upgraded: 1 });
  });
  // Wiki compiler: DB returns no pending docs
  const chain = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([]),
  };
  const db = { select: vi.fn().mockReturnValue(chain) };
  mockGetDb.mockResolvedValue(db);
  // compileDocumentToWiki not called (no docs)
  mockCompileDocumentToWiki.mockResolvedValue(undefined);
}

// ─── runSwarmTick ─────────────────────────────────────────────────────────────
describe("swarmTickJob — runSwarmTick()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaults();
  });

  it("returns a SwarmTickResult with all required fields", async () => {
    const result = await runSwarmTick();

    expect(typeof result.startedAt).toBe("string");
    expect(typeof result.completedAt).toBe("string");
    expect(typeof result.durationMs).toBe("number");
    expect(Array.isArray(result.agents)).toBe(true);
    expect(typeof result.summary).toBe("object");
  });

  it("summary.total equals number of agents (6)", async () => {
    const result = await runSwarmTick();

    expect(result.summary.total).toBe(6);
  });

  it("agents array has 6 entries", async () => {
    const result = await runSwarmTick();

    expect(result.agents).toHaveLength(6);
  });

  it("durationMs is a non-negative number", async () => {
    const result = await runSwarmTick();

    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("startedAt and completedAt are valid ISO strings", async () => {
    const result = await runSwarmTick();

    expect(() => new Date(result.startedAt)).not.toThrow();
    expect(() => new Date(result.completedAt)).not.toThrow();
    expect(new Date(result.startedAt).getTime()).toBeLessThanOrEqual(
      new Date(result.completedAt).getTime()
    );
  });

  it("summary counts ok/error/skip correctly", async () => {
    const result = await runSwarmTick();

    expect(result.summary.ok + result.summary.error + result.summary.skip).toBe(
      result.summary.total
    );
  });

  it("each agent result has agent, status, and detail fields", async () => {
    const result = await runSwarmTick();

    for (const agent of result.agents) {
      expect(typeof agent.agent).toBe("string");
      expect(typeof agent.status).toBe("string");
      expect(typeof agent.detail).toBe("string");
    }
  });

  it("harvester agent returns ok when pmcFeedJobHandler succeeds", async () => {
    const result = await runSwarmTick();

    const harvester = result.agents.find((a) => a.agent === "harvester");
    expect(harvester?.status).toBe("ok");
  });
});

// ─── swarmTickHandler ─────────────────────────────────────────────────────────
describe("swarmTickJob — swarmTickHandler()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaults();
  });

  function makeRes() {
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    } as unknown as Response;
    return res;
  }

  it("responds with json result on success (no explicit status call)", async () => {
    const req = {} as Request;
    const res = makeRes();

    await swarmTickHandler(req, res);

    // Handler calls res.json() directly on success (no res.status(200))
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        summary: expect.objectContaining({ total: 6 }),
      })
    );
  });

  it("response includes agents array", async () => {
    const req = {} as Request;
    const res = makeRes();

    await swarmTickHandler(req, res);

    const jsonArg = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(Array.isArray(jsonArg.agents)).toBe(true);
    expect(jsonArg.agents).toHaveLength(6);
  });
});
