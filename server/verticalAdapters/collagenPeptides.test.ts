/**
 * collagenPeptides.test.ts
 * Unit tests for server/verticalAdapters/collagenPeptides.ts
 *
 * This adapter calls:
 * 1. fetch (for PubMed/UniProt lookups)
 * 2. synthesiseEvidence (calls invokeLLM)
 * We mock both.
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

describe("collagenPeptidesAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    // Default: synthesiseEvidence returns a neutral synthesis
    mocks.mockSynthesise.mockResolvedValue({
      found: true,
      confidenceScore: 0.75,
      confidenceFlags: ["LLM_SYNTHESIS"],
      summary: "Evidence found",
    });
    // Default: applySynthesis returns the synthesis result as-is
    mocks.mockApplySynthesis.mockImplementation((_base: unknown, synthesis: { found: boolean; confidenceScore: number; confidenceFlags: string[] }) => ({
      found: synthesis.found,
      sourceId: null,
      sourceUrl: null,
      evidenceRaw: null,
      confidenceScore: synthesis.confidenceScore,
      confidenceFlags: synthesis.confidenceFlags,
    }));
  });

  it("is registered with domainKey 'collagen_peptides'", async () => {
    // Mock fetch for PubMed RCT search
    mocks.mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ esearchresult: { count: "5", idlist: ["12345"] } }),
    });
    const { registry } = await import("./types");
    await import("./collagenPeptides");
    const adapter = registry.get("collagen_peptides");
    expect(adapter).toBeDefined();
    expect(adapter?.domainKey).toBe("collagen_peptides");
  });

  it("returns found=true when RCT count is high", async () => {
    // PubMed RCT search returns 10 results
    mocks.mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ esearchresult: { count: "10", idlist: ["1", "2", "3"] } }),
    });
    const { registry } = await import("./types");
    await import("./collagenPeptides");
    const adapter = registry.get("collagen_peptides");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "Collagen peptides improve skin elasticity",
      extractedValue: "collagen peptides",
    });
    expect(result.found).toBe(true);
    expect(mocks.mockSynthesise).toHaveBeenCalled();
  });

  it("returns found=false when synthesis says not found", async () => {
    mocks.mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ esearchresult: { count: "0", idlist: [] } }),
    });
    mocks.mockSynthesise.mockResolvedValueOnce({
      found: false,
      confidenceScore: 0.1,
      confidenceFlags: ["NO_EVIDENCE"],
      summary: "No evidence found",
    });
    mocks.mockApplySynthesis.mockImplementationOnce((_base: unknown, synthesis: { found: boolean; confidenceScore: number; confidenceFlags: string[] }) => ({
      found: synthesis.found,
      sourceId: null,
      sourceUrl: null,
      evidenceRaw: null,
      confidenceScore: synthesis.confidenceScore,
      confidenceFlags: synthesis.confidenceFlags,
    }));
    const { registry } = await import("./types");
    await import("./collagenPeptides");
    const adapter = registry.get("collagen_peptides");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "Collagen peptides cure cancer",
      extractedValue: null,
    });
    expect(result.found).toBe(false);
  });
});
