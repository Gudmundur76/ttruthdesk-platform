/**
 * sprint34.test.ts — Sprint 34 tests
 * Molecular biology adapters: AlphaFold, NIST Chemistry WebBook
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import "./alphafold";
import "./nist_chemistry";
import { getVertical } from "./types";

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── AlphaFold ────────────────────────────────────────────────────────────────

describe("AlphaFoldAdapter", () => {
  it("registers with domainKey alphafold", () => {
    expect(getVertical("alphafold")).toBeDefined();
  });

  it("returns found=true for UniProt accession lookup", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ([
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
          cifUrl: "https://alphafold.ebi.ac.uk/files/AF-P04637-F1-model_v4.cif",
          bcifUrl: "https://alphafold.ebi.ac.uk/files/AF-P04637-F1-model_v4.bcif",
          pdbUrl: "https://alphafold.ebi.ac.uk/files/AF-P04637-F1-model_v4.pdb",
          paeImageUrl: "https://alphafold.ebi.ac.uk/files/AF-P04637-F1-predicted_aligned_error_v4.png",
          paeDocUrl: "https://alphafold.ebi.ac.uk/files/AF-P04637-F1-predicted_aligned_error_v4.json",
        }
      ]),
    });

    const adapter = getVertical("alphafold");
    expect(adapter).toBeDefined();

    const result = await adapter!.lookupEvidence({
      claimText: "TP53 protein structure P04637 has an alpha helix at residues 94-102",
      extractedValue: "P04637",
    });
    expect(result.found).toBe(true);
    expect(result.sourceId).toBe("alphafold-AF-P04637-F1");
    expect(result.confidenceFlags).toContain("alphafold_prediction");
    expect(result.confidenceFlags).toContain("uniprot_reviewed");
    expect(result.confidenceScore).toBeGreaterThan(0.85);
    expect(result.sourceUrl).toContain("alphafold.ebi.ac.uk/entry/P04637");
  });

  it("returns found=true via UniProt search when no accession in query", async () => {
    // First call: UniProt search
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: [{
          primaryAccession: "P04637",
          genes: [{ geneName: { value: "TP53" } }],
          proteinDescription: { recommendedName: { fullName: { value: "Cellular tumor antigen p53" } } },
          organism: { scientificName: "Homo sapiens" },
        }],
      }),
    });
    // Second call: AlphaFold by accession
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ([
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
        }
      ]),
    });

    const adapter = getVertical("alphafold");
    const result = await adapter!.lookupEvidence({
      claimText: "TP53 tumor suppressor protein structure",
      extractedValue: "TP53 tumor suppressor",
    });
    expect(result.found).toBe(true);
    expect(result.confidenceFlags).toContain("alphafold_prediction");
  });

  it("returns found=false with alphafold_not_found on 404", async () => {
    // Q9Y6K9 is a valid UniProt accession format
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });

    const adapter = getVertical("alphafold");
    const result = await adapter!.lookupEvidence({
      claimText: "protein structure Q9Y6K9",
      extractedValue: "Q9Y6K9",
    });
    expect(result.found).toBe(false);
    expect(result.confidenceFlags).toContain("alphafold_not_found");
  });

  it("returns found=false with http_error flag on 503", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 503 });

    const adapter = getVertical("alphafold");
    const result = await adapter!.lookupEvidence({
      claimText: "protein structure P12345",
      extractedValue: "P12345",
    });
    expect(result.found).toBe(false);
    expect(result.confidenceFlags).toContain("http_error_503");
  });

  it("returns found=false with network_or_parsing_error on fetch throw", async () => {
    mockFetch.mockRejectedValueOnce(new Error("network timeout"));

    const adapter = getVertical("alphafold");
    const result = await adapter!.lookupEvidence({
      claimText: "protein structure P04637",
      extractedValue: "P04637",
    });
    expect(result.found).toBe(false);
    expect(result.confidenceFlags).toContain("network_or_parsing_error");
  });

  it("returns found=false with no_alphafold_entry when array is empty", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ([]),
    });

    const adapter = getVertical("alphafold");
    const result = await adapter!.lookupEvidence({
      claimText: "protein structure P04637",
      extractedValue: "P04637",
    });
    expect(result.found).toBe(false);
    expect(result.confidenceFlags).toContain("no_alphafold_entry");
  });

  it("has required VerticalAdapter fields", () => {
    const adapter = getVertical("alphafold")!;
    expect(adapter.displayName).toBe("AlphaFold Protein Structure Database");
    expect(adapter.claimExtractorPrompt).toBeTruthy();
    expect(adapter.discoverySearchTerms.length).toBeGreaterThan(3);
  });
});

// ─── NIST Chemistry ───────────────────────────────────────────────────────────

describe("NistChemistryAdapter", () => {
  it("registers with domainKey nist_chemistry", () => {
    expect(getVertical("nist_chemistry")).toBeDefined();
  });

  it("returns found=true for CAS number lookup with JSON response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: { get: () => "application/json" },
      json: async () => ({
        name: "Ethanol",
        MolecularFormula: "C2H6O",
        CASRegistryNumber: "64-17-5",
        MolecularWeight: 46.068,
        InChIKey: "LFQSCWFLJHTTHZ-UHFFFAOYSA-N",
      }),
    });

    const adapter = getVertical("nist_chemistry");
    expect(adapter).toBeDefined();

    const result = await adapter!.lookupEvidence({
      claimText: "Ethanol (CAS 64-17-5) has a boiling point of 78.37°C",
      extractedValue: "64-17-5",
    });
    expect(result.found).toBe(true);
    expect(result.sourceId).toContain("nist-");
    expect(result.confidenceFlags).toContain("nist_chemistry");
    expect(result.confidenceFlags).toContain("cas_lookup");
    expect(result.confidenceScore).toBeGreaterThan(0.85);
    expect(result.sourceUrl).toContain("webbook.nist.gov");
  });

  it("returns found=true with nist_reference on non-JSON response for CAS lookup", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: { get: () => "text/html; charset=utf-8" },
      json: async () => { throw new Error("not JSON"); },
    });

    const adapter = getVertical("nist_chemistry");
    const result = await adapter!.lookupEvidence({
      claimText: "Water (CAS 7732-18-5) boiling point is 100°C",
      extractedValue: "7732-18-5",
    });
    expect(result.found).toBe(true);
    expect(result.confidenceFlags).toContain("nist_chemistry");
    expect(result.confidenceFlags).toContain("nist_reference");
    expect(result.sourceUrl).toContain("webbook.nist.gov");
  });

  it("returns found=true for name-based lookup with JSON response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: { get: () => "application/json" },
      json: async () => ({
        name: "Benzene",
        MolecularFormula: "C6H6",
        CASRegistryNumber: "71-43-2",
        MolecularWeight: 78.112,
      }),
    });

    const adapter = getVertical("nist_chemistry");
    const result = await adapter!.lookupEvidence({
      claimText: "Benzene has a melting point of 5.5°C",
      extractedValue: "benzene melting point",
    });
    expect(result.found).toBe(true);
    expect(result.confidenceFlags).toContain("nist_chemistry");
    expect(result.confidenceFlags).toContain("name_lookup");
  });

  it("returns found=false with nist_not_found on 404", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });

    const adapter = getVertical("nist_chemistry");
    const result = await adapter!.lookupEvidence({
      claimText: "XYZ compound properties",
      extractedValue: "999-99-9",
    });
    expect(result.found).toBe(false);
    expect(result.confidenceFlags).toContain("nist_not_found");
  });

  it("returns found=false with http_error flag on 500", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });

    const adapter = getVertical("nist_chemistry");
    const result = await adapter!.lookupEvidence({
      claimText: "acetone boiling point",
      extractedValue: null,
    });
    expect(result.found).toBe(false);
    expect(result.confidenceFlags).toContain("http_error_500");
  });

  it("returns found=false with network_or_parsing_error on fetch throw", async () => {
    mockFetch.mockRejectedValueOnce(new Error("network error"));

    const adapter = getVertical("nist_chemistry");
    const result = await adapter!.lookupEvidence({
      claimText: "methane properties",
      extractedValue: null,
    });
    expect(result.found).toBe(false);
    expect(result.confidenceFlags).toContain("network_or_parsing_error");
  });

  it("has required VerticalAdapter fields", () => {
    const adapter = getVertical("nist_chemistry")!;
    expect(adapter.displayName).toBe("NIST Chemistry WebBook");
    expect(adapter.claimExtractorPrompt).toBeTruthy();
    expect(adapter.discoverySearchTerms.length).toBeGreaterThan(3);
  });
});
