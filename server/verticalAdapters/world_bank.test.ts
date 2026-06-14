/**
 * world_bank.test.ts
 * Unit tests for server/verticalAdapters/world_bank.ts
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  mockFetch: vi.fn(),
}));

vi.stubGlobal("fetch", mocks.mockFetch);

describe("worldBankAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("is registered with domainKey 'world_bank'", async () => {
    const { registry } = await import("./types");
    await import("./world_bank");
    const adapter = registry.get("world_bank");
    expect(adapter).toBeDefined();
    expect(adapter?.domainKey).toBe("world_bank");
  });

  it("returns found=true when World Bank API returns indicator data", async () => {
    mocks.mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ([
        { page: 1, pages: 1, per_page: 50, total: 1 },
        [
          {
            indicator: { id: "NY.GDP.MKTP.CD", value: "GDP (current US$)" },
            country: { id: "US", value: "United States" },
            value: 25000000000000,
            date: "2022",
          },
        ],
      ]),
    });
    const { registry } = await import("./types");
    await import("./world_bank");
    const adapter = registry.get("world_bank");
    if (!adapter) throw new Error("Adapter not registered");
    // Must include the actual indicator code pattern in claimText for the regex to match
    const result = await adapter.lookupEvidence({
      claimText: "According to NY.GDP.MKTP.CD, US GDP is approximately $25 trillion",
      extractedValue: "NY.GDP.MKTP.CD",
    });
    expect(result.found).toBe(true);
    expect(result.confidenceScore).toBeGreaterThan(0.5);
  });

  it("returns found=false when World Bank returns empty data", async () => {
    mocks.mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ([
        { page: 1, pages: 0, per_page: 50, total: 0 },
        null,
      ]),
    });
    const { registry } = await import("./types");
    await import("./world_bank");
    const adapter = registry.get("world_bank");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "Some economic claim",
      extractedValue: "nonexistent_indicator",
    });
    expect(result.found).toBe(false);
  });

  it("handles network errors gracefully", async () => {
    mocks.mockFetch.mockRejectedValueOnce(new Error("Network error"));
    const { registry } = await import("./types");
    await import("./world_bank");
    const adapter = registry.get("world_bank");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "Some economic claim",
      extractedValue: null,
    });
    expect(result.found).toBe(false);
    expect(result.confidenceFlags.length).toBeGreaterThan(0);
  });
});
