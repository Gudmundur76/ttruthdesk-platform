/**
 * verticalAdapters.coverage.test.ts
 *
 * Unit tests for the salmonBiotech and gutMicrobiome vertical adapters.
 * External HTTP calls are mocked via vi.stubGlobal("fetch").
 */
import { describe, it, expect, vi, afterEach } from "vitest";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function mockFetchOk(body: unknown) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  });
}

function mockFetchFail() {
  return vi.fn().mockRejectedValue(new Error("Network error"));
}

// ─── salmonBiotech adapter ───────────────────────────────────────────────────

describe("salmonBiotech adapter", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("exports a default adapter with required VerticalAdapter fields", async () => {
    vi.stubGlobal("fetch", mockFetchOk({}));
    const mod = await import("./verticalAdapters/salmonBiotech");
    const adapter = mod.default;
    expect(adapter).toHaveProperty("domainKey");
    expect(adapter).toHaveProperty("displayName");
    expect(adapter).toHaveProperty("description");
    expect(adapter).toHaveProperty("lookupEvidence");
    expect(adapter).toHaveProperty("discoverySearchTerms");
    expect(typeof adapter.lookupEvidence).toBe("function");
  });

  it("domainKey is salmon_biotech", async () => {
    vi.stubGlobal("fetch", mockFetchOk({}));
    const mod = await import("./verticalAdapters/salmonBiotech");
    expect(mod.default.domainKey).toBe("salmon_biotech");
  });

  it("discoverySearchTerms is a non-empty array of strings", async () => {
    vi.stubGlobal("fetch", mockFetchOk({}));
    const mod = await import("./verticalAdapters/salmonBiotech");
    const terms = mod.default.discoverySearchTerms;
    expect(Array.isArray(terms)).toBe(true);
    expect(terms.length).toBeGreaterThan(0);
    terms.forEach(t => expect(typeof t).toBe("string"));
  });

  it("lookupEvidence returns EvidenceResult with required fields when fetch fails", async () => {
    vi.stubGlobal("fetch", mockFetchFail());
    const mod = await import("./verticalAdapters/salmonBiotech");
    const result = await mod.default.lookupEvidence({
      claimText: "astaxanthin reduces oxidative stress",
      extractedValue: "astaxanthin",
    });
    expect(result).toHaveProperty("found");
    expect(result).toHaveProperty("sourceId");
    expect(result).toHaveProperty("sourceUrl");
    expect(result).toHaveProperty("confidenceScore");
    expect(result).toHaveProperty("confidenceFlags");
    expect(Array.isArray(result.confidenceFlags)).toBe(true);
  });

  it("lookupEvidence confidenceScore is between 0 and 1", async () => {
    vi.stubGlobal("fetch", mockFetchFail());
    const mod = await import("./verticalAdapters/salmonBiotech");
    const result = await mod.default.lookupEvidence({
      claimText: "omega-3 supplementation improves cognition",
      extractedValue: "omega-3",
    });
    expect(result.confidenceScore).toBeGreaterThanOrEqual(0);
    expect(result.confidenceScore).toBeLessThanOrEqual(1);
  });

  it("lookupEvidence handles unknown compound gracefully", async () => {
    vi.stubGlobal("fetch", mockFetchFail());
    const mod = await import("./verticalAdapters/salmonBiotech");
    const result = await mod.default.lookupEvidence({
      claimText: "quantum entanglement affects salmon",
      extractedValue: null,
    });
    expect(result).toHaveProperty("found");
    expect(result.found).toBe(false);
  });

  it("lookupEvidence with successful PubChem response returns found=true", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetchOk({
        PropertyTable: {
          Properties: [
            {
              MolecularFormula: "C40H52O4",
              MolecularWeight: "596.8",
              IUPACName: "astaxanthin",
              IsomericSMILES: "CC1=C...",
              InChIKey: "MQIUGAXCHLFZKX-JSZLBQMZSA-N",
            },
          ],
        },
      })
    );
    const mod = await import("./verticalAdapters/salmonBiotech");
    const result = await mod.default.lookupEvidence({
      claimText: "astaxanthin is a potent antioxidant",
      extractedValue: "astaxanthin",
    });
    expect(result.found).toBe(true);
    expect(result.confidenceScore).toBeGreaterThan(0);
  });
});

// ─── registry / listVerticals ─────────────────────────────────────────────────

describe("verticalAdapters registry", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("listVerticals returns an array", async () => {
    vi.stubGlobal("fetch", mockFetchOk({}));
    const { listVerticals } = await import("./verticalAdapters/types");
    const list = listVerticals();
    expect(Array.isArray(list)).toBe(true);
  });

  it("getVertical returns undefined for unknown domainKey", async () => {
    vi.stubGlobal("fetch", mockFetchOk({}));
    const { getVertical } = await import("./verticalAdapters/types");
    expect(getVertical("nonexistent_domain_xyz")).toBeUndefined();
  });

  it("salmon_biotech is registered after importing the adapter", async () => {
    vi.stubGlobal("fetch", mockFetchOk({}));
    // Import the adapter to trigger registerVertical side-effect
    await import("./verticalAdapters/salmonBiotech");
    const { getVertical } = await import("./verticalAdapters/types");
    const adapter = getVertical("salmon_biotech");
    expect(adapter).toBeDefined();
    expect(adapter?.domainKey).toBe("salmon_biotech");
  });
});
