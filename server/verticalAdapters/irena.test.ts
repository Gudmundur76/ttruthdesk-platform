/**
 * irena.test.ts
 * Unit tests for server/verticalAdapters/irena.ts
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({ mockFetch: vi.fn() }));
vi.stubGlobal("fetch", mocks.mockFetch);

describe("irenaAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("is registered with domainKey 'irena'", async () => {
    const { registry } = await import("./types");
    await import("./irena");
    expect(registry.get("irena")?.domainKey).toBe("irena");
  });

  it("returns found=true when API returns a valid hit", async () => {
    mocks.mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [["2022", "900000"]],
        columns: [{ code: "Year" }, { code: "Value" }],
      }),
    });
    const { registry } = await import("./types");
    await import("./irena");
    const adapter = registry.get("irena");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "Wind energy capacity grew to 900 GW globally in 2022",
      extractedValue: "wind energy capacity 2022",
    });
    expect(result.found).toBe(true);
    expect(result.confidenceScore).toBeGreaterThan(0);
  });

  it("returns found=false when API returns empty results", async () => {
    mocks.mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [] }),
    });
    const { registry } = await import("./types");
    await import("./irena");
    const adapter = registry.get("irena");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "Wind energy capacity grew to 900 GW globally in 2022",
      extractedValue: null,
    });
    expect(result.found).toBe(false);
  });

  it("returns found=false when API returns HTTP error", async () => {
    mocks.mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });
    const { registry } = await import("./types");
    await import("./irena");
    const adapter = registry.get("irena");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "Wind energy capacity grew to 900 GW globally in 2022",
      extractedValue: null,
    });
    expect(result.found).toBe(false);
  });

  it("returns found=false when fetch throws (network error)", async () => {
    mocks.mockFetch.mockRejectedValueOnce(new Error("network error"));
    const { registry } = await import("./types");
    await import("./irena");
    const adapter = registry.get("irena");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "Wind energy capacity grew to 900 GW globally in 2022",
      extractedValue: null,
    });
    expect(result.found).toBe(false);
  });
});
