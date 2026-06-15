/**
 * domainIngestScheduler.ts
 *
 * Scheduled heartbeat handler: POST /api/scheduled/domain-ingest
 *
 * Autonomously ingests scientific papers for the top 5 domains that enterprise
 * AI clients (Perplexity, Anthropic, OpenAI, Google, Meta) most need coverage
 * for: biology, medicine, chemistry, physics, and climate.
 *
 * For each domain, queries PubMed for recent high-impact papers, deduplicates
 * against the auto_ingested_papers table, fetches abstracts, and submits new
 * papers through the full audit pipeline (claim extraction → verification →
 * registry write → trainingBridge emit → SLM corpus).
 *
 * Designed to run every 6 hours via Manus Heartbeat cron.
 * No API key required — uses NCBI E-utilities (free, rate-limited to 3 req/s).
 */
import type { Request, Response } from "express";
import {
  upsertAutoIngestedPaper,
  updateAutoIngestedPaperStatus,
  getAutoIngestedPaperByPmid,
  createDocument,
} from "./db";
import { runAnalysisPipeline } from "./analysisPipeline";
import { ENV } from "./_core/env";
import { logger, errData } from "./logger";

const log = logger("domainIngestScheduler");

const NCBI_BASE = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";
const TOOL = "citation-is-registry";
const EMAIL = "info@citation.is";
const MAX_PER_QUERY = 5; // fetch at most 5 new papers per query per run
const SYSTEM_USER_ID = 1;

// ── Top 5 scientific domains with targeted PubMed queries ───────────────────
// These are the domains enterprise AI clients most need verified claims for.
// Queries are designed to surface recent, high-impact, verifiable findings.
export const DOMAIN_QUERIES: Array<{
  domain: string;
  label: string;
  queries: string[];
}> = [
  {
    domain: "biology",
    label: "Molecular Biology",
    queries: [
      "protein structure function[Title/Abstract] AND systematic review[Publication Type]",
      "CRISPR gene editing mechanism[Title/Abstract] AND 2024:2026[PDAT]",
      "cell signaling pathway[Title/Abstract] AND Nature[Journal] AND 2024:2026[PDAT]",
    ],
  },
  {
    domain: "medicine",
    label: "Clinical Medicine",
    queries: [
      "clinical trial efficacy[Title/Abstract] AND randomized controlled trial[Publication Type] AND 2024:2026[PDAT]",
      "drug mechanism of action[Title/Abstract] AND systematic review[Publication Type] AND 2024:2026[PDAT]",
      "biomarker diagnostic accuracy[Title/Abstract] AND meta-analysis[Publication Type] AND 2024:2026[PDAT]",
    ],
  },
  {
    domain: "chemistry",
    label: "Chemistry",
    queries: [
      "molecular synthesis mechanism[Title/Abstract] AND Nature Chemistry[Journal] AND 2024:2026[PDAT]",
      "catalysis reaction mechanism[Title/Abstract] AND Science[Journal] AND 2024:2026[PDAT]",
      "drug molecule binding affinity[Title/Abstract] AND 2024:2026[PDAT]",
    ],
  },
  {
    domain: "physics",
    label: "Physics & Materials",
    queries: [
      "quantum computing qubit[Title/Abstract] AND Nature Physics[Journal] AND 2024:2026[PDAT]",
      "materials science properties[Title/Abstract] AND Physical Review[Journal] AND 2024:2026[PDAT]",
      "semiconductor device physics[Title/Abstract] AND 2024:2026[PDAT]",
    ],
  },
  {
    domain: "climate",
    label: "Climate & Earth Science",
    queries: [
      "climate change temperature[Title/Abstract] AND Nature Climate Change[Journal] AND 2024:2026[PDAT]",
      "carbon dioxide emissions measurement[Title/Abstract] AND 2024:2026[PDAT]",
      "sea level rise projection[Title/Abstract] AND Science[Journal] AND 2024:2026[PDAT]",
    ],
  },
];

interface ESearchResult {
  esearchresult?: { idlist?: string[]; count?: string };
}

interface PaperMeta {
  pmid: string;
  doi: string | null;
  title: string;
  authors: string;
  journal: string;
  pubYear: string;
  abstractText: string;
}

async function searchPubmed(
  query: string,
  retmax = MAX_PER_QUERY
): Promise<string[]> {
  const url = `${NCBI_BASE}/esearch.fcgi?db=pubmed&term=${encodeURIComponent(query)}&retmode=json&retmax=${retmax}&sort=pub+date&tool=${TOOL}&email=${EMAIL}`;
  const res = await fetch(url);
  const data = (await res.json()) as ESearchResult;
  return data?.esearchresult?.idlist ?? [];
}

async function fetchPaperMeta(pmid: string): Promise<PaperMeta | null> {
  try {
    const url = `${NCBI_BASE}/efetch.fcgi?db=pubmed&id=${pmid}&rettype=abstract&retmode=xml&tool=${TOOL}&email=${EMAIL}`;
    const res = await fetch(url);
    const xml = await res.text();
    const titleMatch = xml.match(/<ArticleTitle>([\s\S]*?)<\/ArticleTitle>/);
    const title = titleMatch
      ? titleMatch[1].replace(/<[^>]+>/g, "").trim()
      : "";
    if (!title) return null;
    const abstractMatches = Array.from(
      xml.matchAll(
        /<AbstractText(?:[^>]* Label="([^"]*)"|[^>]*)>([\s\S]*?)<\/AbstractText>/g
      )
    );
    const abstractParts: string[] = [];
    for (const m of abstractMatches) {
      const label = m[1] ? `${m[1]}: ` : "";
      const text = m[2].replace(/<[^>]+>/g, "").trim();
      if (text) abstractParts.push(label + text);
    }
    const authorMatches = Array.from(
      xml.matchAll(/<LastName>([^<]+)<\/LastName>/g)
    );
    const authors = authorMatches
      .slice(0, 8)
      .map(m => m[1])
      .join(", ");
    const authorSuffix = authorMatches.length > 8 ? " et al." : "";
    const journalMatch = xml.match(
      /<ISOAbbreviation>([^<]+)<\/ISOAbbreviation>/
    );
    const yearMatch = xml.match(/<PubDate>[\s\S]*?<Year>([0-9]{4})<\/Year>/);
    const doiMatch = xml.match(
      /<ELocationID EIdType="doi"[^>]*>([^<]+)<\/ELocationID>/
    );
    return {
      pmid,
      doi: doiMatch ? doiMatch[1].trim() : null,
      title,
      authors: `${authors}${authorSuffix}`,
      journal: journalMatch ? journalMatch[1] : "",
      pubYear: yearMatch ? yearMatch[1] : "",
      abstractText: abstractParts.join("\n\n"),
    };
  } catch {
    return null;
  }
}

function buildRawText(meta: PaperMeta): string {
  return [
    `Title: ${meta.title}`,
    meta.authors ? `Authors: ${meta.authors}` : "",
    meta.journal
      ? `Journal: ${meta.journal}${meta.pubYear ? ` (${meta.pubYear})` : ""}`
      : "",
    meta.doi ? `DOI: ${meta.doi}` : "",
    `PMID: ${meta.pmid}`,
    "",
    meta.abstractText || "[Abstract not available]",
  ]
    .filter(Boolean)
    .join("\n");
}

export interface DomainIngestResult {
  domain: string;
  label: string;
  queriesRun: number;
  newPapersFound: number;
  submitted: number;
  skipped: number;
  errors: string[];
}

/**
 * Run domain ingest for all 5 domains.
 * Returns per-domain results.
 */
export async function runDomainIngest(): Promise<DomainIngestResult[]> {
  const results: DomainIngestResult[] = [];

  for (const domainConfig of DOMAIN_QUERIES) {
    const domainResult: DomainIngestResult = {
      domain: domainConfig.domain,
      label: domainConfig.label,
      queriesRun: 0,
      newPapersFound: 0,
      submitted: 0,
      skipped: 0,
      errors: [],
    };

    for (const query of domainConfig.queries) {
      domainResult.queriesRun++;
      let pmids: string[] = [];
      try {
        pmids = await searchPubmed(query);
        // Rate limit: NCBI allows 3 req/s without API key
        await new Promise(r => setTimeout(r, 400));
      } catch (err) {
        domainResult.errors.push(
          `Search failed for query "${query}": ${String(err)}`
        );
        continue;
      }

      for (const pmid of pmids) {
        // Skip if already ingested
        const existing = await getAutoIngestedPaperByPmid(pmid);
        if (existing) {
          domainResult.skipped++;
          continue;
        }
        domainResult.newPapersFound++;

        // Fetch metadata
        let meta: PaperMeta | null = null;
        try {
          meta = await fetchPaperMeta(pmid);
          await new Promise(r => setTimeout(r, 400));
        } catch (err) {
          domainResult.errors.push(
            `Fetch failed for PMID ${pmid}: ${String(err)}`
          );
          continue;
        }
        if (!meta) {
          domainResult.errors.push(`No metadata for PMID ${pmid}`);
          continue;
        }

        // Insert into auto_ingested_papers
        await upsertAutoIngestedPaper({
          pmid: meta.pmid,
          doi: meta.doi ?? undefined,
          title: meta.title,
          authors: meta.authors,
          journal: meta.journal,
          pubYear: meta.pubYear,
          searchQuery: query,
          status: "fetched",
          isPublic: true,
        });

        // Create document and run audit pipeline
        try {
          const rawText = buildRawText(meta);
          const docId = await createDocument({
            userId: SYSTEM_USER_ID,
            title: meta.title,
            sourceType: "paste",
            rawText,
          });
          await updateAutoIngestedPaperStatus(pmid, "submitted", {
            documentId: docId,
          });
          // Fire-and-forget — pipeline runs async, emits VerdictEvents to trainingBridge
          runAnalysisPipeline(docId, rawText, SYSTEM_USER_ID)
            .then(() =>
              updateAutoIngestedPaperStatus(pmid, "complete", {
                documentId: docId,
              })
            )
            .catch((err: unknown) =>
              updateAutoIngestedPaperStatus(pmid, "failed", {
                errorMessage: String(err),
              })
            );
          domainResult.submitted++;
        } catch (err) {
          await updateAutoIngestedPaperStatus(pmid, "failed", {
            errorMessage: String(err),
          });
          domainResult.errors.push(
            `Pipeline submission failed for PMID ${pmid}: ${String(err)}`
          );
        }
      }
    }

    results.push(domainResult);
    log.info(
      `[domainIngest] ${domainConfig.label}: ${domainResult.submitted} submitted, ` +
        `${domainResult.skipped} skipped, ${domainResult.errors.length} errors`
    );
  }

  return results;
}

/**
 * Express handler for POST /api/scheduled/domain-ingest
 * Fires the 5-domain ingest loop and returns per-domain results.
 */
export async function domainIngestJobHandler(
  req: Request,
  res: Response
): Promise<void> {
  // Simple bearer token check — same pattern as pubmedIngestJob
  const authHeader = req.headers["authorization"] ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (ENV.forgeApiKey && token !== ENV.forgeApiKey) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    log.info("[domainIngest] Starting 5-domain ingest run");
    const domainResults = await runDomainIngest();
    const totals = domainResults.reduce(
      (acc, d) => ({
        queriesRun: acc.queriesRun + d.queriesRun,
        newPapersFound: acc.newPapersFound + d.newPapersFound,
        submitted: acc.submitted + d.submitted,
        skipped: acc.skipped + d.skipped,
        errors: acc.errors + d.errors.length,
      }),
      { queriesRun: 0, newPapersFound: 0, submitted: 0, skipped: 0, errors: 0 }
    );
    res.json({
      ok: true,
      domains: domainResults,
      totals,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    log.error("[domainIngest] Fatal error:", errData(err));
    res.status(500).json({ ok: false, error: String(err) });
  }
}
