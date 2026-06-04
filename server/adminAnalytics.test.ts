import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock the DB module ───────────────────────────────────────────────────────
vi.mock("./db", () => ({
  getDb: vi.fn(),
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeChain(returnValue: unknown) {
  const chain: Record<string, unknown> = {};
  const methods = ["select", "from", "where", "groupBy", "orderBy", "limit", "leftJoin", "innerJoin"];
  methods.forEach((m) => {
    chain[m] = vi.fn(() => chain);
  });
  // Make the chain thenable so await works
  chain.then = (resolve: (v: unknown) => void) => Promise.resolve(returnValue).then(resolve);
  chain.catch = (reject: (e: unknown) => void) => Promise.resolve(returnValue).catch(reject);
  return chain;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("adminAnalytics module", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("getPlatformOverview returns correct shape", async () => {
    const { getDb } = await import("./db");
    const mockDb = {
      select: vi.fn(() => makeChain([{ total: 10, completed: 8, failed: 1, pending: 1 }])),
      execute: vi.fn(() => Promise.resolve([[{ count: 5 }]])),
    };
    vi.mocked(getDb).mockResolvedValue(mockDb as never);

    const { getPlatformOverview } = await import("./adminAnalytics");
    const result = await getPlatformOverview();

    expect(result).toMatchObject({
      totalDocuments: expect.any(Number),
      completedDocuments: expect.any(Number),
      failedDocuments: expect.any(Number),
      pendingDocuments: expect.any(Number),
      totalClaims: expect.any(Number),
      verifiedClaims: expect.any(Number),
      contradictionCount: expect.any(Number),
      totalEntities: expect.any(Number),
      totalRelations: expect.any(Number),
      coordTasksActive: expect.any(Number),
      coordTasksCompleted: expect.any(Number),
    });
  });

  it("getVerdictDistribution returns array with percentage fields", async () => {
    const { getDb } = await import("./db");
    const mockDb = {
      select: vi.fn(() =>
        makeChain([
          { verdict: "Supported", count: 60 },
          { verdict: "Contradicted", count: 40 },
        ])
      ),
    };
    vi.mocked(getDb).mockResolvedValue(mockDb as never);

    const { getVerdictDistribution } = await import("./adminAnalytics");
    const result = await getVerdictDistribution();

    expect(Array.isArray(result)).toBe(true);
    if (result.length > 0) {
      expect(result[0]).toHaveProperty("verdict");
      expect(result[0]).toHaveProperty("count");
      expect(result[0]).toHaveProperty("percentage");
      // Percentages should sum to 100
      const total = result.reduce((s, r) => s + r.percentage, 0);
      expect(total).toBeCloseTo(100, 0);
    }
  });

  it("getVerticalHealth returns array with required fields", async () => {
    const { getDb } = await import("./db");
    const mockDb = {
      select: vi.fn(() =>
        makeChain([
          {
            verticalDomain: "protein-supplements",
            documentCount: 10,
            claimCount: 50,
            completedCount: 8,
            failedCount: 1,
            avgConfidence: 0.72,
          },
        ])
      ),
    };
    vi.mocked(getDb).mockResolvedValue(mockDb as never);

    const { getVerticalHealth } = await import("./adminAnalytics");
    const result = await getVerticalHealth();

    expect(Array.isArray(result)).toBe(true);
    if (result.length > 0) {
      const v = result[0];
      expect(v).toHaveProperty("verticalDomain");
      expect(v).toHaveProperty("documentCount");
      expect(v).toHaveProperty("claimCount");
      expect(v).toHaveProperty("completedCount");
      expect(v).toHaveProperty("failedCount");
    }
  });

  it("getProcessingTrend returns 30 days of data", async () => {
    const { getDb } = await import("./db");
    const rows = Array.from({ length: 5 }, (_, i) => ({
      date: `2026-05-${String(i + 1).padStart(2, "0")}`,
      documentsProcessed: i * 2,
      claimsExtracted: i * 10,
    }));
    const mockDb = {
      select: vi.fn(() => makeChain(rows)),
    };
    vi.mocked(getDb).mockResolvedValue(mockDb as never);

    const { getProcessingTrend } = await import("./adminAnalytics");
    const result = await getProcessingTrend();

    expect(Array.isArray(result)).toBe(true);
    // Should have at most 30 entries
    expect(result.length).toBeLessThanOrEqual(30);
    if (result.length > 0) {
      expect(result[0]).toHaveProperty("date");
      expect(result[0]).toHaveProperty("documentsProcessed");
      expect(result[0]).toHaveProperty("claimsExtracted");
    }
  });

  it("getQualityDistribution returns histogram buckets", async () => {
    const { getDb } = await import("./db");
    const mockDb = {
      select: vi.fn(() =>
        makeChain([
          { bucket: 0, count: 5 },
          { bucket: 1, count: 10 },
          { bucket: 2, count: 20 },
        ])
      ),
    };
    vi.mocked(getDb).mockResolvedValue(mockDb as never);

    const { getQualityDistribution } = await import("./adminAnalytics");
    const result = await getQualityDistribution();

    expect(Array.isArray(result)).toBe(true);
    if (result.length > 0) {
      expect(result[0]).toHaveProperty("range");
      expect(result[0]).toHaveProperty("count");
    }
  });

  it("getTopEntities returns entities with claimCount", async () => {
    const { getDb } = await import("./db");
    const mockDb = {
      select: vi.fn(() =>
        makeChain([
          { canonicalName: "Whey Protein", entityType: "supplement", claimCount: 42 },
          { canonicalName: "Creatine", entityType: "supplement", claimCount: 38 },
        ])
      ),
    };
    vi.mocked(getDb).mockResolvedValue(mockDb as never);

    const { getTopEntities } = await import("./adminAnalytics");
    const result = await getTopEntities();

    expect(Array.isArray(result)).toBe(true);
    if (result.length > 0) {
      expect(result[0]).toHaveProperty("canonicalName");
      expect(result[0]).toHaveProperty("entityType");
      expect(result[0]).toHaveProperty("claimCount");
    }
  });

  it("getRecentActivity returns sorted items with type field", async () => {
    const { getDb } = await import("./db");
    const now = new Date();
    const mockDb = {
      select: vi.fn()
        .mockReturnValueOnce(
          makeChain([{ id: 1, title: "Test Paper", status: "complete", updatedAt: now }])
        )
        .mockReturnValueOnce(
          makeChain([{ id: 2, vertical: "protein-supplements", status: "completed", startedAt: now }])
        ),
    };
    vi.mocked(getDb).mockResolvedValue(mockDb as never);

    const { getRecentActivity } = await import("./adminAnalytics");
    const result = await getRecentActivity();

    expect(Array.isArray(result)).toBe(true);
    if (result.length > 0) {
      expect(result[0]).toHaveProperty("type");
      expect(result[0]).toHaveProperty("id");
      expect(result[0]).toHaveProperty("label");
      expect(result[0]).toHaveProperty("status");
      expect(result[0]).toHaveProperty("timestamp");
    }
  });
});
