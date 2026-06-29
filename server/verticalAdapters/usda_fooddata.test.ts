/**
 * usda_fooddata.test.ts
 * Unit tests for server/verticalAdapters/usda_fooddata.ts
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({ mockFetch: vi.fn() }));
vi.stubGlobal("fetch", mocks.mockFetch);

describe("usdaFooddataAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("is registered with domainKey 'usda_fooddata'", async () => {
    const { registry } = await import("./types");
    await import("./usda_fooddata");
    expect(registry.get("usda_fooddata")?.domainKey).toBe("usda_fooddata");
  });

  it("returns found=true when API returns a valid hit", async () => {
    mocks.mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        foods: [
          {
            fdcId: 171265,
            description: "Milk, whole, 3.25% milkfat",
            dataType: "SR Legacy",
            foodNutrients: [
              { nutrientName: "Protein", value: 8.0, unitName: "G" },
            ],
          },
        ],
        totalHits: 1,
      }),
    });
    const { registry } = await import("./types");
    await import("./usda_fooddata");
    const adapter = registry.get("usda_fooddata");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText:
        "One cup of whole milk contains approximately 8 grams of protein",
      extractedValue: "whole milk protein content",
    });
    expect(result.found).toBe(true);
    expect(result.confidenceScore).toBeGreaterThan(0);
  });

  it("returns found=false when API returns empty results", async () => {
    mocks.mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ foods: [], totalHits: 0 }),
    });
    const { registry } = await import("./types");
    await import("./usda_fooddata");
    const adapter = registry.get("usda_fooddata");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText:
        "One cup of whole milk contains approximately 8 grams of protein",
      extractedValue: null,
    });
    expect(result.found).toBe(false);
  });

  it("returns found=false when API returns HTTP error", async () => {
    mocks.mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });
    const { registry } = await import("./types");
    await import("./usda_fooddata");
    const adapter = registry.get("usda_fooddata");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText:
        "One cup of whole milk contains approximately 8 grams of protein",
      extractedValue: null,
    });
    expect(result.found).toBe(false);
  });

  it("returns found=false when fetch throws (network error)", async () => {
    mocks.mockFetch.mockRejectedValueOnce(new Error("network error"));
    const { registry } = await import("./types");
    await import("./usda_fooddata");
    const adapter = registry.get("usda_fooddata");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText:
        "One cup of whole milk contains approximately 8 grams of protein",
      extractedValue: null,
    });
    expect(result.found).toBe(false);
  });
});
