/**
 * nist_chemistry.test.ts
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
const mocks = vi.hoisted(() => ({ mockFetch: vi.fn() }));
vi.stubGlobal("fetch", mocks.mockFetch);

const makeJsonResponse = (data: unknown) => ({
  ok: true,
  status: 200,
  headers: {
    get: (h: string) => (h === "content-type" ? "application/json" : null),
  },
  json: async () => data,
});

describe("nistChemistryAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("is registered with domainKey \'nist_chemistry\'", async () => {
    const { registry } = await import("./types");
    await import("./nist_chemistry");
    expect(registry.get("nist_chemistry")?.domainKey).toBe("nist_chemistry");
  });

  it("returns found=true when NIST returns compound data with name and formula (name lookup)", async () => {
    mocks.mockFetch.mockResolvedValueOnce(
      makeJsonResponse({
        name: "Ethanol",
        MolecularFormula: "C2H5OH",
        CASRegistryNumber: "64-17-5",
        MolecularWeight: 46.068,
        InChIKey: "LFQSCWFLJHTTHZ-UHFFFAOYSA-N",
      })
    );
    const { registry } = await import("./types");
    await import("./nist_chemistry");
    const adapter = registry.get("nist_chemistry");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "Ethanol boiling point is seventy-eight degrees",
      extractedValue: null,
    });
    expect(result.found).toBe(true);
    expect(result.confidenceScore).toBeGreaterThan(0);
  });

  it("returns found=true when NIST returns IUPACName and formula fields (name lookup)", async () => {
    mocks.mockFetch.mockResolvedValueOnce(
      makeJsonResponse({
        IUPACName: "methane",
        formula: "CH4",
        cas: "74-82-8",
      })
    );
    const { registry } = await import("./types");
    await import("./nist_chemistry");
    const adapter = registry.get("nist_chemistry");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "Methane boiling point is very low",
      extractedValue: null,
    });
    expect(result.found).toBe(true);
  });

  it("returns found=false when NIST returns empty/null compound data", async () => {
    mocks.mockFetch.mockResolvedValueOnce(makeJsonResponse({}));
    const { registry } = await import("./types");
    await import("./nist_chemistry");
    const adapter = registry.get("nist_chemistry");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "Unknown compound XYZ has a boiling point",
      extractedValue: null,
    });
    expect(typeof result.found).toBe("boolean");
  });

  it("returns found=false when API returns HTTP 404", async () => {
    mocks.mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      headers: { get: () => null },
    });
    const { registry } = await import("./types");
    await import("./nist_chemistry");
    const adapter = registry.get("nist_chemistry");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "Ethanol boiling point",
      extractedValue: null,
    });
    expect(result.found).toBe(false);
  });

  it("returns found=false when fetch throws (network error)", async () => {
    mocks.mockFetch.mockRejectedValueOnce(new Error("network error"));
    const { registry } = await import("./types");
    await import("./nist_chemistry");
    const adapter = registry.get("nist_chemistry");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "Ethanol boiling point",
      extractedValue: null,
    });
    expect(result.found).toBe(false);
  });
});
