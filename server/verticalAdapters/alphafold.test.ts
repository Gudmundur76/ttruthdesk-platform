/**
 * alphafold.test.ts
 * Unit tests for server/verticalAdapters/alphafold.ts
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({ mockFetch: vi.fn() }));
vi.stubGlobal("fetch", mocks.mockFetch);

describe("alphafoldAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("is registered with domainKey 'alphafold'", async () => {
    const { registry } = await import("./types");
    await import("./alphafold");
    expect(registry.get("alphafold")?.domainKey).toBe("alphafold");
  });

  it("returns found=true when API returns a valid hit", async () => {
    mocks.mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [
        {
          entryId: "AF-P04637-F1",
          gene: "TP53",
          uniprotAccession: "P04637",
          uniprotId: "P53_HUMAN",
          uniprotDescription: "Cellular tumor antigen p53",
          taxId: 9606,
          organismScientificName: "Homo sapiens",
          uniprotStart: 1,
          uniprotEnd: 393,
          uniprotSequenceVersion: 4,
          modelCreatedDate: "2022-06-01",
          latestVersion: 4,
          allVersions: [1, 2, 3, 4],
          cifUrl: "https://alphafold.ebi.ac.uk/files/AF-P04637-F1-model_v4.cif",
          bcifUrl:
            "https://alphafold.ebi.ac.uk/files/AF-P04637-F1-model_v4.bcif",
          pdbUrl: "https://alphafold.ebi.ac.uk/files/AF-P04637-F1-model_v4.pdb",
          paeImageUrl:
            "https://alphafold.ebi.ac.uk/files/AF-P04637-F1-predicted_aligned_error_v4.png",
          paeDocUrl:
            "https://alphafold.ebi.ac.uk/files/AF-P04637-F1-predicted_aligned_error_v4.json",
        },
      ],
    });
    const { registry } = await import("./types");
    await import("./alphafold");
    const adapter = registry.get("alphafold");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText:
        "AlphaFold predicted the structure of human p53 tumor suppressor protein",
      extractedValue: "P04637",
    });
    expect(result.found).toBe(true);
    expect(result.confidenceScore).toBeGreaterThan(0);
  });

  it("returns found=false when API returns empty results", async () => {
    mocks.mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [],
    });
    const { registry } = await import("./types");
    await import("./alphafold");
    const adapter = registry.get("alphafold");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText:
        "AlphaFold predicted the structure of human p53 tumor suppressor protein",
      extractedValue: null,
    });
    expect(result.found).toBe(false);
  });

  it("returns found=false when API returns HTTP error", async () => {
    mocks.mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });
    const { registry } = await import("./types");
    await import("./alphafold");
    const adapter = registry.get("alphafold");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText:
        "AlphaFold predicted the structure of human p53 tumor suppressor protein",
      extractedValue: null,
    });
    expect(result.found).toBe(false);
  });

  it("returns found=false when fetch throws (network error)", async () => {
    mocks.mockFetch.mockRejectedValueOnce(new Error("network error"));
    const { registry } = await import("./types");
    await import("./alphafold");
    const adapter = registry.get("alphafold");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText:
        "AlphaFold predicted the structure of human p53 tumor suppressor protein",
      extractedValue: null,
    });
    expect(result.found).toBe(false);
  });
});
