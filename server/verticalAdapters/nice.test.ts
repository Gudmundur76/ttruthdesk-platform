/**
 * nice.test.ts
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
const mocks = vi.hoisted(() => ({ mockFetch: vi.fn() }));
vi.stubGlobal("fetch", mocks.mockFetch);

describe("niceAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("is registered with domainKey 'nice'", async () => {
    const { registry } = await import("./types");
    await import("./nice");
    expect(registry.get("nice")?.domainKey).toBe("nice");
  });

  it("returns found=true when NICE returns a valid guideline hit", async () => {
    mocks.mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        guidance: [
          {
            id: "ng28",
            title: "Type 2 diabetes in adults: management",
            type: "Clinical guideline",
            publishedDate: "2015-12-02",
            url: "https://www.nice.org.uk/guidance/ng28",
          },
        ],
      }),
    });
    const { registry } = await import("./types");
    await import("./nice");
    const adapter = registry.get("nice");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText:
        "NICE recommends metformin as first-line treatment for type 2 diabetes",
      extractedValue: "type 2 diabetes metformin",
    });
    expect(result.found).toBe(true);
    expect(result.confidenceScore).toBeGreaterThan(0);
  });

  it("returns found=false when NICE returns empty guidance", async () => {
    mocks.mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ guidance: [] }),
    });
    const { registry } = await import("./types");
    await import("./nice");
    const adapter = registry.get("nice");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "Some obscure clinical claim",
      extractedValue: null,
    });
    expect(result.found).toBe(false);
  });

  it("returns found=false when API returns HTTP error", async () => {
    mocks.mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });
    const { registry } = await import("./types");
    await import("./nice");
    const adapter = registry.get("nice");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "NICE guideline claim",
      extractedValue: null,
    });
    expect(result.found).toBe(false);
  });

  it("returns found=false when fetch throws (network error)", async () => {
    mocks.mockFetch.mockRejectedValueOnce(new Error("network error"));
    const { registry } = await import("./types");
    await import("./nice");
    const adapter = registry.get("nice");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "NICE guideline claim",
      extractedValue: null,
    });
    expect(result.found).toBe(false);
  });
});
