/**
 * openfda_labels.test.ts
 * Unit tests for server/verticalAdapters/openfda_labels.ts
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({ mockFetch: vi.fn() }));
vi.stubGlobal("fetch", mocks.mockFetch);

describe("openFdaLabelsAdapter", () => {
  beforeEach(() => { vi.clearAllMocks(); vi.resetModules(); });

  it("is registered with domainKey 'openfda_labels'", async () => {
    const { registry } = await import("./types");
    await import("./openfda_labels");
    const adapter = registry.get("openfda_labels");
    expect(adapter).toBeDefined();
    expect(adapter?.domainKey).toBe("openfda_labels");
  });

  it("returns found=true when FDA returns drug label results", async () => {
    mocks.mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: [
          {
            id: "0001234567890abcdef",
            set_id: "abc123",
            openfda: {
              brand_name: ["ASPIRIN"],
              generic_name: ["ASPIRIN"],
              manufacturer_name: ["Bayer"],
            },
            indications_and_usage: ["For the temporary relief of minor aches and pains"],
          },
        ],
        meta: { results: { total: 1 } },
      }),
    });
    const { registry } = await import("./types");
    await import("./openfda_labels");
    const adapter = registry.get("openfda_labels");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "Aspirin is approved for pain relief",
      extractedValue: "aspirin",
    });
    expect(result.found).toBe(true);
    expect(result.confidenceScore).toBeGreaterThan(0.5);
  });

  it("returns found=false when FDA returns no results", async () => {
    mocks.mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ results: [], meta: { results: { total: 0 } } }),
    });
    const { registry } = await import("./types");
    await import("./openfda_labels");
    const adapter = registry.get("openfda_labels");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "Unknown drug XYZ is approved",
      extractedValue: null,
    });
    expect(result.found).toBe(false);
  });

  it("handles HTTP errors gracefully", async () => {
    mocks.mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
    });
    const { registry } = await import("./types");
    await import("./openfda_labels");
    const adapter = registry.get("openfda_labels");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "Some drug claim",
      extractedValue: null,
    });
    expect(result.found).toBe(false);
  });
});
