/**
 * creatineErgogenics.test.ts
 * Unit tests for server/verticalAdapters/creatineErgogenics.ts
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  mockFetch: vi.fn(),
  mockSynthesise: vi.fn(),
  mockApplySynthesis: vi.fn(),
  mockSearchFda: vi.fn(),
  mockInterpretFda: vi.fn(),
}));

vi.stubGlobal("fetch", mocks.mockFetch);
vi.mock("./evidenceSynthesizer", () => ({
  synthesiseEvidence: mocks.mockSynthesise,
  applySynthesis: mocks.mockApplySynthesis,
}));
vi.mock("../openfdaAdapter", () => ({
  searchFdaAdverseEvents: mocks.mockSearchFda,
  interpretFdaSignals: mocks.mockInterpretFda,
}));

describe("creatineErgogenicsAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mocks.mockSynthesise.mockResolvedValue({
      found: true, confidenceScore: 0.8, confidenceFlags: ["LLM_SYNTHESIS"], summary: "Evidence found",
    });
    mocks.mockApplySynthesis.mockImplementation((_b: unknown, s: { found: boolean; confidenceScore: number; confidenceFlags: string[] }) => ({
      found: s.found, sourceId: null, sourceUrl: null, evidenceRaw: null,
      confidenceScore: s.confidenceScore, confidenceFlags: s.confidenceFlags,
    }));
    mocks.mockSearchFda.mockResolvedValue({ totalEvents: 5, events: [] });
    mocks.mockInterpretFda.mockReturnValue({ score: 0.1, flags: [] });
  });

  it("is registered with domainKey 'creatine_ergogenics'", async () => {
    mocks.mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ esearchresult: { count: "3", idlist: ["1"] } }),
    });
    const { registry } = await import("./types");
    await import("./creatineErgogenics");
    const adapter = registry.get("creatine_ergogenics");
    expect(adapter).toBeDefined();
    expect(adapter?.domainKey).toBe("creatine_ergogenics");
  });

  it("returns found=true when RCT count is positive", async () => {
    mocks.mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ esearchresult: { count: "8", idlist: ["1", "2"] } }),
    });
    const { registry } = await import("./types");
    await import("./creatineErgogenics");
    const adapter = registry.get("creatine_ergogenics");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "Creatine supplementation improves athletic performance",
      extractedValue: "creatine",
    });
    expect(result.found).toBe(true);
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
    await import("./creatineErgogenics");
    const adapter = registry.get("creatine_ergogenics");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "Creatine cures Alzheimer's disease",
      extractedValue: null,
    });
    expect(result.found).toBe(false);
  });
});
