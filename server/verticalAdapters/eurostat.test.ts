/**
 * eurostat.test.ts
 * Unit tests for server/verticalAdapters/eurostat.ts
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({ mockFetch: vi.fn() }));
vi.stubGlobal("fetch", mocks.mockFetch);

describe("eurostatAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("is registered with domainKey 'eurostat'", async () => {
    const { registry } = await import("./types");
    await import("./eurostat");
    const adapter = registry.get("eurostat");
    expect(adapter).toBeDefined();
    expect(adapter?.domainKey).toBe("eurostat");
  });

  it("returns found=true when Eurostat API returns data", async () => {
    mocks.mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        dataset: "GDP_PER_CAPITA",
        dimension: {
          geo: { label: "geo", category: { label: { EU: "European Union" } } },
          time: { label: "time", category: { label: { "2022": "2022" } } },
        },
        value: { "0": 42.5, "1": 43.1 },
        label: "GDP per capita",
      }),
    });
    const { registry } = await import("./types");
    await import("./eurostat");
    const adapter = registry.get("eurostat");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "GDP_PER_CAPITA shows EU economic trends",
      extractedValue: "GDP_PER_CAPITA",
    });
    expect(result.found).toBe(true);
    expect(result.confidenceScore).toBeGreaterThan(0.5);
  });

  it("returns found=false when Eurostat API returns error", async () => {
    mocks.mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: "Not Found",
    });
    const { registry } = await import("./types");
    await import("./eurostat");
    const adapter = registry.get("eurostat");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "NONEXISTENT_DATASET shows some data",
      extractedValue: "NONEXISTENT_DATASET",
    });
    expect(result.found).toBe(false);
  });

  it("handles network errors gracefully", async () => {
    mocks.mockFetch.mockRejectedValueOnce(new Error("Network error"));
    const { registry } = await import("./types");
    await import("./eurostat");
    const adapter = registry.get("eurostat");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "HLTH_STAT shows health data",
      extractedValue: null,
    });
    expect(result.found).toBe(false);
  });
});
