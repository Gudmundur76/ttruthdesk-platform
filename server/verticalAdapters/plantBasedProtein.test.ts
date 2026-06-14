/**
 * plantBasedProtein.test.ts
 * Unit tests for server/verticalAdapters/plantBasedProtein.ts
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

describe("plantBasedProteinAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mocks.mockSynthesise.mockResolvedValue({
      found: true, confidenceScore: 0.77, confidenceFlags: ["LLM_SYNTHESIS"], summary: "Evidence found",
    });
    mocks.mockApplySynthesis.mockImplementation((_b: unknown, s: { found: boolean; confidenceScore: number; confidenceFlags: string[] }) => ({
      found: s.found, sourceId: null, sourceUrl: null, evidenceRaw: null,
      confidenceScore: s.confidenceScore, confidenceFlags: s.confidenceFlags,
    }));
    mocks.mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ esearchresult: { count: "7", idlist: ["1", "2", "3"] } }),
    });
  });

  it("is registered with domainKey 'plant_based_protein'", async () => {
    const { registry } = await import("./types");
    await import("./plantBasedProtein");
    const adapter = registry.get("plant_based_protein");
    expect(adapter).toBeDefined();
    expect(adapter?.domainKey).toBe("plant_based_protein");
  });

  it("returns found=true when evidence is synthesised", async () => {
    const { registry } = await import("./types");
    await import("./plantBasedProtein");
    const adapter = registry.get("plant_based_protein");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "Pea protein has comparable bioavailability to whey protein",
      extractedValue: "pea protein",
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
    await import("./plantBasedProtein");
    const adapter = registry.get("plant_based_protein");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "Mystery plant XYZ provides complete nutrition",
      extractedValue: null,
    });
    expect(result.found).toBe(false);
  });
});
