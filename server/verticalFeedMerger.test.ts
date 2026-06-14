/**
 * verticalFeedMerger.test.ts
 * Unit tests for server/verticalFeedMerger.ts
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  mockGetDb: vi.fn(),
}));

vi.mock("./db", () => ({ getDb: mocks.mockGetDb }));
vi.mock("./logger", () => ({
  logger: () => ({ info: vi.fn(), warn: vi.fn() }),
  errData: vi.fn((e: unknown) => ({ err: String(e) })),
}));

const makeDb = (rows: Array<{ domainKey: string; displayName: string; meshTerms: string[]; enabled: boolean; qualityTier: string }> = []) => {
  const db = {
    select: vi.fn(),
    from: vi.fn(),
  };
  db.select.mockReturnValue(db);
  db.from.mockResolvedValue(rows);
  return db;
};

describe("getActiveVerticalFeedConfigs()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("falls back to static configs when DB is unavailable", async () => {
    mocks.mockGetDb.mockResolvedValue(null);
    const { getActiveVerticalFeedConfigs } = await import("./verticalFeedMerger");
    const { VERTICAL_FEED_CONFIGS } = await import("./verticalFeedConfig");
    const result = await getActiveVerticalFeedConfigs();
    expect(result).toEqual(VERTICAL_FEED_CONFIGS);
  });

  it("falls back to static configs when DB query throws", async () => {
    const db = makeDb();
    db.from.mockRejectedValue(new Error("table not found"));
    mocks.mockGetDb.mockResolvedValue(db);
    const { getActiveVerticalFeedConfigs } = await import("./verticalFeedMerger");
    const { VERTICAL_FEED_CONFIGS } = await import("./verticalFeedConfig");
    const result = await getActiveVerticalFeedConfigs();
    expect(result).toEqual(VERTICAL_FEED_CONFIGS);
  });

  it("returns static configs when DB has no records", async () => {
    mocks.mockGetDb.mockResolvedValue(makeDb([]));
    const { getActiveVerticalFeedConfigs } = await import("./verticalFeedMerger");
    const { VERTICAL_FEED_CONFIGS } = await import("./verticalFeedConfig");
    const result = await getActiveVerticalFeedConfigs();
    expect(result.length).toBe(VERTICAL_FEED_CONFIGS.length);
  });

  it("overrides static config when DB has enabled record for same domainKey", async () => {
    const dbRow = {
      domainKey: "structural_biology",
      displayName: "Structural Biology (DB Override)",
      meshTerms: ["\"Protein Structure\"[MeSH] AND free full text[sb]"],
      enabled: true,
      qualityTier: "high",
    };
    mocks.mockGetDb.mockResolvedValue(makeDb([dbRow]));
    const { getActiveVerticalFeedConfigs } = await import("./verticalFeedMerger");
    const result = await getActiveVerticalFeedConfigs();
    const sbConfig = result.find((c) => c.domainKey === "structural_biology");
    expect(sbConfig).toBeDefined();
    expect(sbConfig!.displayName).toBe("Structural Biology (DB Override)");
  });

  it("excludes disabled DB records even if static config exists", async () => {
    const dbRow = {
      domainKey: "structural_biology",
      displayName: "Structural Biology",
      meshTerms: ["\"Protein Structure\"[MeSH]"],
      enabled: false,
      qualityTier: "high",
    };
    mocks.mockGetDb.mockResolvedValue(makeDb([dbRow]));
    const { getActiveVerticalFeedConfigs } = await import("./verticalFeedMerger");
    const result = await getActiveVerticalFeedConfigs();
    const sbConfig = result.find((c) => c.domainKey === "structural_biology");
    expect(sbConfig).toBeUndefined();
  });

  it("adds DB-only verticals not in static config", async () => {
    const dbRow = {
      domainKey: "new_vertical_xyz",
      displayName: "New Vertical",
      meshTerms: ["\"New Term\"[MeSH] AND free full text[sb]"],
      enabled: true,
      qualityTier: "medium",
    };
    mocks.mockGetDb.mockResolvedValue(makeDb([dbRow]));
    const { getActiveVerticalFeedConfigs } = await import("./verticalFeedMerger");
    const result = await getActiveVerticalFeedConfigs();
    const newConfig = result.find((c) => c.domainKey === "new_vertical_xyz");
    expect(newConfig).toBeDefined();
    expect(newConfig!.displayName).toBe("New Vertical");
  });

  it("wraps bare meshTerms with PMC OA filter when not already present", async () => {
    const dbRow = {
      domainKey: "test_vertical",
      displayName: "Test",
      meshTerms: ["\"Some Term\"[MeSH]"], // no free full text[sb]
      enabled: true,
      qualityTier: "medium",
    };
    mocks.mockGetDb.mockResolvedValue(makeDb([dbRow]));
    const { getActiveVerticalFeedConfigs } = await import("./verticalFeedMerger");
    const result = await getActiveVerticalFeedConfigs();
    const cfg = result.find((c) => c.domainKey === "test_vertical");
    expect(cfg).toBeDefined();
    expect(cfg!.meshQueries[0]).toContain("free full text[sb]");
  });
});
