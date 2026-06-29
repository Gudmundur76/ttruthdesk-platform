/**
 * nasa_earthdata.test.ts
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
const mocks = vi.hoisted(() => ({ mockFetch: vi.fn() }));
vi.stubGlobal("fetch", mocks.mockFetch);

describe("nasaEarthdataAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("is registered with domainKey 'nasa_earthdata'", async () => {
    const { registry } = await import("./types");
    await import("./nasa_earthdata");
    expect(registry.get("nasa_earthdata")?.domainKey).toBe("nasa_earthdata");
  });

  it("returns found=true when API returns a valid hit", async () => {
    mocks.mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        feed: {
          entry: [
            {
              id: "GHRSST-OSTIA-UKMO-L4-GLOB-v2.0",
              title:
                "GHRSST Level 4 OSTIA Global Foundation Sea Surface Temperature",
              summary: "Global sea surface temperature analysis.",
              links: [
                {
                  href: "https://podaac.jpl.nasa.gov/dataset/GHRSST-OSTIA-UKMO-L4-GLOB-v2.0",
                },
              ],
            },
          ],
        },
      }),
    });
    const { registry } = await import("./types");
    await import("./nasa_earthdata");
    const adapter = registry.get("nasa_earthdata");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "Global sea surface temperature anomaly in 2023",
      extractedValue: "sea surface temperature 2023",
    });
    expect(result.found).toBe(true);
    expect(result.confidenceScore).toBeGreaterThan(0);
  });

  it("returns found=false when API returns empty results", async () => {
    mocks.mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ feed: { entry: [] } }),
    });
    const { registry } = await import("./types");
    await import("./nasa_earthdata");
    const adapter = registry.get("nasa_earthdata");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "Global sea surface temperature anomaly in 2023",
      extractedValue: null,
    });
    expect(result.found).toBe(false);
  });

  it("returns found=false when API returns HTTP error", async () => {
    mocks.mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });
    const { registry } = await import("./types");
    await import("./nasa_earthdata");
    const adapter = registry.get("nasa_earthdata");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "Global sea surface temperature anomaly in 2023",
      extractedValue: null,
    });
    expect(result.found).toBe(false);
  });

  it("returns found=false when fetch throws (network error)", async () => {
    mocks.mockFetch.mockRejectedValueOnce(new Error("network error"));
    const { registry } = await import("./types");
    await import("./nasa_earthdata");
    const adapter = registry.get("nasa_earthdata");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "Global sea surface temperature anomaly in 2023",
      extractedValue: null,
    });
    expect(result.found).toBe(false);
  });
});
