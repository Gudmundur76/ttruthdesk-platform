/**
 * clinvar.test.ts
 * Unit tests for server/verticalAdapters/clinvar.ts
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({ mockFetch: vi.fn() }));
vi.stubGlobal("fetch", mocks.mockFetch);

describe("ClinVarAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("is registered with domainKey 'clinvar'", async () => {
    const { registry } = await import("./types");
    await import("./clinvar");
    const adapter = registry.get("clinvar");
    expect(adapter).toBeDefined();
    expect(adapter?.domainKey).toBe("clinvar");
  });

  it("returns found=true when ClinVar esearch returns IDs and efetch returns data", async () => {
    // esearch call
    mocks.mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        esearchresult: {
          idlist: ["12345"],
          count: "1",
        },
      }),
    });
    // efetch call (esummary returns JSON)
    mocks.mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        DocumentSummarySet: {
          DocumentSummary: [
            {
              uid: "12345",
              variation_id: "12345",
              title: "BRCA1 c.5266dupC (p.Gln1756fs)",
              clinical_significance: { description: "Pathogenic" },
              gene_sort: "BRCA1",
            },
          ],
        },
      }),
    });
    const { registry } = await import("./types");
    await import("./clinvar");
    const adapter = registry.get("clinvar");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "BRCA1 rs80357906 is pathogenic",
      extractedValue: "rs80357906",
    });
    expect(result.found).toBe(true);
    expect(result.confidenceScore).toBeGreaterThan(0);
  });

  it("returns found=false when ClinVar esearch returns no IDs", async () => {
    mocks.mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        esearchresult: { idlist: [], count: "0" },
      }),
    });
    const { registry } = await import("./types");
    await import("./clinvar");
    const adapter = registry.get("clinvar");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "NONEXISTENT_VARIANT is pathogenic",
      extractedValue: null,
    });
    expect(result.found).toBe(false);
    expect(result.confidenceFlags).toContain("no_match_found");
  });

  it("handles network errors gracefully", async () => {
    mocks.mockFetch.mockRejectedValueOnce(new Error("Network error"));
    const { registry } = await import("./types");
    await import("./clinvar");
    const adapter = registry.get("clinvar");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "rs80357906 is pathogenic",
      extractedValue: "rs80357906",
    });
    expect(result.found).toBe(false);
  });
});
