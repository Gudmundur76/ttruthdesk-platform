/**
 * sprint36.test.ts — Sprint 36: Coverage Push
 *
 * Adds tests for uncovered branches in:
 *   - world_bank.ts  (61% → target 85%+): extractedValue fallback, HTTP error, abort timeout, TypeError
 *   - wikidata.ts    (76.5% → target 90%+): Q-number SPARQL path, SPARQL non-ok, keyword fallback non-ok
 *   - alphafold.ts   (93.6% → target 98%+): UniProt search fallback, no_uniprot_accession, uniprot_search_error
 *
 * All tests follow the Ralph Wiggum TDD pattern: failing test → minimum fix → green.
 *
 * Key discipline:
 *   - vi.resetAllMocks() in beforeEach (not clearAllMocks) to flush the mockResolvedValueOnce queue
 *   - All World Bank tests use valid 4-part indicator codes so fetch is always called
 *   - Each test sets exactly the mocks it needs, no more
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import "./world_bank";
import "./wikidata";
import "./alphafold";
import { getVertical } from "./types";

beforeEach(() => {
  // resetAllMocks clears both call history AND the mockResolvedValueOnce queue,
  // preventing mock bleed-through between tests.
  vi.resetAllMocks();
});

// ─── world_bank.ts — uncovered lines 44, 54, 74, 80-88, 90-107 ──────────────

describe("WorldBankAdapter — Sprint 36 coverage", () => {
  it("extracts indicator from extractedValue when claimText has no regex match", async () => {
    // NY.GDP.MKTP.CD is a valid 4-part code that the regex will match in extractedValue
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [
        { page: 1, pages: 1, per_page: 50, total: 1 },
        [
          {
            indicator: { id: "NY.GDP.MKTP.CD", value: "GDP (current US$)" },
            country: { id: "WLD", value: "World" },
            countryiso3code: "WLD",
            date: "2022",
            value: 100000000000000,
            unit: "USD",
            obs_status: "",
            decimal: 0,
          },
        ],
      ],
    });
    const adapter = getVertical("world_bank");
    expect(adapter).toBeDefined();
    const result = await adapter!.lookupEvidence({
      // claimText has no 4-part indicator code — extractedValue provides it
      claimText: "World GDP exceeded 100 trillion dollars in 2022",
      extractedValue: "NY.GDP.MKTP.CD",
    });
    expect(result.found).toBe(true);
    expect(result.confidenceScore).toBeGreaterThanOrEqual(0.9);
    expect(result.confidenceFlags).toContain("world_bank_official_data");
  });

  it("returns found=false with http_error flag when API returns non-ok status", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 503,
      statusText: "Service Unavailable",
    });
    const adapter = getVertical("world_bank");
    expect(adapter).toBeDefined();
    const result = await adapter!.lookupEvidence({
      claimText: "NY.GDP.MKTP.CD global GDP data",
      extractedValue: "NY.GDP.MKTP.CD",
    });
    expect(result.found).toBe(false);
    expect(result.confidenceFlags).toContain("http_error");
    expect(result.confidenceFlags).toContain("status_503");
  });

  it("returns found=false with request_timeout flag on AbortError", async () => {
    const abortErr = new Error("The operation was aborted");
    abortErr.name = "AbortError";
    mockFetch.mockRejectedValueOnce(abortErr);
    const adapter = getVertical("world_bank");
    expect(adapter).toBeDefined();
    const result = await adapter!.lookupEvidence({
      claimText: "NY.GDP.MKTP.CD global GDP data",
      extractedValue: "NY.GDP.MKTP.CD",
    });
    expect(result.found).toBe(false);
    expect(result.confidenceFlags).toContain("request_timeout");
    expect(result.confidenceScore).toBeLessThan(0.1);
  });

  it("returns found=false with invalid_url_or_network_issue on TypeError", async () => {
    mockFetch.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const adapter = getVertical("world_bank");
    expect(adapter).toBeDefined();
    const result = await adapter!.lookupEvidence({
      claimText: "NY.GDP.MKTP.CD global GDP data",
      extractedValue: "NY.GDP.MKTP.CD",
    });
    expect(result.found).toBe(false);
    expect(result.confidenceFlags).toContain("invalid_url_or_network_issue");
  });

  it("returns found=false with no_data_for_indicator when data[1] is empty array", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [{ page: 1, pages: 0, per_page: 50, total: 0 }, []],
    });
    const adapter = getVertical("world_bank");
    expect(adapter).toBeDefined();
    const result = await adapter!.lookupEvidence({
      claimText: "NY.GDP.MKTP.CD data",
      extractedValue: "NY.GDP.MKTP.CD",
    });
    expect(result.found).toBe(false);
    expect(result.confidenceFlags).toContain("no_data_for_indicator");
  });

  it("returns found=false with no_indicator_code_found when no valid code present", async () => {
    // No fetch call expected — returns early
    const adapter = getVertical("world_bank");
    expect(adapter).toBeDefined();
    const result = await adapter!.lookupEvidence({
      claimText: "World population exceeded 8 billion people",
      extractedValue: null,
    });
    expect(result.found).toBe(false);
    expect(result.confidenceFlags).toContain("no_indicator_code_found");
    // No fetch should have been called
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// ─── wikidata.ts — uncovered lines 27-28, 39-64 (Q-number SPARQL path) ──────

describe("WikidataAdapter — Sprint 36 coverage", () => {
  it("returns found=true via SPARQL when claim contains a Q-number", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: {
          bindings: [
            {
              item: { value: "http://www.wikidata.org/entity/Q7240673" },
              itemLabel: { value: "protein" },
              itemDescription: { value: "biological macromolecule" },
            },
          ],
        },
      }),
    });
    const adapter = getVertical("wikidata");
    expect(adapter).toBeDefined();
    const result = await adapter!.lookupEvidence({
      claimText: "Q7240673 is a biological macromolecule",
      extractedValue: null,
    });
    expect(result.found).toBe(true);
    expect(result.confidenceScore).toBeGreaterThan(0);
    expect(result.sourceUrl).toBe("https://www.wikidata.org/wiki/Q7240673");
  });

  it("falls back to keyword search when SPARQL returns empty bindings", async () => {
    // First fetch: SPARQL returns empty bindings
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ results: { bindings: [] } }),
    });
    // Second fetch: keyword search returns a result
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        search: [
          {
            id: "Q7240673",
            label: "protein",
            description: "biological macromolecule",
            concepturi: "http://www.wikidata.org/entity/Q7240673",
          },
        ],
      }),
    });
    const adapter = getVertical("wikidata");
    expect(adapter).toBeDefined();
    const result = await adapter!.lookupEvidence({
      claimText: "Q7240673 protein structure",
      extractedValue: "protein",
    });
    expect(result.found).toBe(true);
  });

  it("returns found=false when SPARQL is non-ok and keyword search also returns empty", async () => {
    // First fetch: SPARQL non-ok
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });
    // Second fetch: keyword search returns empty
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ search: [] }),
    });
    const adapter = getVertical("wikidata");
    expect(adapter).toBeDefined();
    const result = await adapter!.lookupEvidence({
      claimText: "Q9999999 nonexistent entity",
      extractedValue: null,
    });
    expect(result.found).toBe(false);
    expect(result.confidenceFlags).toContain("no-match");
  });

  it("returns found=false when keyword search response is non-ok (no Q-number in text)", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 429 });
    const adapter = getVertical("wikidata");
    expect(adapter).toBeDefined();
    const result = await adapter!.lookupEvidence({
      claimText: "some entity without Q-number",
      extractedValue: null,
    });
    expect(result.found).toBe(false);
  });

  it("uses concepturi as sourceUrl when present in keyword search result", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        search: [
          {
            id: "Q42",
            label: "Douglas Adams",
            concepturi: "http://www.wikidata.org/entity/Q42",
          },
        ],
      }),
    });
    const adapter = getVertical("wikidata");
    expect(adapter).toBeDefined();
    const result = await adapter!.lookupEvidence({
      claimText: "Douglas Adams wrote The Hitchhiker's Guide",
      extractedValue: "Douglas Adams",
    });
    expect(result.found).toBe(true);
    expect(result.sourceUrl).toBe("http://www.wikidata.org/entity/Q42");
  });
});

// ─── alphafold.ts — uncovered lines 158-160, 172-173, 178-180, 208-210 ──────

describe("AlphaFoldAdapter — Sprint 36 coverage", () => {
  it("returns found=false with uniprot_search_error when UniProt search returns non-ok", async () => {
    // No accession in query → goes to lookupBySearch → UniProt search fails
    mockFetch.mockResolvedValueOnce({ ok: false, status: 503 });
    const adapter = getVertical("alphafold");
    expect(adapter).toBeDefined();
    const result = await adapter!.lookupEvidence({
      claimText: "tumor suppressor protein structure",
      extractedValue: null,
    });
    expect(result.found).toBe(false);
    expect(result.confidenceFlags).toContain("uniprot_search_error_503");
  });

  it("returns found=false with no_uniprot_match when UniProt returns empty results", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ results: [] }),
    });
    const adapter = getVertical("alphafold");
    expect(adapter).toBeDefined();
    const result = await adapter!.lookupEvidence({
      claimText: "completely unknown protein xyzzy",
      extractedValue: null,
    });
    expect(result.found).toBe(false);
    expect(result.confidenceFlags).toContain("no_uniprot_match");
  });

  it("returns found=false with no_uniprot_accession when primaryAccession is missing", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: [
          // Entry with no primaryAccession field
          { genes: [], proteinDescription: {}, organism: {} },
        ],
      }),
    });
    const adapter = getVertical("alphafold");
    expect(adapter).toBeDefined();
    const result = await adapter!.lookupEvidence({
      claimText: "protein with no accession",
      extractedValue: null,
    });
    expect(result.found).toBe(false);
    expect(result.confidenceFlags).toContain("no_uniprot_accession");
  });

  it("returns UniProt fallback when AlphaFold lookup returns 404 for searched accession", async () => {
    // UniProt search succeeds, returns accession
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: [
          {
            primaryAccession: "A0A000",
            genes: [{ geneName: { value: "TESTGENE" } }],
            proteinDescription: {
              recommendedName: { fullName: { value: "Test Protein" } },
            },
            organism: { scientificName: "Homo sapiens" },
          },
        ],
      }),
    });
    // AlphaFold lookup for that accession returns 404
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });
    const adapter = getVertical("alphafold");
    expect(adapter).toBeDefined();
    const result = await adapter!.lookupEvidence({
      claimText: "test gene protein structure",
      extractedValue: null,
    });
    // Should return UniProt-based fallback with found=true
    expect(result.found).toBe(true);
    expect(result.confidenceFlags).toContain("uniprot_search");
    expect(result.sourceId).toBe("alphafold-A0A000");
    expect(result.confidenceScore).toBe(0.78);
  });

  it("returns found=false with network_or_parsing_error when lookupBySearch throws", async () => {
    mockFetch.mockRejectedValueOnce(new Error("DNS resolution failed"));
    const adapter = getVertical("alphafold");
    expect(adapter).toBeDefined();
    const result = await adapter!.lookupEvidence({
      claimText: "some protein query without accession",
      extractedValue: null,
    });
    expect(result.found).toBe(false);
    expect(result.confidenceFlags).toContain("network_or_parsing_error");
  });

  it("returns found=false with no_alphafold_entry when API returns non-array", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({}),
    });
    const adapter = getVertical("alphafold");
    expect(adapter).toBeDefined();
    const result = await adapter!.lookupEvidence({
      claimText: "P04637 TP53 protein",
      extractedValue: "P04637",
    });
    expect(result.found).toBe(false);
    expect(result.confidenceFlags).toContain("no_alphafold_entry");
  });

  it("sets uniprot_reviewed and reference_proteome flags when entry has both true", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [
        {
          entryId: "AF-P04637-F1",
          gene: "TP53",
          uniprotAccession: "P04637",
          uniprotId: "P53_HUMAN",
          uniprotDescription: "Cellular tumor antigen p53",
          taxId: 9606,
          organismScientificName: "Homo sapiens",
          uniprotStart: 1,
          uniprotEnd: 393,
          uniprotSequenceVersion: 4,
          modelCreatedDate: "2022-06-01",
          latestVersion: 4,
          allVersions: [1, 2, 3, 4],
          isReviewed: true,
          isReferenceProteome: true,
          cifUrl: "",
          bcifUrl: "",
          pdbUrl: "https://alphafold.ebi.ac.uk/files/AF-P04637-F1-model_v4.pdb",
          paeImageUrl: "",
          paeDocUrl: "",
        },
      ],
    });
    const adapter = getVertical("alphafold");
    expect(adapter).toBeDefined();
    const result = await adapter!.lookupEvidence({
      claimText: "P04637 TP53 tumor suppressor protein structure",
      extractedValue: "P04637",
    });
    expect(result.found).toBe(true);
    expect(result.confidenceFlags).toContain("uniprot_reviewed");
    expect(result.confidenceFlags).toContain("reference_proteome");
  });
});
