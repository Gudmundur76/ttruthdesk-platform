/**
 * eea.test.ts
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
const mocks = vi.hoisted(() => ({ mockFetch: vi.fn() }));
vi.stubGlobal("fetch", mocks.mockFetch);

describe("eeaAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("is registered with domainKey 'eea'", async () => {
    const { registry } = await import("./types");
    await import("./eea");
    expect(registry.get("eea")?.domainKey).toBe("eea");
  });

  it("returns found=true when EEA returns a valid indicator hit", async () => {
    mocks.mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        items: [
          {
            "@id":
              "https://www.eea.europa.eu/data-and-maps/indicators/air-quality-pm2-5",
            title: "Air quality — PM2.5 concentrations in Europe",
            description: "Annual mean PM2.5 concentrations in European cities.",
            effective: "2023-01-15T00:00:00Z",
            "@type": "Indicator",
          },
        ],
      }),
    });
    const { registry } = await import("./types");
    await import("./eea");
    const adapter = registry.get("eea");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "European PM2.5 air pollution exceeded WHO limits in 2022",
      extractedValue: "PM2.5 air pollution Europe 2022",
    });
    expect(result.found).toBe(true);
    expect(result.confidenceScore).toBeGreaterThan(0);
  });

  it("returns found=false when EEA returns empty items", async () => {
    mocks.mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ items: [] }),
    });
    const { registry } = await import("./types");
    await import("./eea");
    const adapter = registry.get("eea");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "Some obscure claim",
      extractedValue: null,
    });
    expect(result.found).toBe(false);
  });

  it("returns found=false when API returns HTTP error", async () => {
    mocks.mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });
    const { registry } = await import("./types");
    await import("./eea");
    const adapter = registry.get("eea");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "European air quality claim",
      extractedValue: null,
    });
    expect(result.found).toBe(false);
  });

  it("returns found=false when fetch throws (network error)", async () => {
    mocks.mockFetch.mockRejectedValueOnce(new Error("network error"));
    const { registry } = await import("./types");
    await import("./eea");
    const adapter = registry.get("eea");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "European air quality claim",
      extractedValue: null,
    });
    expect(result.found).toBe(false);
  });
});
