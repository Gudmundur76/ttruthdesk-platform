/**
 * salmonBiotech.test.ts
 * Unit tests for server/verticalAdapters/salmonBiotech.ts
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  mockFetch: vi.fn(),
  mockSynthesise: vi.fn(),
  mockApplySynthesis: vi.fn(),
}));

vi.stubGlobal("fetch", mocks.mockFetch);
vi.mock("./evidenceSynthesizer", () => ({
  synthesiseEvidence: mocks.mockSynthesise,
  applySynthesis: mocks.mockApplySynthesis,
}));

describe("salmonBiotechAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mocks.mockSynthesise.mockResolvedValue({
      found: true, confidenceScore: 0.78, confidenceFlags: ["LLM_SYNTHESIS"], summary: "Evidence found",
    });
    mocks.mockApplySynthesis.mockImplementation((_b: unknown, s: { found: boolean; confidenceScore: number; confidenceFlags: string[] }) => ({
      found: s.found, sourceId: null, sourceUrl: null, evidenceRaw: null,
      confidenceScore: s.confidenceScore, confidenceFlags: s.confidenceFlags,
    }));
    mocks.mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ esearchresult: { count: "4", idlist: ["1", "2"] } }),
    });
  });

  it("is registered with domainKey 'salmon_biotech'", async () => {
    const { registry } = await import("./types");
    await import("./salmonBiotech");
    const adapter = registry.get("salmon_biotech");
    expect(adapter).toBeDefined();
    expect(adapter?.domainKey).toBe("salmon_biotech");
  });

  it("returns found=true when PubChem returns compound data for known compound", async () => {
    // astaxanthin is in KNOWN_COMPOUNDS with CID 5281224
    // fetchPubChemProperties call
    mocks.mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        PropertyTable: {
          Properties: [{
            CID: 5281224,
            MolecularFormula: "C40H52O4",
            MolecularWeight: "596.8",
            IUPACName: "astaxanthin",
          }],
        },
      }),
    });
    // fetchPubChemSynonyms call
    mocks.mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        InformationList: {
          Information: [{ Synonym: ["astaxanthin", "3,3'-dihydroxy-beta,beta-carotene-4,4'-dione"] }],
        },
      }),
    });
    const { registry } = await import("./types");
    await import("./salmonBiotech");
    const adapter = registry.get("salmon_biotech");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "Astaxanthin from salmon has antioxidant properties",
      extractedValue: "astaxanthin",
    });
    expect(result.found).toBe(true);
    expect(result.sourceId).toContain("5281224");
  });

  it("returns found=false when compound is not in KNOWN_COMPOUNDS and PubChem returns nothing", async () => {
    // Unknown compound - not in KNOWN_COMPOUNDS, PubChem name search returns null
    mocks.mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
    });
    const { registry } = await import("./types");
    await import("./salmonBiotech");
    const adapter = registry.get("salmon_biotech");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "Unknown compound XYZ123 has bioactivity",
      extractedValue: "XYZ123",
    });
    expect(result.found).toBe(false);
  });
});
