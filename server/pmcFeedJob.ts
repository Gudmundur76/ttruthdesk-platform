/**
 * pmcFeedJob.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * POST /api/scheduled/pmc-feed
 *
 * Nightly PMC Open Access bulk feed connector.
 *
 * Strategy:
 *   1. For each configured vertical, run ESearch against PubMed/PMC with the
 *      vertical's MeSH term set, filtered to papers added in the last N days
 *      (default: 2 days to allow for NCBI indexing lag).
 *   2. Fetch structured abstract XML for each new PMID via EFetch.
 *   3. Apply the signal-density quality gate (≥ MIN_SIGNAL_DENSITY signals).
 *   4. Deduplicate against auto_ingested_papers (skip already-ingested PMIDs).
 *   5. Insert into auto_ingested_papers and fire runAnalysisPipeline async.
 *
 * Rate limits: NCBI allows 3 requests/second without an API key. We enforce
 * 400ms inter-request delays throughout.
 *
 * This job is idempotent: re-running it for the same date window is safe
 * because every PMID is checked against the DB before insertion.
 */

import type { Request, Response } from "express";
import {
  upsertAutoIngestedPaper,
  updateAutoIngestedPaperStatus,
  getAutoIngestedPaperByPmid,
  createDocument,
} from "./db";
import { runAnalysisPipeline } from "./analysisPipeline";
import { computeSignalDensity } from "./discoveryLoopJob";
import { notifyOwner } from "./_core/notification";
import { ENV } from "./_core/env";
import {
  VERTICAL_FEED_CONFIGS,
  getVerticalFeedConfig,
  type VerticalFeedConfig,
} from "./verticalFeedConfig";
export { VERTICAL_FEED_CONFIGS, getVerticalFeedConfig } from "./verticalFeedConfig";


// ─── Constants ────────────────────────────────────────────────────────────────

const SYSTEM_USER_ID = 1;
const MIN_SIGNAL_DENSITY = 2;
const NCBI_RATE_DELAY_MS = 420; // stay safely under 3 req/s
const DEFAULT_LOOKBACK_DAYS = 2; // fetch papers added in last 2 days

// VERTICAL_FEED_CONFIGS is now imported from verticalFeedConfig.ts (shared module)

// ─── Types ────────────────────────────────────────────────────────────────────

interface PaperMeta {
  pmid: string;
  doi: string | null;
  title: string;
  authors: string;
  journal: string;
  pubYear: string;
  abstractText: string;
}

interface FeedResult {
  vertical: string;
  queriesRun: number;
  candidatesFound: number;
  passedQualityGate: number;
  alreadyIngested: number;
  submitted: number;
  failed: number;
  errors: string[];
}

// ─── NCBI E-utilities helpers ─────────────────────────────────────────────────

/**
 * ESearch: returns up to `retmax` PMIDs for papers matching `query` that were
 * added to PubMed within the last `lookbackDays` days.
 */
async function esearch(
  query: string,
  retmax: number,
  lookbackDays: number
): Promise<string[]> {
  const url = new URL("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi");
  url.searchParams.set("db", "pubmed");
  url.searchParams.set("term", query);
  url.searchParams.set("retmax", String(retmax));
  url.searchParams.set("retmode", "json");
  url.searchParams.set("sort", "date");
  url.searchParams.set("datetype", "edat");
  url.searchParams.set("reldate", String(lookbackDays));
  url.searchParams.set("tool", "TruthDeskFeed");
  url.searchParams.set("email", "pippinlitli@hotmail.com");

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`ESearch HTTP ${res.status}`);
  const json = (await res.json()) as {
    esearchresult?: { idlist?: string[] };
  };
  return json.esearchresult?.idlist ?? [];
}

/**
 * EFetch: retrieves structured abstract XML for a batch of PMIDs (max 200).
 * Returns a map of pmid → PaperMeta.
 */
async function efetchBatch(pmids: string[]): Promise<Map<string, PaperMeta>> {
  if (pmids.length === 0) return new Map();

  const url = new URL("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi");
  url.searchParams.set("db", "pubmed");
  url.searchParams.set("id", pmids.join(","));
  url.searchParams.set("rettype", "xml");
  url.searchParams.set("retmode", "xml");
  url.searchParams.set("tool", "TruthDeskFeed");
  url.searchParams.set("email", "pippinlitli@hotmail.com");

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`EFetch HTTP ${res.status}`);
  const xml = await res.text();

  return parseEfetchXml(xml);
}

/**
 * Parse PubMed EFetch XML response into a map of pmid → PaperMeta.
 * Handles both structured (labelled) and unstructured AbstractText elements.
 */
function parseEfetchXml(xml: string): Map<string, PaperMeta> {
  const result = new Map<string, PaperMeta>();

  // Split by PubmedArticle to process each record independently
  const articleBlocks = xml.match(/<PubmedArticle>[\s\S]*?<\/PubmedArticle>/g) ?? [];

  for (const block of articleBlocks) {
    try {
      // PMID
      const pmidMatch = block.match(/<PMID[^>]*>(\d+)<\/PMID>/);
      if (!pmidMatch) continue;
      const pmid = pmidMatch[1];

      // Title
      const titleMatch = block.match(/<ArticleTitle[^>]*>([\s\S]*?)<\/ArticleTitle>/);
      const title = titleMatch ? stripTags(titleMatch[1]) : "";
      if (!title) continue;

      // Abstract — collect all AbstractText sections
      const abstractMatches = Array.from(
        block.matchAll(/<AbstractText(?:[^>]* Label="([^"]*)"|[^>]*)>([\s\S]*?)<\/AbstractText>/g)
      );
      const abstractParts: string[] = [];
      for (const m of abstractMatches) {
        const label = m[1] ? `${m[1]}: ` : "";
        const text = stripTags(m[2]);
        if (text) abstractParts.push(label + text);
      }

      // Authors (first 8 + et al.)
      const authorMatches = Array.from(block.matchAll(/<LastName>([^<]+)<\/LastName>/g));
      const authors =
        authorMatches
          .slice(0, 8)
          .map((m) => m[1])
          .join(", ") + (authorMatches.length > 8 ? " et al." : "");

      // Journal
      const journalMatch = block.match(/<ISOAbbreviation>([^<]+)<\/ISOAbbreviation>/);

      // Year
      const yearMatch = block.match(/<PubDate>[\s\S]*?<Year>([0-9]{4})<\/Year>/);

      // DOI
      const doiMatch = block.match(/<ELocationID EIdType="doi"[^>]*>([^<]+)<\/ELocationID>/);

      result.set(pmid, {
        pmid,
        doi: doiMatch ? doiMatch[1].trim() : null,
        title,
        authors,
        journal: journalMatch ? journalMatch[1] : "",
        pubYear: yearMatch ? yearMatch[1] : "",
        abstractText: abstractParts.join("\n\n"),
      });
    } catch {
      // Skip malformed records
    }
  }

  return result;
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, "").trim();
}

function buildRawText(meta: PaperMeta, fullTextSections?: string): string {
  const parts = [
    `Title: ${meta.title}`,
    meta.authors ? `Authors: ${meta.authors}` : "",
    meta.journal ? `Journal: ${meta.journal}${meta.pubYear ? ` (${meta.pubYear})` : ""}` : "",
    meta.doi ? `DOI: ${meta.doi}` : "",
    `PMID: ${meta.pmid}`,
    "",
    meta.abstractText || "[Abstract not available]",
  ];
  if (fullTextSections) {
    parts.push("", "--- Full Text Sections (PMC OA) ---", fullTextSections);
  }
  return parts.filter(Boolean).join("\n");
}

/**
 * Attempt to fetch Methods and Results sections from PMC OA XML for a given PMCID.
 * Returns null if the paper is not in PMC OA or if the fetch fails.
 * This is best-effort — the abstract is always the primary source.
 */
async function fetchPmcFullTextSections(pmcid: string): Promise<string | null> {
  try {
    const url = new URL("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi");
    url.searchParams.set("db", "pmc");
    url.searchParams.set("id", pmcid);
    url.searchParams.set("rettype", "xml");
    url.searchParams.set("retmode", "xml");
    url.searchParams.set("tool", "TruthDeskFeed");
    url.searchParams.set("email", "pippinlitli@hotmail.com");

    const res = await fetch(url.toString());
    if (!res.ok) return null;
    const xml = await res.text();

    // Extract Methods and Results section text from JATS XML
    const sections: string[] = [];
    const sectionMatches = Array.from(
      xml.matchAll(
        /<sec[^>]*>\s*<title>([^<]*(?:method|result|material|discussion)[^<]*)<\/title>([\s\S]*?)<\/sec>/gi
      )
    );
    for (const m of sectionMatches) {
      const sectionTitle = m[1].trim();
      const sectionBody = stripTags(m[2]).replace(/\s+/g, " ").trim();
      if (sectionBody.length > 50) {
        sections.push(`${sectionTitle}:\n${sectionBody.slice(0, 2000)}`);
      }
    }
    return sections.length > 0 ? sections.join("\n\n") : null;
  } catch {
    return null;
  }
}

/**
 * Attempt to resolve a PMID to a PMCID using the NCBI ID Converter API.
 * Returns null if no PMCID is available (paper not in PMC OA).
 */
async function pmidToPmcid(pmid: string): Promise<string | null> {
  try {
    const url = `https://www.ncbi.nlm.nih.gov/pmc/utils/idconv/v1.0/?ids=${pmid}&format=json&tool=TruthDeskFeed&email=pippinlitli@hotmail.com`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const json = (await res.json()) as {
      records?: Array<{ pmcid?: string; status?: string }>;
    };
    const record = json.records?.[0];
    if (!record || record.status === "error" || !record.pmcid) return null;
    // PMCID is returned as "PMC1234567" — strip the prefix for EFetch
    return record.pmcid.replace(/^PMC/i, "");
  } catch {
    return null;
  }
}

// ─── Per-vertical feed runner ─────────────────────────────────────────────────

async function runVerticalFeed(
  config: VerticalFeedConfig,
  lookbackDays: number
): Promise<FeedResult> {
  const result: FeedResult = {
    vertical: config.domainKey,
    queriesRun: 0,
    candidatesFound: 0,
    passedQualityGate: 0,
    alreadyIngested: 0,
    submitted: 0,
    failed: 0,
    errors: [],
  };

  // Collect unique PMIDs across all queries for this vertical
  const allPmids = new Set<string>();

  for (const query of config.meshQueries) {
    result.queriesRun++;
    try {
      const pmids = await esearch(query, config.maxResultsPerQuery, lookbackDays);
      for (const p of pmids) allPmids.add(p);
      await delay(NCBI_RATE_DELAY_MS);
    } catch (err) {
      result.errors.push(`ESearch failed for vertical ${config.domainKey}: ${String(err)}`);
    }
  }

  result.candidatesFound = allPmids.size;
  if (allPmids.size === 0) return result;

  // Batch fetch metadata in groups of 100 (NCBI recommends ≤ 200 per request)
  const pmidList = Array.from(allPmids);
  const BATCH_SIZE = 100;

  for (let i = 0; i < pmidList.length; i += BATCH_SIZE) {
    const batch = pmidList.slice(i, i + BATCH_SIZE);
    let metaMap: Map<string, PaperMeta>;

    try {
      metaMap = await efetchBatch(batch);
      await delay(NCBI_RATE_DELAY_MS);
    } catch (err) {
      result.errors.push(`EFetch batch failed: ${String(err)}`);
      continue;
    }

    for (const pmid of batch) {
      const meta = metaMap.get(pmid);
      if (!meta) continue;

      // Quality gate: signal density check
      const signalText = `${meta.title} ${meta.abstractText}`;
      const density = computeSignalDensity(signalText);
      if (density < MIN_SIGNAL_DENSITY) continue;
      result.passedQualityGate++;

      // Deduplication: skip if already in the DB
      const existing = await getAutoIngestedPaperByPmid(pmid);
      if (existing) {
        result.alreadyIngested++;
        continue;
      }

      // Insert record and submit to pipeline
      try {
        await upsertAutoIngestedPaper({
          pmid: meta.pmid,
          doi: meta.doi ?? undefined,
          title: meta.title,
          authors: meta.authors,
          journal: meta.journal,
          pubYear: meta.pubYear,
          searchQuery: `pmc-feed:${config.domainKey}`,
          status: "fetched",
          isPublic: true,
          verticalDomain: config.domainKey,
          ingestSource: "pubmed",
        });

        // Best-effort PMC OA full-text fetch: resolve PMID → PMCID → Methods/Results sections
        let fullTextSections: string | null = null;
        try {
          const pmcid = await pmidToPmcid(pmid);
          if (pmcid) {
            await delay(NCBI_RATE_DELAY_MS);
            fullTextSections = await fetchPmcFullTextSections(pmcid);
          }
        } catch {
          // Non-fatal — abstract is sufficient
        }
        const rawText = buildRawText(meta, fullTextSections ?? undefined);
        const docId = await createDocument({
          userId: SYSTEM_USER_ID,
          title: meta.title,
          sourceType: "paste",
          rawText,
          verticalDomain: config.domainKey,
        });

        await updateAutoIngestedPaperStatus(pmid, "submitted", { documentId: docId });

        // Fire-and-forget — pipeline runs async
        runAnalysisPipeline(docId, rawText, SYSTEM_USER_ID)
          .then(() => updateAutoIngestedPaperStatus(pmid, "complete", { documentId: docId }))
          .catch((err: unknown) =>
            updateAutoIngestedPaperStatus(pmid, "failed", { errorMessage: String(err) })
          );

        result.submitted++;
      } catch (err) {
        result.failed++;
        result.errors.push(`Pipeline submission failed for PMID ${pmid}: ${String(err)}`);
        try {
          await updateAutoIngestedPaperStatus(pmid, "failed", { errorMessage: String(err) });
        } catch {
          // Best-effort status update
        }
      }

      // Rate limit between individual DB/pipeline operations
      await delay(50);
    }
  }

  return result;
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── HTTP handler ─────────────────────────────────────────────────────────────

export async function pmcFeedJobHandler(req: Request, res: Response): Promise<void> {
  // Auth: bearer token check (same pattern as other scheduled handlers)
  const authHeader = req.headers["authorization"] ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (ENV.forgeApiKey && token !== ENV.forgeApiKey) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  // Allow caller to override lookback window.
  // Normal nightly runs: capped at 30 days.
  // Bulk seed runs (allVerticals=true): capped at 365 days.
  const isBulkSeed = req.body?.allVerticals === true;
  const maxLookback = isBulkSeed ? 365 : 30;
  const lookbackDays =
    typeof req.body?.lookbackDays === "number"
      ? Math.min(Math.max(1, req.body.lookbackDays), maxLookback)
      : DEFAULT_LOOKBACK_DAYS;

  // Allow caller to restrict to a single vertical (useful for testing)
  const targetVertical: string | undefined = req.body?.vertical;
  const configs = targetVertical
    ? VERTICAL_FEED_CONFIGS.filter((c) => c.domainKey === targetVertical)
    : VERTICAL_FEED_CONFIGS;

  if (configs.length === 0) {
    res.status(400).json({ error: `Unknown vertical: ${targetVertical}` });
    return;
  }

  const allResults: FeedResult[] = [];
  let totalSubmitted = 0;

  try {
    for (const config of configs) {
      const result = await runVerticalFeed(config, lookbackDays);
      allResults.push(result);
      totalSubmitted += result.submitted;
    }

    // Notify owner if new papers were submitted
    if (totalSubmitted > 0) {
      const summary = allResults
        .map(
          (r) =>
            `${r.vertical}: ${r.submitted} submitted (${r.candidatesFound} found, ${r.passedQualityGate} passed gate, ${r.alreadyIngested} already ingested)`
        )
        .join("\n");
      await notifyOwner({
        title: `PMC Feed: ${totalSubmitted} new paper${totalSubmitted === 1 ? "" : "s"} ingested`,
        content: `PMC Open Access nightly feed completed.\n\n${summary}`,
      }).catch(() => {
        // Non-fatal
      });
    }

    res.json({
      ok: true,
      lookbackDays,
      totalSubmitted,
      results: allResults,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[pmcFeedJob] Fatal error:", err);
    res.status(500).json({ ok: false, error: String(err) });
  }
}
