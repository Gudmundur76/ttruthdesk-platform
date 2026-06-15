/**
 * Phase 117 — Verbatim Evidence Passages
 *
 * Provides utilities for extracting and scoring verbatim text excerpts from
 * PubMed abstract snippets, so that MCP `verify_claim` responses include
 * citable text rather than returning `excerpt: null`.
 *
 * Design decisions:
 *  - No LLM call: excerpt selection uses keyword-overlap scoring (O(n) per sentence)
 *    which is deterministic, fast, and free.
 *  - The `abstractSnippet` field already present on PubMedResult (first 400 chars
 *    from Europe PMC) is the primary source. No additional HTTP calls are needed.
 *  - Excerpts are capped at 500 characters to keep MCP responses compact.
 *  - `selectBestPassage` picks the single best excerpt across all evidence items
 *    for persistence into `claims.sourcePassage`.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface EvidenceItem {
  sourceId: string;
  sourceUrl: string;
  excerpt: string | null;
  confidenceScore: number;
  database: string;
  title?: string;
  publicationYear?: number;
}

export interface BestPassage {
  excerpt: string;
  sourceId: string;
  score: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_EXCERPT_CHARS = 500;

// Common English stop-words excluded from keyword matching to improve signal quality
const STOP_WORDS = new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "but",
  "in",
  "on",
  "at",
  "to",
  "for",
  "of",
  "with",
  "by",
  "from",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "has",
  "have",
  "had",
  "this",
  "that",
  "it",
  "its",
  "as",
  "not",
  "no",
  "can",
  "may",
  "will",
  "would",
  "could",
  "should",
  "do",
  "does",
  "did",
]);

// ─── Keyword extraction ───────────────────────────────────────────────────────

function extractKeywords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s.åÅ]/g, " ")
      .split(/\s+/)
      .filter(w => w.length > 2 && !STOP_WORDS.has(w))
  );
}

// ─── Sentence splitter ────────────────────────────────────────────────────────

function splitSentences(text: string): string[] {
  // Split on ". " or ".\n" followed by a capital letter, or end of string
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z])/)
    .map(s => s.trim())
    .filter(s => s.length > 0);
}

// ─── Core: extractBestExcerpt ─────────────────────────────────────────────────

/**
 * Selects the sentence from `abstract` that has the highest keyword overlap
 * with `claimText`. Falls back to the first sentence when no keywords match.
 * Returns null when the abstract is empty or whitespace-only.
 */
export function extractBestExcerpt(
  claimText: string,
  abstract: string
): string | null {
  const trimmed = abstract.trim();
  if (!trimmed) return null;

  const claimKeywords = extractKeywords(claimText);
  const sentences = splitSentences(trimmed);

  if (sentences.length === 0) return null;
  if (sentences.length === 1) {
    return truncate(sentences[0]);
  }

  let bestSentence = sentences[0]; // fallback: first sentence
  let bestScore = 0;

  for (const sentence of sentences) {
    const sentenceKeywords = extractKeywords(sentence);
    let overlap = 0;
    claimKeywords.forEach(kw => {
      if (sentenceKeywords.has(kw)) overlap++;
    });
    if (overlap > bestScore) {
      bestScore = overlap;
      bestSentence = sentence;
    }
  }

  return truncate(bestSentence);
}

function truncate(text: string): string {
  if (text.length <= MAX_EXCERPT_CHARS) return text;
  return text.slice(0, MAX_EXCERPT_CHARS) + "...";
}

// ─── buildEvidenceWithExcerpts ────────────────────────────────────────────────

/**
 * Compute a per-item confidence score based on keyword overlap between
 * the claim text and the evidence item's title + abstract snippet.
 * Returns a value in [0.1, 1.0] — minimum 0.1 so items are never invisible.
 */
function scoreEvidenceItem(
  claimText: string,
  title: string | undefined,
  snippet: string | undefined
): number {
  const claimKeywords = extractKeywords(claimText);
  if (claimKeywords.size === 0) return 0.5;
  const combined = `${title ?? ""} ${snippet ?? ""}`;
  const itemKeywords = extractKeywords(combined);
  let overlap = 0;
  claimKeywords.forEach(kw => {
    if (itemKeywords.has(kw)) overlap++;
  });
  // Jaccard-style: overlap / union, then remap to [0.1, 1.0]
  const union = claimKeywords.size + itemKeywords.size - overlap;
  const raw = union > 0 ? overlap / union : 0;
  return Math.max(0.1, Math.min(1.0, Math.round(raw * 10) / 10));
}

export function buildEvidenceWithExcerpts(
  claimText: string,
  pubmedResults: Array<{
    pmid: string;
    title?: string;
    abstractSnippet?: string;
    citationUrl?: string;
    authors?: string[];
    journal?: string;
    year?: number;
  }>,
  _claimConfidence: number
): EvidenceItem[] {
  return pubmedResults.map(p => {
    const snippet = p.abstractSnippet ?? "";
    const excerpt = snippet ? extractBestExcerpt(claimText, snippet) : null;
    const perItemScore = scoreEvidenceItem(claimText, p.title, snippet);
    return {
      sourceId: `pmid:${p.pmid}`,
      sourceUrl:
        p.citationUrl ??
        (p.pmid ? `https://pubmed.ncbi.nlm.nih.gov/${p.pmid}/` : ""),
      excerpt,
      confidenceScore: perItemScore,
      database: "pubmed",
      title: p.title,
      publicationYear: p.year,
    };
  });
}

// ─── selectBestPassage ────────────────────────────────────────────────────────

/**
 * Picks the single best evidence excerpt across all items for persistence
 * into `claims.sourcePassage`. Returns null when all excerpts are null.
 */
export function selectBestPassage(
  claimText: string,
  evidence: EvidenceItem[]
): BestPassage | null {
  const claimKeywords = extractKeywords(claimText);
  let best: BestPassage | null = null;
  let bestScore = -1;

  for (const item of evidence) {
    if (!item.excerpt) continue;
    const excerptKeywords = extractKeywords(item.excerpt);
    let score = 0;
    claimKeywords.forEach(kw => {
      if (excerptKeywords.has(kw)) score++;
    });
    if (score > bestScore) {
      bestScore = score;
      best = { excerpt: item.excerpt, sourceId: item.sourceId, score };
    }
  }

  return best;
}
