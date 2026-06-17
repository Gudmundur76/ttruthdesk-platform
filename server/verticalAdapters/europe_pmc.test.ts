/**
 * europe_pmc.test.ts
 * Unit tests for server/verticalAdapters/europe_pmc.ts
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({ mockFetch: vi.fn() }));
vi.stubGlobal("fetch", mocks.mockFetch);

describe("europePmcAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("is registered with domainKey 'europe_pmc'", async () => {
    const { registry } = await import("./types");
    await import("./europe_pmc");
    const adapter = registry.get("europe_pmc");
    expect(adapter).toBeDefined();
    expect(adapter?.domainKey).toBe("europe_pmc");
  });

  it("returns found=true when Europe PMC returns results", async () => {
    mocks.mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        hitCount: 1,
        resultList: {
          result: [
            {
              pmid: "12345678",
              pmcid: "PMC1234567",
              title: "Protein folding mechanisms in eukaryotic cells",
              abstractText:
                "This study examines protein folding mechanisms in eukaryotes and the role of molecular chaperones.",
              journalTitle: "Nature",
              pubYear: "2022",
              isOpenAccess: "Y",
              journalInfo: { journal: { title: "Nature" } },
              pubType: ["Journal Article"],
              fullTextUrlList: {
                fullTextUrl: [
                  { url: "https://europepmc.org/article/MED/12345678" },
                ],
              },
            },
          ],
        },
      }),
    });
    const { registry } = await import("./types");
    await import("./europe_pmc");
    const adapter = registry.get("europe_pmc");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "Protein folding mechanisms in eukaryotes",
      extractedValue: "protein folding",
    });
    expect(result.found).toBe(true);
    expect(result.confidenceScore).toBeGreaterThan(0);
  });

  it("returns found=false when Europe PMC returns empty results", async () => {
    mocks.mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ resultList: { result: [] } }),
    });
    const { registry } = await import("./types");
    await import("./europe_pmc");
    const adapter = registry.get("europe_pmc");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "Completely made up claim",
      extractedValue: null,
    });
    expect(result.found).toBe(false);
  });

  it("handles network errors gracefully", async () => {
    mocks.mockFetch.mockRejectedValueOnce(new Error("Network error"));
    const { registry } = await import("./types");
    await import("./europe_pmc");
    const adapter = registry.get("europe_pmc");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "Some research claim",
      extractedValue: null,
    });
    expect(result.found).toBe(false);
  });
});
