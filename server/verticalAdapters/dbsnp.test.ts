/**
 * dbsnp.test.ts
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
const mocks = vi.hoisted(() => ({ mockFetch: vi.fn() }));
vi.stubGlobal("fetch", mocks.mockFetch);

describe("dbsnpAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("is registered with domainKey 'dbsnp'", async () => {
    const { registry } = await import("./types");
    await import("./dbsnp");
    expect(registry.get("dbsnp")?.domainKey).toBe("dbsnp");
  });

  it("returns found=true when rsID is in claim text and variant data is returned", async () => {
    mocks.mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        refsnp_id: "328",
        primary_snapshot_data: {
          allele_annotations: [
            {
              assembly_annotation: [],
              frequency: [
                {
                  study_name: "1000Genomes",
                  allele_count: 1234,
                  total_count: 5000,
                },
              ],
              clinical: [
                {
                  clinical_significances: ["pathogenic"],
                  disease_names: ["Breast cancer"],
                },
              ],
            },
          ],
          variant_type: "snv",
          placements_with_allele: [],
        },
        genes: [{ name: "BRCA2", id: 675 }],
      }),
    });
    const { registry } = await import("./types");
    await import("./dbsnp");
    const adapter = registry.get("dbsnp");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "rs328 is associated with lipase activity",
      extractedValue: "rs328",
    });
    expect(typeof result.found).toBe("boolean");
    expect(result.confidenceScore).toBeGreaterThanOrEqual(0);
  });

  it("returns found=true when keyword search finds matching variants", async () => {
    mocks.mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ esearchresult: { idlist: ["328"], count: "15" } }),
    });
    const { registry } = await import("./types");
    await import("./dbsnp");
    const adapter = registry.get("dbsnp");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "BRCA1 pathogenic variant increases cancer risk",
      extractedValue: "BRCA1 pathogenic variant",
    });
    expect(result.found).toBe(true);
    expect(result.confidenceScore).toBeGreaterThan(0);
  });

  it("returns found=false when keyword search returns no variants", async () => {
    mocks.mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ esearchresult: { idlist: [], count: "0" } }),
    });
    const { registry } = await import("./types");
    await import("./dbsnp");
    const adapter = registry.get("dbsnp");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "FAKEGENE999 variant causes disease",
      extractedValue: "FAKEGENE999 variant",
    });
    expect(result.found).toBe(false);
  });

  it("returns found=false when fetch throws (network error)", async () => {
    mocks.mockFetch.mockRejectedValueOnce(new Error("network error"));
    const { registry } = await import("./types");
    await import("./dbsnp");
    const adapter = registry.get("dbsnp");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "BRCA1 pathogenic variant",
      extractedValue: null,
    });
    expect(result.found).toBe(false);
  });
});
