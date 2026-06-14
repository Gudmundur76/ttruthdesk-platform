/**
 * chembl.test.ts
 * Unit tests for server/verticalAdapters/chembl.ts
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({ mockFetch: vi.fn() }));
vi.stubGlobal("fetch", mocks.mockFetch);

describe("chemblAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("is registered with domainKey 'chembl'", async () => {
    const { registry } = await import("./types");
    await import("./chembl");
    const adapter = registry.get("chembl");
    expect(adapter).toBeDefined();
    expect(adapter?.domainKey).toBe("chembl");
  });

  it("returns found=true when ChEMBL returns molecule data", async () => {
    mocks.mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        molecules: [
          {
            chembl_id: "CHEMBL25",
            pref_name: "ASPIRIN",
            max_phase_for_ind: 4,
            molecule_type: "Small molecule",
          },
        ],
      }),
    });
    const { registry } = await import("./types");
    await import("./chembl");
    const adapter = registry.get("chembl");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "Aspirin is effective for pain relief",
      extractedValue: "aspirin",
    });
    expect(result.found).toBe(true);
    expect(result.confidenceScore).toBeGreaterThan(0.5);
  });

  it("returns found=true when ChEMBL ID is directly looked up", async () => {
    mocks.mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        chembl_id: "CHEMBL25",
        pref_name: "ASPIRIN",
        max_phase_for_ind: 4,
        molecule_type: "Small molecule",
      }),
    });
    const { registry } = await import("./types");
    await import("./chembl");
    const adapter = registry.get("chembl");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "CHEMBL25 is an approved drug",
      extractedValue: "CHEMBL25",
    });
    expect(result.found).toBe(true);
    expect(result.sourceId).toBe("CHEMBL25");
  });

  it("returns found=false when ChEMBL returns no molecules", async () => {
    mocks.mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ molecules: [] }),
    });
    const { registry } = await import("./types");
    await import("./chembl");
    const adapter = registry.get("chembl");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "Unknown compound XYZ is effective",
      extractedValue: null,
    });
    expect(result.found).toBe(false);
  });

  it("handles HTTP errors gracefully", async () => {
    mocks.mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 503,
    });
    const { registry } = await import("./types");
    await import("./chembl");
    const adapter = registry.get("chembl");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "Aspirin reduces fever",
      extractedValue: "aspirin",
    });
    expect(result.found).toBe(false);
    expect(result.confidenceFlags.length).toBeGreaterThan(0);
  });
});
