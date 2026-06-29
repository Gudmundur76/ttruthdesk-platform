/**
 * openfda_adverse.test.ts
 * Unit tests for server/verticalAdapters/openfda_adverse.ts
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({ mockFetch: vi.fn() }));
vi.stubGlobal("fetch", mocks.mockFetch);

describe("openfdaAdverseAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("is registered with domainKey 'openfda_adverse'", async () => {
    const { registry } = await import("./types");
    await import("./openfda_adverse");
    expect(registry.get("openfda_adverse")?.domainKey).toBe("openfda_adverse");
  });

  it("returns found=true when API returns a valid hit", async () => {
    mocks.mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: [
          {
            safetyreportid: "US-FDA-2023-12345",
            receivedate: "20230601",
            patient: {
              reaction: [{ reactionmeddrapt: "GASTROINTESTINAL HAEMORRHAGE" }],
              drug: [{ medicinalproduct: "ASPIRIN", drugindication: "PAIN" }],
            },
            serious: "1",
          },
        ],
        meta: { results: { total: 1 } },
      }),
    });
    const { registry } = await import("./types");
    await import("./openfda_adverse");
    const adapter = registry.get("openfda_adverse");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText:
        "Aspirin is associated with gastrointestinal bleeding adverse events",
      extractedValue: "aspirin gastrointestinal bleeding",
    });
    expect(result.found).toBe(true);
    expect(result.confidenceScore).toBeGreaterThan(0);
  });

  it("returns found=false when API returns empty results", async () => {
    mocks.mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ results: [], meta: { results: { total: 0 } } }),
    });
    const { registry } = await import("./types");
    await import("./openfda_adverse");
    const adapter = registry.get("openfda_adverse");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText:
        "Aspirin is associated with gastrointestinal bleeding adverse events",
      extractedValue: null,
    });
    expect(result.found).toBe(false);
  });

  it("returns found=false when API returns HTTP error", async () => {
    mocks.mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });
    const { registry } = await import("./types");
    await import("./openfda_adverse");
    const adapter = registry.get("openfda_adverse");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText:
        "Aspirin is associated with gastrointestinal bleeding adverse events",
      extractedValue: null,
    });
    expect(result.found).toBe(false);
  });

  it("returns found=false when fetch throws (network error)", async () => {
    mocks.mockFetch.mockRejectedValueOnce(new Error("network error"));
    const { registry } = await import("./types");
    await import("./openfda_adverse");
    const adapter = registry.get("openfda_adverse");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText:
        "Aspirin is associated with gastrointestinal bleeding adverse events",
      extractedValue: null,
    });
    expect(result.found).toBe(false);
  });
});
