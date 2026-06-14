/**
 * biorxiv.test.ts
 * Unit tests for server/verticalAdapters/biorxiv.ts
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  mockFetch: vi.fn(),
}));

vi.stubGlobal("fetch", mocks.mockFetch);

describe("biorxivAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("is registered with domainKey 'biorxiv'", async () => {
    const { registry } = await import("./types");
    await import("./biorxiv");
    const adapter = registry.get("biorxiv");
    expect(adapter).toBeDefined();
    expect(adapter?.domainKey).toBe("biorxiv");
  });

  it("returns found=false when no DOI is in claimText", async () => {
    const { registry } = await import("./types");
    await import("./biorxiv");
    const adapter = registry.get("biorxiv");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "Protein folding mechanisms are well understood",
      extractedValue: null,
    });
    expect(result.found).toBe(false);
    expect(result.confidenceFlags).toContain("no_doi_found");
  });

  it("returns found=true when biorxiv API returns collection data", async () => {
    mocks.mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        collection: [
          {
            doi: "10.1101/2023.01.01.123456",
            title: "Test Preprint",
            abstract: "A test abstract",
            biorxiv_url:
              "https://www.biorxiv.org/content/10.1101/2023.01.01.123456",
            date: "2023-01-01",
          },
        ],
      }),
    });
    const { registry } = await import("./types");
    await import("./biorxiv");
    const adapter = registry.get("biorxiv");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "According to 10.1101/2023.01.01.123456, proteins fold",
      extractedValue: "10.1101/2023.01.01.123456",
    });
    expect(result.found).toBe(true);
    expect(result.confidenceScore).toBeLessThanOrEqual(0.7); // Preprints have lower confidence
  });

  it("returns found=false when biorxiv API returns empty collection", async () => {
    // Both biorxiv and medrxiv return empty
    mocks.mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ collection: [] }),
    });
    const { registry } = await import("./types");
    await import("./biorxiv");
    const adapter = registry.get("biorxiv");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "According to 10.1101/9999.99.99.999999, some claim",
      extractedValue: "10.1101/9999.99.99.999999",
    });
    expect(result.found).toBe(false);
  });

  it("handles network errors gracefully", async () => {
    mocks.mockFetch.mockRejectedValue(new Error("Network error"));
    const { registry } = await import("./types");
    await import("./biorxiv");
    const adapter = registry.get("biorxiv");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "According to 10.1101/2023.01.01.123456, proteins fold",
      extractedValue: "10.1101/2023.01.01.123456",
    });
    expect(result.found).toBe(false);
  });
});
