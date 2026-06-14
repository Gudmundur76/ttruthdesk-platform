/**
 * wikidata.test.ts
 * Unit tests for server/verticalAdapters/wikidata.ts
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  mockFetch: vi.fn(),
}));

vi.stubGlobal("fetch", mocks.mockFetch);

describe("WikidataAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("is registered with domainKey 'wikidata'", async () => {
    const { registry } = await import("./types");
    await import("./wikidata");
    const adapter = registry.get("wikidata");
    expect(adapter).toBeDefined();
    expect(adapter?.domainKey).toBe("wikidata");
  });

  it("returns found=true when Wikidata returns entity data", async () => {
    mocks.mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        search: [
          {
            id: "Q7240673",
            label: "protein",
            description: "biological macromolecule",
            url: "https://www.wikidata.org/wiki/Q7240673",
          },
        ],
      }),
    });
    const { registry } = await import("./types");
    await import("./wikidata");
    const adapter = registry.get("wikidata");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "Proteins are biological macromolecules",
      extractedValue: "protein",
    });
    expect(result.found).toBe(true);
    expect(result.confidenceScore).toBeGreaterThan(0);
  });

  it("returns found=false when Wikidata returns no results", async () => {
    mocks.mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ search: [] }),
    });
    const { registry } = await import("./types");
    await import("./wikidata");
    const adapter = registry.get("wikidata");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "Completely made up entity",
      extractedValue: "xyznonexistent123",
    });
    expect(result.found).toBe(false);
  });

  it("handles network errors gracefully", async () => {
    mocks.mockFetch.mockRejectedValueOnce(new Error("Network error"));
    const { registry } = await import("./types");
    await import("./wikidata");
    const adapter = registry.get("wikidata");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "Some entity claim",
      extractedValue: null,
    });
    expect(result.found).toBe(false);
    expect(result.confidenceFlags.length).toBeGreaterThan(0);
  });
});
