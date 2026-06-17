/**
 * sprint35.test.ts — Sprint 35 tests
 * Social science adapters: Campbell Collaboration, APA PsycArticles, SSRN
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import "./campbell";
import "./apa_psycarticles";
import "./ssrn";
import { getVertical } from "./types";

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── Campbell Collaboration ───────────────────────────────────────────────────

describe("CampbellAdapter", () => {
  it("registers with domainKey campbell", () => {
    expect(getVertical("campbell")).toBeDefined();
  });

  it("returns found=true for a successful review search", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [
          {
            id: 12345,
            title: "The effects of early childhood education programs on cognitive development",
            abstract: "This systematic review examines evidence from 45 RCTs...",
            doi: "10.4073/csr.2022.12",
            url: "https://www.campbellcollaboration.org/library/12345",
            published_at: "2022-03-15",
            authors: ["Smith, J.", "Jones, A."],
            group: "Education",
            status: "published",
            type: "systematic_review",
          },
        ],
        meta: { total: 23, per_page: 3, current_page: 1 },
      }),
    });

    const adapter = getVertical("campbell");
    expect(adapter).toBeDefined();

    const result = await adapter!.lookupEvidence({
      claimText: "Early childhood education programs improve cognitive development",
      extractedValue: "early childhood education cognitive development",
    });
    expect(result.found).toBe(true);
    expect(result.sourceId).toBe("campbell-12345");
    expect(result.confidenceFlags).toContain("campbell_systematic_review");
    expect(result.confidenceFlags).toContain("published_review");
    expect(result.confidenceFlags).toContain("systematic_review");
    expect(result.confidenceScore).toBeGreaterThan(0.85);
    expect(result.sourceUrl).toContain("campbellcollaboration.org");
  });

  it("returns found=false with no_campbell_reviews when data is empty", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [], meta: { total: 0 } }),
    });

    const adapter = getVertical("campbell");
    const result = await adapter!.lookupEvidence({
      claimText: "obscure intervention nobody has studied",
      extractedValue: null,
    });
    expect(result.found).toBe(false);
    expect(result.confidenceFlags).toContain("no_campbell_reviews");
  });

  it("returns found=false with campbell_not_found on 404", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });

    const adapter = getVertical("campbell");
    const result = await adapter!.lookupEvidence({
      claimText: "some intervention",
      extractedValue: null,
    });
    expect(result.found).toBe(false);
    expect(result.confidenceFlags).toContain("campbell_not_found");
  });

  it("returns found=false with campbell_rate_limited on 429", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 429 });

    const adapter = getVertical("campbell");
    const result = await adapter!.lookupEvidence({
      claimText: "crime prevention program effectiveness",
      extractedValue: null,
    });
    expect(result.found).toBe(false);
    expect(result.confidenceFlags).toContain("campbell_rate_limited");
  });

  it("returns found=false with network_or_parsing_error on fetch throw", async () => {
    mockFetch.mockRejectedValueOnce(new Error("network timeout"));

    const adapter = getVertical("campbell");
    const result = await adapter!.lookupEvidence({
      claimText: "social program evaluation",
      extractedValue: null,
    });
    expect(result.found).toBe(false);
    expect(result.confidenceFlags).toContain("network_or_parsing_error");
  });

  it("has required VerticalAdapter fields", () => {
    const adapter = getVertical("campbell")!;
    expect(adapter.displayName).toBe("Campbell Collaboration");
    expect(adapter.claimExtractorPrompt).toBeTruthy();
    expect(adapter.discoverySearchTerms.length).toBeGreaterThan(3);
  });
});

// ─── APA PsycArticles ─────────────────────────────────────────────────────────

describe("ApaPsycarticlesAdapter", () => {
  it("registers with domainKey apa_psycarticles", () => {
    expect(getVertical("apa_psycarticles")).toBeDefined();
  });

  it("returns found=true with apa_journal flag when APA ISSN matched", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        message: {
          items: [
            {
              DOI: "10.1037/0022-3514.84.4.822",
              title: ["The role of implicit theories in goal setting and achievement"],
              author: [{ given: "Carol", family: "Dweck" }],
              "container-title": ["Journal of Personality and Social Psychology"],
              ISSN: ["0022-3514"], // APA journal
              published: { "date-parts": [[2003, 4]] },
            },
          ],
          "total-results": 142,
        },
      }),
    });

    const adapter = getVertical("apa_psycarticles");
    expect(adapter).toBeDefined();

    const result = await adapter!.lookupEvidence({
      claimText: "Growth mindset interventions improve academic achievement",
      extractedValue: "growth mindset achievement",
    });
    expect(result.found).toBe(true);
    expect(result.confidenceFlags).toContain("apa_journal");
    expect(result.confidenceFlags).toContain("apa_psycarticles");
    expect(result.confidenceFlags).toContain("peer_reviewed");
    expect(result.confidenceScore).toBeGreaterThan(0.85);
    expect(result.sourceUrl).toContain("doi.org");
  });

  it("returns found=true with psychology_adjacent flag for non-APA journal", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        message: {
          items: [
            {
              DOI: "10.1016/j.cognition.2021.104700",
              title: ["Cognitive load theory in educational settings"],
              author: [{ given: "John", family: "Sweller" }],
              "container-title": ["Cognition"],
              ISSN: ["0010-0277"], // Not APA
              published: { "date-parts": [[2021, 6]] },
            },
          ],
          "total-results": 89,
        },
      }),
    });

    const adapter = getVertical("apa_psycarticles");
    const result = await adapter!.lookupEvidence({
      claimText: "Cognitive load affects learning efficiency",
      extractedValue: "cognitive load learning",
    });
    expect(result.found).toBe(true);
    expect(result.confidenceFlags).toContain("psychology_adjacent");
    expect(result.confidenceScore).toBeLessThan(0.80);
  });

  it("returns found=false with no_crossref_results when items is empty", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ message: { items: [], "total-results": 0 } }),
    });

    const adapter = getVertical("apa_psycarticles");
    const result = await adapter!.lookupEvidence({
      claimText: "very obscure psychological phenomenon",
      extractedValue: null,
    });
    expect(result.found).toBe(false);
    expect(result.confidenceFlags).toContain("no_crossref_results");
  });

  it("returns found=false with crossref_rate_limited on 429", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 429 });

    const adapter = getVertical("apa_psycarticles");
    const result = await adapter!.lookupEvidence({
      claimText: "anxiety treatment effectiveness",
      extractedValue: null,
    });
    expect(result.found).toBe(false);
    expect(result.confidenceFlags).toContain("crossref_rate_limited");
  });

  it("returns found=false with network_or_parsing_error on fetch throw", async () => {
    mockFetch.mockRejectedValueOnce(new Error("connection refused"));

    const adapter = getVertical("apa_psycarticles");
    const result = await adapter!.lookupEvidence({
      claimText: "depression cognitive behavioral therapy",
      extractedValue: null,
    });
    expect(result.found).toBe(false);
    expect(result.confidenceFlags).toContain("network_or_parsing_error");
  });

  it("has required VerticalAdapter fields", () => {
    const adapter = getVertical("apa_psycarticles")!;
    expect(adapter.displayName).toBe("APA PsycArticles");
    expect(adapter.claimExtractorPrompt).toBeTruthy();
    expect(adapter.discoverySearchTerms.length).toBeGreaterThan(3);
  });
});

// ─── SSRN ─────────────────────────────────────────────────────────────────────

describe("SsrnAdapter", () => {
  it("registers with domainKey ssrn", () => {
    expect(getVertical("ssrn")).toBeDefined();
  });

  it("returns found=true with ssrn_paper flag when SSRN DOI matched", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        message: {
          items: [
            {
              DOI: "10.2139/ssrn.3876543",
              title: ["The Effects of Minimum Wage on Employment: A Meta-Analysis"],
              author: [{ given: "David", family: "Card" }, { given: "Alan", family: "Krueger" }],
              "container-title": ["SSRN Electronic Journal"],
              published: { "date-parts": [[2021, 5]] },
            },
          ],
          "total-results": 47,
        },
      }),
    });

    const adapter = getVertical("ssrn");
    expect(adapter).toBeDefined();

    const result = await adapter!.lookupEvidence({
      claimText: "Minimum wage increases reduce employment",
      extractedValue: "minimum wage employment effects",
    });
    expect(result.found).toBe(true);
    expect(result.sourceId).toContain("ssrn-3876543");
    expect(result.confidenceFlags).toContain("ssrn_paper");
    expect(result.confidenceFlags).toContain("working_paper");
    expect(result.confidenceScore).toBeGreaterThan(0.80);
    expect(result.sourceUrl).toContain("papers.ssrn.com");
  });

  it("falls back to Semantic Scholar when CrossRef returns no results", async () => {
    // First call: CrossRef returns empty
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ message: { items: [], "total-results": 0 } }),
    });
    // Second call: Semantic Scholar returns results
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [
          {
            paperId: "abc123",
            title: "Fiscal Policy Multipliers in Recessions",
            abstract: "We estimate fiscal multipliers using panel data...",
            year: 2020,
            authors: [{ name: "Auerbach, A." }, { name: "Gorodnichenko, Y." }],
            externalIds: { SSRN: "3456789", DOI: "10.2139/ssrn.3456789" },
            venue: "SSRN Electronic Journal",
            url: "https://papers.ssrn.com/sol3/papers.cfm?abstract_id=3456789",
          },
        ],
        total: 12,
      }),
    });

    const adapter = getVertical("ssrn");
    const result = await adapter!.lookupEvidence({
      claimText: "Fiscal multipliers are larger during recessions",
      extractedValue: "fiscal multipliers recession",
    });
    expect(result.found).toBe(true);
    expect(result.confidenceFlags).toContain("ssrn_paper");
    expect(result.sourceUrl).toContain("ssrn.com");
  });

  it("returns found=false with network_or_parsing_error when both sources fail", async () => {
    mockFetch.mockRejectedValueOnce(new Error("network error"));
    // Second call also fails
    mockFetch.mockRejectedValueOnce(new Error("network error"));

    const adapter = getVertical("ssrn");
    const result = await adapter!.lookupEvidence({
      claimText: "economics working paper",
      extractedValue: null,
    });
    expect(result.found).toBe(false);
    expect(result.confidenceFlags).toContain("network_or_parsing_error");
  });

  it("returns found=false with no_semantic_scholar_results when both sources empty", async () => {
    // CrossRef returns empty
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ message: { items: [], "total-results": 0 } }),
    });
    // Semantic Scholar returns empty
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [], total: 0 }),
    });

    const adapter = getVertical("ssrn");
    const result = await adapter!.lookupEvidence({
      claimText: "very obscure economic theory",
      extractedValue: null,
    });
    expect(result.found).toBe(false);
    expect(result.confidenceFlags).toContain("no_semantic_scholar_results");
  });

  it("returns found=false with semantic_scholar_rate_limited on 429 from Semantic Scholar", async () => {
    // CrossRef returns empty
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ message: { items: [], "total-results": 0 } }),
    });
    // Semantic Scholar returns 429
    mockFetch.mockResolvedValueOnce({ ok: false, status: 429 });

    const adapter = getVertical("ssrn");
    const result = await adapter!.lookupEvidence({
      claimText: "labor economics study",
      extractedValue: null,
    });
    expect(result.found).toBe(false);
    expect(result.confidenceFlags).toContain("semantic_scholar_rate_limited");
  });

  it("has required VerticalAdapter fields", () => {
    const adapter = getVertical("ssrn")!;
    expect(adapter.displayName).toBe("SSRN (Social Science Research Network)");
    expect(adapter.claimExtractorPrompt).toBeTruthy();
    expect(adapter.discoverySearchTerms.length).toBeGreaterThan(3);
  });
});
