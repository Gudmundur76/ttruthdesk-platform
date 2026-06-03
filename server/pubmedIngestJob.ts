/**
 * pubmedIngestJob.ts
 *
 * Scheduled heartbeat handler: POST /api/scheduled/pubmed-ingest
 *
 * Queries PubMed for recent papers from a configurable list of search queries
 * (default: deCODE Genetics), deduplicates against the auto_ingested_papers
 * table, fetches abstracts, and submits new papers through the audit pipeline.
 *
 * Designed to run weekly via Manus Heartbeat cron.
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

// ── Search queries to run on each job execution ─────────────────────────────
const SEARCH_QUERIES = [
  "deCODE genetics[Affiliation] AND protein[Title/Abstract]",
  "deCODE genetics[Affiliation] AND structure[Title/Abstract]",
  "Stefansson K[Author] AND protein structure",
];

const NCBI_BASE = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";
const TOOL = "protein-truth-desk";
const EMAIL = "info@protein-truth-desk.com";
const MAX_PER_QUERY = 5; // fetch at most 5 new papers per query per run

// ── System user ID for auto-ingested documents ───────────────────────────────
// Use 1 as the system sentinel. MySQL auto-increment starts at 1, so 0 is never
// a real user row — but 0 can cause FK issues in strict mode. Using 1 is safe
// because the first real user inserted will also be id=1, but the documents
// table has no FK constraint on userId (intentional — system docs are valid).
const SYSTEM_USER_ID = 1;

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

async function searchPubmed(query: string, retmax = MAX_PER_QUERY): Promise<string[]> {
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
    const title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, "").trim() : "";
    if (!title) return null;

    const abstractMatches = Array.from(
      xml.matchAll(/<AbstractText(?:[^>]* Label="([^"]*)"|[^>]*)>([\s\S]*?)<\/AbstractText>/g)
    );
    const abstractParts: string[] = [];
    for (const m of abstractMatches) {
      const label = m[1] ? `${m[1]}: ` : "";
      const text = m[2].replace(/<[^>]+>/g, "").trim();
      if (text) abstractParts.push(label + text);
    }

    const authorMatches = Array.from(xml.matchAll(/<LastName>([^<]+)<\/LastName>/g));
    const authors = authorMatches
      .slice(0, 8)
      .map((m) => m[1])
      .join(", ");
    const authorSuffix = authorMatches.length > 8 ? " et al." : "";

    const journalMatch = xml.match(/<ISOAbbreviation>([^<]+)<\/ISOAbbreviation>/);
    const yearMatch = xml.match(/<PubDate>[\s\S]*?<Year>([0-9]{4})<\/Year>/);
    const doiMatch = xml.match(/<ELocationID EIdType="doi"[^>]*>([^<]+)<\/ELocationID>/);

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
    meta.journal ? `Journal: ${meta.journal}${meta.pubYear ? ` (${meta.pubYear})` : ""}` : "",
    meta.doi ? `DOI: ${meta.doi}` : "",
    `PMID: ${meta.pmid}`,
    "",
    meta.abstractText || "[Abstract not available]",
  ]
    .filter(Boolean)
    .join("\n");
}

export async function pubmedIngestJobHandler(req: Request, res: Response): Promise<void> {
  // Simple bearer token check — same pattern as the monitoring job
  const authHeader = req.headers["authorization"] ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (ENV.forgeApiKey && token !== ENV.forgeApiKey) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const results = {
    queriesRun: 0,
    newPapersFound: 0,
    submitted: 0,
    skipped: 0,
    errors: [] as string[],
  };

  try {
    for (const query of SEARCH_QUERIES) {
      results.queriesRun++;
      let pmids: string[] = [];
      try {
        pmids = await searchPubmed(query);
        // Rate limit: NCBI allows 3 req/s without API key
        await new Promise((r) => setTimeout(r, 400));
      } catch (err) {
        results.errors.push(`Search failed for query "${query}": ${String(err)}`);
        continue;
      }

      for (const pmid of pmids) {
        // Skip if already ingested
        const existing = await getAutoIngestedPaperByPmid(pmid);
        if (existing) {
          results.skipped++;
          continue;
        }

        results.newPapersFound++;

        // Fetch metadata
        let meta: PaperMeta | null = null;
        try {
          meta = await fetchPaperMeta(pmid);
          await new Promise((r) => setTimeout(r, 400));
        } catch (err) {
          results.errors.push(`Fetch failed for PMID ${pmid}: ${String(err)}`);
          continue;
        }

        if (!meta) {
          results.errors.push(`No metadata for PMID ${pmid}`);
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

          await updateAutoIngestedPaperStatus(pmid, "submitted", { documentId: docId });

          // Fire-and-forget — pipeline runs async
          runAnalysisPipeline(docId, rawText, SYSTEM_USER_ID)
            .then(() => updateAutoIngestedPaperStatus(pmid, "complete", { documentId: docId }))
            .catch((err: unknown) =>
              updateAutoIngestedPaperStatus(pmid, "failed", {
                errorMessage: String(err),
              })
            );

          results.submitted++;
        } catch (err) {
          await updateAutoIngestedPaperStatus(pmid, "failed", {
            errorMessage: String(err),
          });
          results.errors.push(`Pipeline submission failed for PMID ${pmid}: ${String(err)}`);
        }
      }
    }

    res.json({
      ok: true,
      ...results,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[pubmedIngestJob] Fatal error:", err);
    res.status(500).json({ ok: false, error: String(err) });
  }
}
