/**
 * bis_statistics.test.ts
 * Unit tests for server/verticalAdapters/bis_statistics.ts
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({ mockFetch: vi.fn() }));
vi.stubGlobal("fetch", mocks.mockFetch);

describe("bisStatisticsAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("is registered with domainKey 'bis_statistics'", async () => {
    const { registry } = await import("./types");
    await import("./bis_statistics");
    expect(registry.get("bis_statistics")?.domainKey).toBe("bis_statistics");
  });

  it("returns found=true when API returns a valid hit", async () => {
    mocks.mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: {
          dataflows: [
            { id: "WS_CREDIT_GAP", name: [{ value: "Credit-to-GDP gaps" }] },
          ],
        },
      }),
    });
    const { registry } = await import("./types");
    await import("./bis_statistics");
    const adapter = registry.get("bis_statistics");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "Global bank credit to GDP ratio reached 150% in 2022",
      extractedValue: "bank credit GDP ratio 2022",
    });
    expect(result.found).toBe(true);
    expect(result.confidenceScore).toBeGreaterThan(0);
  });

  it("returns found=false when API returns empty results", async () => {
    mocks.mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: { dataflows: [] } }),
    });
    const { registry } = await import("./types");
    await import("./bis_statistics");
    const adapter = registry.get("bis_statistics");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "Global bank credit to GDP ratio reached 150% in 2022",
      extractedValue: null,
    });
    expect(result.found).toBe(false);
  });

  it("returns found=false when API returns HTTP error", async () => {
    mocks.mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });
    const { registry } = await import("./types");
    await import("./bis_statistics");
    const adapter = registry.get("bis_statistics");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "Global bank credit to GDP ratio reached 150% in 2022",
      extractedValue: null,
    });
    expect(result.found).toBe(false);
  });

  it("returns found=false when fetch throws (network error)", async () => {
    mocks.mockFetch.mockRejectedValueOnce(new Error("network error"));
    const { registry } = await import("./types");
    await import("./bis_statistics");
    const adapter = registry.get("bis_statistics");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "Global bank credit to GDP ratio reached 150% in 2022",
      extractedValue: null,
    });
    expect(result.found).toBe(false);
  });
});
