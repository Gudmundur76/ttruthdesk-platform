/**
 * oecd.test.ts
 * Unit tests for server/verticalAdapters/oecd.ts
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  mockFetch: vi.fn(),
}));

vi.stubGlobal("fetch", mocks.mockFetch);

describe("oecdAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("is registered with domainKey 'oecd'", async () => {
    const { registry } = await import("./types");
    await import("./oecd");
    const adapter = registry.get("oecd");
    expect(adapter).toBeDefined();
    expect(adapter?.domainKey).toBe("oecd");
  });

  it("returns found=true when OECD API returns data", async () => {
    mocks.mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        dataSets: [{ series: { "0:0:0": { observations: { "0": [42.5] } } } }],
        structure: { dimensions: { series: [] } },
      }),
    });
    const { registry } = await import("./types");
    await import("./oecd");
    const adapter = registry.get("oecd");
    if (!adapter) throw new Error("Adapter not registered");
    // OECD extracts first uppercase word as dataset code
    const result = await adapter.lookupEvidence({
      claimText: "EDU_FIN shows education spending trends",
      extractedValue: "EDU_FIN",
    });
    expect(result.found).toBe(true);
    expect(result.confidenceScore).toBeGreaterThan(0.5);
  });

  it("returns found=false when OECD API returns error", async () => {
    mocks.mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: "Not Found",
    });
    const { registry } = await import("./types");
    await import("./oecd");
    const adapter = registry.get("oecd");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "NONEXISTENT_DATASET shows some data",
      extractedValue: null,
    });
    expect(result.found).toBe(false);
  });

  it("handles network errors gracefully", async () => {
    mocks.mockFetch.mockRejectedValueOnce(new Error("Network error"));
    const { registry } = await import("./types");
    await import("./oecd");
    const adapter = registry.get("oecd");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "HEALTH_STAT shows health data",
      extractedValue: null,
    });
    expect(result.found).toBe(false);
    expect(result.confidenceFlags.length).toBeGreaterThan(0);
  });
});
