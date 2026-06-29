/**
 * usgs.test.ts
 * Unit tests for server/verticalAdapters/usgs.ts
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({ mockFetch: vi.fn() }));
vi.stubGlobal("fetch", mocks.mockFetch);

describe("usgsAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("is registered with domainKey 'usgs'", async () => {
    const { registry } = await import("./types");
    await import("./usgs");
    expect(registry.get("usgs")?.domainKey).toBe("usgs");
  });

  it("returns found=true when API returns a valid hit", async () => {
    mocks.mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        features: [
          {
            id: "us7000abc1",
            properties: {
              mag: 7.2,
              place: "Turkey",
              time: 1674000000000,
              url: "https://earthquake.usgs.gov/earthquakes/eventpage/us7000abc1",
              title: "M 7.2 - Turkey",
            },
          },
        ],
        metadata: { count: 1 },
      }),
    });
    const { registry } = await import("./types");
    await import("./usgs");
    const adapter = registry.get("usgs");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "A magnitude 7.2 earthquake struck Turkey in 2023",
      extractedValue: "magnitude 7.2 earthquake Turkey",
    });
    expect(result.found).toBe(true);
    expect(result.confidenceScore).toBeGreaterThan(0);
  });

  it("returns found=false when API returns empty results", async () => {
    mocks.mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ features: [], metadata: { count: 0 } }),
    });
    const { registry } = await import("./types");
    await import("./usgs");
    const adapter = registry.get("usgs");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "A magnitude 7.2 earthquake struck Turkey in 2023",
      extractedValue: null,
    });
    expect(result.found).toBe(false);
  });

  it("returns found=false when API returns HTTP error", async () => {
    mocks.mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });
    const { registry } = await import("./types");
    await import("./usgs");
    const adapter = registry.get("usgs");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "A magnitude 7.2 earthquake struck Turkey in 2023",
      extractedValue: null,
    });
    expect(result.found).toBe(false);
  });

  it("returns found=false when fetch throws (network error)", async () => {
    mocks.mockFetch.mockRejectedValueOnce(new Error("network error"));
    const { registry } = await import("./types");
    await import("./usgs");
    const adapter = registry.get("usgs");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "A magnitude 7.2 earthquake struck Turkey in 2023",
      extractedValue: null,
    });
    expect(result.found).toBe(false);
  });
});
