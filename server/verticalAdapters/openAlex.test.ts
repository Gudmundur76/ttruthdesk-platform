/**
 * openAlex.test.ts
 * Unit tests for server/verticalAdapters/openAlex.ts
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  mockFetch: vi.fn(),
}));

vi.stubGlobal("fetch", mocks.mockFetch);

describe("openAlexAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("is registered with domainKey 'openalex'", async () => {
    const { registry } = await import("./types");
    await import("./openAlex");
    const adapter = registry.get("openalex");
    expect(adapter).toBeDefined();
    expect(adapter?.domainKey).toBe("openalex");
  });

  it("returns found=true for a valid DOI lookup", async () => {
    mocks.mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: "https://openalex.org/W2741809807",
        doi: "https://doi.org/10.1038/nature12345",
        title: "Test Paper",
        publication_year: 2023,
        cited_by_count: 200,
        concepts: [{ display_name: "Structural Biology", score: 0.9, level: 1 }],
        primary_location: { source: { display_name: "Nature", type: "journal" }, is_oa: false },
        open_access: { is_oa: false },
        authorships: [{ author: { display_name: "Smith, J." }, institutions: [] }],
        type: "article",
        referenced_works_count: 50,
      }),
    });
    const { registry } = await import("./types");
    await import("./openAlex");
    const adapter = registry.get("openalex");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "According to 10.1038/nature12345 the protein folds",
      extractedValue: "10.1038/nature12345",
    });
    expect(result.found).toBe(true);
    expect(result.confidenceScore).toBeGreaterThan(0.5);
  });

  it("falls back to text search when no DOI is present", async () => {
    // First call: search results
    mocks.mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: [
          {
            id: "https://openalex.org/W123",
            doi: null,
            title: "Protein folding mechanisms",
            publication_year: 2022,
            cited_by_count: 50,
            concepts: [],
            primary_location: null,
            open_access: { is_oa: true },
            authorships: [],
            type: "article",
            referenced_works_count: 20,
          },
        ],
        meta: { count: 1 },
      }),
    });
    const { registry } = await import("./types");
    await import("./openAlex");
    const adapter = registry.get("openalex");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "Protein folding mechanisms are well understood",
      extractedValue: null,
    });
    expect(result.found).toBe(true);
  });

  it("returns found=false when no results are found", async () => {
    mocks.mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: [],
        meta: { count: 0 },
      }),
    });
    const { registry } = await import("./types");
    await import("./openAlex");
    const adapter = registry.get("openalex");
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
    await import("./openAlex");
    const adapter = registry.get("openalex");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "Some claim text",
      extractedValue: null,
    });
    expect(result.found).toBe(false);
    expect(result.confidenceFlags.length).toBeGreaterThan(0);
  });
});
