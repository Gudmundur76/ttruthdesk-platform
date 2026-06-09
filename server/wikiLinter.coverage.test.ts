/**
 * wikiLinter.coverage.test.ts
 *
 * Unit tests for wikiLinter.ts — the wiki quality linting pipeline.
 * The DB is mocked so tests run without a real database.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./db", async importOriginal => {
  const actual = await importOriginal<typeof import("./db")>();
  return {
    ...actual,
    getDb: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
      innerJoin: vi.fn().mockReturnThis(),
      leftJoin: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      execute: vi.fn().mockResolvedValue([]),
    }),
    // Return empty arrays so processedEntities = 0
    getGraphEntitiesByType: vi.fn().mockResolvedValue([]),
    upsertGraphRelation: vi.fn().mockResolvedValue(undefined),
  };
});

describe("runWikiLint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns a WikiLintReport with required fields", async () => {
    const { runWikiLint } = await import("./wikiLinter");
    const report = await runWikiLint();
    expect(report).toHaveProperty("processedEntities");
    expect(report).toHaveProperty("contradictionsFound");
    expect(report).toHaveProperty("newEdgesCreated");
    expect(report).toHaveProperty("results");
    expect(report).toHaveProperty("processedAt");
    expect(Array.isArray(report.results)).toBe(true);
  });

  it("returns 0 processedEntities when DB is empty", async () => {
    const { runWikiLint } = await import("./wikiLinter");
    const report = await runWikiLint();
    expect(report.processedEntities).toBe(0);
  });

  it("returns 0 contradictionsFound when DB is empty", async () => {
    const { runWikiLint } = await import("./wikiLinter");
    const report = await runWikiLint();
    expect(report.contradictionsFound).toBe(0);
  });

  it("returns empty results array when DB is empty", async () => {
    const { runWikiLint } = await import("./wikiLinter");
    const report = await runWikiLint();
    expect(report.results).toEqual([]);
  });

  it("processedAt is a recent ISO timestamp", async () => {
    const before = Date.now();
    const { runWikiLint } = await import("./wikiLinter");
    const report = await runWikiLint();
    const after = Date.now();
    const ts = new Date(report.processedAt).getTime();
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });

  it("newEdgesCreated is a non-negative integer", async () => {
    const { runWikiLint } = await import("./wikiLinter");
    const report = await runWikiLint();
    expect(typeof report.newEdgesCreated).toBe("number");
    expect(report.newEdgesCreated).toBeGreaterThanOrEqual(0);
  });
});
