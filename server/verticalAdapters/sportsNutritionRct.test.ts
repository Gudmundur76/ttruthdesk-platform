/**
 * sportsNutritionRct.test.ts
 * Unit tests for server/verticalAdapters/sportsNutritionRct.ts
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

describe("sportsNutritionRctAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mocks.mockSynthesise.mockResolvedValue({
      found: true, confidenceScore: 0.82, confidenceFlags: ["LLM_SYNTHESIS"], summary: "Evidence found",
    });
    mocks.mockApplySynthesis.mockImplementation((_b: unknown, s: { found: boolean; confidenceScore: number; confidenceFlags: string[] }) => ({
      found: s.found, sourceId: null, sourceUrl: null, evidenceRaw: null,
      confidenceScore: s.confidenceScore, confidenceFlags: s.confidenceFlags,
    }));
    mocks.mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ esearchresult: { count: "6", idlist: ["1", "2", "3"] } }),
    });
  });

  it("is registered with domainKey 'sports_nutrition_rct'", async () => {
    const { registry } = await import("./types");
    await import("./sportsNutritionRct");
    const adapter = registry.get("sports_nutrition_rct");
    expect(adapter).toBeDefined();
    expect(adapter?.domainKey).toBe("sports_nutrition_rct");
  });

  it("returns found=true when RCT evidence is found", async () => {
    const { registry } = await import("./types");
    await import("./sportsNutritionRct");
    const adapter = registry.get("sports_nutrition_rct");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "Beta-alanine supplementation improves endurance performance",
      extractedValue: "beta-alanine",
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
      found: false, confidenceScore: 0.1, confidenceFlags: ["NO_EVIDENCE"], summary: "No evidence",
    });
    mocks.mockApplySynthesis.mockImplementationOnce((_b: unknown, s: { found: boolean; confidenceScore: number; confidenceFlags: string[] }) => ({
      found: s.found, sourceId: null, sourceUrl: null, evidenceRaw: null,
      confidenceScore: s.confidenceScore, confidenceFlags: s.confidenceFlags,
    }));
    const { registry } = await import("./types");
    await import("./sportsNutritionRct");
    const adapter = registry.get("sports_nutrition_rct");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "Magic powder XYZ increases strength by 500%",
      extractedValue: null,
    });
    expect(result.found).toBe(false);
  });
});
