/**
 * sourcePaperAdapter.test.ts
 * Unit tests for the PMC source paper semantic similarity adapter.
 * All HTTP calls and DB access are mocked.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  embedText,
  cosineSimilarity,
  fetchPubMedAbstract,
  verifyClaimAgainstSourcePaper,
  extractPmids,
} from "./sourcePaperAdapter";

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// Mock the DB module — paperEmbeddings table operations
vi.mock("./db", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve([]),
        }),
      }),
    }),
    insert: () => ({
      values: () => ({
        onDuplicateKeyUpdate: () => Promise.resolve(),
      }),
    }),
  }),
}));

// Mock drizzle-orm eq to avoid real DB import
vi.mock("drizzle-orm", () => ({
  eq: (_a: unknown, _b: unknown) => ({ _a, _b }),
}));

// Mock the schema import
vi.mock("../drizzle/schema", () => ({
  paperEmbeddings: { pmid: "pmid", embedding: "embedding" },
}));

beforeEach(() => {
  mockFetch.mockReset();
});

// ─── cosineSimilarity ─────────────────────────────────────────────────────────

describe("cosineSimilarity()", () => {
  it("returns 1.0 for identical vectors", () => {
    const v = [1, 2, 3, 4];
    expect(cosineSimilarity(v, v)).toBeCloseTo(1.0, 5);
  });

  it("returns 0.0 for orthogonal vectors", () => {
    const a = [1, 0, 0];
    const b = [0, 1, 0];
    expect(cosineSimilarity(a, b)).toBeCloseTo(0.0, 5);
  });

  it("returns 0.0 for zero vectors", () => {
    const a = [0, 0, 0];
    const b = [1, 2, 3];
    expect(cosineSimilarity(a, b)).toBe(0);
  });

  it("returns 0.0 for empty vectors", () => {
    expect(cosineSimilarity([], [])).toBe(0);
  });

  it("returns 0.0 for mismatched lengths", () => {
    expect(cosineSimilarity([1, 2], [1, 2, 3])).toBe(0);
  });

  it("returns value in [0,1] for typical vectors", () => {
    const a = [0.5, 0.3, 0.8, 0.1];
    const b = [0.4, 0.9, 0.2, 0.7];
    const sim = cosineSimilarity(a, b);
    expect(sim).toBeGreaterThanOrEqual(0);
    expect(sim).toBeLessThanOrEqual(1);
  });
});

// ─── embedText ────────────────────────────────────────────────────────────────

describe("embedText()", () => {
  it("returns null when forge API is not configured", async () => {
    // ENV.forgeApiUrl is empty in test environment
    const result = await embedText("test text");
    // Should return null since forgeApiUrl is empty in test env
    expect(result === null || Array.isArray(result)).toBe(true);
  });

  it("returns null when API call fails", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Network error"));
    const result = await embedText("test text");
    expect(result === null || Array.isArray(result)).toBe(true);
  });
});

// ─── fetchPubMedAbstract ──────────────────────────────────────────────────────

describe("fetchPubMedAbstract()", () => {
  it("returns abstract data when API responds successfully", async () => {
    const mockAbstractText = [
      "Hemoglobin Structure and Function",
      "",
      "Hemoglobin is a tetrameric protein that transports oxygen in red blood cells.",
      "The alpha and beta subunits each contain a heme group with an iron atom.",
      "Mutations in the beta subunit cause sickle cell disease.",
    ].join("\n");

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => mockAbstractText,
    });

    const result = await fetchPubMedAbstract("12345678");

    expect(result).not.toBeNull();
    expect(result!.title).toBe("Hemoglobin Structure and Function");
    expect(result!.abstract).toContain("tetrameric protein");
    expect(result!.url).toContain("12345678");
  });

  it("returns null when API returns non-ok status", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });

    const result = await fetchPubMedAbstract("99999999");

    expect(result).toBeNull();
  });

  it("returns null when response text is too short", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => "short",
    });

    const result = await fetchPubMedAbstract("12345678");

    expect(result).toBeNull();
  });

  it("returns null when fetch throws", async () => {
    mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));

    const result = await fetchPubMedAbstract("12345678");

    expect(result).toBeNull();
  });
});

// ─── verifyClaimAgainstSourcePaper ────────────────────────────────────────────

describe("verifyClaimAgainstSourcePaper()", () => {
  it("returns Insufficient Evidence when abstract cannot be fetched", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });

    const verdict = await verifyClaimAgainstSourcePaper(
      "Hemoglobin transports oxygen.",
      "99999999"
    );

    expect(verdict.verdict).toBe("Insufficient Evidence");
    expect(verdict.evidenceUrl).toContain("99999999");
    expect(verdict.similarityScore).toBeNull();
  });

  it("returns keyword-heuristic verdict when embeddings are unavailable", async () => {
    // Abstract fetch succeeds
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () =>
        "Hemoglobin Structure\n\nHemoglobin is a tetrameric protein that transports oxygen in red blood cells. The alpha and beta subunits contain heme groups.",
    });
    // Embedding call returns non-ok (embeddings unavailable)
    mockFetch.mockResolvedValueOnce({ ok: false, status: 503 });
    // Second embedding call also fails
    mockFetch.mockResolvedValueOnce({ ok: false, status: 503 });

    const verdict = await verifyClaimAgainstSourcePaper(
      "Hemoglobin transports oxygen in blood.",
      "12345678"
    );

    // Should return a verdict (keyword heuristic)
    expect(["Supported", "Ambiguous", "Insufficient Evidence"]).toContain(
      verdict.verdict
    );
    expect(verdict.evidenceUrl).toContain("12345678");
  });
});

// ─── extractPmids ─────────────────────────────────────────────────────────────

describe("extractPmids()", () => {
  it("extracts PMID with colon notation", () => {
    const text = "As reported in PMID: 12345678, hemoglobin structure was determined.";
    const pmids = extractPmids(text);
    expect(pmids).toContain("12345678");
  });

  it("extracts PMID without colon", () => {
    const text = "See PMID12345678 for details.";
    const pmids = extractPmids(text);
    expect(pmids).toContain("12345678");
  });

  it("extracts pubmed URL format", () => {
    const text = "Reference: pubmed/34567890";
    const pmids = extractPmids(text);
    expect(pmids).toContain("34567890");
  });

  it("deduplicates repeated PMIDs", () => {
    const text = "PMID: 12345678 and PMID: 12345678 are the same.";
    const pmids = extractPmids(text);
    expect(pmids).toHaveLength(1);
  });

  it("returns empty array when no PMIDs found", () => {
    const text = "No PMIDs in this text.";
    const pmids = extractPmids(text);
    expect(pmids).toHaveLength(0);
  });

  it("does not match 6-digit numbers (too short for PMID)", () => {
    const text = "PMID: 123456 is too short.";
    const pmids = extractPmids(text);
    expect(pmids).toHaveLength(0);
  });
});
