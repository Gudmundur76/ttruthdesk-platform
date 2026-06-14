/**
 * uniprotVertical.test.ts
 * Unit tests for server/verticalAdapters/uniprotVertical.ts
 *
 * uniprotVertical uses named imports from ../uniprotAdapter which calls fetch.
 * We stub fetch globally.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({ mockFetch: vi.fn() }));
vi.stubGlobal("fetch", mocks.mockFetch);

describe("uniprotVerticalAdapter", () => {
  beforeEach(() => { vi.clearAllMocks(); vi.resetModules(); });

  it("is registered with domainKey 'uniprot'", async () => {
    const { registry } = await import("./types");
    await import("./uniprotVertical");
    const adapter = registry.get("uniprot");
    expect(adapter).toBeDefined();
    expect(adapter?.domainKey).toBe("uniprot");
  });

  it("returns found=true when UniProt returns protein data", async () => {
    // verifyProteinViaUniProt calls fetch to UniProt REST API
    mocks.mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: [
          {
            primaryAccession: "P69905",
            uniProtkbId: "HBA_HUMAN",
            proteinDescription: {
              recommendedName: { fullName: { value: "Hemoglobin subunit alpha" } },
            },
            organism: { scientificName: "Homo sapiens" },
            genes: [{ geneName: { value: "HBA1" } }],
          },
        ],
        totalResults: 1,
      }),
    });
    const { registry } = await import("./types");
    await import("./uniprotVertical");
    const adapter = registry.get("uniprot");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "Hemoglobin subunit alpha is found in human blood",
      extractedValue: "hemoglobin alpha",
    });
    expect(result.found).toBe(true);
    expect(result.confidenceScore).toBeGreaterThan(0);
  });

  it("returns found=false when UniProt returns no results", async () => {
    mocks.mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ results: [], totalResults: 0 }),
    });
    const { registry } = await import("./types");
    await import("./uniprotVertical");
    const adapter = registry.get("uniprot");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "Unknown protein XYZ123 is found in bacteria",
      extractedValue: null,
    });
    expect(result.found).toBe(false);
  });

  it("handles network errors gracefully", async () => {
    mocks.mockFetch.mockRejectedValueOnce(new Error("Network error"));
    const { registry } = await import("./types");
    await import("./uniprotVertical");
    const adapter = registry.get("uniprot");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "Hemoglobin is a protein",
      extractedValue: "hemoglobin",
    });
    expect(result.found).toBe(false);
  });
});
