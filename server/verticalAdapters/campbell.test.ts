/**
 * campbell.test.ts
 * Unit tests for server/verticalAdapters/campbell.ts
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({ mockFetch: vi.fn() }));
vi.stubGlobal("fetch", mocks.mockFetch);

describe("campbellAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("is registered with domainKey 'campbell'", async () => {
    const { registry } = await import("./types");
    await import("./campbell");
    expect(registry.get("campbell")?.domainKey).toBe("campbell");
  });

  it("returns found=true when API returns a valid hit", async () => {
    mocks.mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [
          {
            id: 123,
            title: "Effects of Early Childhood Programs",
            abstract: "Meta-analysis of early childhood interventions.",
            doi: "10.4073/csr.2022.1",
            url: "https://www.campbellcollaboration.org/library/early-childhood-programs.html",
            published_at: "2022-01-15",
            authors: ["Smith, J.", "Jones, A."],
            group: "Education",
            status: "published",
            type: "systematic_review",
          },
        ],
        meta: { total: 1 },
      }),
    });
    const { registry } = await import("./types");
    await import("./campbell");
    const adapter = registry.get("campbell");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "Early childhood interventions improve educational outcomes",
      extractedValue: "early childhood intervention education",
    });
    expect(result.found).toBe(true);
    expect(result.confidenceScore).toBeGreaterThan(0);
  });

  it("returns found=false when API returns empty results", async () => {
    mocks.mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [], meta: { total: 0 } }),
    });
    const { registry } = await import("./types");
    await import("./campbell");
    const adapter = registry.get("campbell");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "Early childhood interventions improve educational outcomes",
      extractedValue: null,
    });
    expect(result.found).toBe(false);
  });

  it("returns found=false when API returns HTTP error", async () => {
    mocks.mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });
    const { registry } = await import("./types");
    await import("./campbell");
    const adapter = registry.get("campbell");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "Early childhood interventions improve educational outcomes",
      extractedValue: null,
    });
    expect(result.found).toBe(false);
  });

  it("returns found=false when fetch throws (network error)", async () => {
    mocks.mockFetch.mockRejectedValueOnce(new Error("network error"));
    const { registry } = await import("./types");
    await import("./campbell");
    const adapter = registry.get("campbell");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "Early childhood interventions improve educational outcomes",
      extractedValue: null,
    });
    expect(result.found).toBe(false);
  });
});
