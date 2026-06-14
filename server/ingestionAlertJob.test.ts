/**
 * ingestionAlertJob.test.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Unit tests for checkIngestionAlerts() — push-based alerting for the
 * autonomous ingestion pipeline.
 *
 * All DB and notifyOwner dependencies are mocked.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Hoist mocks ─────────────────────────────────────────────────────────────
const { mockGetDb, mockNotifyOwner } = vi.hoisted(() => ({
  mockGetDb: vi.fn(),
  mockNotifyOwner: vi.fn().mockResolvedValue(true),
}));

vi.mock("./db", () => ({ getDb: mockGetDb }));
vi.mock("./_core/notification", () => ({ notifyOwner: mockNotifyOwner }));
vi.mock("../drizzle/schema", () => ({
  autoIngestedPapers: { ingestedAt: "ingestedAt", status: "status" },
}));
vi.mock("drizzle-orm", () => ({
  desc: vi.fn(col => `desc(${String(col)})`),
  gte: vi.fn((col, val) => `gte(${String(col)},${String(val)})`),
}));
vi.mock("./logger", () => {
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return { logger: () => log, errData: (e: unknown) => e };
});

import { checkIngestionAlerts } from "./ingestionAlertJob";

// ─── DB mock helpers ──────────────────────────────────────────────────────────
type Row = { ingestedAt: string; status?: string };

function makeDbChain(limitRows: Row[], whereRows: Row[] = []) {
  let callCount = 0;
  const chain = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockImplementation(() => {
      callCount++;
      return Promise.resolve(callCount === 1 ? limitRows : whereRows);
    }),
  };
  // For the failure-rate check (no .limit() call), resolve via .where()
  chain.where.mockImplementation(() => Promise.resolve(whereRows));
  return chain;
}

// ─── Tests ────────────────────────────────────────────────────────────────────
describe("ingestionAlertJob — checkIngestionAlerts()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset the in-memory cooldown map between tests by re-importing
    // (vi.resetModules is not needed since we check shouldFire logic via time)
  });

  it("returns skipped:true when DB is unavailable", async () => {
    mockGetDb.mockResolvedValue(null);

    const result = await checkIngestionAlerts();

    expect(result.skipped).toBe(true);
    expect(result.alertsFired).toBe(0);
    expect(mockNotifyOwner).not.toHaveBeenCalled();
  });

  it("throws when getDb() rejects (not caught at top level)", async () => {
    mockGetDb.mockRejectedValue(new Error("DB down"));

    // checkIngestionAlerts does not wrap getDb() in try/catch — it propagates
    await expect(checkIngestionAlerts()).rejects.toThrow("DB down");
  });

  it("returns stall:ok when ingestion is recent (<6h)", async () => {
    const recentDate = new Date(Date.now() - 30 * 60 * 1000).toISOString(); // 30 min ago
    const db = makeDbChain(
      [{ ingestedAt: recentDate, status: "success" }],
      [] // no rows for failure-rate window (insufficient data)
    );
    mockGetDb.mockResolvedValue(db);

    const result = await checkIngestionAlerts();

    expect(result.checks).toContain("stall:ok");
    expect(result.alertsFired).toBe(0);
    expect(mockNotifyOwner).not.toHaveBeenCalled();
  });

  it("fires stall alert when ingestion is stalled (>6h)", async () => {
    const stalledDate = new Date(Date.now() - 8 * 60 * 60 * 1000).toISOString(); // 8h ago
    const db = makeDbChain(
      [{ ingestedAt: stalledDate, status: "success" }],
      []
    );
    mockGetDb.mockResolvedValue(db);

    const result = await checkIngestionAlerts();

    expect(result.checks).toContain("stall:fired");
    expect(result.alertsFired).toBeGreaterThanOrEqual(1);
    expect(mockNotifyOwner).toHaveBeenCalledWith(
      expect.objectContaining({ title: expect.stringContaining("Stalled") })
    );
  });

  it("returns stall:no-data when no papers exist", async () => {
    const db = makeDbChain([], []);
    mockGetDb.mockResolvedValue(db);

    const result = await checkIngestionAlerts();

    expect(result.checks).toContain("stall:no-data");
    expect(result.alertsFired).toBe(0);
  });

  it("fires failure-rate alert when >20% of recent papers failed", async () => {
    const recentDate = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    // 3 failed out of 10 = 30% > 20% threshold
    const recentRows: Row[] = [
      ...Array(7).fill({ ingestedAt: recentDate, status: "success" }),
      ...Array(3).fill({ ingestedAt: recentDate, status: "failed" }),
    ];
    const db = makeDbChain(
      [{ ingestedAt: recentDate, status: "success" }], // stall check: recent
      recentRows
    );
    mockGetDb.mockResolvedValue(db);

    const result = await checkIngestionAlerts();

    const failureCheck = result.checks.find(c =>
      c.startsWith("failure_rate:fired")
    );
    expect(failureCheck).toBeTruthy();
    expect(result.alertsFired).toBeGreaterThanOrEqual(1);
    expect(mockNotifyOwner).toHaveBeenCalledWith(
      expect.objectContaining({
        title: expect.stringContaining("Failure Rate"),
      })
    );
  });

  it("does NOT fire failure-rate alert when <5 papers (insufficient data)", async () => {
    const recentDate = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const recentRows: Row[] = [
      { ingestedAt: recentDate, status: "failed" },
      { ingestedAt: recentDate, status: "failed" },
    ]; // only 2 rows — below 5 threshold
    const db = makeDbChain(
      [{ ingestedAt: recentDate, status: "success" }],
      recentRows
    );
    mockGetDb.mockResolvedValue(db);

    const result = await checkIngestionAlerts();

    expect(result.checks).toContain("failure_rate:insufficient-data");
    expect(mockNotifyOwner).not.toHaveBeenCalledWith(
      expect.objectContaining({
        title: expect.stringContaining("Failure Rate"),
      })
    );
  });

  it("result always has alertsFired, skipped, checks, durationMs", async () => {
    mockGetDb.mockResolvedValue(null);

    const result = await checkIngestionAlerts();

    expect(typeof result.alertsFired).toBe("number");
    expect(typeof result.skipped).toBe("boolean");
    expect(Array.isArray(result.checks)).toBe(true);
    expect(typeof result.durationMs).toBe("number");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });
});
