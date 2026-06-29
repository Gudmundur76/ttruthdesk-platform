/**
 * ncbi_gene.test.ts
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
const mocks = vi.hoisted(() => ({ mockFetch: vi.fn() }));
vi.stubGlobal("fetch", mocks.mockFetch);

describe("ncbiGeneAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("is registered with domainKey 'ncbi_gene'", async () => {
    const { registry } = await import("./types");
    await import("./ncbi_gene");
    expect(registry.get("ncbi_gene")?.domainKey).toBe("ncbi_gene");
  });

  it("returns found=true when gene is found via esearch + esummary", async () => {
    // esearch call
    mocks.mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ esearchresult: { idlist: ["672"] } }),
    });
    // esummary call
    mocks.mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        result: {
          "672": {
            uid: "672",
            name: "BRCA1",
            description: "BRCA1 DNA repair associated",
            organism: { scientificname: "Homo sapiens", taxid: 9606 },
            chromosome: "17",
            summary:
              "This gene encodes a nuclear phosphoprotein that plays a role in maintaining genomic stability.",
            status: "live",
          },
        },
      }),
    });
    const { registry } = await import("./types");
    await import("./ncbi_gene");
    const adapter = registry.get("ncbi_gene");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "BRCA1 mutations increase breast cancer risk",
      extractedValue: "BRCA1",
    });
    expect(result.found).toBe(true);
    expect(result.confidenceScore).toBeGreaterThan(0);
  });

  it("returns found=false when gene is not found in esearch", async () => {
    mocks.mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ esearchresult: { idlist: [] } }),
    });
    const { registry } = await import("./types");
    await import("./ncbi_gene");
    const adapter = registry.get("ncbi_gene");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "FAKEGENE123 causes disease",
      extractedValue: "FAKEGENE123",
    });
    expect(result.found).toBe(false);
  });

  it("returns found=false when fetch throws (network error)", async () => {
    mocks.mockFetch.mockRejectedValueOnce(new Error("network error"));
    const { registry } = await import("./types");
    await import("./ncbi_gene");
    const adapter = registry.get("ncbi_gene");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "BRCA1 mutations increase breast cancer risk",
      extractedValue: null,
    });
    expect(result.found).toBe(false);
  });
});
