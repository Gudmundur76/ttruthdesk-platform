/**
 * noaa.test.ts
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
const mocks = vi.hoisted(() => ({ mockFetch: vi.fn() }));
vi.stubGlobal("fetch", mocks.mockFetch);

describe("noaaAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  it("is registered with domainKey 'noaa'", async () => {
    const { registry } = await import("./types");
    await import("./noaa");
    expect(registry.get("noaa")?.domainKey).toBe("noaa");
  });

  it("returns found=true when global surface temperature data is available (public endpoint)", async () => {
    // noaa fetches global temp anomaly from a text/plain endpoint
    mocks.mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => "1880 -0.16\n1881 -0.08\n2023 0.98\n",
    });
    const { registry } = await import("./types");
    await import("./noaa");
    const adapter = registry.get("noaa");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "Global average temperature anomaly was 0.98°C in 2023",
      extractedValue: "0.98°C",
    });
    expect(result.found).toBe(true);
    expect(result.confidenceScore).toBeGreaterThan(0);
  });

  it("returns found=true when CDO datasets are available (with token)", async () => {
    vi.stubEnv("NOAA_CDO_TOKEN", "test-token");
    // When token is set, code goes directly to CDO path — only one fetch (CDO datasets)
    mocks.mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: [
          {
            id: "GHCND",
            name: "Daily Summaries",
            mindate: "1763-01-01",
            maxdate: "2024-01-01",
            datacoverage: 1.0,
          },
        ],
        metadata: { resultset: { count: 1 } },
      }),
    });
    const { registry } = await import("./types");
    await import("./noaa");
    const adapter = registry.get("noaa");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "Global average temperature anomaly was 0.98°C in 2023",
      extractedValue: "0.98°C",
    });
    expect(result.found).toBe(true);
  });

  it("returns found=false when global temp fetch fails", async () => {
    mocks.mockFetch.mockResolvedValueOnce({ ok: false, status: 503 });
    const { registry } = await import("./types");
    await import("./noaa");
    const adapter = registry.get("noaa");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "Global average temperature anomaly was 0.98°C in 2023",
      extractedValue: null,
    });
    expect(result.found).toBe(false);
  });

  it("returns found=false when fetch throws (network error)", async () => {
    mocks.mockFetch.mockRejectedValueOnce(new Error("network error"));
    const { registry } = await import("./types");
    await import("./noaa");
    const adapter = registry.get("noaa");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "Global average temperature anomaly was 0.98°C in 2023",
      extractedValue: null,
    });
    expect(result.found).toBe(false);
  });
});
