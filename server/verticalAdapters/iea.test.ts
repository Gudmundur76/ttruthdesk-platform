/**
 * iea.test.ts
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
const mocks = vi.hoisted(() => ({ mockFetch: vi.fn() }));
vi.stubGlobal("fetch", mocks.mockFetch);

describe("ieaAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("is registered with domainKey 'iea'", async () => {
    const { registry } = await import("./types");
    await import("./iea");
    expect(registry.get("iea")?.domainKey).toBe("iea");
  });

  it("returns found=true when IEA returns an array of energy data points", async () => {
    mocks.mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [
        {
          country: "WORLD",
          product: "COAL",
          flow: "TPES",
          year: 2022,
          value: 5765.3,
          unit: "Mtoe",
        },
        {
          country: "WORLD",
          product: "COAL",
          flow: "TPES",
          year: 2021,
          value: 5612.1,
          unit: "Mtoe",
        },
      ],
    });
    const { registry } = await import("./types");
    await import("./iea");
    const adapter = registry.get("iea");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "Global coal consumption reached 5765 Mtoe in 2022",
      extractedValue: "5765 Mtoe coal 2022",
    });
    expect(result.found).toBe(true);
    expect(result.confidenceScore).toBeGreaterThan(0);
  });

  it("returns found=false when IEA returns empty array", async () => {
    mocks.mockFetch.mockResolvedValueOnce({ ok: true, json: async () => [] });
    const { registry } = await import("./types");
    await import("./iea");
    const adapter = registry.get("iea");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "Some obscure energy claim",
      extractedValue: null,
    });
    expect(result.found).toBe(false);
  });

  it("returns found=false when API returns HTTP error", async () => {
    mocks.mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });
    const { registry } = await import("./types");
    await import("./iea");
    const adapter = registry.get("iea");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "Global coal consumption",
      extractedValue: null,
    });
    expect(result.found).toBe(false);
  });

  it("returns found=false when fetch throws (network error)", async () => {
    mocks.mockFetch.mockRejectedValueOnce(new Error("network error"));
    const { registry } = await import("./types");
    await import("./iea");
    const adapter = registry.get("iea");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "Global coal consumption",
      extractedValue: null,
    });
    expect(result.found).toBe(false);
  });
});
