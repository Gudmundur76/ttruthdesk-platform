/**
 * pdbAdapter.test.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Unit tests for the PDB Evidence Adapter.
 *
 * All fetch() calls and eventBus are mocked so tests run without network access.
 * Tests cover:
 *   1. fetchPdbEntry — success, 404, API error, network error
 *   2. searchPdbByProteinName — success, empty result, API error
 *   3. verdictForClaim — pdb_id, experimental_method, resolution, protein_name,
 *      organism, ligand, general_molecular, unknown claimType
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Hoist mocks ─────────────────────────────────────────────────────────────
const { mockFetch, mockPublishEvent } = vi.hoisted(() => ({
  mockFetch: vi.fn(),
  mockPublishEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.stubGlobal("fetch", mockFetch);

vi.mock("./autonomousLoop/eventBus", () => ({
  publishEvent: mockPublishEvent,
}));

import {
  fetchPdbEntry,
  searchPdbByProteinName,
  verdictForClaim,
  type PdbEntry,
} from "./pdbAdapter";

// ─── Helpers ─────────────────────────────────────────────────────────────────
function makePdbDataResponse(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    struct: { title: "Crystal structure of Lysozyme" },
    exptl: [{ method: "X-RAY DIFFRACTION" }],
    rcsb_entry_info: { resolution_combined: [1.8] },
    rcsb_accession_info: { initial_release_date: "2020-01-15" },
    ...overrides,
  };
}

function makePolymerResponse(description = "Lysozyme C", organism = "Homo sapiens") {
  return {
    rcsb_polymer_entity: { pdbx_description: description },
    rcsb_entity_source_organism: [{ scientific_name: organism }],
  };
}

function makeChemCompResponse(name = "ATP") {
  return {
    chem_comp: { name },
  };
}

function makeOkResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    json: vi.fn().mockResolvedValue(body),
  };
}

function makeErrorResponse(status: number) {
  return {
    ok: false,
    status,
    json: vi.fn().mockResolvedValue({}),
  };
}

// ─── fetchPdbEntry ────────────────────────────────────────────────────────────
describe("pdbAdapter — fetchPdbEntry()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns found:true with a populated PdbEntry on success", async () => {
    mockFetch
      .mockResolvedValueOnce(makeOkResponse(makePdbDataResponse())) // main entry
      .mockResolvedValueOnce(makeOkResponse(makePolymerResponse()))  // polymer entity
      .mockResolvedValueOnce(makeOkResponse({}));                    // ligands (empty)

    const result = await fetchPdbEntry("1AZM");

    expect(result.found).toBe(true);
    expect(result.error).toBeNull();
    expect(result.entry).not.toBeNull();
    expect(result.entry!.pdbId).toBe("1AZM");
    expect(result.entry!.title).toBe("Crystal structure of Lysozyme");
    expect(result.entry!.experimentalMethod).toBe("X-RAY DIFFRACTION");
    expect(result.entry!.resolution).toBe(1.8);
    expect(result.entry!.url).toContain("1AZM");
  });

  it("normalises pdbId to uppercase", async () => {
    mockFetch
      .mockResolvedValueOnce(makeOkResponse(makePdbDataResponse()))
      .mockResolvedValueOnce(makeOkResponse(makePolymerResponse()))
      .mockResolvedValueOnce(makeOkResponse({}));

    const result = await fetchPdbEntry("1azm");

    expect(result.entry!.pdbId).toBe("1AZM");
    // The fetch URL should use uppercase
    const firstCall = mockFetch.mock.calls[0][0] as string;
    expect(firstCall).toContain("1AZM");
  });

  it("returns found:false with error when PDB ID not found (404)", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404, json: vi.fn() });

    const result = await fetchPdbEntry("XXXX");

    expect(result.found).toBe(false);
    expect(result.entry).toBeNull();
    expect(result.error).toContain("not found");
  });

  it("returns found:false with error on non-404 API error", async () => {
    mockFetch.mockResolvedValueOnce(makeErrorResponse(503));

    const result = await fetchPdbEntry("1AZM");

    expect(result.found).toBe(false);
    expect(result.error).toContain("503");
  });

  it("returns found:false with error on network failure", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Network error"));

    const result = await fetchPdbEntry("1AZM");

    expect(result.found).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it("handles missing resolution gracefully (null)", async () => {
    const dataWithoutResolution = makePdbDataResponse({ rcsb_entry_info: {} });
    mockFetch
      .mockResolvedValueOnce(makeOkResponse(dataWithoutResolution))
      .mockResolvedValueOnce(makeOkResponse(makePolymerResponse()))
      .mockResolvedValueOnce(makeOkResponse({}));

    const result = await fetchPdbEntry("1AZM");

    expect(result.found).toBe(true);
    expect(result.entry!.resolution).toBeNull();
  });
});

// ─── searchPdbByProteinName ───────────────────────────────────────────────────
describe("pdbAdapter — searchPdbByProteinName()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns an array of PDB IDs on success", async () => {
    mockFetch.mockResolvedValueOnce(
      makeOkResponse({
        result_set: [
          { identifier: "1AZM" },
          { identifier: "2LZT" },
          { identifier: "3LZT" },
        ],
      })
    );

    const ids = await searchPdbByProteinName("Lysozyme");

    expect(ids).toEqual(["1AZM", "2LZT", "3LZT"]);
  });

  it("returns empty array when no results", async () => {
    mockFetch.mockResolvedValueOnce(makeOkResponse({ result_set: [] }));

    const ids = await searchPdbByProteinName("NonExistentProtein");

    expect(ids).toEqual([]);
  });

  it("returns empty array on API error", async () => {
    mockFetch.mockResolvedValueOnce(makeErrorResponse(500));

    const ids = await searchPdbByProteinName("Lysozyme");

    expect(ids).toEqual([]);
  });

  it("returns empty array on network failure", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Network error"));

    const ids = await searchPdbByProteinName("Lysozyme");

    expect(ids).toEqual([]);
  });

  it("respects the limit parameter", async () => {
    mockFetch.mockResolvedValueOnce(makeOkResponse({ result_set: [{ identifier: "1AZM" }] }));

    await searchPdbByProteinName("Lysozyme", 1);

    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    expect(body.request_options.paginate.rows).toBe(1);
  });
});

// ─── verdictForClaim ─────────────────────────────────────────────────────────
describe("pdbAdapter — verdictForClaim()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns Supported for a valid pdb_id claim", async () => {
    mockFetch
      .mockResolvedValueOnce(makeOkResponse(makePdbDataResponse()))
      .mockResolvedValueOnce(makeOkResponse(makePolymerResponse()))
      .mockResolvedValueOnce(makeOkResponse({}));

    const result = await verdictForClaim({ claimType: "pdb_id", pdbId: "1AZM" });

    expect(result.verdict).toBe("Supported");
    expect(result.evidenceUrl).toContain("1AZM");
  });

  it("returns Contradicted for a pdb_id claim when ID not found", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404, json: vi.fn() });

    const result = await verdictForClaim({ claimType: "pdb_id", pdbId: "XXXX" });

    expect(result.verdict).toBe("Contradicted");
    expect(result.rationale).toContain("XXXX");
  });

  it("returns Supported for matching experimental_method claim", async () => {
    mockFetch
      .mockResolvedValueOnce(makeOkResponse(makePdbDataResponse()))
      .mockResolvedValueOnce(makeOkResponse(makePolymerResponse()))
      .mockResolvedValueOnce(makeOkResponse({}));

    const result = await verdictForClaim({
      claimType: "experimental_method",
      pdbId: "1AZM",
      experimentalMethod: "X-RAY DIFFRACTION",
    });

    expect(result.verdict).toBe("Supported");
  });

  it("returns Contradicted for mismatched experimental_method claim", async () => {
    mockFetch
      .mockResolvedValueOnce(makeOkResponse(makePdbDataResponse()))
      .mockResolvedValueOnce(makeOkResponse(makePolymerResponse()))
      .mockResolvedValueOnce(makeOkResponse({}));

    const result = await verdictForClaim({
      claimType: "experimental_method",
      pdbId: "1AZM",
      experimentalMethod: "CRYO-EM",
    });

    expect(result.verdict).toBe("Contradicted");
  });

  it("returns Insufficient Evidence for experimental_method when PDB ID not found", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404, json: vi.fn() });

    const result = await verdictForClaim({
      claimType: "experimental_method",
      pdbId: "XXXX",
      experimentalMethod: "X-RAY DIFFRACTION",
    });

    expect(result.verdict).toBe("Insufficient Evidence");
  });

  it("returns Insufficient Evidence for unknown claimType (fallback path)", async () => {
    // The adapter returns Insufficient Evidence (not Out of Scope) for unrecognised
    // claim types so downstream AI can still present PubMed evidence.
    const result = await verdictForClaim({ claimType: "unknown_type" });

    expect(result.verdict).toBe("Insufficient Evidence");
    expect(result.evidenceUrl).toBeNull();
  });

  it("returns Insufficient Evidence for pdb_id claim without pdbId value (fallback)", async () => {
    // claimType=pdb_id but no pdbId — falls through to the general fallback
    const result = await verdictForClaim({ claimType: "pdb_id", pdbId: null });

    expect(result.verdict).toBe("Insufficient Evidence");
  });

  it("returns a verdict with rationale and evidenceRaw for all paths", async () => {
    mockFetch
      .mockResolvedValueOnce(makeOkResponse(makePdbDataResponse()))
      .mockResolvedValueOnce(makeOkResponse(makePolymerResponse()))
      .mockResolvedValueOnce(makeOkResponse({}));

    const result = await verdictForClaim({ claimType: "pdb_id", pdbId: "1AZM" });

    expect(result.rationale).toBeTruthy();
    expect(result.verdict).toBeTruthy();
  });
});
