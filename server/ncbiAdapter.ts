/**
 * ncbiAdapter.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * NCBI E-utilities adapter replacing EuropePMC.
 *
 * Pipeline:
 *   1. esearch  → get up to `limit` PMIDs for a query
 *   2. efetch   → fetch full abstracts in parallel (one request per PMID)
 *   3. bestSentence → score each sentence against the claim, return the best
 *
 * Latency target: <500ms for cached queries, <1.5s cold.
 * Timeout: 5s per request (was 12s with EuropePMC).
 */
import type { PubMedResult } from "./autonomousIngest";

const ESEARCH = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi";
const EFETCH = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi";
const TIMEOUT_MS = 5_000;

// ─── esearch: get PMIDs ───────────────────────────────────────────────────────
async function esearch(query: string, retmax: number): Promise<string[]> {
  const url =
    `${ESEARCH}?db=pubmed&retmode=json&retmax=${retmax}` +
    `&term=${encodeURIComponent(query)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) return [];
  const json = (await res.json()) as {
    esearchresult?: { idlist?: string[] };
  };
  return json.esearchresult?.idlist ?? [];
}

// ─── efetch: fetch one abstract ──────────────────────────────────────────────
interface EfetchRecord {
  pmid: string;
  title: string;
  abstract: string;
  authors: string[];
  journal: string;
  year: number | undefined;
}

async function efetchOne(pmid: string): Promise<EfetchRecord | null> {
  const url = `${EFETCH}?db=pubmed&retmode=xml&rettype=abstract&id=${pmid}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) return null;
    const xml = await res.text();
    const title = extractXml(xml, "ArticleTitle") ?? "Untitled";
    const abstract = extractXml(xml, "AbstractText") ?? "";
    const journal =
      extractXml(xml, "ISOAbbreviation") ?? extractXml(xml, "Title") ?? "";
    const year = extractYear(xml);
    const authors = extractAuthors(xml);
    return { pmid, title, abstract, authors, journal, year };
  } catch {
    return null;
  }
}

// ─── XML helpers (no DOM dependency) ─────────────────────────────────────────
function extractXml(xml: string, tag: string): string | undefined {
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
  let pmids: string[];
  try {
    pmids = await esearch(query, limit);
  } catch {
    return [];
  }
  if (pmids.length === 0) return [];

  const records = await Promise.all(pmids.map(id => efetchOne(id)));
  return records
    .filter((r): r is EfetchRecord => r !== null && r.abstract.length > 0)
    .map(r => ({
      pmid: r.pmid,
      title: r.title,
      abstractSnippet: bestSentence(r.abstract, claim),
      citationUrl: `https://pubmed.ncbi.nlm.nih.gov/${r.pmid}/`,
      authors: r.authors,
      journal: r.journal,
      year: r.year,
    }));
}
