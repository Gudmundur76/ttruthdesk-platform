/**
 * owid.test.ts
 * Unit tests for server/verticalAdapters/owid.ts
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  mockFetch: vi.fn(),
}));

vi.stubGlobal("fetch", mocks.mockFetch);

describe("owidAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("is registered with domainKey 'owid'", async () => {
    const { registry } = await import("./types");
    await import("./owid");
    const adapter = registry.get("owid");
    expect(adapter).toBeDefined();
    expect(adapter?.domainKey).toBe("owid");
  });

  it("returns found=true when CSV fetch succeeds for a slug in claimText", async () => {
    mocks.mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => "Year,Value\n2022,72.5\n",
    });
    const { registry } = await import("./types");
    await import("./owid");
    const adapter = registry.get("owid");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "See ourworldindata.org/grapher/life-expectancy for data",
      extractedValue: null,
    });
    expect(result.found).toBe(true);
    expect(result.confidenceScore).toBeGreaterThan(0.5);
  });

  it("falls back to search and returns found=true when HTML contains grapher link", async () => {
    // No slug in claimText, falls back to search
    mocks.mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => '<a href="/grapher/life-expectancy">Life expectancy</a>',
    });
    const { registry } = await import("./types");
    await import("./owid");
    const adapter = registry.get("owid");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "Life expectancy has increased globally",
      extractedValue: "life expectancy",
    });
    expect(result.found).toBe(true);
  });

  it("returns found=false when search returns no grapher links", async () => {
    mocks.mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => "<html><body>No results</body></html>",
    });
    const { registry } = await import("./types");
    await import("./owid");
    const adapter = registry.get("owid");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "Completely made up claim",
      extractedValue: null,
    });
    expect(result.found).toBe(false);
  });

  it("handles network errors gracefully", async () => {
    mocks.mockFetch.mockRejectedValueOnce(new Error("Network error"));
    const { registry } = await import("./types");
    await import("./owid");
    const adapter = registry.get("owid");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "Some claim",
      extractedValue: null,
    });
    expect(result.found).toBe(false);
  });
});
