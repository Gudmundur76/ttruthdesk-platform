/**
 * Phase 117 — Verbatim Evidence Passages
 *
 * Tests for:
 *  1. extractBestExcerpt() — keyword-overlap sentence selector
 *  2. buildEvidenceWithExcerpts() — maps PubMedResult[] → evidence[] with excerpt populated
 *  3. persistAbstractPassage() — writes sourcePassage + passageConfidence to claims table
 *  4. buildVerifyResult() integration — evidence[].excerpt is non-null when abstractSnippet present
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  extractBestExcerpt,
  buildEvidenceWithExcerpts,
  type EvidenceItem,
} from "./pubmedAbstractFetcher";

// ─── 1. extractBestExcerpt ────────────────────────────────────────────────────

describe("extractBestExcerpt", () => {
  it("returns the sentence with the highest keyword overlap", () => {
    const abstract =
      "Lysozyme is a well-studied enzyme. " +
      "The crystal structure of lysozyme at 1.5 Å resolution was determined by X-ray diffraction. " +
      "It cleaves peptidoglycan in bacterial cell walls.";
    const claim = "Lysozyme has a resolution of 1.5 Å in PDB 1LYZ";
    const result = extractBestExcerpt(claim, abstract);
    expect(result).toContain("1.5");
    expect(result).toContain("lysozyme");
  });

  it("returns the full abstract when it is a single sentence", () => {
    const abstract = "Lysozyme crystal structure at 1.5 Å resolution.";
    const claim = "Lysozyme resolution 1.5 Å";
    const result = extractBestExcerpt(claim, abstract);
    expect(result).toBe(abstract);
  });

  it("returns null when abstract is empty", () => {
    const result = extractBestExcerpt("some claim", "");
    expect(result).toBeNull();
  });

  it("returns null when abstract is only whitespace", () => {
    const result = extractBestExcerpt("some claim", "   \n\t  ");
    expect(result).toBeNull();
  });

  it("falls back to the first sentence when no keywords match", () => {
    const abstract =
      "Unrelated topic. Another unrelated sentence. Third sentence.";
    const claim = "Lysozyme resolution 1.5 Å";
    const result = extractBestExcerpt(claim, abstract);
    // Should return the first sentence as fallback, not null
    expect(result).toBe("Unrelated topic.");
  });

  it("is case-insensitive in keyword matching", () => {
    const abstract =
      "LYSOZYME RESOLUTION IS 1.5 ANGSTROMS. Other content here.";
    const claim = "lysozyme resolution 1.5";
    const result = extractBestExcerpt(claim, abstract);
    expect(result?.toLowerCase()).toContain("lysozyme");
  });

  it("truncates excerpts longer than 500 characters", () => {
    const longSentence = "Lysozyme " + "x".repeat(600) + " resolution 1.5 Å.";
    const result = extractBestExcerpt("Lysozyme resolution 1.5", longSentence);
    expect(result).not.toBeNull();
    expect(result!.length).toBeLessThanOrEqual(503); // 500 + "..."
  });
});

// ─── 2. buildEvidenceWithExcerpts ─────────────────────────────────────────────

describe("buildEvidenceWithExcerpts", () => {
  const claimText = "Lysozyme has a resolution of 1.5 Å in PDB 1LYZ";

  const pubmedResults = [
    {
      pmid: "12345",
      title: "Crystal structure of lysozyme",
      abstractSnippet:
        "The crystal structure of lysozyme at 1.5 Å resolution was determined. " +
        "It is a well-studied enzyme.",
      citationUrl: "https://pubmed.ncbi.nlm.nih.gov/12345/",
      authors: ["Smith J", "Jones A"],
      journal: "Nature",
      year: 2020,
    },
    {
      pmid: "67890",
      title: "Enzyme kinetics review",
      abstractSnippet: "A review of enzyme kinetics and catalysis mechanisms.",
      citationUrl: "https://pubmed.ncbi.nlm.nih.gov/67890/",
      authors: ["Brown K"],
      journal: "PNAS",
      year: 2019,
    },
    {
      pmid: "",
      title: "No PMID entry",
      abstractSnippet: "Some abstract.",
      citationUrl: "",
      authors: [],
      year: 2018,
    },
  ];

  it("returns one evidence item per pubmed result", () => {
    const evidence = buildEvidenceWithExcerpts(claimText, pubmedResults, 0.75);
    expect(evidence).toHaveLength(3);
  });

  it("populates excerpt from abstractSnippet when available", () => {
    const evidence = buildEvidenceWithExcerpts(claimText, pubmedResults, 0.75);
    const first = evidence[0] as EvidenceItem;
    expect(first.excerpt).not.toBeNull();
    expect(typeof first.excerpt).toBe("string");
    expect((first.excerpt as string).length).toBeGreaterThan(0);
  });

  it("sets excerpt to null when abstractSnippet is empty", () => {
    const results = [
      {
        pmid: "11111",
        title: "No abstract",
        abstractSnippet: "",
        citationUrl: "https://pubmed.ncbi.nlm.nih.gov/11111/",
        authors: [],
        year: 2021,
      },
    ];
    const evidence = buildEvidenceWithExcerpts(claimText, results, 0.5);
    expect(evidence[0].excerpt).toBeNull();
  });

  it("sets correct sourceId format pmid:XXXX", () => {
    const evidence = buildEvidenceWithExcerpts(claimText, pubmedResults, 0.75);
    expect(evidence[0].sourceId).toBe("pmid:12345");
  });

  it("sets correct sourceUrl", () => {
    const evidence = buildEvidenceWithExcerpts(claimText, pubmedResults, 0.75);
    expect(evidence[0].sourceUrl).toBe(
      "https://pubmed.ncbi.nlm.nih.gov/12345/"
    );
  });

  it("sets confidenceScore via per-item keyword overlap (not flat claim confidence)", () => {
    // Sprint 20: confidence is now computed per-item via Jaccard keyword overlap
    // between the claim text and the evidence item's title + abstract.
    // The passed confidence parameter is ignored (renamed _claimConfidence).
    // For claimText "Lysozyme has a resolution of 1.5 Å in PDB 1LYZ" and
    // evidence[0] title "Crystal structure of lysozyme" + abstract about lysozyme
    // at 1.5 Å, we expect a score in [0.1, 1.0] that is NOT the passed value.
    const evidence = buildEvidenceWithExcerpts(claimText, pubmedResults, 0.82);
    const score = evidence[0].confidenceScore as number;
    expect(score).toBeGreaterThanOrEqual(0.1);
    expect(score).toBeLessThanOrEqual(1.0);
    // The score must be computed from keyword overlap, not from the passed 0.82
    expect(score).not.toBe(0.82);
  });

  it("sets database field to pubmed", () => {
    const evidence = buildEvidenceWithExcerpts(claimText, pubmedResults, 0.5);
    evidence.forEach(e => expect(e.database).toBe("pubmed"));
  });

  it("handles empty pubmedResults array", () => {
    const evidence = buildEvidenceWithExcerpts(claimText, [], 0.5);
    expect(evidence).toHaveLength(0);
  });

  it("includes title in evidence item", () => {
    const evidence = buildEvidenceWithExcerpts(claimText, pubmedResults, 0.75);
    expect(evidence[0].title).toBe("Crystal structure of lysozyme");
  });

  it("includes publicationYear when available", () => {
    const evidence = buildEvidenceWithExcerpts(claimText, pubmedResults, 0.75);
    expect(evidence[0].publicationYear).toBe(2020);
  });
});

// ─── 3. selectBestPassage ─────────────────────────────────────────────────────

describe("selectBestPassage", () => {
  it("returns the excerpt with the highest keyword overlap score across all evidence items", async () => {
    const { selectBestPassage } = await import("./pubmedAbstractFetcher");
    const claimText = "Lysozyme 1.5 Å resolution";
    const evidence: EvidenceItem[] = [
      {
        sourceId: "pmid:1",
        sourceUrl: "",
        excerpt: "Lysozyme resolution 1.5 Å crystal structure.",
        confidenceScore: 0.8,
        database: "pubmed",
        title: "A",
        publicationYear: 2020,
      },
      {
        sourceId: "pmid:2",
        sourceUrl: "",
        excerpt: "Unrelated enzyme kinetics study.",
        confidenceScore: 0.6,
        database: "pubmed",
        title: "B",
        publicationYear: 2019,
      },
    ];
    const result = selectBestPassage(claimText, evidence);
    expect(result?.excerpt).toContain("Lysozyme");
    expect(result?.score).toBeGreaterThan(0);
  });

  it("returns null when all excerpts are null", async () => {
    const { selectBestPassage } = await import("./pubmedAbstractFetcher");
    const evidence: EvidenceItem[] = [
      {
        sourceId: "pmid:1",
        sourceUrl: "",
        excerpt: null,
        confidenceScore: 0.5,
        database: "pubmed",
        title: "A",
        publicationYear: 2020,
      },
    ];
    const result = selectBestPassage("any claim", evidence);
    expect(result).toBeNull();
  });
});
