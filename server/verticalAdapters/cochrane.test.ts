/**
 * cochrane.test.ts
 * Unit tests for server/verticalAdapters/cochrane.ts
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  mockFetch: vi.fn(),
}));

vi.stubGlobal("fetch", mocks.mockFetch);

describe("CochraneAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("is registered with domainKey 'cochrane'", async () => {
    const { registry } = await import("./types");
    await import("./cochrane");
    const adapter = registry.get("cochrane");
    expect(adapter).toBeDefined();
    expect(adapter?.domainKey).toBe("cochrane");
  });

  it("returns found=true when Cochrane API returns results", async () => {
    mocks.mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: [
          {
            doi: "10.1002/14651858.CD001234",
            title: "Systematic review of aspirin for pain",
            abstract: "A systematic review...",
            year: 2022,
          },
        ],
      }),
    });
    const { registry } = await import("./types");
    await import("./cochrane");
    const adapter = registry.get("cochrane");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "Aspirin is effective for pain relief",
      extractedValue: "aspirin pain relief",
    });
    expect(result.found).toBe(true);
    expect(result.confidenceScore).toBeGreaterThan(0.5);
  });

  it("returns found=false when Cochrane API returns no results", async () => {
    mocks.mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ results: [] }),
    });
    const { registry } = await import("./types");
    await import("./cochrane");
    const adapter = registry.get("cochrane");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "Completely made up medical claim",
      extractedValue: "xyznonexistent",
    });
    expect(result.found).toBe(false);
  });

  it("handles network errors gracefully", async () => {
    mocks.mockFetch.mockRejectedValueOnce(new Error("Network error"));
    const { registry } = await import("./types");
    await import("./cochrane");
    const adapter = registry.get("cochrane");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "Some medical claim",
      extractedValue: null,
    });
    expect(result.found).toBe(false);
    expect(result.confidenceFlags.length).toBeGreaterThan(0);
  });
});
