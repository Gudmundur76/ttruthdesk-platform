/**
 * structuralBiology.test.ts
 * Unit tests for server/verticalAdapters/structuralBiology.ts
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock fetch globally
const mocks = vi.hoisted(() => ({
  mockFetch: vi.fn(),
}));

vi.stubGlobal("fetch", mocks.mockFetch);

describe("structuralBiologyAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("is registered with domainKey 'structural_biology'", async () => {
    const { registry } = await import("./types");
    // Import the adapter so it self-registers
    await import("./structuralBiology");
    const adapter = registry.get("structural_biology");
    expect(adapter).toBeDefined();
    expect(adapter?.domainKey).toBe("structural_biology");
  });

  it("returns found=true when PDB lookup succeeds", async () => {
    mocks.mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        entry_id: "1LYZ",
        struct: { title: "Lysozyme" },
        rcsb_entry_info: { resolution_combined: [1.8] },
      }),
    });
    const { registry } = await import("./types");
    await import("./structuralBiology");
    const adapter = registry.get("structural_biology");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "The 1LYZ structure was solved at 1.8 Å resolution",
      extractedValue: "1LYZ",
    });
    expect(result.found).toBe(true);
    expect(result.sourceId).toBe("1LYZ");
    expect(result.confidenceScore).toBeGreaterThan(0.5);
  });

  it("returns found=false when PDB entry does not exist", async () => {
    mocks.mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
    });
    const { registry } = await import("./types");
    await import("./structuralBiology");
    const adapter = registry.get("structural_biology");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "The XXXX structure was solved",
      extractedValue: "XXXX",
    });
    expect(result.found).toBe(false);
    expect(result.confidenceScore).toBeLessThan(0.5);
  });

  it("handles fetch errors gracefully", async () => {
    mocks.mockFetch.mockRejectedValueOnce(new Error("Network error"));
    const { registry } = await import("./types");
    await import("./structuralBiology");
    const adapter = registry.get("structural_biology");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "The 1LYZ structure was solved",
      extractedValue: "1LYZ",
    });
    expect(result.found).toBe(false);
    expect(result.confidenceFlags.length).toBeGreaterThan(0);
  });

  it("has required VerticalAdapter fields", async () => {
    const { registry } = await import("./types");
    await import("./structuralBiology");
    const adapter = registry.get("structural_biology");
    expect(adapter?.displayName).toBeTruthy();
    expect(adapter?.description).toBeTruthy();
    expect(adapter?.claimExtractorPrompt).toBeTruthy();
    expect(adapter?.discoverySearchTerms).toBeInstanceOf(Array);
    expect(adapter?.discoverySearchTerms.length).toBeGreaterThan(0);
  });
});
