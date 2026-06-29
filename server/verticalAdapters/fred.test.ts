/**
 * fred.test.ts
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
const mocks = vi.hoisted(() => ({ mockFetch: vi.fn() }));
vi.stubGlobal("fetch", mocks.mockFetch);

describe("fredAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  it("is registered with domainKey 'fred'", async () => {
    const { registry } = await import("./types");
    await import("./fred");
    expect(registry.get("fred")?.domainKey).toBe("fred");
  });

  it("returns found=false when FRED_API_KEY is not set", async () => {
    vi.stubEnv("FRED_API_KEY", "");
    const { registry } = await import("./types");
    await import("./fred");
    const adapter = registry.get("fred");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "US GDP growth rate was 2.5% in 2023",
      extractedValue: "2.5%",
    });
    expect(result.found).toBe(false);
    expect(
      result.confidenceFlags.some(
        (f: string) =>
          f.includes("api_key") || f.includes("FRED") || f.includes("key")
      )
    ).toBe(true);
  });

  it("returns found=false when claim does not match economics signals", async () => {
    vi.stubEnv("FRED_API_KEY", "test-key");
    const { registry } = await import("./types");
    await import("./fred");
    const adapter = registry.get("fred");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "The sky is blue today",
      extractedValue: null,
    });
    expect(result.found).toBe(false);
  });

  it("returns found=true when FRED API returns a valid series with observations", async () => {
    vi.stubEnv("FRED_API_KEY", "test-key");
    // First call: series metadata
    mocks.mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        seriess: [
          {
            id: "GDP",
            title: "Gross Domestic Product",
            units: "Billions of Dollars",
            frequency: "Quarterly",
          },
        ],
      }),
    });
    // Second call: observations
    mocks.mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        observations: [
          { date: "2023-10-01", value: "27610.1" },
          { date: "2023-07-01", value: "27357.9" },
        ],
      }),
    });
    const { registry } = await import("./types");
    await import("./fred");
    const adapter = registry.get("fred");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "US GDP growth rate was 2.5% in 2023",
      extractedValue: "2.5%",
    });
    expect(result.found).toBe(true);
    expect(result.confidenceScore).toBeGreaterThan(0);
  });

  it("returns found=false when fetch throws (network error)", async () => {
    vi.stubEnv("FRED_API_KEY", "test-key");
    mocks.mockFetch.mockRejectedValueOnce(new Error("network error"));
    const { registry } = await import("./types");
    await import("./fred");
    const adapter = registry.get("fred");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "US GDP growth rate was 2.5% in 2023",
      extractedValue: "2.5%",
    });
    expect(result.found).toBe(false);
  });
});
