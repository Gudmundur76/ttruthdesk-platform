/**
 * pubchem.test.ts
 * Unit tests for server/verticalAdapters/pubchem.ts
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  mockFetch: vi.fn(),
}));

vi.stubGlobal("fetch", mocks.mockFetch);

describe("PubChemAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("is registered with domainKey 'pubchem'", async () => {
    const { registry } = await import("./types");
    await import("./pubchem");
    const adapter = registry.get("pubchem");
    expect(adapter).toBeDefined();
    expect(adapter?.domainKey).toBe("pubchem");
  });

  it("returns found=true when PubChem finds the compound", async () => {
    mocks.mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        PC_Compounds: [
          {
            id: { cid: 2244 },
            atoms: {},
            bonds: {},
          },
        ],
      }),
    });
    const { registry } = await import("./types");
    await import("./pubchem");
    const adapter = registry.get("pubchem");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "Aspirin has molecular formula C9H8O4",
      extractedValue: "aspirin",
    });
    expect(result.found).toBe(true);
    expect(result.confidenceScore).toBeGreaterThan(0.5);
  });

  it("returns found=false when compound is not found", async () => {
    mocks.mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
    });
    const { registry } = await import("./types");
    await import("./pubchem");
    const adapter = registry.get("pubchem");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "Nonexistent compound XYZ123",
      extractedValue: "xyznonexistent",
    });
    expect(result.found).toBe(false);
  });

  it("handles network errors gracefully", async () => {
    mocks.mockFetch.mockRejectedValueOnce(new Error("Network error"));
    const { registry } = await import("./types");
    await import("./pubchem");
    const adapter = registry.get("pubchem");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "Some chemical claim",
      extractedValue: null,
    });
    expect(result.found).toBe(false);
    expect(result.confidenceFlags.length).toBeGreaterThan(0);
  });

  it("has required VerticalAdapter fields", async () => {
    const { registry } = await import("./types");
    await import("./pubchem");
    const adapter = registry.get("pubchem");
    expect(adapter?.displayName).toBeTruthy();
    expect(adapter?.description).toBeTruthy();
    expect(adapter?.claimExtractorPrompt).toBeTruthy();
    expect(adapter?.discoverySearchTerms).toBeInstanceOf(Array);
  });
});
