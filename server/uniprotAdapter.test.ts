/**
 * uniprotAdapter.test.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Unit tests for uniprotAdapter.ts — searchUniProt, verifyProteinViaUniProt
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  mockFetch: vi.fn(),
}));

vi.stubGlobal("fetch", mocks.mockFetch);

import { searchUniProt, verifyProteinViaUniProt } from "./uniprotAdapter";

function makeResponse(ok: boolean, body: unknown) {
  return Promise.resolve({
    ok,
    status: ok ? 200 : 404,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as Response);
}

describe("searchUniProt()", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns { found: false, entries: [], error } when fetch throws", async () => {
    mocks.mockFetch.mockRejectedValueOnce(new Error("network error"));
    const result = await searchUniProt("BRCA1");
    expect(result.found).toBe(false);
    expect(result.entries).toEqual([]);
    expect(result.error).toBeTruthy();
  });

  it("returns { found: false } when response is not ok", async () => {
    mocks.mockFetch.mockReturnValueOnce(makeResponse(false, {}));
    const result = await searchUniProt("BRCA1");
    expect(result.found).toBe(false);
    expect(result.entries).toEqual([]);
  });

  it("returns parsed entries when UniProt responds with results", async () => {
    mocks.mockFetch.mockReturnValueOnce(makeResponse(true, {
      results: [
        {
          primaryAccession: "P38398",
          entryType: "UniProtKB reviewed (Swiss-Prot)",
          proteinDescription: {
            recommendedName: { fullName: { value: "Breast cancer type 1 susceptibility protein" } },
          },
          organism: { scientificName: "Homo sapiens" },
          genes: [{ geneName: { value: "BRCA1" } }],
        },
      ],
    }));
    const result = await searchUniProt("BRCA1");
    expect(result.found).toBe(true);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].accession).toBe("P38398");
    expect(result.entries[0].organism).toBe("Homo sapiens");
    expect(result.entries[0].reviewed).toBe(true);
  });

  it("returns { found: false } when results array is empty", async () => {
    mocks.mockFetch.mockReturnValueOnce(makeResponse(true, { results: [] }));
    const result = await searchUniProt("UNKNOWN_PROTEIN");
    expect(result.found).toBe(false);
    expect(result.entries).toEqual([]);
  });
});

describe("verifyProteinViaUniProt()", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns { found: false, confidenceScore: 0 } when protein not found", async () => {
    mocks.mockFetch.mockRejectedValueOnce(new Error("timeout"));
    const result = await verifyProteinViaUniProt("P99999");
    expect(result.found).toBe(false);
    expect(result.confidenceScore).toBe(0);
    expect(result.sourceId).toBeNull();
  });

  it("returns { found: false } when search returns no entries", async () => {
    mocks.mockFetch.mockReturnValueOnce(makeResponse(true, { results: [] }));
    const result = await verifyProteinViaUniProt("UNKNOWN");
    expect(result.found).toBe(false);
    expect(result.confidenceScore).toBe(0);
  });

  it("returns { found: true } with boosted confidence for reviewed entry", async () => {
    mocks.mockFetch.mockReturnValueOnce(makeResponse(true, {
      results: [
        {
          primaryAccession: "P38398",
          entryType: "UniProtKB reviewed (Swiss-Prot)",
          proteinDescription: {
            recommendedName: { fullName: { value: "BRCA1" } },
          },
          organism: { scientificName: "Homo sapiens" },
          genes: [],
        },
      ],
    }));
    const result = await verifyProteinViaUniProt("BRCA1");
    expect(result.found).toBe(true);
    expect(result.confidenceScore).toBeGreaterThan(0.5);
    expect(result.sourceId).toContain("UniProt:P38398");
  });

  it("boosts confidence further when organism matches", async () => {
    mocks.mockFetch.mockReturnValueOnce(makeResponse(true, {
      results: [
        {
          primaryAccession: "P38398",
          entryType: "UniProtKB reviewed (Swiss-Prot)",
          proteinDescription: {
            recommendedName: { fullName: { value: "BRCA1" } },
          },
          organism: { scientificName: "Homo sapiens" },
          genes: [],
        },
      ],
    }));
    const result = await verifyProteinViaUniProt("BRCA1", "Homo sapiens");
    expect(result.found).toBe(true);
    expect(result.confidenceScore).toBeGreaterThan(0.75);
  });
});
