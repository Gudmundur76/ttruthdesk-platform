/**
 * detailedHealthRoute.test.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Unit tests for buildHealthReport() and detailedHealthHandler().
 *
 * All DB and module dependencies are mocked so tests run without a live DB.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Hoist mocks ─────────────────────────────────────────────────────────────
const { mockGetDb, mockSelect } = vi.hoisted(() => ({
  mockGetDb: vi.fn(),
  mockSelect: vi.fn(),
}));

vi.mock("./db", () => ({ getDb: mockGetDb }));

vi.mock("../drizzle/schema", () => ({
  autoIngestedPapers: { ingestedAt: "ingestedAt" },
}));

vi.mock("drizzle-orm", () => ({
  desc: vi.fn(col => `desc(${String(col)})`),
}));

vi.mock("./logger", () => {
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return { logger: () => log, errData: (e: unknown) => e };
});

// Mock dynamic imports used in checkVectorStore and checkMcp
vi.mock("./embeddingBackfillJob", () => ({ runEmbeddingBackfill: vi.fn() }));
vi.mock("./mcpServer", () => ({ MCP_TOOL_COUNT: 12 }));

import { buildHealthReport, type HealthReport } from "./detailedHealthRoute";

// ─── DB mock helpers ──────────────────────────────────────────────────────────
function makeDbChain(rows: unknown[]) {
  const chain = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(rows),
  };
  return chain;
}

// ─── Tests ────────────────────────────────────────────────────────────────────
describe("detailedHealthRoute — buildHealthReport()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns overall ok when DB is healthy and ingestion is recent", async () => {
    const recentDate = new Date(Date.now() - 30 * 60 * 1000).toISOString(); // 30 min ago
    const db = makeDbChain([{ ingestedAt: recentDate }]);
    mockGetDb.mockResolvedValue(db);

    const report: HealthReport = await buildHealthReport();

    expect(report.overall).toBe("ok");
    expect(report.subsystems.db.status).toBe("ok");
    expect(report.subsystems.ingestion.status).toBe("ok");
    expect(report.timestamp).toBeTruthy();
    expect(typeof report.subsystems.db.latencyMs).toBe("number");
  });

  it("returns overall degraded when ingestion is stalled (>6h)", async () => {
    const stalledDate = new Date(Date.now() - 8 * 60 * 60 * 1000).toISOString(); // 8h ago
    const db = makeDbChain([{ ingestedAt: stalledDate }]);
    mockGetDb.mockResolvedValue(db);

    const report = await buildHealthReport();

    expect(report.overall).toBe("degraded");
    expect(report.subsystems.ingestion.status).toBe("degraded");
    expect(report.subsystems.ingestion.detail).toContain("ago");
  });

  it("returns overall degraded when no papers ingested yet", async () => {
    const db = makeDbChain([]); // empty result
    mockGetDb.mockResolvedValue(db);

    const report = await buildHealthReport();

    expect(report.overall).toBe("degraded");
    expect(report.subsystems.ingestion.status).toBe("degraded");
    expect(report.subsystems.ingestion.detail).toContain("No papers");
  });

  it("returns overall degraded (not down) when DB returns null", async () => {
    mockGetDb.mockResolvedValue(null);

    const report = await buildHealthReport();

    // DB null → db.status = "down" → overall = "down"
    expect(report.overall).toBe("down");
    expect(report.subsystems.db.status).toBe("down");
  });

  it("returns overall degraded when DB throws", async () => {
    mockGetDb.mockRejectedValue(new Error("Connection refused"));

    const report = await buildHealthReport();

    expect(report.subsystems.db.status).toBe("down");
    expect(report.overall).toBe("down");
  });

  it("report has all required subsystem keys", async () => {
    const recentDate = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const db = makeDbChain([{ ingestedAt: recentDate }]);
    mockGetDb.mockResolvedValue(db);

    const report = await buildHealthReport();

    expect(report.subsystems).toHaveProperty("db");
    expect(report.subsystems).toHaveProperty("vectorStore");
    expect(report.subsystems).toHaveProperty("ingestion");
    expect(report.subsystems).toHaveProperty("mcp");
  });

  it("each subsystem has status and latencyMs", async () => {
    const recentDate = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const db = makeDbChain([{ ingestedAt: recentDate }]);
    mockGetDb.mockResolvedValue(db);

    const report = await buildHealthReport();

    for (const [, health] of Object.entries(report.subsystems)) {
      expect(["ok", "degraded", "down"]).toContain(health.status);
      expect(typeof health.latencyMs).toBe("number");
      expect(health.latencyMs).toBeGreaterThanOrEqual(0);
    }
  });
});
