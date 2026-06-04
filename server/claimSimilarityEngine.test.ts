/**
 * Tests for claimSimilarityEngine.ts
 *
 * Tests the TF-IDF cosine similarity algorithm directly without hitting the DB.
 * We expose internal helpers via a test-only re-export pattern using vi.mock.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock the DB module ───────────────────────────────────────────────────────

vi.mock("./db", () => ({ getDb: vi.fn() }));

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeChain(returnValue: unknown) {
  const chain: Record<string, unknown> = {};
  const methods = ["select", "from", "where", "orderBy", "limit", "innerJoin", "and"];
  methods.forEach((m) => { chain[m] = vi.fn(() => chain); });
  chain.then = (resolve: (v: unknown) => void) => Promise.resolve(returnValue).then(resolve);
  chain.catch = (reject: (e: unknown) => void) => Promise.resolve(returnValue).catch(reject);
  return chain;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("findSimilarClaims", () => {
  beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); });

  it("returns empty array when DB returns no rows", async () => {
    const { getDb } = await import("./db");
    vi.mocked(getDb).mockResolvedValue({ select: vi.fn(() => makeChain([])) } as never);

    const { findSimilarClaims } = await import("./claimSimilarityEngine");
    const result = await findSimilarClaims("whey protein muscle synthesis");
    expect(result).toEqual([]);
  });

  it("returns empty array when getDb returns null", async () => {
    const { getDb } = await import("./db");
    vi.mocked(getDb).mockResolvedValue(null as never);

    const { findSimilarClaims } = await import("./claimSimilarityEngine");
    const result = await findSimilarClaims("creatine strength");
    expect(result).toEqual([]);
  });

  it("returns results above threshold sorted by similarity descending", async () => {
    const { getDb } = await import("./db");
    const rows = [
      { claimId: 1, documentId: 10, documentTitle: "Paper A", claimText: "whey protein increases muscle mass in athletes", verdict: "Supported", confidenceScore: 0.8 },
      { claimId: 2, documentId: 11, documentTitle: "Paper B", claimText: "creatine monohydrate improves strength output", verdict: "Supported", confidenceScore: 0.7 },
      { claimId: 3, documentId: 12, documentTitle: "Paper C", claimText: "whey protein supplementation enhances muscle protein synthesis", verdict: "Supported", confidenceScore: 0.9 },
    ];
    vi.mocked(getDb).mockResolvedValue({ select: vi.fn(() => makeChain(rows)) } as never);

    const { findSimilarClaims } = await import("./claimSimilarityEngine");
    const result = await findSimilarClaims("whey protein muscle synthesis", { threshold: 0.1, topK: 10 });

    // Results should be sorted by similarity descending
    for (let i = 1; i < result.length; i++) {
      expect(result[i - 1].similarity).toBeGreaterThanOrEqual(result[i].similarity);
    }
    // All results should be above threshold
    result.forEach((r) => expect(r.similarity).toBeGreaterThanOrEqual(0.1));
    // Should have required fields
    if (result.length > 0) {
      expect(result[0]).toHaveProperty("claimId");
      expect(result[0]).toHaveProperty("documentId");
      expect(result[0]).toHaveProperty("documentTitle");
      expect(result[0]).toHaveProperty("claimText");
      expect(result[0]).toHaveProperty("similarity");
    }
  });

  it("respects topK limit", async () => {
    const { getDb } = await import("./db");
    const rows = Array.from({ length: 20 }, (_, i) => ({
      claimId: i + 1,
      documentId: i + 100,
      documentTitle: `Paper ${i}`,
      claimText: `protein supplement study ${i} muscle mass athletes strength`,
      verdict: "Supported",
      confidenceScore: 0.7,
    }));
    vi.mocked(getDb).mockResolvedValue({ select: vi.fn(() => makeChain(rows)) } as never);

    const { findSimilarClaims } = await import("./claimSimilarityEngine");
    const result = await findSimilarClaims("protein supplement muscle strength", { threshold: 0.0, topK: 5 });
    expect(result.length).toBeLessThanOrEqual(5);
  });

  it("filters results below threshold", async () => {
    const { getDb } = await import("./db");
    const rows = [
      { claimId: 1, documentId: 10, documentTitle: "Paper A", claimText: "completely unrelated topic about geology rocks", verdict: null, confidenceScore: null },
    ];
    vi.mocked(getDb).mockResolvedValue({ select: vi.fn(() => makeChain(rows)) } as never);

    const { findSimilarClaims } = await import("./claimSimilarityEngine");
    const result = await findSimilarClaims("whey protein muscle synthesis", { threshold: 0.5 });
    // Geology text should not match protein claims above 0.5
    expect(result.length).toBe(0);
  });

  it("similarity scores are between 0 and 1", async () => {
    const { getDb } = await import("./db");
    const rows = [
      { claimId: 1, documentId: 10, documentTitle: "Paper A", claimText: "protein synthesis muscle growth", verdict: "Supported", confidenceScore: 0.8 },
      { claimId: 2, documentId: 11, documentTitle: "Paper B", claimText: "protein intake muscle recovery athletes", verdict: "Supported", confidenceScore: 0.75 },
    ];
    vi.mocked(getDb).mockResolvedValue({ select: vi.fn(() => makeChain(rows)) } as never);

    const { findSimilarClaims } = await import("./claimSimilarityEngine");
    const result = await findSimilarClaims("protein muscle", { threshold: 0.0 });
    result.forEach((r) => {
      expect(r.similarity).toBeGreaterThanOrEqual(0);
      expect(r.similarity).toBeLessThanOrEqual(1);
    });
  });
});

describe("findSimilarToClaimId", () => {
  beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); });

  it("returns empty array when source claim not found", async () => {
    const { getDb } = await import("./db");
    vi.mocked(getDb).mockResolvedValue({ select: vi.fn(() => makeChain([])) } as never);

    const { findSimilarToClaimId } = await import("./claimSimilarityEngine");
    const result = await findSimilarToClaimId(9999);
    expect(result).toEqual([]);
  });

  it("excludes the source claim from results", async () => {
    const { getDb } = await import("./db");
    // First call: get source claim text
    // Second call: get corpus
    const sourceRows = [{ claimText: "whey protein muscle mass", documentId: 10 }];
    const corpusRows = [
      { claimId: 42, documentId: 10, documentTitle: "Paper A", claimText: "whey protein muscle mass", verdict: "Supported", confidenceScore: 0.8 },
      { claimId: 43, documentId: 11, documentTitle: "Paper B", claimText: "whey protein increases muscle synthesis", verdict: "Supported", confidenceScore: 0.75 },
    ];
    vi.mocked(getDb)
      .mockResolvedValueOnce({ select: vi.fn(() => makeChain(sourceRows)) } as never)
      .mockResolvedValueOnce({ select: vi.fn(() => makeChain(corpusRows)) } as never);

    const { findSimilarToClaimId } = await import("./claimSimilarityEngine");
    const result = await findSimilarToClaimId(42, { threshold: 0.0 });
    // Should not include the source claim (id 42)
    expect(result.find((r) => r.claimId === 42)).toBeUndefined();
  });
});

describe("detectDuplicatesInDocument", () => {
  beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); });

  it("returns empty array for documents with fewer than 2 claims", async () => {
    const { getDb } = await import("./db");
    vi.mocked(getDb).mockResolvedValue({
      select: vi.fn(() => makeChain([{ id: 1, claimText: "single claim" }])),
    } as never);

    const { detectDuplicatesInDocument } = await import("./claimSimilarityEngine");
    const result = await detectDuplicatesInDocument(1);
    expect(result).toEqual([]);
  });

  it("detects near-duplicate claims above threshold", async () => {
    const { getDb } = await import("./db");
    const claims = [
      { id: 1, claimText: "whey protein increases muscle mass in resistance-trained athletes" },
      { id: 2, claimText: "whey protein increases muscle mass in resistance-trained athletes significantly" },
      { id: 3, claimText: "creatine monohydrate improves strength output in trained individuals" },
    ];
    vi.mocked(getDb).mockResolvedValue({ select: vi.fn(() => makeChain(claims)) } as never);

    const { detectDuplicatesInDocument } = await import("./claimSimilarityEngine");
    const result = await detectDuplicatesInDocument(1, 0.7);

    // Claims 1 and 2 are near-duplicates
    expect(result.length).toBeGreaterThan(0);
    result.forEach((pair) => {
      expect(pair).toHaveProperty("claimA");
      expect(pair).toHaveProperty("claimB");
      expect(pair).toHaveProperty("similarity");
      expect(pair).toHaveProperty("textA");
      expect(pair).toHaveProperty("textB");
      expect(pair.similarity).toBeGreaterThanOrEqual(0.7);
    });
  });

  it("returns pairs sorted by similarity descending", async () => {
    const { getDb } = await import("./db");
    const claims = [
      { id: 1, claimText: "protein synthesis muscle growth athletes supplementation" },
      { id: 2, claimText: "protein synthesis muscle growth athletes supplementation study" },
      { id: 3, claimText: "protein intake muscle recovery post exercise" },
      { id: 4, claimText: "protein intake muscle recovery post exercise training" },
    ];
    vi.mocked(getDb).mockResolvedValue({ select: vi.fn(() => makeChain(claims)) } as never);

    const { detectDuplicatesInDocument } = await import("./claimSimilarityEngine");
    const result = await detectDuplicatesInDocument(1, 0.5);

    for (let i = 1; i < result.length; i++) {
      expect(result[i - 1].similarity).toBeGreaterThanOrEqual(result[i].similarity);
    }
  });
});
