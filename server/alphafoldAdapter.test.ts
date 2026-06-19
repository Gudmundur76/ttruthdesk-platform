/**
 * alphafoldAdapter.test.ts
 * Unit tests for the AlphaFold DB adapter.
 * All HTTP calls are mocked — no real network requests.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  fetchAlphaFoldEntry,
  verifyStructurePredictionViaAlphaFold,
  extractUniProtAccessions,
} from "./alphafoldAdapter";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

beforeEach(() => {
  mockFetch.mockReset();
});

// ─── fetchAlphaFoldEntry ──────────────────────────────────────────────────────

describe("fetchAlphaFoldEntry()", () => {
  it("returns found=true with entry when API responds with valid data", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => [
        {
          entryId: "AF-P68871-F1",
          meanPlddt: 82.5,
          uniprotEnd: 147,
          cifUrl: "https://alphafold.ebi.ac.uk/files/AF-P68871-F1-model_v4.cif",
          paeImageUrl: null,
        },
      ],
    });

    const result = await fetchAlphaFoldEntry("P68871");

    expect(result.found).toBe(true);
    expect(result.entry).not.toBeNull();
    expect(result.entry!.uniprotAccession).toBe("P68871");
    expect(result.entry!.meanPlddt).toBe(82.5);
    expect(result.entry!.entryId).toBe("AF-P68871-F1");
    expect(result.error).toBeNull();
  });

  it("returns found=false when API returns 404", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });

    const result = await fetchAlphaFoldEntry("P99999");

    expect(result.found).toBe(false);
    expect(result.entry).toBeNull();
    expect(result.error).toContain("P99999");
  });

  it("returns found=false on non-ok status", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 503 });

    const result = await fetchAlphaFoldEntry("P68871");

    expect(result.found).toBe(false);
    expect(result.error).toContain("503");
  });

  it("returns found=false when fetch throws (network error)", async () => {
    mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));

    const result = await fetchAlphaFoldEntry("P68871");

    expect(result.found).toBe(false);
    expect(result.error).toContain("ECONNREFUSED");
  });

  it("handles single-object response (non-array)", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        entryId: "AF-P12345-F1",
        meanPlddt: 65.0,
        uniprotEnd: 200,
        cifUrl: "https://alphafold.ebi.ac.uk/files/AF-P12345-F1-model_v4.cif",
        paeImageUrl: null,
      }),
    });

    const result = await fetchAlphaFoldEntry("P12345");

    expect(result.found).toBe(true);
    expect(result.entry!.meanPlddt).toBe(65.0);
  });
});

// ─── verifyStructurePredictionViaAlphaFold ────────────────────────────────────

describe("verifyStructurePredictionViaAlphaFold()", () => {
  it("returns Supported when pLDDT > 70", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => [{ entryId: "AF-P68871-F1", meanPlddt: 85.0, uniprotEnd: 147, cifUrl: "", paeImageUrl: null }],
    });

    const verdict = await verifyStructurePredictionViaAlphaFold(
      "P68871",
      "Hemoglobin subunit beta has a well-defined predicted structure."
    );

    expect(verdict.verdict).toBe("Supported");
    expect(verdict.confidenceScore).toBeGreaterThan(0.6);
    expect(verdict.evidenceUrl).toContain("P68871");
    expect(verdict.evidenceRaw).not.toBeNull();
  });

  it("returns Ambiguous when pLDDT is between 50 and 70", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => [{ entryId: "AF-P12345-F1", meanPlddt: 60.0, uniprotEnd: 200, cifUrl: "", paeImageUrl: null }],
    });

    const verdict = await verifyStructurePredictionViaAlphaFold(
      "P12345",
      "Protein X has a predicted disordered region."
    );

    expect(verdict.verdict).toBe("Ambiguous");
    expect(verdict.confidenceScore).toBeGreaterThan(0.3);
    expect(verdict.confidenceScore).toBeLessThan(0.6);
  });

  it("returns Ambiguous when pLDDT < 50", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => [{ entryId: "AF-P99998-F1", meanPlddt: 35.0, uniprotEnd: 80, cifUrl: "", paeImageUrl: null }],
    });

    const verdict = await verifyStructurePredictionViaAlphaFold(
      "P99998",
      "Intrinsically disordered protein claim."
    );

    expect(verdict.verdict).toBe("Ambiguous");
    expect(verdict.confidenceScore).toBeLessThan(0.35);
  });

  it("returns Insufficient Evidence when protein not found", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });

    const verdict = await verifyStructurePredictionViaAlphaFold(
      "P00000",
      "Unknown protein claim."
    );

    expect(verdict.verdict).toBe("Insufficient Evidence");
    expect(verdict.confidenceScore).toBeLessThan(0.2);
    expect(verdict.evidenceRaw).toBeNull();
  });

  it("returns Insufficient Evidence when fetch fails", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Network error"));

    const verdict = await verifyStructurePredictionViaAlphaFold(
      "P68871",
      "Some claim."
    );

    expect(verdict.verdict).toBe("Insufficient Evidence");
  });
});

// ─── extractUniProtAccessions ─────────────────────────────────────────────────

describe("extractUniProtAccessions()", () => {
  it("extracts standard 6-char UniProt accession codes", () => {
    const text = "The protein P68871 (hemoglobin beta) and Q9Y2X3 were studied.";
    const accessions = extractUniProtAccessions(text);
    expect(accessions).toContain("P68871");
    expect(accessions).toContain("Q9Y2X3");
  });

  it("extracts O-prefix accession codes", () => {
    const text = "O15350 is a well-characterized protein.";
    const accessions = extractUniProtAccessions(text);
    expect(accessions).toContain("O15350");
  });

  it("deduplicates repeated accessions", () => {
    const text = "P68871 and P68871 are the same protein.";
    const accessions = extractUniProtAccessions(text);
    expect(accessions).toHaveLength(1);
    expect(accessions[0]).toBe("P68871");
  });

  it("returns empty array when no accessions found", () => {
    const text = "This text has no UniProt accession codes.";
    const accessions = extractUniProtAccessions(text);
    expect(accessions).toHaveLength(0);
  });

  it("does not match short or invalid codes", () => {
    const text = "P123 is not a valid accession. Neither is ABCDEF.";
    const accessions = extractUniProtAccessions(text);
    expect(accessions).toHaveLength(0);
  });
});
