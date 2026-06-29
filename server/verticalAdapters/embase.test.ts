/**
 * embase.test.ts
 * Unit tests for server/verticalAdapters/embase.ts
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({ mockFetch: vi.fn() }));
vi.stubGlobal("fetch", mocks.mockFetch);

describe("embaseAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("is registered with domainKey 'embase'", async () => {
    const { registry } = await import("./types");
    await import("./embase");
    expect(registry.get("embase")?.domainKey).toBe("embase");
  });

  it("returns found=true when API returns a valid hit", async () => {
    mocks.mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        resultList: {
          result: [
            {
              id: "PMC9876543",
              title: "Metformin and Cardiovascular Outcomes",
              authorString: "Smith J, Jones A",
              pubYear: "2023",
              doi: "10.1016/j.jacc.2023.01.001",
              abstractText: "Metformin reduces cardiovascular events in T2DM.",
            },
          ],
        },
        hitCount: 1,
      }),
    });
    const { registry } = await import("./types");
    await import("./embase");
    const adapter = registry.get("embase");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText:
        "Metformin reduces cardiovascular risk in type 2 diabetes patients",
      extractedValue: "metformin cardiovascular risk diabetes",
    });
    expect(result.found).toBe(true);
    expect(result.confidenceScore).toBeGreaterThan(0);
  });

  it("returns found=false when API returns empty results", async () => {
    mocks.mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ resultList: { result: [] }, hitCount: 0 }),
    });
    const { registry } = await import("./types");
    await import("./embase");
    const adapter = registry.get("embase");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText:
        "Metformin reduces cardiovascular risk in type 2 diabetes patients",
      extractedValue: null,
    });
    expect(result.found).toBe(false);
  });

  it("returns found=false when API returns HTTP error", async () => {
    mocks.mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });
    const { registry } = await import("./types");
    await import("./embase");
    const adapter = registry.get("embase");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText:
        "Metformin reduces cardiovascular risk in type 2 diabetes patients",
      extractedValue: null,
    });
    expect(result.found).toBe(false);
  });

  it("returns found=false when fetch throws (network error)", async () => {
    mocks.mockFetch.mockRejectedValueOnce(new Error("network error"));
    const { registry } = await import("./types");
    await import("./embase");
    const adapter = registry.get("embase");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText:
        "Metformin reduces cardiovascular risk in type 2 diabetes patients",
      extractedValue: null,
    });
    expect(result.found).toBe(false);
  });
});
