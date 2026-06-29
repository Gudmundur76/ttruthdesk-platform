/**
 * omim.test.ts
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
const mocks = vi.hoisted(() => ({ mockFetch: vi.fn() }));
vi.stubGlobal("fetch", mocks.mockFetch);

describe("omimAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  it("is registered with domainKey 'omim'", async () => {
    const { registry } = await import("./types");
    await import("./omim");
    expect(registry.get("omim")?.domainKey).toBe("omim");
  });

  it("returns found=false when OMIM_API_KEY is not set", async () => {
    vi.stubEnv("OMIM_API_KEY", "");
    const { registry } = await import("./types");
    await import("./omim");
    const adapter = registry.get("omim");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "BRCA1 mutations cause hereditary breast cancer",
      extractedValue: "BRCA1",
    });
    expect(result.found).toBe(false);
    expect(
      result.confidenceFlags.some(
        (f: string) => f.includes("OMIM_API_KEY") || f.includes("configured")
      )
    ).toBe(true);
  });

  it("returns found=true when OMIM returns a valid entry via keyword search", async () => {
    vi.stubEnv("OMIM_API_KEY", "test-key");
    // searchOmim call
    mocks.mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        omim: {
          searchResponse: { entryList: [{ entry: { mimNumber: 113705 } }] },
        },
      }),
    });
    // fetchOmimEntry call
    mocks.mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        omim: {
          entryList: [
            {
              entry: {
                mimNumber: 113705,
                titles: {
                  preferredTitle: "BREAST CANCER 1, EARLY ONSET; BRCA1",
                },
                geneMap: {
                  geneSymbols: "BRCA1",
                  geneName: "breast cancer 1",
                  chromosome: "17",
                  location: "17q21.31",
                },
                textSectionList: [
                  {
                    textSection: {
                      textSectionName: "description",
                      textSectionContent: "BRCA1 is a tumor suppressor gene.",
                    },
                  },
                ],
              },
            },
          ],
        },
      }),
    });
    const { registry } = await import("./types");
    await import("./omim");
    const adapter = registry.get("omim");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "BRCA1 mutations cause hereditary breast cancer",
      extractedValue: "BRCA1",
    });
    expect(result.found).toBe(true);
    expect(result.confidenceScore).toBeGreaterThan(0);
  });

  it("returns found=true when MIM number is in claim text (direct lookup)", async () => {
    vi.stubEnv("OMIM_API_KEY", "test-key");
    // fetchOmimEntry call (no searchOmim needed — MIM number extracted from claim)
    mocks.mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        omim: {
          entryList: [
            {
              entry: {
                mimNumber: 113705,
                titles: {
                  preferredTitle: "BREAST CANCER 1, EARLY ONSET; BRCA1",
                },
                geneMap: { geneSymbols: "BRCA1" },
                textSectionList: [],
              },
            },
          ],
        },
      }),
    });
    const { registry } = await import("./types");
    await import("./omim");
    const adapter = registry.get("omim");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "OMIM entry 113705 describes BRCA1 mutations",
      extractedValue: "113705",
    });
    expect(result.found).toBe(true);
  });

  it("returns found=false when fetch throws (network error)", async () => {
    vi.stubEnv("OMIM_API_KEY", "test-key");
    mocks.mockFetch.mockRejectedValueOnce(new Error("network error"));
    const { registry } = await import("./types");
    await import("./omim");
    const adapter = registry.get("omim");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "BRCA1 mutations cause hereditary breast cancer",
      extractedValue: null,
    });
    expect(result.found).toBe(false);
  });
});
