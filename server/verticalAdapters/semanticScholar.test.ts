/**
 * semanticScholar.test.ts
 * Unit tests for server/verticalAdapters/semanticScholar.ts
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  mockFetch: vi.fn(),
}));

vi.stubGlobal("fetch", mocks.mockFetch);

describe("semanticScholarAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("is registered with domainKey 'semantic_scholar'", async () => {
    const { registry } = await import("./types");
    await import("./semanticScholar");
    const adapter = registry.get("semantic_scholar");
    expect(adapter).toBeDefined();
    expect(adapter?.domainKey).toBe("semantic_scholar");
  });

  it("returns found=true for a valid DOI paper lookup", async () => {
    mocks.mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        paperId: "abc123",
        externalIds: { DOI: "10.1038/nature12345" },
        title: "Test Paper",
        abstract: "This is a test abstract about protein folding",
        year: 2023,
        citationCount: 200,
        influentialCitationCount: 50,
        fieldsOfStudy: ["Biology"],
        tldr: { text: "Key finding about protein folding" },
        openAccessPdf: null,
        publicationTypes: ["JournalArticle"],
        journal: { name: "Nature" },
      }),
    });
    const { registry } = await import("./types");
    await import("./semanticScholar");
    const adapter = registry.get("semantic_scholar");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "According to 10.1038/nature12345 the protein folds",
      extractedValue: "10.1038/nature12345",
    });
    expect(result.found).toBe(true);
    expect(result.confidenceScore).toBeGreaterThan(0.5);
  });

  it("falls back to search when no DOI is present", async () => {
    mocks.mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [
          {
            paperId: "xyz789",
            externalIds: {},
            title: "Protein folding mechanisms",
            abstract: "Study of protein folding",
            year: 2022,
            citationCount: 100,
            influentialCitationCount: 20,
            fieldsOfStudy: ["Biology"],
            tldr: null,
            openAccessPdf: null,
            publicationTypes: ["JournalArticle"],
            journal: { name: "Science" },
          },
        ],
        total: 1,
      }),
    });
    const { registry } = await import("./types");
    await import("./semanticScholar");
    const adapter = registry.get("semantic_scholar");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "Protein folding mechanisms are well understood",
      extractedValue: null,
    });
    expect(result.found).toBe(true);
  });

  it("returns found=false when no papers are found", async () => {
    mocks.mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [],
        total: 0,
      }),
    });
    const { registry } = await import("./types");
    await import("./semanticScholar");
    const adapter = registry.get("semantic_scholar");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "Completely made up claim with no evidence",
      extractedValue: null,
    });
    expect(result.found).toBe(false);
  });

  it("handles network errors gracefully", async () => {
    mocks.mockFetch.mockRejectedValueOnce(new Error("Network error"));
    const { registry } = await import("./types");
    await import("./semanticScholar");
    const adapter = registry.get("semantic_scholar");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "Some claim text",
      extractedValue: null,
    });
    expect(result.found).toBe(false);
    expect(result.confidenceFlags.length).toBeGreaterThan(0);
  });
});
