/**
 * crossRef.test.ts
 * Unit tests for server/verticalAdapters/crossRef.ts
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  mockFetch: vi.fn(),
}));

vi.stubGlobal("fetch", mocks.mockFetch);

describe("crossRefAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("is registered with domainKey 'crossref'", async () => {
    const { registry } = await import("./types");
    await import("./crossRef");
    const adapter = registry.get("crossref");
    expect(adapter).toBeDefined();
    expect(adapter?.domainKey).toBe("crossref");
  });

  it("returns found=true for a valid DOI", async () => {
    mocks.mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        message: {
          DOI: "10.1038/nature12345",
          title: ["Test Paper Title"],
          "container-title": ["Nature"],
          published: { "date-parts": [[2023]] },
          "is-referenced-by-count": 150,
          abstract: "This is a test abstract",
          URL: "https://doi.org/10.1038/nature12345",
          type: "journal-article",
        },
      }),
    });
    const { registry } = await import("./types");
    await import("./crossRef");
    const adapter = registry.get("crossref");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "According to 10.1038/nature12345 the protein folds",
      extractedValue: "10.1038/nature12345",
    });
    expect(result.found).toBe(true);
    expect(result.sourceId).toBe("10.1038/nature12345");
    expect(result.confidenceScore).toBeGreaterThan(0.5);
  });

  it("returns found=false for a non-existent DOI", async () => {
    mocks.mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
    });
    const { registry } = await import("./types");
    await import("./crossRef");
    const adapter = registry.get("crossref");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "According to 10.9999/nonexistent the protein folds",
      extractedValue: "10.9999/nonexistent",
    });
    expect(result.found).toBe(false);
    expect(result.confidenceScore).toBeLessThan(0.5);
  });

  it("handles network errors gracefully", async () => {
    mocks.mockFetch.mockRejectedValueOnce(new Error("Network timeout"));
    const { registry } = await import("./types");
    await import("./crossRef");
    const adapter = registry.get("crossref");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "According to 10.1038/nature12345 the protein folds",
      extractedValue: "10.1038/nature12345",
    });
    expect(result.found).toBe(false);
    expect(result.confidenceFlags.length).toBeGreaterThan(0);
  });

  it("has required VerticalAdapter fields", async () => {
    const { registry } = await import("./types");
    await import("./crossRef");
    const adapter = registry.get("crossref");
    expect(adapter?.displayName).toBeTruthy();
    expect(adapter?.description).toBeTruthy();
    expect(adapter?.claimExtractorPrompt).toBeTruthy();
    expect(adapter?.discoverySearchTerms).toBeInstanceOf(Array);
  });
});
