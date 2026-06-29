/**
 * rcsb_pdb.test.ts
 * Unit tests for server/verticalAdapters/rcsb_pdb.ts
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({ mockFetch: vi.fn() }));
vi.stubGlobal("fetch", mocks.mockFetch);

describe("rcsbPdbAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("is registered with domainKey 'rcsb_pdb'", async () => {
    const { registry } = await import("./types");
    await import("./rcsb_pdb");
    expect(registry.get("rcsb_pdb")?.domainKey).toBe("rcsb_pdb");
  });

  it("returns found=true when API returns a valid hit", async () => {
    mocks.mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        entryId: "2LYZ",
        rcsb_entry_info: {
          experimental_method: "X-RAY DIFFRACTION",
          resolution_combined: [1.9],
          polymer_entity_count_protein: 1,
        },
        citation: [{ pdbx_database_id_doi: "10.1107/S0108767390010224" }],
      }),
    });
    const { registry } = await import("./types");
    await import("./rcsb_pdb");
    const adapter = registry.get("rcsb_pdb");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText:
        "The crystal structure of lysozyme was solved at 1.9 Angstrom resolution",
      extractedValue: "2LYZ",
    });
    expect(result.found).toBe(true);
    expect(result.confidenceScore).toBeGreaterThan(0);
  });

  it("returns found=false when API returns empty results", async () => {
    mocks.mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ result_set: [] }),
    });
    const { registry } = await import("./types");
    await import("./rcsb_pdb");
    const adapter = registry.get("rcsb_pdb");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText:
        "The crystal structure of lysozyme was solved at 1.9 Angstrom resolution",
      extractedValue: null,
    });
    expect(result.found).toBe(false);
  });

  it("returns found=false when API returns HTTP error", async () => {
    mocks.mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });
    const { registry } = await import("./types");
    await import("./rcsb_pdb");
    const adapter = registry.get("rcsb_pdb");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText:
        "The crystal structure of lysozyme was solved at 1.9 Angstrom resolution",
      extractedValue: null,
    });
    expect(result.found).toBe(false);
  });

  it("returns found=false when fetch throws (network error)", async () => {
    mocks.mockFetch.mockRejectedValueOnce(new Error("network error"));
    const { registry } = await import("./types");
    await import("./rcsb_pdb");
    const adapter = registry.get("rcsb_pdb");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText:
        "The crystal structure of lysozyme was solved at 1.9 Angstrom resolution",
      extractedValue: null,
    });
    expect(result.found).toBe(false);
  });
});
