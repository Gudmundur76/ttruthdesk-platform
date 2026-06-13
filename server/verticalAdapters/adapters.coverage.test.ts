/**
 * adapters.coverage.test.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Coverage tests for the domain-agnostic vertical adapters:
 *   - CrossRef
 *   - OpenAlex
 *   - Semantic Scholar
 *   - Generic Source (URL/DOI fallback)
 *
 * These are unit tests — they mock fetch to avoid live network calls.
 * They verify that each adapter:
 *   1. Returns the correct EvidenceResult shape
 *   2. Extracts DOIs from claim text correctly
 *   3. Falls back to keyword search when no DOI is present
 *   4. Returns found: false gracefully on network errors
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Import adapters to trigger self-registration
import "./crossRef";
import "./openAlex";
import "./semanticScholar";
import "./genericSource";
import { getVertical } from "./types";

// ─── Mock fetch ───────────────────────────────────────────────────────────────

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function mockCrossRefResponse(doi: string) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      message: {
        DOI: doi,
        title: ["Test Paper Title"],
        "container-title": ["Nature"],
        published: { "date-parts": [[2023]] },
        "is-referenced-by-count": 150,
        abstract: "<jats:p>Test abstract content.</jats:p>",
        type: "journal-article",
        subject: ["Biology", "Medicine"],
      },
    }),
  };
}

function mockOpenAlexResponse(doi: string) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      id: "https://openalex.org/W123456",
      doi: `https://doi.org/${doi}`,
      title: "Test Paper Title",
      abstract_inverted_index: {
        "Test": [0],
        "abstract": [1],
        "content": [2],
      },
      publication_year: 2023,
      cited_by_count: 150,
      concepts: [
        { display_name: "Biology", score: 0.9, level: 1 },
        { display_name: "Medicine", score: 0.8, level: 1 },
      ],
      primary_location: { source: { display_name: "Nature" } },
      open_access: { is_oa: false },
      type: "article",
    }),
  };
}

function mockSemanticScholarResponse() {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      paperId: "abc123",
      externalIds: { DOI: "10.1038/nature12373", PubMed: "23955558" },
      title: "Test Paper Title",
      abstract: "Test abstract content.",
      year: 2023,
      citationCount: 200,
      influentialCitationCount: 45,
      fieldsOfStudy: ["Biology", "Medicine"],
      tldr: { text: "A brief summary of the paper." },
      openAccessPdf: null,
      publicationTypes: ["JournalArticle"],
      journal: { name: "Nature" },
    }),
  };
}

// ─── CrossRef adapter tests ───────────────────────────────────────────────────

describe("CrossRef adapter", () => {
  beforeEach(() => mockFetch.mockReset());
  afterEach(() => vi.restoreAllMocks());

  it("is registered with domainKey crossref", () => {
    const adapter = getVertical("crossref");
    expect(adapter).toBeDefined();
    expect(adapter?.domainKey).toBe("crossref");
  });

  it("returns found: true for a claim with a DOI", async () => {
    const doi = "10.1038/nature12373";
    mockFetch.mockResolvedValue(mockCrossRefResponse(doi));
    const adapter = getVertical("crossref")!;
    const result = await adapter.lookupEvidence({
      claimText: `This study (doi:${doi}) demonstrates the effect.`,
      extractedValue: null,
    });
    expect(result.found).toBe(true);
    expect(result.sourceId).toBe(doi);
    expect(result.sourceUrl).toBe(`https://doi.org/${doi}`);
    expect(result.confidenceScore).toBeGreaterThan(0.8);
    expect(result.evidenceRaw).toMatchObject({ doi, title: "Test Paper Title" });
  });

  it("falls back to keyword search when no DOI in claim", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        message: {
          items: [{
            DOI: "10.1038/nature12373",
            title: ["Test Paper Title"],
            "is-referenced-by-count": 50,
            score: 85.5,
            type: "journal-article",
          }],
        },
      }),
    });
    const adapter = getVertical("crossref")!;
    const result = await adapter.lookupEvidence({
      claimText: "Aspirin reduces cardiovascular risk in high-risk patients",
      extractedValue: null,
    });
    expect(result.found).toBe(true);
    expect(result.confidenceFlags.some(f => f.includes("keyword") || f.includes("relevance"))).toBe(true);
  });

  it("returns found: false on network error", async () => {
    mockFetch.mockRejectedValue(new Error("Network error"));
    const adapter = getVertical("crossref")!;
    const result = await adapter.lookupEvidence({
      claimText: "doi:10.1038/nature12373 demonstrates X",
      extractedValue: null,
    });
    expect(result.found).toBe(false);
    expect(result.confidenceScore).toBeLessThan(0.3);
  });

  it("has discoverySearchTerms array", () => {
    const adapter = getVertical("crossref")!;
    expect(Array.isArray(adapter.discoverySearchTerms)).toBe(true);
    expect(adapter.discoverySearchTerms.length).toBeGreaterThan(0);
  });
});

// ─── OpenAlex adapter tests ───────────────────────────────────────────────────

describe("OpenAlex adapter", () => {
  beforeEach(() => mockFetch.mockReset());

  it("is registered with domainKey openalex", () => {
    const adapter = getVertical("openalex");
    expect(adapter).toBeDefined();
    expect(adapter?.domainKey).toBe("openalex");
  });

  it("returns found: true for a claim with a DOI", async () => {
    const doi = "10.1038/nature12373";
    mockFetch.mockResolvedValue(mockOpenAlexResponse(doi));
    const adapter = getVertical("openalex")!;
    const result = await adapter.lookupEvidence({
      claimText: `Study doi:${doi} shows X.`,
      extractedValue: null,
    });
    expect(result.found).toBe(true);
    expect(result.confidenceScore).toBeGreaterThan(0.7);
    expect(result.evidenceRaw).toMatchObject({ title: "Test Paper Title" });
  });

  it("reconstructs abstract from inverted index", async () => {
    const doi = "10.1038/nature12373";
    mockFetch.mockResolvedValue(mockOpenAlexResponse(doi));
    const adapter = getVertical("openalex")!;
    const result = await adapter.lookupEvidence({
      claimText: `doi:${doi}`,
      extractedValue: null,
    });
    // Abstract is reconstructed from inverted index: {"Test":[0],"abstract":[1],"content":[2]}
    expect(result.evidenceRaw?.abstract).toContain("Test");
    expect(result.evidenceRaw?.abstract).toContain("abstract");
  });

  it("returns found: false on HTTP 404", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 404 });
    const adapter = getVertical("openalex")!;
    const result = await adapter.lookupEvidence({
      claimText: "doi:10.9999/nonexistent",
      extractedValue: null,
    });
    expect(result.found).toBe(false);
    expect(result.confidenceScore).toBeLessThan(0.3);
  });
});

// ─── Semantic Scholar adapter tests ──────────────────────────────────────────

describe("Semantic Scholar adapter", () => {
  beforeEach(() => mockFetch.mockReset());

  it("is registered with domainKey semantic_scholar", () => {
    const adapter = getVertical("semantic_scholar");
    expect(adapter).toBeDefined();
    expect(adapter?.domainKey).toBe("semantic_scholar");
  });

  it("returns found: true for a claim with a DOI", async () => {
    mockFetch.mockResolvedValue(mockSemanticScholarResponse());
    const adapter = getVertical("semantic_scholar")!;
    const result = await adapter.lookupEvidence({
      claimText: "doi:10.1038/nature12373 shows X",
      extractedValue: null,
    });
    expect(result.found).toBe(true);
    expect(result.confidenceScore).toBeGreaterThan(0.85);
    expect(result.evidenceRaw).toMatchObject({
      influentialCitations: 45,
      tldr: "A brief summary of the paper.",
    });
  });

  it("extracts PMID from claim text", async () => {
    mockFetch.mockResolvedValue(mockSemanticScholarResponse());
    const adapter = getVertical("semantic_scholar")!;
    const result = await adapter.lookupEvidence({
      claimText: "According to PMID:23955558, aspirin reduces risk.",
      extractedValue: null,
    });
    expect(result.found).toBe(true);
  });

  it("extracts arXiv ID from claim text", async () => {
    mockFetch.mockResolvedValue(mockSemanticScholarResponse());
    const adapter = getVertical("semantic_scholar")!;
    const result = await adapter.lookupEvidence({
      claimText: "The paper arXiv:2301.07041 demonstrates X.",
      extractedValue: null,
    });
    expect(result.found).toBe(true);
  });

  it("returns found: false on HTTP 404", async () => {
    // Use HTTP 404 response (not network error) to test the error path
    mockFetch.mockResolvedValue({ ok: false, status: 404, headers: { get: () => "application/json" } });
    const adapter = getVertical("semantic_scholar")!;
    const result = await adapter.lookupEvidence({
      claimText: "doi:10.1038/nature12373",
      extractedValue: null,
    });
    expect(result.found).toBe(false);
    expect(result.confidenceScore).toBeLessThan(0.3);
  });
});

// ─── Generic Source adapter tests ────────────────────────────────────────────

describe("Generic Source adapter", () => {
  beforeEach(() => mockFetch.mockReset());

  it("is registered with domainKey generic_source", () => {
    const adapter = getVertical("generic_source");
    expect(adapter).toBeDefined();
    expect(adapter?.domainKey).toBe("generic_source");
  });

  it("resolves a DOI via CrossRef + OpenAlex in parallel", async () => {
    mockFetch
      .mockResolvedValueOnce(mockCrossRefResponse("10.1038/nature12373"))
      .mockResolvedValueOnce(mockOpenAlexResponse("10.1038/nature12373"));
    const adapter = getVertical("generic_source")!;
    const result = await adapter.lookupEvidence({
      claimText: "doi:10.1038/nature12373 demonstrates X",
      extractedValue: null,
    });
    expect(result.found).toBe(true);
    expect(result.sourceUrl).toBe("https://doi.org/10.1038/nature12373");
  });

  it("fetches URL metadata when no DOI is present", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => "text/html" },
      text: async () => `
        <html>
          <head>
            <title>Test Article</title>
            <meta property="og:title" content="Test Article Title" />
            <meta name="description" content="A test article about X." />
            <meta name="author" content="Jane Doe" />
          </head>
        </html>
      `,
    });
    const adapter = getVertical("generic_source")!;
    const result = await adapter.lookupEvidence({
      claimText: "According to https://example.com/article, X is true.",
      extractedValue: null,
    });
    expect(result.found).toBe(true);
    expect(result.evidenceRaw?.title).toBe("Test Article Title");
    expect(result.confidenceScore).toBeGreaterThan(0.3);
    expect(result.confidenceScore).toBeLessThan(0.6);
  });

  it("returns found: false for inaccessible URL", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 403, headers: { get: () => "text/html" } });
    const adapter = getVertical("generic_source")!;
    const result = await adapter.lookupEvidence({
      claimText: "According to https://paywalled.com/article, X is true.",
      extractedValue: null,
    });
    expect(result.found).toBe(false);
    expect(result.confidenceFlags.some(f => f.includes("not accessible") || f.includes("403"))).toBe(true);
  });

  it("returns very low confidence when no URL or DOI found", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        message: { items: [] },
      }),
    });
    const adapter = getVertical("generic_source")!;
    const result = await adapter.lookupEvidence({
      claimText: "Some claim with no URL or DOI reference.",
      extractedValue: null,
    });
    expect(result.found).toBe(false);
    expect(result.confidenceScore).toBeLessThan(0.2);
  });
});

// ─── Source registry integration ─────────────────────────────────────────────

describe("sourceRegistry new sources", () => {
  it("crossref, openalex, semantic_scholar, openfda are approved in registry", async () => {
    const { getApprovedSources } = await import("../sourceRegistry");
    const approved = getApprovedSources().map(s => s.id);
    expect(approved).toContain("crossref");
    expect(approved).toContain("openalex");
    expect(approved).toContain("semantic_scholar");
    expect(approved).toContain("openfda");
    expect(approved).toContain("efsa_openfoodtox");
  });

  it("all new sources have valid health check functions", async () => {
    const { SOURCE_WHITELIST } = await import("../sourceRegistry");
    const newSources = SOURCE_WHITELIST.filter(s =>
      ["crossref", "openalex", "semantic_scholar", "openfda", "efsa_openfoodtox"].includes(s.id)
    );
    for (const source of newSources) {
      expect(typeof source.healthCheckFn).toBe("function");
      expect(source.approved).toBe(true);
      expect(source.approvedAt).toBeTruthy();
    }
  });
});
