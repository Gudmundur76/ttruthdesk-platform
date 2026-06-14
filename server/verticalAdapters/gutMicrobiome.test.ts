/**
 * gutMicrobiome.test.ts
 * Unit tests for server/verticalAdapters/gutMicrobiome.ts
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

describe("gutMicrobiomeAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mocks.mockSynthesise.mockResolvedValue({
      found: true, confidenceScore: 0.75, confidenceFlags: ["LLM_SYNTHESIS"], summary: "Evidence found",
    });
    mocks.mockApplySynthesis.mockImplementation((_b: unknown, s: { found: boolean; confidenceScore: number; confidenceFlags: string[] }) => ({
      found: s.found, sourceId: null, sourceUrl: null, evidenceRaw: null,
      confidenceScore: s.confidenceScore, confidenceFlags: s.confidenceFlags,
    }));
    // Mock fetch for NCBI taxonomy and PubMed searches
    mocks.mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ esearchresult: { count: "5", idlist: ["1", "2"] } }),
    });
  });

  it("is registered with domainKey 'gut_microbiome'", async () => {
    const { registry } = await import("./types");
    await import("./gutMicrobiome");
    const adapter = registry.get("gut_microbiome");
    expect(adapter).toBeDefined();
    expect(adapter?.domainKey).toBe("gut_microbiome");
  });

  it("returns found=true when evidence is synthesised", async () => {
    const { registry } = await import("./types");
    await import("./gutMicrobiome");
    const adapter = registry.get("gut_microbiome");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "Lactobacillus rhamnosus improves gut health",
      extractedValue: "Lactobacillus rhamnosus",
    });
    expect(result.found).toBe(true);
  });

  it("returns found=false when synthesis says not found", async () => {
    mocks.mockSynthesise.mockResolvedValueOnce({
      found: false, confidenceScore: 0.1, confidenceFlags: ["NO_EVIDENCE"], summary: "No evidence",
    });
    mocks.mockApplySynthesis.mockImplementationOnce((_b: unknown, s: { found: boolean; confidenceScore: number; confidenceFlags: string[] }) => ({
      found: s.found, sourceId: null, sourceUrl: null, evidenceRaw: null,
      confidenceScore: s.confidenceScore, confidenceFlags: s.confidenceFlags,
    }));
    const { registry } = await import("./types");
    await import("./gutMicrobiome");
    const adapter = registry.get("gut_microbiome");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "Unknown bacteria XYZ cures all diseases",
      extractedValue: null,
    });
    expect(result.found).toBe(false);
  });
});
