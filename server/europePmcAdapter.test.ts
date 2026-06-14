/**
 * europePmcAdapter.test.ts
 * Unit tests for server/europePmcAdapter.ts
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const makeApiResponse = (overrides: Partial<{
  hitCount: number;
  result: Array<{ pmid?: string; id?: string; title?: string; pubType?: string }>;
}> = {}) => ({
  hitCount: overrides.hitCount ?? 2,
  resultList: {
    result: overrides.result ?? [
      { pmid: "12345", title: "Systematic review of protein folding", pubType: "systematic review" },
      { pmid: "67890", title: "Meta-analysis of collagen studies", pubType: "meta-analysis" },
    ],
  },
});

const makeOkFetchResponse = (data: unknown) => ({
  ok: true,
  json: vi.fn().mockResolvedValue(data),
});

describe("searchSystematicReviews()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns found:true with counts when API returns results", async () => {
    mockFetch.mockResolvedValue(makeOkFetchResponse(makeApiResponse()));
    const { searchSystematicReviews } = await import("./europePmcAdapter");
    const result = await searchSystematicReviews("collagen structure");
    expect(result.found).toBe(true);
    expect(result.topPmids).toContain("12345");
    expect(result.topPmids).toContain("67890");
    expect(result.error).toBeNull();
  });

  it("returns found:false when hitCount is 0", async () => {
    mockFetch.mockResolvedValue(makeOkFetchResponse(makeApiResponse({ hitCount: 0, result: [] })));
    const { searchSystematicReviews } = await import("./europePmcAdapter");
    const result = await searchSystematicReviews("obscure topic");
    expect(result.found).toBe(false);
    expect(result.systematicReviewCount).toBe(0);
    expect(result.metaAnalysisCount).toBe(0);
  });

  it("returns error when API returns non-OK status", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500 });
    const { searchSystematicReviews } = await import("./europePmcAdapter");
    const result = await searchSystematicReviews("collagen");
    expect(result.found).toBe(false);
    expect(result.error).toContain("500");
  });

  it("returns error when fetch throws (network error)", async () => {
    mockFetch.mockRejectedValue(new Error("Network timeout"));
    const { searchSystematicReviews } = await import("./europePmcAdapter");
    const result = await searchSystematicReviews("collagen");
    expect(result.found).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it("counts systematic reviews and meta-analyses by pubType", async () => {
    const data = makeApiResponse({
      hitCount: 3,
      result: [
        { pmid: "1", title: "SR 1", pubType: "systematic review" },
        { pmid: "2", title: "MA 1", pubType: "meta-analysis" },
        { pmid: "3", title: "MA 2", pubType: "meta-analysis" },
      ],
    });
    mockFetch.mockResolvedValue(makeOkFetchResponse(data));
    const { searchSystematicReviews } = await import("./europePmcAdapter");
    const result = await searchSystematicReviews("collagen");
    expect(result.systematicReviewCount).toBe(1);
    expect(result.metaAnalysisCount).toBe(2);
  });
});

describe("interpretSystematicReviewEvidence()", () => {
  it("returns baseScore unchanged when no results found", async () => {
    const { interpretSystematicReviewEvidence } = await import("./europePmcAdapter");
    const result = interpretSystematicReviewEvidence(
      { found: false, systematicReviewCount: 0, metaAnalysisCount: 0, topPmids: [], topTitles: [], sourceUrl: "", error: null },
      0.5
    );
    expect(result.confidenceScore).toBe(0.5);
    expect(result.flags[0]).toContain("No systematic reviews");
  });

  it("boosts score to ≥0.90 when 3+ meta-analyses found", async () => {
    const { interpretSystematicReviewEvidence } = await import("./europePmcAdapter");
    const result = interpretSystematicReviewEvidence(
      { found: true, systematicReviewCount: 0, metaAnalysisCount: 4, topPmids: [], topTitles: [], sourceUrl: "", error: null },
      0.5
    );
    expect(result.confidenceScore).toBeGreaterThanOrEqual(0.90);
    expect(result.flags.some((f) => f.includes("meta-anal"))).toBe(true);
  });

  it("boosts score to ≥0.80 when 1-2 meta-analyses found", async () => {
    const { interpretSystematicReviewEvidence } = await import("./europePmcAdapter");
    const result = interpretSystematicReviewEvidence(
      { found: true, systematicReviewCount: 0, metaAnalysisCount: 1, topPmids: [], topTitles: [], sourceUrl: "", error: null },
      0.5
    );
    expect(result.confidenceScore).toBeGreaterThanOrEqual(0.80);
  });

  it("boosts score to ≥0.75 when 2+ systematic reviews found", async () => {
    const { interpretSystematicReviewEvidence } = await import("./europePmcAdapter");
    const result = interpretSystematicReviewEvidence(
      { found: true, systematicReviewCount: 3, metaAnalysisCount: 0, topPmids: [], topTitles: [], sourceUrl: "", error: null },
      0.5
    );
    expect(result.confidenceScore).toBeGreaterThanOrEqual(0.75);
  });

  it("caps score at 0.95 regardless of evidence strength", async () => {
    const { interpretSystematicReviewEvidence } = await import("./europePmcAdapter");
    const result = interpretSystematicReviewEvidence(
      { found: true, systematicReviewCount: 10, metaAnalysisCount: 10, topPmids: [], topTitles: ["Top review title"], sourceUrl: "", error: null },
      0.99
    );
    expect(result.confidenceScore).toBeLessThanOrEqual(0.95);
  });
});
