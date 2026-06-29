/**
 * molecularDiscovery.test.ts
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
const mocks = vi.hoisted(() => ({ mockFetch: vi.fn() }));
vi.stubGlobal("fetch", mocks.mockFetch);

describe("molecularDiscoveryAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("is registered with domainKey 'molecular_discovery'", async () => {
    const { registry } = await import("./types");
    await import("./molecularDiscovery");
    expect(registry.get("molecular_discovery")?.domainKey).toBe(
      "molecular_discovery"
    );
  });

  it("returns found=true when asi-evolve returns candidate molecules", async () => {
    mocks.mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        candidates: [
          {
            id: "mol-001",
            smiles: "CC1=CC=CC=C1",
            score: 0.92,
            target: "EGFR",
            mechanism: "ATP-competitive inhibitor",
            novelty: 0.85,
            quantum_tier: "QUANTUM_DUAL",
            proposed_strategy: "ATP-competitive binding",
            lesson: "High selectivity against EGFR kinase domain",
            generation: 1,
            parent_id: null,
            fitness: 0.92,
            citation_ids: ["cit-001"],
            predicted_affinity_nm: 12.5,
            is_best_so_far: true,
            cycle_id: 3,
            provenance_status: "classical",
            confidence: 0.88,
            pic50_vqe: null,
            quantum_hardware: null,
          },
        ],
        total: 1,
        quantum_enabled: true,
      }),
    });
    const { registry } = await import("./types");
    await import("./molecularDiscovery");
    const adapter = registry.get("molecular_discovery");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "Novel EGFR inhibitor discovered with IC50 of 0.5 nM",
      extractedValue: "EGFR inhibitor",
    });
    expect(result.found).toBe(true);
    expect(result.confidenceScore).toBeGreaterThan(0);
  });

  it("returns found=false when asi-evolve returns empty candidates array", async () => {
    mocks.mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ candidates: [], total: 0, quantum_enabled: false }),
    });
    const { registry } = await import("./types");
    await import("./molecularDiscovery");
    const adapter = registry.get("molecular_discovery");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "Novel EGFR inhibitor discovered",
      extractedValue: null,
    });
    expect(result.found).toBe(false);
  });

  it("returns found=false when asi-evolve returns HTTP error", async () => {
    mocks.mockFetch.mockResolvedValueOnce({ ok: false, status: 503 });
    const { registry } = await import("./types");
    await import("./molecularDiscovery");
    const adapter = registry.get("molecular_discovery");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "Novel EGFR inhibitor",
      extractedValue: null,
    });
    expect(result.found).toBe(false);
  });

  it("returns found=false when fetch throws (network error)", async () => {
    mocks.mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const { registry } = await import("./types");
    await import("./molecularDiscovery");
    const adapter = registry.get("molecular_discovery");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "Novel EGFR inhibitor",
      extractedValue: null,
    });
    expect(result.found).toBe(false);
  });
});
