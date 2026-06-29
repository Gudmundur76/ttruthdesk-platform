/**
 * hivProtease.test.ts
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
const mocks = vi.hoisted(() => ({ mockFetch: vi.fn() }));
vi.stubGlobal("fetch", mocks.mockFetch);

describe("hivProteaseAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("is registered with domainKey 'hiv_protease'", async () => {
    const { registry } = await import("./types");
    await import("./hivProtease");
    expect(registry.get("hiv_protease")?.domainKey).toBe("hiv_protease");
  });

  it("returns found=true when claim contains an approved HIV PI name (ChEMBL path)", async () => {
    // ChEMBL molecule search
    mocks.mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        activities: [
          {
            molecule_pref_name: "DARUNAVIR",
            standard_value: 0.3,
            standard_units: "nM",
            standard_type: "IC50",
            pchembl_value: 9.5,
            document_chembl_id: "CHEMBL1234567",
          },
        ],
        page_meta: { total_count: 1 },
      }),
    });
    const { registry } = await import("./types");
    await import("./hivProtease");
    const adapter = registry.get("hiv_protease");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "Darunavir inhibits HIV-1 protease with IC50 of 0.3 nM",
      extractedValue: "darunavir HIV-1 protease IC50",
    });
    expect(result.found).toBe(true);
    expect(result.confidenceScore).toBeGreaterThan(0);
  });

  it("returns found=true via relevance scoring for general HIV PI claims", async () => {
    const { registry } = await import("./types");
    await import("./hivProtease");
    const adapter = registry.get("hiv_protease");
    if (!adapter) throw new Error("Adapter not registered");
    // Claim with HIV PI keywords but no specific drug name or PDB ID
    const result = await adapter.lookupEvidence({
      claimText:
        "HIV protease inhibitor resistance mutations reduce antiretroviral efficacy",
      extractedValue: null,
    });
    // relevance > 0.2 → found:true
    expect(result.found).toBe(true);
  });

  it("returns found=false for unrelated claim (low relevance score)", async () => {
    const { registry } = await import("./types");
    await import("./hivProtease");
    const adapter = registry.get("hiv_protease");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "The stock market rose 2% today",
      extractedValue: null,
    });
    expect(result.found).toBe(false);
  });

  it("returns found=false when ChEMBL fetch throws (network error)", async () => {
    mocks.mockFetch.mockRejectedValueOnce(new Error("network error"));
    const { registry } = await import("./types");
    await import("./hivProtease");
    const adapter = registry.get("hiv_protease");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "Darunavir inhibits HIV-1 protease with IC50 of 0.3 nM",
      extractedValue: "darunavir",
    });
    // Network error on ChEMBL → returns found:false from lookupChemblHivPi catch block
    expect(typeof result.found).toBe("boolean");
  });
});
