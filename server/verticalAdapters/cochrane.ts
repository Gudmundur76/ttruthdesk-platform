/**
 * cochrane.ts — Cochrane Library adapter
 *
 * The Cochrane Library API (cochranelibrary.com/api) returns 403 for all
 * non-institutional / non-browser requests. There is no public API key programme.
 *
 * Fix (Sprint 41): Route through PubMed instead.
 * PubMed indexes every Cochrane Database of Systematic Reviews article with full
 * DOIs (10.1002/14651858.*) and open JSON APIs. This gives us the same data —
 * title, DOI, journal, abstract — without institutional access.
 *
 * Strategy:
 *   1. If the claim contains a Cochrane DOI (10.1002/14651858.*), search PubMed
 *      by DOI directly.
 *   2. Otherwise, search PubMed with the claim text filtered to
 *      journal:"Cochrane Database Syst Rev".
 *   3. Return the first matching result with a direct Cochrane Library URL
 *      constructed from the DOI.
 */
import { registerVertical, EvidenceResult, VerticalAdapter } from "./types";
import { logger, errData } from "../logger";
const log = logger("verticalAdapters/cochrane");

const PUBMED_ESEARCH =
  "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi";
const PUBMED_ESUMMARY =
  "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi";
const COCHRANE_DOI_REGEX = /10\.1002\/14651858\.[A-Za-z0-9.]+/;

interface PubMedSummary {
  uid: string;
  title: string;
  fulljournalname: string;
  pubdate: string;
  authors?: Array<{ name: string }>;
  articleids?: Array<{ idtype: string; value: string }>;
}

class CochraneAdapter implements VerticalAdapter {
  readonly domainKey = "cochrane";
  readonly displayName = "Cochrane Library (via PubMed)";
  readonly description =
    "Systematic reviews from Cochrane Database of Systematic Reviews, retrieved via PubMed";
  readonly claimExtractorPrompt =
    "Extract Cochrane DOIs (e.g., 10.1002/14651858.CD000001) or key clinical terms from the claim text.";
  readonly discoverySearchTerms = [
    "systematic review",
    "meta-analysis",
    "randomised controlled trial",
    "clinical evidence",
    "Cochrane review",
  ];

  async lookupEvidence(claim: {
    claimText: string;
    extractedValue: string | null;
  }): Promise<EvidenceResult> {
    try {
      // Step 1: build PubMed search term
      const doiMatch = claim.claimText.match(COCHRANE_DOI_REGEX);
      let searchTerm: string;

      if (doiMatch) {
        // DOI present — search by DOI directly
        searchTerm = `${doiMatch[0]}[AID]`;
      } else {
        // Keyword search filtered to Cochrane journal
        const keywords = (claim.extractedValue ?? claim.claimText)
          .replace(/[^a-zA-Z0-9 ]/g, " ")
          .trim()
          .split(/\s+/)
          .slice(0, 6)
          .join(" ");
        searchTerm = `${keywords}[Title] AND "Cochrane Database Syst Rev"[Journal]`;
      }

      // Step 2: esearch to get PMID list
      const searchUrl = `${PUBMED_ESEARCH}?db=pubmed&term=${encodeURIComponent(searchTerm)}&retmax=1&retmode=json&tool=citation.is&email=citation@citation.is`;
      const searchRes = await fetch(searchUrl, {
        signal: AbortSignal.timeout(10_000),
      });

      if (!searchRes.ok) {
        log.error(`PubMed esearch error: ${searchRes.status}`);
        return this._notFound(["pubmed_esearch_http_error"]);
      }

      const searchData = (await searchRes.json()) as {
        esearchresult: { idlist: string[] };
      };
      const pmids = searchData.esearchresult?.idlist ?? [];

      if (pmids.length === 0) {
        return this._notFound(["no_cochrane_review_found"]);
      }

      // Step 3: esummary to get full record
      const summaryUrl = `${PUBMED_ESUMMARY}?db=pubmed&id=${pmids[0]}&retmode=json&tool=citation.is&email=citation@citation.is`;
      const summaryRes = await fetch(summaryUrl, {
        signal: AbortSignal.timeout(10_000),
      });

      if (!summaryRes.ok) {
        log.error(`PubMed esummary error: ${summaryRes.status}`);
        return this._notFound(["pubmed_esummary_http_error"]);
      }

      const summaryData = (await summaryRes.json()) as {
        result: Record<string, PubMedSummary>;
      };
      const record = summaryData.result?.[pmids[0]];

      if (!record) {
        return this._notFound(["pubmed_esummary_empty"]);
      }

      // Extract DOI from articleids
      const doi =
        record.articleids?.find(a => a.idtype === "doi")?.value ?? null;
      const sourceUrl = doi
        ? `https://www.cochranelibrary.com/cdsr/doi/${doi}/full`
        : `https://pubmed.ncbi.nlm.nih.gov/${pmids[0]}/`;

      return {
        found: true,
        sourceId: doi ?? `pmid:${pmids[0]}`,
        sourceUrl,
        evidenceRaw: {
          pmid: pmids[0],
          doi,
          title: record.title,
          journal: record.fulljournalname,
          pubdate: record.pubdate,
          authors: record.authors?.slice(0, 5).map(a => a.name) ?? [],
          cochrane_review: true,
        },
        confidenceScore: 0.95,
        confidenceFlags: ["cochrane_review_via_pubmed"],
      };
    } catch (error) {
      log.error("Error fetching Cochrane review via PubMed:", errData(error));
      return this._notFound(["network_or_parsing_error"]);
    }
  }

  private _notFound(flags: string[]): EvidenceResult {
    return {
      found: false,
      sourceId: null,
      sourceUrl: null,
      evidenceRaw: null,
      confidenceScore: 0.1,
      confidenceFlags: flags,
    };
  }
}

registerVertical(new CochraneAdapter());
