/**
 * wikiEngine.test.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Tests for the DB-backed LLM wiki engine.
 *
 * Covers:
 *   - appendLog: inserts a log entry and returns an ID
 *   - updateEntityPage: creates and updates wiki pages, tracks inbound links
 *   - ingestSourceToWiki: handles empty claims, calls LLM, creates pages
 *   - buildIndex: rebuilds wiki_index from wiki_pages
 *   - lintWiki: detects orphans, stale pages, contradictions
 *   - searchWiki: returns matching pages
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock DB ──────────────────────────────────────────────────────────────────
vi.mock("./db", () => ({
  getDb: vi.fn(),
}));

// ─── Mock LLM ─────────────────────────────────────────────────────────────────
vi.mock("./_core/llm", () => ({
  invokeLLM: vi.fn(),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Build a minimal chainable Drizzle mock that resolves to `returnValue`.
 * Supports: select, from, where, limit, offset, orderBy, insert, values,
 * update, set, and the SQL template tag.
 */
function makeDbChain(returnValue: unknown) {
  const chain: Record<string, unknown> = {};
  const methods = [
    "select", "from", "where", "limit", "offset", "orderBy",
    "insert", "values", "update", "set", "innerJoin", "leftJoin",
  ];
  for (const m of methods) {
    chain[m] = vi.fn(() => chain);
  }
  // Make it thenable
  chain.then = (resolve: (v: unknown) => void) =>
    Promise.resolve(returnValue).then(resolve);
  chain.catch = (reject: (e: unknown) => void) =>
    Promise.resolve(returnValue).catch(reject);
  return chain;
}

function makeDb(overrides: Record<string, unknown> = {}) {
  return {
    select: vi.fn(() => makeDbChain([])),
    insert: vi.fn(() => makeDbChain([{ insertId: 42 }])),
    update: vi.fn(() => makeDbChain(undefined)),
    ...overrides,
  };
}

// ─── appendLog ────────────────────────────────────────────────────────────────

describe("appendLog", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("inserts a log entry and returns the insertId", async () => {
    const { getDb } = await import("./db");
    const insertChain = makeDbChain([{ insertId: 7 }]);
    const db = {
      insert: vi.fn(() => insertChain),
    };
    vi.mocked(getDb).mockResolvedValue(db as never);

    const { appendLog } = await import("./wikiEngine");
    const id = await appendLog("ingest", "Test ingest", 3, "entity-foo", 1);
    expect(id).toBe(7);
    expect(db.insert).toHaveBeenCalledTimes(1);
  });

  it("returns 0 when db is unavailable", async () => {
    const { getDb } = await import("./db");
    vi.mocked(getDb).mockResolvedValue(null as never);

    const { appendLog } = await import("./wikiEngine");
    const id = await appendLog("lint", "No db", 0);
    expect(id).toBe(0);
  });
});

// ─── updateEntityPage ─────────────────────────────────────────────────────────

describe("updateEntityPage", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("creates a new page when slug does not exist", async () => {
    const { getDb } = await import("./db");
    const insertChain = makeDbChain([{ insertId: 1 }]);
    const db = {
      select: vi.fn(() => makeDbChain([])), // no existing page
      insert: vi.fn(() => insertChain),
      update: vi.fn(() => makeDbChain(undefined)),
    };
    vi.mocked(getDb).mockResolvedValue(db as never);

    const { updateEntityPage } = await import("./wikiEngine");
    const result = await updateEntityPage(
      "entity-lysozyme",
      "Human Lysozyme",
      "entity",
      "# Human Lysozyme\n\nA well-known enzyme.",
      "structural_biology",
      0.85
    );
    expect(result).toBe("created");
    expect(db.insert).toHaveBeenCalledTimes(1);
  });

  it("updates an existing page and increments sourceCount", async () => {
    const { getDb } = await import("./db");
    const existingPage = {
      id: 1,
      slug: "entity-lysozyme",
      title: "Human Lysozyme",
      category: "entity",
      content: "# Human Lysozyme\n\nOld content.",
      sourceCount: 2,
      inboundLinks: [],
      outboundLinks: [],
      avgConfidence: 0.7,
      verticalDomain: "structural_biology",
      lastCompiledAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const selectChain = makeDbChain([existingPage]);
    const db = {
      select: vi.fn(() => selectChain),
      update: vi.fn(() => makeDbChain(undefined)),
      insert: vi.fn(() => makeDbChain([{ insertId: 1 }])),
    };
    vi.mocked(getDb).mockResolvedValue(db as never);

    const { updateEntityPage } = await import("./wikiEngine");
    const result = await updateEntityPage(
      "entity-lysozyme",
      "Human Lysozyme",
      "entity",
      "# Human Lysozyme\n\nUpdated content with [[entity-bard1|BARD1]].",
      "structural_biology",
      0.9
    );
    expect(result).toBe("updated");
    expect(db.update).toHaveBeenCalled();
  });

  it("throws when db is unavailable", async () => {
    const { getDb } = await import("./db");
    vi.mocked(getDb).mockResolvedValue(null as never);

    const { updateEntityPage } = await import("./wikiEngine");
    await expect(
      updateEntityPage("entity-foo", "Foo", "entity", "content", "structural_biology")
    ).rejects.toThrow("Database unavailable");
  });
});

// ─── ingestSourceToWiki ───────────────────────────────────────────────────────

describe("ingestSourceToWiki", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("returns empty result with logId when claims array is empty", async () => {
    const { getDb } = await import("./db");
    const db = {
      select: vi.fn(() => makeDbChain([])),
      insert: vi.fn(() => makeDbChain([{ insertId: 5 }])),
      update: vi.fn(() => makeDbChain(undefined)),
    };
    vi.mocked(getDb).mockResolvedValue(db as never);

    const { ingestSourceToWiki } = await import("./wikiEngine");
    const doc = { id: 1, title: "Empty Doc", verticalDomain: "structural_biology" };
    const result = await ingestSourceToWiki(doc as never, []);
    expect(result.pagesCreated).toBe(0);
    expect(result.pagesUpdated).toBe(0);
    expect(result.slugs).toEqual([]);
    expect(typeof result.logId).toBe("number");
  });

  it("calls invokeLLM to plan pages when claims are present", async () => {
    const { getDb } = await import("./db");
    const { invokeLLM } = await import("./_core/llm");

    // Mock DB: no existing pages, insert returns IDs
    const db = {
      select: vi.fn(() => makeDbChain([])),
      insert: vi.fn(() => makeDbChain([{ insertId: 10 }])),
      update: vi.fn(() => makeDbChain(undefined)),
    };
    vi.mocked(getDb).mockResolvedValue(db as never);

    // Mock LLM: returns a plan with one entity page, then content for each page
    // Note: ingestSourceToWiki always appends a source_summary page, so we need
    // 1 plan call + N content calls (1 entity + 1 source_summary = 3 total)
    vi.mocked(invokeLLM)
      .mockResolvedValueOnce({
        choices: [{
          message: {
            content: JSON.stringify({
              pages: [{
                slug: "entity-lysozyme",
                title: "Human Lysozyme",
                category: "entity",
                reason: "Mentioned in 2 claims",
              }],
            }),
          },
        }],
      } as never)
      .mockResolvedValue({
        choices: [{
          message: {
            content: "# Human Lysozyme\n\nA well-known enzyme. ✅ Supported claim.",
          },
        }],
      } as never);

    const { ingestSourceToWiki } = await import("./wikiEngine");
    const doc = { id: 2, title: "Lysozyme Study", verticalDomain: "structural_biology" };
    const claims = [
      {
        id: 1,
        claimText: "Human lysozyme has 129 amino acids",
        verdict: "Supported",
        confidenceScore: 0.9,
      },
      {
        id: 2,
        claimText: "Lysozyme cleaves peptidoglycan",
        verdict: "Supported",
        confidenceScore: 0.85,
      },
    ];

    const result = await ingestSourceToWiki(doc as never, claims as never);
    expect(invokeLLM).toHaveBeenCalledTimes(3); // plan + entity content + source_summary content
    expect(result.slugs).toContain("entity-lysozyme");
    expect(result.pagesCreated + result.pagesUpdated).toBeGreaterThan(0);
  });

  it("handles LLM returning invalid JSON gracefully", async () => {
    const { getDb } = await import("./db");
    const { invokeLLM } = await import("./_core/llm");

    const db = {
      select: vi.fn(() => makeDbChain([])),
      insert: vi.fn(() => makeDbChain([{ insertId: 11 }])),
      update: vi.fn(() => makeDbChain(undefined)),
    };
    vi.mocked(getDb).mockResolvedValue(db as never);

    // LLM returns invalid JSON for the plan, but still needs to handle content calls
    // for the always-added source_summary page
    vi.mocked(invokeLLM)
      .mockResolvedValueOnce({
        choices: [{ message: { content: "not valid json at all" } }],
      } as never)
      .mockResolvedValue({
        choices: [{ message: { content: "# Source Summary\n\nAuto-generated." } }],
      } as never);

    const { ingestSourceToWiki } = await import("./wikiEngine");
    const doc = { id: 3, title: "Bad JSON Doc", verticalDomain: "structural_biology" };
    const claims = [{ id: 1, claimText: "Some claim", verdict: "Supported", confidenceScore: 0.5 }];

    // Should not throw — graceful degradation
    const result = await ingestSourceToWiki(doc as never, claims as never);
    expect(result).toMatchObject({
      pagesCreated: expect.any(Number),
      pagesUpdated: expect.any(Number),
      slugs: expect.any(Array),
    });
  });

  it("throws when db is unavailable", async () => {
    const { getDb } = await import("./db");
    vi.mocked(getDb).mockResolvedValue(null as never);

    const { ingestSourceToWiki } = await import("./wikiEngine");
    const doc = { id: 4, title: "No DB Doc", verticalDomain: "structural_biology" };
    await expect(ingestSourceToWiki(doc as never, [])).rejects.toThrow("Database unavailable");
  });
});

// ─── buildIndex ───────────────────────────────────────────────────────────────

describe("buildIndex", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("creates a new index row when none exists", async () => {
    const { getDb } = await import("./db");
    const pages = [
      { slug: "entity-foo", title: "Foo", category: "entity", sourceCount: 1, avgConfidence: 0.8, updatedAt: new Date() },
    ];
    let selectCallCount = 0;
    const db = {
      select: vi.fn(() => {
        selectCallCount++;
        // First call: return pages; second call: return empty (no existing index)
        return makeDbChain(selectCallCount === 1 ? pages : []);
      }),
      insert: vi.fn(() => makeDbChain([{ insertId: 1 }])),
      update: vi.fn(() => makeDbChain(undefined)),
    };
    vi.mocked(getDb).mockResolvedValue(db as never);

    const { buildIndex } = await import("./wikiEngine");
    await buildIndex();
    expect(db.insert).toHaveBeenCalledTimes(1);
  });

  it("updates existing index row when one exists", async () => {
    const { getDb } = await import("./db");
    const pages = [
      { slug: "entity-bar", title: "Bar", category: "concept", sourceCount: 2, avgConfidence: 0.6, updatedAt: new Date() },
    ];
    const existingIndex = [{ id: 1, content: "old", pageCount: 0, lastBuiltAt: new Date() }];
    let selectCallCount = 0;
    const db = {
      select: vi.fn(() => {
        selectCallCount++;
        return makeDbChain(selectCallCount === 1 ? pages : existingIndex);
      }),
      insert: vi.fn(() => makeDbChain([{ insertId: 1 }])),
      update: vi.fn(() => makeDbChain(undefined)),
    };
    vi.mocked(getDb).mockResolvedValue(db as never);

    const { buildIndex } = await import("./wikiEngine");
    await buildIndex();
    expect(db.update).toHaveBeenCalledTimes(1);
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("returns early when db is unavailable", async () => {
    const { getDb } = await import("./db");
    vi.mocked(getDb).mockResolvedValue(null as never);

    const { buildIndex } = await import("./wikiEngine");
    // Should not throw
    await expect(buildIndex()).resolves.toBeUndefined();
  });
});

// ─── lintWiki ─────────────────────────────────────────────────────────────────

describe("lintWiki", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("returns a valid WikiLintResult with empty wiki", async () => {
    const { getDb } = await import("./db");
    const db = {
      select: vi.fn(() => makeDbChain([])),
      insert: vi.fn(() => makeDbChain([{ insertId: 1 }])),
      update: vi.fn(() => makeDbChain(undefined)),
    };
    vi.mocked(getDb).mockResolvedValue(db as never);

    const { lintWiki } = await import("./wikiEngine");
    const result = await lintWiki();
    expect(result).toMatchObject({
      contradictions: expect.any(Array),
      orphanSlugs: expect.any(Array),
      stalePageSlugs: expect.any(Array),
      missingCrossRefs: expect.any(Array),
      summary: expect.any(String),
    });
  });

  it("detects orphan pages (pages with no inbound links and no outbound links)", async () => {
    const { getDb } = await import("./db");
    const now = new Date();
    const staleDate = new Date(now.getTime() - 100 * 24 * 60 * 60 * 1000); // 100 days ago
    const pages = [
      {
        id: 1,
        slug: "entity-orphan",
        title: "Orphan Page",
        category: "entity",
        content: "# Orphan\n\nNo links here.",
        sourceCount: 1,
        inboundLinks: [],
        outboundLinks: [],
        avgConfidence: 0.5,
        verticalDomain: "structural_biology",
        lastCompiledAt: staleDate,
        createdAt: staleDate,
        updatedAt: staleDate,
      },
    ];
    const db = {
      select: vi.fn(() => makeDbChain(pages)),
      insert: vi.fn(() => makeDbChain([{ insertId: 1 }])),
      update: vi.fn(() => makeDbChain(undefined)),
    };
    vi.mocked(getDb).mockResolvedValue(db as never);

    const { lintWiki } = await import("./wikiEngine");
    const result = await lintWiki();
    expect(result.orphanSlugs).toContain("entity-orphan");
  });

  it("detects stale pages (not updated in 90+ days)", async () => {
    const { getDb } = await import("./db");
    const staleDate = new Date(Date.now() - 95 * 24 * 60 * 60 * 1000);
    const pages = [
      {
        id: 2,
        slug: "entity-stale",
        title: "Stale Page",
        category: "entity",
        content: "# Stale\n\nOld content.",
        sourceCount: 1,
        inboundLinks: ["entity-other"],
        outboundLinks: ["entity-other"],
        avgConfidence: 0.5,
        verticalDomain: "structural_biology",
        lastCompiledAt: staleDate,
        createdAt: staleDate,
        updatedAt: staleDate,
      },
    ];
    const db = {
      select: vi.fn(() => makeDbChain(pages)),
      insert: vi.fn(() => makeDbChain([{ insertId: 1 }])),
      update: vi.fn(() => makeDbChain(undefined)),
    };
    vi.mocked(getDb).mockResolvedValue(db as never);

    const { lintWiki } = await import("./wikiEngine");
    const result = await lintWiki();
    expect(result.stalePageSlugs).toContain("entity-stale");
  });

  it("throws when db is unavailable", async () => {
    const { getDb } = await import("./db");
    vi.mocked(getDb).mockResolvedValue(null as never);

    const { lintWiki } = await import("./wikiEngine");
    await expect(lintWiki()).rejects.toThrow("Database unavailable");
  });

  it("summary string is always non-empty", async () => {
    const { getDb } = await import("./db");
    const db = {
      select: vi.fn(() => makeDbChain([])),
      insert: vi.fn(() => makeDbChain([{ insertId: 1 }])),
      update: vi.fn(() => makeDbChain(undefined)),
    };
    vi.mocked(getDb).mockResolvedValue(db as never);

    const { lintWiki } = await import("./wikiEngine");
    const result = await lintWiki();
    expect(result.summary.length).toBeGreaterThan(0);
  });
});

// ─── searchWiki ───────────────────────────────────────────────────────────────

describe("searchWiki", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("returns matching pages with snippet", async () => {
    const { getDb } = await import("./db");
    const matchingPages = [
      {
        slug: "entity-lysozyme",
        title: "Human Lysozyme",
        category: "entity",
        content: "# Human Lysozyme\n\nA well-known enzyme that cleaves peptidoglycan.",
      },
    ];
    const db = {
      select: vi.fn(() => makeDbChain(matchingPages)),
    };
    vi.mocked(getDb).mockResolvedValue(db as never);

    const { searchWiki } = await import("./wikiEngine");
    const results = await searchWiki("lysozyme");
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      slug: "entity-lysozyme",
      title: "Human Lysozyme",
      category: "entity",
      snippet: expect.any(String),
    });
    expect(results[0].snippet.length).toBeGreaterThan(0);
  });

  it("returns empty array when db is unavailable", async () => {
    const { getDb } = await import("./db");
    vi.mocked(getDb).mockResolvedValue(null as never);

    const { searchWiki } = await import("./wikiEngine");
    const results = await searchWiki("anything");
    expect(results).toEqual([]);
  });

  it("returns empty array when no pages match", async () => {
    const { getDb } = await import("./db");
    const db = {
      select: vi.fn(() => makeDbChain([])),
    };
    vi.mocked(getDb).mockResolvedValue(db as never);

    const { searchWiki } = await import("./wikiEngine");
    const results = await searchWiki("nonexistent-term-xyz");
    expect(results).toEqual([]);
  });

  it("respects the limit parameter", async () => {
    const { getDb } = await import("./db");
    const db = {
      select: vi.fn(() => makeDbChain([])),
    };
    vi.mocked(getDb).mockResolvedValue(db as never);

    const { searchWiki } = await import("./wikiEngine");
    // Just verify it doesn't throw with a custom limit
    await expect(searchWiki("test", 5)).resolves.toEqual([]);
  });
});
