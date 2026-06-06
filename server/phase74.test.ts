/**
 * phase74.test.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Tests for Phase 74: vertical adapter routing, UniProt, OpenFDA, Europe PMC.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { FdaAdverseEventResult } from "./openfdaAdapter";
import type { EuropePmcResult } from "./europePmcAdapter";

// ─── Mock fetch globally ───────────────────────────────────────────────────────

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function jsonResponse(data: unknown, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
  });
}

beforeEach(() => {
  mockFetch.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── uniprotAdapter tests ─────────────────────────────────────────────────────

describe("uniprotAdapter", () => {
  it("returns found=true with reviewed entry when UniProt responds", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({
      results: [
        {
          primaryAccession: "P00698",
          entryType: "UniProtKB reviewed (Swiss-Prot)",
          proteinDescription: {
            recommendedName: { fullName: { value: "Lysozyme C" } },
          },
          genes: [{ geneName: { value: "LYZ" } }],
          organism: { scientificName: "Homo sapiens" },
        },
      ],
    }));

    const { searchUniProt } = await import("./uniprotAdapter");
    const result = await searchUniProt("lysozyme");
    expect(result.found).toBe(true);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].accession).toBe("P00698");
    expect(result.entries[0].reviewed).toBe(true);
    expect(result.entries[0].url).toBe("https://www.uniprot.org/uniprotkb/P00698");
  });

  it("returns found=false when UniProt returns empty results", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ results: [] }));
    const { searchUniProt } = await import("./uniprotAdapter");
    const result = await searchUniProt("nonexistent_protein_xyz");
    expect(result.found).toBe(false);
    expect(result.entries).toHaveLength(0);
  });

  it("returns found=false and error when fetch throws", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Network error"));
    const { searchUniProt } = await import("./uniprotAdapter");
    const result = await searchUniProt("lysozyme");
    expect(result.found).toBe(false);
    expect(result.error).toContain("Network error");
  });

  it("verifyProteinViaUniProt boosts confidence for reviewed entry", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({
      results: [
        {
          primaryAccession: "P00698",
          entryType: "UniProtKB reviewed (Swiss-Prot)",
          proteinDescription: { recommendedName: { fullName: { value: "Lysozyme C" } } },
          genes: [],
          organism: { scientificName: "Homo sapiens" },
        },
      ],
    }));

    const { verifyProteinViaUniProt } = await import("./uniprotAdapter");
    const result = await verifyProteinViaUniProt("lysozyme");
    expect(result.found).toBe(true);
    expect(result.confidenceScore).toBeGreaterThan(0.5);
    expect(result.flags.some((f: string) => f.includes("Swiss-Prot"))).toBe(true);
  });

  it("verifyProteinViaUniProt applies organism match boost", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({
      results: [
        {
          primaryAccession: "P00698",
          entryType: "UniProtKB reviewed (Swiss-Prot)",
          proteinDescription: { recommendedName: { fullName: { value: "Lysozyme C" } } },
          genes: [],
          organism: { scientificName: "Homo sapiens" },
        },
      ],
    }));

    const { verifyProteinViaUniProt } = await import("./uniprotAdapter");
    const result = await verifyProteinViaUniProt("lysozyme", "Homo sapiens");
    expect(result.confidenceScore).toBeGreaterThan(0.7);
    expect(result.flags.some((f: string) => f.includes("confirmed"))).toBe(true);
  });
});

// ─── openfdaAdapter tests ─────────────────────────────────────────────────────

describe("openfdaAdapter", () => {
  it("returns found=true with event count when FDA responds", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({
      results: [
        { term: "NAUSEA", count: 150 },
        { term: "HEADACHE", count: 80 },
        { term: "DIARRHOEA", count: 45 },
      ],
    }));
    mockFetch.mockResolvedValueOnce(jsonResponse({
      meta: { results: { total: 1200 } },
    }));

    const { searchFdaAdverseEvents } = await import("./openfdaAdapter");
    const result = await searchFdaAdverseEvents("whey protein");
    expect(result.found).toBe(true);
    expect(result.totalEvents).toBe(1200);
    expect(result.topReactions).toContain("NAUSEA");
  });

  it("returns found=false when FDA returns 404", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({}, 404));
    mockFetch.mockResolvedValueOnce(jsonResponse({}, 404));
    const { searchFdaAdverseEvents } = await import("./openfdaAdapter");
    const result = await searchFdaAdverseEvents("obscure_compound");
    expect(result.found).toBe(false);
    expect(result.totalEvents).toBe(0);
  });

  it("interpretFdaSignals lowers confidence for high event count on safety claim", async () => {
    const { interpretFdaSignals } = await import("./openfdaAdapter");
    const result: FdaAdverseEventResult = {
      found: true,
      totalEvents: 15000,
      seriousEvents: 9000,
      topReactions: ["NAUSEA", "VOMITING"],
      sourceUrl: "https://fda.gov",
      error: null,
    };
    const signals = interpretFdaSignals(result, true);
    expect(signals.confidenceDelta).toBeLessThan(0);
    expect(signals.flags.some((f: string) => f.includes("High adverse event"))).toBe(true);
  });

  it("interpretFdaSignals is neutral for non-safety claims", async () => {
    const { interpretFdaSignals } = await import("./openfdaAdapter");
    const result: FdaAdverseEventResult = {
      found: true,
      totalEvents: 15000,
      seriousEvents: 9000,
      topReactions: ["NAUSEA"],
      sourceUrl: "https://fda.gov",
      error: null,
    };
    const signals = interpretFdaSignals(result, false);
    expect(signals.confidenceDelta).toBe(0);
  });

  it("interpretFdaSignals boosts confidence for low event count on safety claim", async () => {
    const { interpretFdaSignals } = await import("./openfdaAdapter");
    const result: FdaAdverseEventResult = {
      found: true,
      totalEvents: 50,
      seriousEvents: 30,
      topReactions: ["HEADACHE"],
      sourceUrl: "https://fda.gov",
      error: null,
    };
    const signals = interpretFdaSignals(result, true);
    expect(signals.confidenceDelta).toBeGreaterThan(0);
  });
});

// ─── europePmcAdapter tests ───────────────────────────────────────────────────

describe("europePmcAdapter", () => {
  it("returns found=true with review counts when Europe PMC responds", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({
      hitCount: 12,
      resultList: {
        result: [
          { pmid: "12345678", title: "Meta-analysis of creatine supplementation", pubType: "meta-analysis" },
          { pmid: "23456789", title: "Systematic review of protein timing", pubType: "systematic review" },
        ],
      },
    }));

    const { searchSystematicReviews } = await import("./europePmcAdapter");
    const result = await searchSystematicReviews("creatine performance");
    expect(result.found).toBe(true);
    expect(result.topPmids).toContain("12345678");
    expect(result.topTitles[0]).toContain("Meta-analysis");
  });

  it("returns found=false when Europe PMC returns empty results", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ hitCount: 0, resultList: { result: [] } }));
    const { searchSystematicReviews } = await import("./europePmcAdapter");
    const result = await searchSystematicReviews("nonexistent_intervention_xyz");
    expect(result.found).toBe(false);
  });

  it("returns error when fetch throws", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Timeout"));
    const { searchSystematicReviews } = await import("./europePmcAdapter");
    const result = await searchSystematicReviews("creatine");
    expect(result.found).toBe(false);
    expect(result.error).toContain("Timeout");
  });

  it("interpretSystematicReviewEvidence boosts score for multiple meta-analyses", async () => {
    const { interpretSystematicReviewEvidence } = await import("./europePmcAdapter");
    const result: EuropePmcResult = {
      found: true,
      systematicReviewCount: 2,
      metaAnalysisCount: 4,
      topPmids: ["12345678"],
      topTitles: ["Meta-analysis of creatine"],
      sourceUrl: "https://europepmc.org",
      error: null,
    };
    const evidence = interpretSystematicReviewEvidence(result, 0.50);
    expect(evidence.confidenceScore).toBeGreaterThanOrEqual(0.90);
    expect(evidence.flags.some((f: string) => f.includes("meta-analyses"))).toBe(true);
  });

  it("interpretSystematicReviewEvidence does not exceed 0.95", async () => {
    const { interpretSystematicReviewEvidence } = await import("./europePmcAdapter");
    const result: EuropePmcResult = {
      found: true,
      systematicReviewCount: 10,
      metaAnalysisCount: 20,
      topPmids: [],
      topTitles: [],
      sourceUrl: "",
      error: null,
    };
    const evidence = interpretSystematicReviewEvidence(result, 0.95);
    expect(evidence.confidenceScore).toBeLessThanOrEqual(0.95);
  });
});

// ─── Vertical adapter registry routing ───────────────────────────────────────

describe("vertical adapter registry", () => {
  it("getVertical returns registered adapters by domainKey", async () => {
    await import("./verticalAdapters");
    const { getVertical } = await import("./verticalAdapters/types");
    expect(getVertical("structural_biology")).toBeDefined();
    expect(getVertical("protein_supplement")).toBeDefined();
    expect(getVertical("creatine_ergogenics")).toBeDefined();
    expect(getVertical("collagen_peptides")).toBeDefined();
    expect(getVertical("sports_nutrition_rct")).toBeDefined();
    expect(getVertical("gut_microbiome")).toBeDefined();
    expect(getVertical("plant_based_protein")).toBeDefined();
    expect(getVertical("salmon_biotech")).toBeDefined();
  });

  it("getVertical returns undefined for unknown domain", async () => {
    const { getVertical } = await import("./verticalAdapters/types");
    expect(getVertical("unknown_domain_xyz")).toBeUndefined();
  });

  it("all registered adapters have required fields", async () => {
    await import("./verticalAdapters");
    const { listVerticals } = await import("./verticalAdapters/types");
    const adapters = listVerticals();
    expect(adapters.length).toBeGreaterThanOrEqual(8);
    for (const adapter of adapters) {
      expect(adapter.domainKey).toBeTruthy();
      expect(adapter.displayName).toBeTruthy();
      expect(typeof adapter.lookupEvidence).toBe("function");
    }
  });
});
