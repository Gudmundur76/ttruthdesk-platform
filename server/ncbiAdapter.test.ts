/**
 * ncbiAdapter.test.ts
 * Tests for the NCBI E-utilities adapter (Sprint 25 Phase 3).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { bestSentence, fetchNcbiResults } from "./ncbiAdapter";

// ─── bestSentence ─────────────────────────────────────────────────────────────
describe("bestSentence", () => {
  it("returns empty string for empty abstract", () => {
    expect(bestSentence("", "aspirin reduces pain")).toBe("");
  });

  it("returns the sentence with the most claim keyword matches", () => {
    const abstract =
      "Aspirin is a widely used analgesic. " +
      "Ibuprofen reduces inflammation. " +
      "Aspirin reduces cardiovascular risk in adults.";
    const result = bestSentence(
      abstract,
      "aspirin reduces cardiovascular risk"
    );
    expect(result.toLowerCase()).toContain(
      "aspirin reduces cardiovascular risk"
    );
  });

  it("falls back to first sentence when no keywords match", () => {
    const abstract = "The quick brown fox jumps. Over the lazy dog.";
    const result = bestSentence(abstract, "lysozyme protein structure");
    expect(result).toBe("The quick brown fox jumps.");
  });

  it("handles single-sentence abstracts", () => {
    const abstract = "Lysozyme is found in human tears and saliva.";
    const result = bestSentence(abstract, "lysozyme tears");
    expect(result).toBe("Lysozyme is found in human tears and saliva.");
  });

  it("ignores short fragments under 20 chars", () => {
    const abstract = "Short. Lysozyme is an enzyme found in tears and saliva.";
    const result = bestSentence(abstract, "lysozyme enzyme tears");
    expect(result).toContain("Lysozyme is an enzyme");
  });
});

// ─── fetchNcbiResults (mocked fetch) ─────────────────────────────────────────
const ESEARCH_RESPONSE = {
  esearchresult: { idlist: ["12345678", "87654321"] },
};

// Combined XML for the batched efetch request (both PMIDs in one response)
const EFETCH_XML_BATCH = `
<PubmedArticleSet>
<PubmedArticle>
  <PMID>12345678</PMID>
  <ArticleTitle>Aspirin reduces cardiovascular events in adults</ArticleTitle>
  <AbstractText>Aspirin significantly reduces the risk of major cardiovascular events in adults over 50. The drug inhibits platelet aggregation.</AbstractText>
  <ISOAbbreviation>N Engl J Med</ISOAbbreviation>
  <PubDate><Year>2022</Year></PubDate>
  <LastName>Smith</LastName>
</PubmedArticle>
<PubmedArticle>
  <PMID>87654321</PMID>
  <ArticleTitle>Ibuprofen and gastrointestinal bleeding</ArticleTitle>
  <AbstractText>Ibuprofen use is associated with increased risk of gastrointestinal bleeding. NSAIDs inhibit prostaglandin synthesis.</AbstractText>
  <ISOAbbreviation>Lancet</ISOAbbreviation>
  <PubDate><Year>2021</Year></PubDate>
  <LastName>Jones</LastName>
</PubmedArticle>
</PubmedArticleSet>`;

describe("fetchNcbiResults", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url.includes("esearch")) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve(ESEARCH_RESPONSE),
          });
        }
        // Batched efetch — both PMIDs in one request
        return Promise.resolve({
          ok: true,
          text: () => Promise.resolve(EFETCH_XML_BATCH),
        });
      })
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns results with PMID, title, and citationUrl", async () => {
    const results = await fetchNcbiResults(
      "aspirin cardiovascular",
      "aspirin reduces cardiovascular risk",
      2
    );
    expect(results).toHaveLength(2);
    expect(results[0].pmid).toBe("12345678");
    expect(results[0].title).toContain("Aspirin");
    expect(results[0].citationUrl).toBe(
      "https://pubmed.ncbi.nlm.nih.gov/12345678/"
    );
  });

  it("returns claim-relevant sentence in abstractSnippet", async () => {
    const results = await fetchNcbiResults(
      "aspirin cardiovascular",
      "aspirin reduces cardiovascular risk",
      2
    );
    expect(results[0].abstractSnippet).toContain("cardiovascular");
  });

  it("returns empty array when esearch returns no PMIDs", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ esearchresult: { idlist: [] } }),
      })
    );
    const results = await fetchNcbiResults("unknown query xyz", "unknown", 5);
    expect(results).toHaveLength(0);
  });

  it("returns empty array when fetch throws", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network")));
    const results = await fetchNcbiResults("aspirin", "aspirin", 5);
    expect(results).toHaveLength(0);
  });

  it("filters out records with empty abstracts", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url.includes("esearch")) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({ esearchresult: { idlist: ["99999"] } }),
          });
        }
        return Promise.resolve({
          ok: true,
          text: () =>
            Promise.resolve(
              "<PubmedArticle><ArticleTitle>Empty</ArticleTitle></PubmedArticle>"
            ),
        });
      })
    );
    const results = await fetchNcbiResults("empty abstract", "test", 1);
    expect(results).toHaveLength(0);
  });
});
