/**
 * pdbLookupAdapter.test.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Sprint 41: Unit tests for verifyResolutionByProteinSearch and
 * verifyProteinNameBySearch.
 *
 * All PDB network calls are mocked so tests are deterministic and fast.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock pdbAdapter before importing pdbLookupAdapter ──────────────────────
vi.mock("./pdbAdapter", () => ({
  searchPdbByProteinName: vi.fn(),
  fetchPdbEntry: vi.fn(),
}));

import {
  verifyResolutionByProteinSearch,
  verifyProteinNameBySearch,
} from "./pdbLookupAdapter";
import {
  searchPdbByProteinName,
  fetchPdbEntry,
} from "./pdbAdapter";

const mockSearch = vi.mocked(searchPdbByProteinName);
const mockFetch = vi.mocked(fetchPdbEntry);

// Helper to build a minimal PdbValidationResult
function makePdbResult(pdbId: string, resolution: number | null) {
  return {
    found: true,
    entry: {
      pdbId,
      title: `Mock entry ${pdbId}`,
      experimentalMethod: "X-RAY DIFFRACTION",
      resolution,
      releaseDate: "2020-01-01",
      organisms: ["Homo sapiens"],
      entities: ["mock protein"],
      ligands: [],
      url: `https://www.rcsb.org/structure/${pdbId}`,
    },
    error: null,
  };
}

function makeNotFound() {
  return { found: false, entry: null, error: "PDB ID not found" };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── verifyResolutionByProteinSearch ─────────────────────────────────────────

describe("verifyResolutionByProteinSearch", () => {
  it("returns null when resolution is null", async () => {
    const result = await verifyResolutionByProteinSearch({
      claimText: "Lysozyme structure at 2.0 Å",
      proteinName: "lysozyme",
      resolution: null,
    });
    expect(result).toBeNull();
    expect(mockSearch).not.toHaveBeenCalled();
  });

  it("returns null when no protein name can be extracted", async () => {
    const result = await verifyResolutionByProteinSearch({
      claimText: "2.0 Å",
      proteinName: null,
      resolution: 2.0,
    });
    expect(result).toBeNull();
  });

  it("returns Insufficient Evidence when PDB search returns no candidates", async () => {
    mockSearch.mockResolvedValueOnce([]);
    const result = await verifyResolutionByProteinSearch({
      claimText: "Carbamoyl phosphate synthetase at 2.1 Å",
      proteinName: "Carbamoyl phosphate synthetase",
      resolution: 2.1,
    });
    expect(result?.verdict).toBe("Insufficient Evidence");
    expect(result?.rationale).toContain("No PDB entries found");
  });

  it("returns Supported for exact resolution match (Δ ≤ 0.05 Å)", async () => {
    mockSearch.mockResolvedValueOnce(["1ABC"]);
    mockFetch.mockResolvedValueOnce(makePdbResult("1ABC", 2.10));
    const result = await verifyResolutionByProteinSearch({
      claimText: "Lysozyme crystal structure at 2.1 Å",
      proteinName: "Lysozyme",
      resolution: 2.10,
    });
    expect(result?.verdict).toBe("Supported");
    expect(result?.rationale).toContain("1ABC");
    expect(result?.evidenceUrl).toContain("1ABC");
  });

  it("returns Supported for near-exact match (Δ = 0.03 Å)", async () => {
    mockSearch.mockResolvedValueOnce(["2DEF"]);
    mockFetch.mockResolvedValueOnce(makePdbResult("2DEF", 1.80));
    const result = await verifyResolutionByProteinSearch({
      claimText: "Hemoglobin at 1.83 Å",
      proteinName: "Hemoglobin",
      resolution: 1.83,
    });
    expect(result?.verdict).toBe("Supported");
  });

  it("returns Partially Supported for close match (0.05 < Δ ≤ 0.20 Å)", async () => {
    mockSearch.mockResolvedValueOnce(["3GHI"]);
    mockFetch.mockResolvedValueOnce(makePdbResult("3GHI", 2.00));
    const result = await verifyResolutionByProteinSearch({
      claimText: "Insulin at 2.15 Å",
      proteinName: "Insulin",
      resolution: 2.15,
    });
    expect(result?.verdict).toBe("Partially Supported");
    expect(result?.rationale).toContain("Δ=0.15");
  });

  it("returns Ambiguous when best candidate is far off (Δ > 0.20 Å)", async () => {
    mockSearch.mockResolvedValueOnce(["4JKL"]);
    mockFetch.mockResolvedValueOnce(makePdbResult("4JKL", 3.50));
    const result = await verifyResolutionByProteinSearch({
      claimText: "Myosin at 1.8 Å",
      proteinName: "Myosin",
      resolution: 1.8,
    });
    expect(result?.verdict).toBe("Ambiguous");
    expect(result?.rationale).toContain("Multiple structures may exist");
  });

  it("returns Ambiguous when candidates have no resolution data", async () => {
    mockSearch.mockResolvedValueOnce(["5MNO"]);
    mockFetch.mockResolvedValueOnce(makePdbResult("5MNO", null));
    const result = await verifyResolutionByProteinSearch({
      claimText: "Actin at 2.0 Å",
      proteinName: "Actin",
      resolution: 2.0,
    });
    expect(result?.verdict).toBe("Ambiguous");
    expect(result?.rationale).toContain("none have resolution data");
  });

  it("picks the best match across multiple candidates", async () => {
    mockSearch.mockResolvedValueOnce(["6PQR", "7STU"]);
    mockFetch
      .mockResolvedValueOnce(makePdbResult("6PQR", 3.00)) // Δ = 0.90
      .mockResolvedValueOnce(makePdbResult("7STU", 2.12)); // Δ = 0.02 → Supported
    const result = await verifyResolutionByProteinSearch({
      claimText: "Tubulin at 2.1 Å",
      proteinName: "Tubulin",
      resolution: 2.10,
    });
    expect(result?.verdict).toBe("Supported");
    expect(result?.rationale).toContain("7STU");
  });

  it("skips failed fetchPdbEntry calls gracefully", async () => {
    mockSearch.mockResolvedValueOnce(["8VWX"]);
    mockFetch.mockResolvedValueOnce(makeNotFound());
    const result = await verifyResolutionByProteinSearch({
      claimText: "Collagen at 1.5 Å",
      proteinName: "Collagen",
      resolution: 1.5,
    });
    expect(result?.verdict).toBe("Ambiguous");
  });
});

// ── verifyProteinNameBySearch ───────────────────────────────────────────────

describe("verifyProteinNameBySearch", () => {
  it("returns null when protein name is too short", async () => {
    const result = await verifyProteinNameBySearch({
      claimText: "ATP",
      proteinName: "ATP",
    });
    expect(result).toBeNull();
  });

  it("returns Insufficient Evidence when PDB search returns nothing", async () => {
    mockSearch.mockResolvedValueOnce([]);
    const result = await verifyProteinNameBySearch({
      claimText: "Unknown protein XYZ-99 is involved in signalling",
      proteinName: "Unknown protein XYZ-99",
    });
    expect(result?.verdict).toBe("Insufficient Evidence");
    expect(result?.rationale).toContain("not found in RCSB PDB");
  });

  it("returns Ambiguous with candidate list when PDB search finds entries", async () => {
    mockSearch.mockResolvedValueOnce(["1LYZ", "2LYZ"]);
    const result = await verifyProteinNameBySearch({
      claimText: "Lysozyme is a well-characterised enzyme",
      proteinName: "Lysozyme",
    });
    expect(result?.verdict).toBe("Ambiguous");
    expect(result?.rationale).toContain("1LYZ");
    expect(result?.rationale).toContain("2 PDB entries");
  });

  it("extracts protein name from claimText when proteinName is null", async () => {
    mockSearch.mockResolvedValueOnce(["4HHB"]);
    const result = await verifyProteinNameBySearch({
      claimText: "Hemoglobin binds oxygen cooperatively",
      proteinName: null,
    });
    expect(mockSearch).toHaveBeenCalledWith(
      expect.stringContaining("Hemoglobin"),
      3
    );
    expect(result?.verdict).toBe("Ambiguous");
  });
});
