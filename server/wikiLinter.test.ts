/**
 * wikiLinter.test.ts
 * Tests for WikiLintReport shape and runWikiLint graceful degradation.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock DB and LLM calls ────────────────────────────────────────────────────
vi.mock("./db", () => ({
  getGraphEntitiesByType: vi.fn().mockResolvedValue([]),
  getContradictionRelations: vi.fn().mockResolvedValue([]),
  upsertGraphRelation: vi.fn().mockResolvedValue(undefined),
  getAllGraphEntities: vi.fn().mockResolvedValue([]),
}));

vi.mock("./_core/llm", () => ({
  invokeLLM: vi.fn().mockResolvedValue({
    choices: [{ message: { content: '{"contradictions":[]}' } }],
  }),
}));

vi.mock("./wikiCompiler", () => ({
  fetchWikiPage: vi.fn().mockResolvedValue(""),
  wikiKey: (type: string, name: string) => `wiki/${type}_${name.toLowerCase()}.md`,
  slugify: (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_"),
}));

describe("wikiLinter: runWikiLint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns a valid WikiLintReport with zero entities", async () => {
    const { runWikiLint } = await import("./wikiLinter");
    const report = await runWikiLint();

    expect(report).toMatchObject({
      processedEntities: 0,
      contradictionsFound: 0,
      newEdgesCreated: 0,
      results: [],
    });
    expect(typeof report.processedAt).toBe("string");
    expect(new Date(report.processedAt).getTime()).toBeGreaterThan(0);
  });

  it("processedAt is a valid ISO timestamp", async () => {
    const { runWikiLint } = await import("./wikiLinter");
    const report = await runWikiLint();
    const d = new Date(report.processedAt);
    expect(isNaN(d.getTime())).toBe(false);
  });

  it("results array is always present even when empty", async () => {
    const { runWikiLint } = await import("./wikiLinter");
    const report = await runWikiLint();
    expect(Array.isArray(report.results)).toBe(true);
  });

  it("contradictionsFound equals sum of contradictions in results", async () => {
    const { runWikiLint } = await import("./wikiLinter");
    const report = await runWikiLint();
    const sum = report.results.reduce((n, r) => n + r.contradictions.length, 0);
    expect(report.contradictionsFound).toBe(sum);
  });

  it("handles entities with no wiki page path gracefully", async () => {
    const { getGraphEntitiesByType } = await import("./db") as Record<string, ReturnType<typeof vi.fn>>;
    getGraphEntitiesByType.mockResolvedValue([
      {
        id: 1,
        entityType: "pdb_id",
        canonicalName: "1LYZ",
        wikiPagePath: null, // no wiki page
        firstSeenDocumentId: null,
        metadata: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    const { runWikiLint } = await import("./wikiLinter");
    const report = await runWikiLint();
    // Should skip entities without wikiPagePath
    expect(report.contradictionsFound).toBe(0);
    expect(report.newEdgesCreated).toBe(0);
  });
});
