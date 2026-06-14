/**
 * who.test.ts
 * Unit tests for server/verticalAdapters/who.ts
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  mockFetch: vi.fn(),
}));

vi.stubGlobal("fetch", mocks.mockFetch);

describe("WHOAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("is registered with domainKey 'who'", async () => {
    const { registry } = await import("./types");
    await import("./who");
    const adapter = registry.get("who");
    expect(adapter).toBeDefined();
    expect(adapter?.domainKey).toBe("who");
  });

  it("returns found=true when WHO GHO API returns data", async () => {
    mocks.mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        value: [
          {
            NumericValue: 72.5,
            SpatialDimType: "COUNTRY",
            SpatialDim: "USA",
            TimeDim: 2022,
          },
        ],
      }),
    });
    const { registry } = await import("./types");
    await import("./who");
    const adapter = registry.get("who");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "Global life expectancy is 72 years according to WHO",
      extractedValue: "life expectancy",
    });
    expect(result.found).toBe(true);
    expect(result.confidenceScore).toBeGreaterThan(0.5);
  });

  it("returns found=false when WHO API returns empty data", async () => {
    mocks.mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ value: [] }),
    });
    const { registry } = await import("./types");
    await import("./who");
    const adapter = registry.get("who");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "Some health claim",
      extractedValue: "nonexistent_indicator",
    });
    expect(result.found).toBe(false);
  });

  it("handles network errors gracefully", async () => {
    mocks.mockFetch.mockRejectedValueOnce(new Error("Network error"));
    const { registry } = await import("./types");
    await import("./who");
    const adapter = registry.get("who");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "Global life expectancy claim",
      extractedValue: null,
    });
    expect(result.found).toBe(false);
    expect(result.confidenceFlags.length).toBeGreaterThan(0);
  });

  it("has required VerticalAdapter fields", async () => {
    const { registry } = await import("./types");
    await import("./who");
    const adapter = registry.get("who");
    expect(adapter?.displayName).toBeTruthy();
    expect(adapter?.description).toBeTruthy();
    expect(adapter?.claimExtractorPrompt).toBeTruthy();
    expect(adapter?.discoverySearchTerms).toBeInstanceOf(Array);
  });
});
