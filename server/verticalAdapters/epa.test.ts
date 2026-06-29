/**
 * epa.test.ts
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
const mocks = vi.hoisted(() => ({ mockFetch: vi.fn() }));
vi.stubGlobal("fetch", mocks.mockFetch);

describe("epaAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("is registered with domainKey 'epa'", async () => {
    const { registry } = await import("./types");
    await import("./epa");
    expect(registry.get("epa")?.domainKey).toBe("epa");
  });

  it("returns found=true when EPA Science Inventory returns a valid hit", async () => {
    mocks.mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: [
          {
            si_id: "123456",
            title: "Air Quality Index Trends in Los Angeles Basin",
            abstract:
              "Analysis of PM2.5 concentrations in the Los Angeles metropolitan area.",
            pub_year: "2023",
            authors: "Smith, J.; Jones, A.",
            product_type: "Journal Article",
            url: "https://cfpub.epa.gov/si/si_public_record_report.cfm?Lab=NRMRL&dirEntryId=123456",
          },
        ],
        total_records: 1,
      }),
    });
    const { registry } = await import("./types");
    await import("./epa");
    const adapter = registry.get("epa");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "US air quality index exceeded 150 in Los Angeles in 2023",
      extractedValue: "air quality index Los Angeles 2023",
    });
    expect(result.found).toBe(true);
    expect(result.confidenceScore).toBeGreaterThan(0);
  });

  it("returns found=false when EPA returns empty results", async () => {
    mocks.mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ results: [], total_records: 0 }),
    });
    const { registry } = await import("./types");
    await import("./epa");
    const adapter = registry.get("epa");
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
    await import("./epa");
    const adapter = registry.get("epa");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "Air quality claim",
      extractedValue: null,
    });
    expect(result.found).toBe(false);
  });

  it("returns found=false when fetch throws (network error)", async () => {
    mocks.mockFetch.mockRejectedValueOnce(new Error("network error"));
    const { registry } = await import("./types");
    await import("./epa");
    const adapter = registry.get("epa");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "Air quality claim",
      extractedValue: null,
    });
    expect(result.found).toBe(false);
  });
});
