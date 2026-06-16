/**
 * ncbiAdapter.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * NCBI E-utilities adapter replacing EuropePMC.
 *
 * Pipeline:
 *   1. esearch  → get up to `limit` PMIDs for a query
 *   2. efetch   → fetch ALL PMIDs in ONE batched request (comma-separated IDs)
 *   3. bestSentence → score each sentence against the claim, return the best
 *
 * Improvements over v1:
 *   - Batched efetch: 1 HTTP request instead of N parallel requests
 *   - NCBI_API_KEY: 10 req/s instead of 3 req/s when env var is set
 *   - LRU cache: 256-entry in-memory cache keyed on query+claim
 *   - Timeout: 5s (was 12s with EuropePMC)
 */
import type { PubMedResult } from "./autonomousIngest";

const ESEARCH = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi";
const EFETCH = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi";
const TIMEOUT_MS = 5_000;

/** Append &api_key=... when NCBI_API_KEY is set (raises cap from 3→10 req/s) */
function apiKeySuffix(): string {
  const k = process.env.NCBI_API_KEY;
  return k ? `&api_key=${encodeURIComponent(k)}` : "";
}

// ─── Simple LRU cache ─────────────────────────────────────────────────────────
const LRU_MAX = 256;
const _lruCache = new Map<string, PubMedResult[]>();
function lruGet(key: string): PubMedResult[] | undefined {
  const v = _lruCache.get(key);
  if (v !== undefined) {
    // refresh recency: delete + re-insert
    _lruCache.delete(key);
    _lruCache.set(key, v);
  }
  return v;
}
function lruSet(key: string, value: PubMedResult[]): void {
  if (_lruCache.size >= LRU_MAX) {
    // evict oldest (first) entry
    const oldest = _lruCache.keys().next().value;
    if (oldest !== undefined) _lruCache.delete(oldest);
  }
  _lruCache.set(key, value);
}

// ─── esearch: get PMIDs ───────────────────────────────────────────────────────
async function esearch(query: string, retmax: number): Promise<string[]> {
  const url =
    `${ESEARCH}?db=pubmed&retmode=json&retmax=${retmax}` +
    `&term=${encodeURIComponent(query)}${apiKeySuffix()}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) return [];
  const json = (await res.json()) as {
    esearchresult?: { idlist?: string[] };
  };
  return json.esearchresult?.idlist ?? [];
}

// ─── efetch: batch fetch ALL PMIDs in one request ────────────────────────────
interface EfetchRecord {
  pmid: string;
  title: string;
  abstract: string;
  authors: string[];
  journal: string;
  year: number | undefined;
}

async function efetchBatch(pmids: string[]): Promise<EfetchRecord[]> {
  if (pmids.length === 0) return [];
  const ids = pmids.join(",");
  const url = `${EFETCH}?db=pubmed&retmode=xml&rettype=abstract&id=${ids}${apiKeySuffix()}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) return [];
    const xml = await res.text();
    return parseArticleSet(xml, pmids);
  } catch {
    return [];
  }
}

/** Split the XML response into per-article chunks and parse each one */
function parseArticleSet(xml: string, pmids: string[]): EfetchRecord[] {
  // Split on <PubmedArticle> boundaries
  const chunks = xml.split(/<PubmedArticle[\s>]/);
  const records: EfetchRecord[] = [];
  for (let i = 1; i < chunks.length; i++) {
    const chunk = chunks[i];
    const pmid = extractXml(chunk, "PMID") ?? pmids[i - 1] ?? String(i);
    const title = extractXml(chunk, "ArticleTitle") ?? "Untitled";
    const abstract = extractXml(chunk, "AbstractText") ?? "";
    const journal =
      extractXml(chunk, "ISOAbbreviation") ?? extractXml(chunk, "Title") ?? "";
    const year = extractYear(chunk);
    const authors = extractAuthors(chunk);
    records.push({ pmid, title, abstract, authors, journal, year });
  }
  return records;
}

// ─── XML helpers (no DOM dependency) ─────────────────────────────────────────
export function extractXml(xml: string, tag: string): string | undefined {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));
  return m ? m[1].replace(/<[^>]+>/g, "").trim() : undefined;
}

function extractYear(xml: string): number | undefined {
  const m = xml.match(/<PubDate>[\s\S]*?<Year>(\d{4})<\/Year>/);
  return m ? parseInt(m[1], 10) : undefined;
}

function extractAuthors(xml: string): string[] {
  const matches = Array.from(xml.matchAll(/<LastName>([^<]+)<\/LastName>/g));
  return matches.slice(0, 5).map(m => m[1]);
}

// ─── Sentence-level provenance ────────────────────────────────────────────────
export function bestSentence(abstract: string, claim: string): string {
  if (!abstract) return "";
  const sentences = abstract
    .replace(/([.!?])\s+/g, "$1\n")
    .split("\n")
    .map(s => s.trim())
    .filter(s => s.length > 20);
  if (sentences.length === 0) return abstract.slice(0, 300);
  const claimWords = new Set(
    claim
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter(w => w.length >= 4)
  );
  let best = sentences[0];
  let bestScore = 0;
  for (const s of sentences) {
    const lower = s.toLowerCase();
    let score = 0;
    claimWords.forEach(w => {
      if (lower.includes(w)) score++;
    });
    if (score > bestScore) {
      bestScore = score;
      best = s;
    }
  }
  return best;
}

// ─── Public API ───────────────────────────────────────────────────────────────
export async function fetchNcbiResults(
  query: string,
  claim: string,
  limit = 5
): Promise<PubMedResult[]> {
  const cacheKey = `${query}|||${claim}|||${limit}`;
  const cached = lruGet(cacheKey);
  if (cached) return cached;

  let pmids: string[];
  try {
    pmids = await esearch(query, limit);
  } catch {
    return [];
  }
  if (pmids.length === 0) return [];

  const records = await efetchBatch(pmids);
  const results = records
    .filter(r => r.abstract.length > 0)
    .map(r => ({
      pmid: r.pmid,
      title: r.title,
      abstractSnippet: bestSentence(r.abstract, claim),
      citationUrl: `https://pubmed.ncbi.nlm.nih.gov/${r.pmid}/`,
      authors: r.authors,
      journal: r.journal,
      year: r.year,
    }));

  lruSet(cacheKey, results);
  return results;
}

/** Exported for testing only */
export { lruGet, lruSet };
