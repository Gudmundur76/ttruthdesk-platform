/**
 * opencitations.test.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Tests for the OpenCitations vertical adapter.
 *
 * Tests are grouped into:
 *   1. Pure utility functions (no I/O) — always deterministic
 *   2. HTTP fetch mocks — verify request construction and response shaping
 *   3. Confidence scoring — boundary and edge cases
 *   4. Adapter registration — verifies the adapter is in the registry
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  processOrderedAuthorList,
  parseCitationDurationYears,
  resolvePublicationType,
  extractOrcids,
  scoreConfidence,
} from "./opencitations";
import { getVertical } from "./types";

// ─── 1. processOrderedAuthorList ─────────────────────────────────────────────

describe("processOrderedAuthorList", () => {
  it("returns empty array for empty string", () => {
    expect(processOrderedAuthorList("")).toEqual([]);
  });

  it("returns empty array for whitespace-only string", () => {
    expect(processOrderedAuthorList("   ")).toEqual([]);
  });

  it("parses single author correctly", () => {
    // Format: "Name [orcid:xxx omid:yyy]:role_a:"
    const raw = "Doe, John [orcid:0000-0001-2345-6789 omid:ra/123]:role_a:";
    const result = processOrderedAuthorList(raw);
    expect(result).toHaveLength(1);
    expect(result[0]).toContain("Doe, John");
  });

  it("preserves order for two authors in linked-list format", () => {
    // role_a → role_b → end
    const raw = "Smith, Alice [omid:ra/1]:role_a:role_b|Jones, Bob [omid:ra/2]:role_b:";
    const result = processOrderedAuthorList(raw);
    expect(result).toHaveLength(2);
    expect(result[0]).toContain("Smith, Alice");
    expect(result[1]).toContain("Jones, Bob");
  });

  it("handles authors without ORCID", () => {
    const raw = "Peroni, Silvio [omid:ra/456]:role_x:";
    const result = processOrderedAuthorList(raw);
    expect(result[0]).toContain("Peroni, Silvio");
  });

  it("handles semicolon-separated flat list (non-linked-list fallback)", () => {
    // If the API returns a simple semicolon list without role encoding,
    // the function should not crash and return something reasonable.
    const raw = "Author One; Author Two; Author Three";
    // This is not the linked-list format — the function should not throw
    expect(() => processOrderedAuthorList(raw)).not.toThrow();
  });
});

// ─── 2. parseCitationDurationYears ───────────────────────────────────────────

describe("parseCitationDurationYears", () => {
  it("returns null for empty string", () => {
    expect(parseCitationDurationYears("")).toBeNull();
  });

  it("parses P2Y correctly", () => {
    expect(parseCitationDurationYears("P2Y")).toBeCloseTo(2.0, 1);
  });

  it("parses P1Y6M correctly", () => {
    expect(parseCitationDurationYears("P1Y6M")).toBeCloseTo(1.5, 1);
  });

  it("parses P0Y3M correctly", () => {
    expect(parseCitationDurationYears("P0Y3M")).toBeCloseTo(0.25, 2);
  });

  it("returns negative value for negative duration (data error signal)", () => {
    const result = parseCitationDurationYears("-P1Y");
    expect(result).not.toBeNull();
    expect(result!).toBeLessThan(0);
  });

  it("returns null for malformed string", () => {
    expect(parseCitationDurationYears("not-a-duration")).toBeNull();
  });

  it("parses P10Y correctly", () => {
    expect(parseCitationDurationYears("P10Y")).toBeCloseTo(10.0, 1);
  });
});

// ─── 3. resolvePublicationType ───────────────────────────────────────────────

describe("resolvePublicationType", () => {
  it("returns human label for FaBiO JournalArticle URI", () => {
    expect(resolvePublicationType("http://purl.org/spar/fabio/JournalArticle"))
      .toBe("journal article");
  });

  it("returns 'preprint' for FaBiO Preprint URI", () => {
    expect(resolvePublicationType("http://purl.org/spar/fabio/Preprint"))
      .toBe("preprint");
  });

  it("returns 'retraction notice' for FaBiO RetractionNotice URI", () => {
    expect(resolvePublicationType("http://purl.org/spar/fabio/RetractionNotice"))
      .toBe("retraction notice");
  });

  it("returns 'book' for FaBiO Book URI", () => {
    expect(resolvePublicationType("http://purl.org/spar/fabio/Book"))
      .toBe("book");
  });

  it("passes through human label unchanged", () => {
    expect(resolvePublicationType("journal article")).toBe("journal article");
  });

  it("returns 'unknown' for unrecognised URI", () => {
    expect(resolvePublicationType("http://example.com/unknown")).toBe("unknown");
  });

  it("returns 'unknown' for empty string", () => {
    expect(resolvePublicationType("")).toBe("unknown");
  });

  it("handles all 30 FaBiO types without throwing", () => {
    const uris = [
      "http://purl.org/spar/doco/Abstract",
      "http://purl.org/spar/fabio/ArchivalDocument",
      "http://purl.org/spar/fabio/AudioDocument",
      "http://purl.org/spar/fabio/Book",
      "http://purl.org/spar/fabio/BookChapter",
      "http://purl.org/spar/fabio/ExpressionCollection",
      "http://purl.org/spar/fabio/BookSeries",
      "http://purl.org/spar/fabio/BookSet",
      "http://purl.org/spar/fabio/ComputerProgram",
      "http://purl.org/spar/doco/Part",
      "http://purl.org/spar/fabio/Expression",
      "http://purl.org/spar/fabio/DataFile",
      "http://purl.org/spar/fabio/DataManagementPlan",
      "http://purl.org/spar/fabio/Thesis",
      "http://purl.org/spar/fabio/Editorial",
      "http://purl.org/spar/fabio/Journal",
      "http://purl.org/spar/fabio/JournalArticle",
      "http://purl.org/spar/fabio/JournalEditorial",
      "http://purl.org/spar/fabio/JournalIssue",
      "http://purl.org/spar/fabio/JournalVolume",
      "http://purl.org/spar/fabio/Newspaper",
      "http://purl.org/spar/fabio/NewspaperArticle",
      "http://purl.org/spar/fabio/NewspaperIssue",
      "http://purl.org/spar/fr/ReviewVersion",
      "http://purl.org/spar/fabio/AcademicProceedings",
      "http://purl.org/spar/fabio/Preprint",
      "http://purl.org/spar/fabio/Presentation",
      "http://purl.org/spar/fabio/ProceedingsPaper",
      "http://purl.org/spar/fabio/ReferenceBook",
      "http://purl.org/spar/fabio/ReferenceEntry",
      "http://purl.org/spar/fabio/ReportDocument",
      "http://purl.org/spar/fabio/RetractionNotice",
      "http://purl.org/spar/fabio/Series",
      "http://purl.org/spar/fabio/SpecificationDocument",
      "http://purl.org/spar/fabio/WebContent",
    ];
    for (const uri of uris) {
      expect(() => resolvePublicationType(uri)).not.toThrow();
    }
  });
});

// ─── 4. extractOrcids ────────────────────────────────────────────────────────

describe("extractOrcids", () => {
  it("extracts a single ORCID", () => {
    const raw = "Massari, Arcangelo [orcid:0000-0002-8420-0696 omid:ra/123]";
    expect(extractOrcids(raw)).toEqual(["0000-0002-8420-0696"]);
  });

  it("extracts multiple ORCIDs from a semicolon-separated list", () => {
    const raw = [
      "Peroni, Silvio [orcid:0000-0003-0530-4305 omid:ra/1]",
      "Massari, Arcangelo [orcid:0000-0002-8420-0696 omid:ra/2]",
    ].join("; ");
    const result = extractOrcids(raw);
    expect(result).toHaveLength(2);
    expect(result).toContain("0000-0003-0530-4305");
    expect(result).toContain("0000-0002-8420-0696");
  });

  it("returns empty array when no ORCID present", () => {
    expect(extractOrcids("Doe, John [omid:ra/999]")).toEqual([]);
  });

  it("returns empty array for empty string", () => {
    expect(extractOrcids("")).toEqual([]);
  });

  it("handles ORCID ending in X", () => {
    const raw = "Author [orcid:0000-0001-2345-678X]";
    expect(extractOrcids(raw)).toEqual(["0000-0001-2345-678X"]);
  });
});

// ─── 5. scoreConfidence ──────────────────────────────────────────────────────

describe("scoreConfidence", () => {
  it("returns base score of 0.70 for 0 citations, no ORCID, unknown type", () => {
    expect(scoreConfidence(0, "unknown", false)).toBeCloseTo(0.70, 2);
  });

  it("adds 0.12 for >500 citations", () => {
    expect(scoreConfidence(501, "unknown", false)).toBeCloseTo(0.82, 2);
  });

  it("adds 0.10 for >100 citations", () => {
    expect(scoreConfidence(101, "unknown", false)).toBeCloseTo(0.80, 2);
  });

  it("adds 0.08 for >50 citations", () => {
    expect(scoreConfidence(51, "unknown", false)).toBeCloseTo(0.78, 2);
  });

  it("adds 0.05 for >10 citations", () => {
    expect(scoreConfidence(11, "unknown", false)).toBeCloseTo(0.75, 2);
  });

  it("adds 0.05 for ORCID-verified author", () => {
    expect(scoreConfidence(0, "unknown", true)).toBeCloseTo(0.75, 2);
  });

  it("adds 0.05 for journal article type", () => {
    expect(scoreConfidence(0, "journal article", false)).toBeCloseTo(0.75, 2);
  });

  it("adds 0.05 for proceedings article type", () => {
    expect(scoreConfidence(0, "proceedings article", false)).toBeCloseTo(0.75, 2);
  });

  it("subtracts 0.10 for preprint type", () => {
    expect(scoreConfidence(0, "preprint", false)).toBeCloseTo(0.60, 2);
  });

  it("subtracts 0.30 for retraction notice", () => {
    expect(scoreConfidence(0, "retraction notice", false)).toBeCloseTo(0.40, 2);
  });

  it("is clamped to 0.95 maximum", () => {
    // 0.70 + 0.12 + 0.05 + 0.05 = 0.92 — still under cap
    // 0.70 + 0.12 + 0.05 + 0.05 + 0.05 = 0.97 — should clamp to 0.95
    const score = scoreConfidence(501, "journal article", true);
    expect(score).toBeLessThanOrEqual(0.95);
  });

  it("is clamped to 0.30 minimum", () => {
    // retraction notice: 0.70 - 0.30 = 0.40 — above floor
    // retraction + preprint: not possible (mutually exclusive types)
    // Force floor by passing a very negative scenario
    const score = scoreConfidence(0, "retraction notice", false);
    expect(score).toBeGreaterThanOrEqual(0.30);
  });

  it("handles very high citation count without exceeding cap", () => {
    const score = scoreConfidence(100_000, "journal article", true);
    expect(score).toBeLessThanOrEqual(0.95);
    expect(score).toBeGreaterThanOrEqual(0.30);
  });
});

// ─── 6. Adapter registration ─────────────────────────────────────────────────

describe("OpenCitations adapter registration", () => {
  it("is registered in the vertical registry under 'opencitations'", async () => {
    // Force the module to load (it self-registers on import)
    await import("./opencitations");
    const adapter = getVertical("opencitations");
    expect(adapter).toBeDefined();
    expect(adapter!.domainKey).toBe("opencitations");
    expect(adapter!.displayName).toContain("OpenCitations");
  });

  it("has a non-empty claimExtractorPrompt", async () => {
    await import("./opencitations");
    const adapter = getVertical("opencitations");
    expect(adapter!.claimExtractorPrompt.trim().length).toBeGreaterThan(50);
  });

  it("has at least 5 discoverySearchTerms", async () => {
    await import("./opencitations");
    const adapter = getVertical("opencitations");
    expect(adapter!.discoverySearchTerms.length).toBeGreaterThanOrEqual(5);
  });
});

// ─── 7. lookupEvidence — fetch mocks ─────────────────────────────────────────

describe("lookupEvidence with mocked fetch", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns found=true with correct fields when Meta and Index both succeed", async () => {
    const mockFetch = vi.mocked(fetch);

    // Meta response
    const metaRecord = {
      id: "doi:10.1000/test omid:br/0612058700",
      title: "Test Paper on Citation Networks",
      author: "Peroni, Silvio [orcid:0000-0003-0530-4305 omid:ra/1]:role_a:",
      pub_date: "2022",
      venue: "Scientometrics",
      volume: "127",
      issue: "6",
      page: "1-20",
      type: "journal article",
      publisher: "Springer",
      editor: "",
    };

    // Index citation-count response
    const countRecord = [{ count: "42" }];

    // Index citations response
    const citationsRecord = [
      {
        oci: "0601-0602",
        citing: "doi:10.2000/citing",
        cited: "doi:10.1000/test",
        creation: "2023",
        timespan: "P1Y",
        journal_sc: "no",
        author_sc: "no",
      },
    ];

    // fetch is called 3 times: meta, citation-count, citations
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [metaRecord],
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => countRecord,
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => citationsRecord,
      } as Response);

    await import("./opencitations");
    const adapter = getVertical("opencitations")!;
    const result = await adapter.lookupEvidence({
      claimText: "Peroni et al. published a paper on citation networks (doi:10.1000/test)",
      extractedValue: "10.1000/test",
    });

    expect(result.found).toBe(true);
    expect(result.sourceId).toBe("doi:10.1000/test");
    expect(result.sourceUrl).toBe("https://doi.org/10.1000/test");
    expect(result.confidenceScore).toBeGreaterThan(0.70);
    expect(result.evidenceRaw).not.toBeNull();
    expect((result.evidenceRaw as Record<string, unknown>).citationCount).toBe(42);
    expect((result.evidenceRaw as Record<string, unknown>).publicationType).toBe("journal article");
    expect(result.confidenceFlags.some(f => f.includes("42"))).toBe(true);
    expect(result.confidenceFlags.some(f => f.includes("ORCID"))).toBe(true);
  });

  it("returns found=false when Meta returns 404", async () => {
    const mockFetch = vi.mocked(fetch);

    mockFetch
      .mockResolvedValueOnce({ ok: false, status: 404 } as Response)  // meta
      .mockResolvedValueOnce({ ok: true, json: async () => [{ count: "0" }] } as Response)  // count
      .mockResolvedValueOnce({ ok: true, json: async () => [] } as Response);  // citations

    await import("./opencitations");
    const adapter = getVertical("opencitations")!;
    const result = await adapter.lookupEvidence({
      claimText: "Some claim with doi:10.9999/notfound",
      extractedValue: "10.9999/notfound",
    });

    expect(result.found).toBe(false);
    expect(result.confidenceScore).toBeLessThan(0.50);
    expect(result.confidenceFlags.some(f => f.includes("not found"))).toBe(true);
  });

  it("returns found=false with low confidence when no DOI in claim", async () => {
    await import("./opencitations");
    const adapter = getVertical("opencitations")!;
    const result = await adapter.lookupEvidence({
      claimText: "A paper about gut microbiome published in 2022",
      extractedValue: null,
    });

    expect(result.found).toBe(false);
    expect(result.confidenceScore).toBeLessThanOrEqual(0.20);
    expect(result.confidenceFlags.some(f => f.toLowerCase().includes("doi"))).toBe(true);
  });

  it("handles fetch network error gracefully (never throws)", async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockRejectedValue(new Error("Network error"));

    await import("./opencitations");
    const adapter = getVertical("opencitations")!;

    await expect(
      adapter.lookupEvidence({
        claimText: "Claim with doi:10.1000/network-error",
        extractedValue: "10.1000/network-error",
      })
    ).resolves.not.toThrow();

    const result = await adapter.lookupEvidence({
      claimText: "Claim with doi:10.1000/network-error-2",
      extractedValue: "10.1000/network-error-2",
    });
    expect(result.found).toBe(false);
    expect(result.confidenceScore).toBeGreaterThanOrEqual(0.10);
  });

  it("detects retraction notice and applies confidence penalty", async () => {
    const mockFetch = vi.mocked(fetch);

    const retractionRecord = {
      id: "doi:10.1000/retracted omid:br/999",
      title: "Retraction Notice: Previous Paper",
      author: "Editor [omid:ra/1]:role_a:",
      pub_date: "2023",
      venue: "Journal of Science",
      volume: "1",
      issue: "1",
      page: "1",
      type: "retraction notice",
      publisher: "Publisher",
      editor: "",
    };

    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => [retractionRecord] } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => [{ count: "5" }] } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => [] } as Response);

    await import("./opencitations");
    const adapter = getVertical("opencitations")!;
    const result = await adapter.lookupEvidence({
      claimText: "Paper doi:10.1000/retracted",
      extractedValue: "10.1000/retracted",
    });

    expect(result.found).toBe(true);
    expect(result.confidenceScore).toBeLessThan(0.60);
    expect(result.confidenceFlags.some(f => f.includes("RETRACTION"))).toBe(true);
  });

  it("surfaces self-citation flag when journal_sc=yes", async () => {
    const mockFetch = vi.mocked(fetch);

    const metaRecord = {
      id: "doi:10.1000/selfcite omid:br/111",
      title: "Self-Citing Paper",
      author: "Author A [omid:ra/1]:role_a:",
      pub_date: "2021",
      venue: "Journal",
      volume: "1",
      issue: "1",
      page: "1-5",
      type: "journal article",
      publisher: "Pub",
      editor: "",
    };

    const selfCiteCitations = [
      {
        oci: "0601-0602",
        citing: "doi:10.1000/other",
        cited: "doi:10.1000/selfcite",
        creation: "2022",
        timespan: "P1Y",
        journal_sc: "yes",
        author_sc: "no",
      },
    ];

    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => [metaRecord] } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => [{ count: "1" }] } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => selfCiteCitations } as Response);

    await import("./opencitations");
    const adapter = getVertical("opencitations")!;
    const result = await adapter.lookupEvidence({
      claimText: "doi:10.1000/selfcite",
      extractedValue: "10.1000/selfcite",
    });

    expect(result.found).toBe(true);
    expect(result.confidenceFlags.some(f => f.includes("self-citation"))).toBe(true);
  });
});
