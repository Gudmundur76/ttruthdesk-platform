/**
 * relevanceUtils.ts — Sprint 36 (Relevance Quality)
 *
 * Shared post-retrieval relevance gate for all vertical adapters that perform
 * free-text search. Prevents topically-adjacent but claim-irrelevant results
 * from being returned as evidence.
 *
 * Design:
 *  - Keyword extraction: lowercased, stop-word filtered, min 3 chars.
 *  - Jaccard-style overlap score: overlap / union, remapped to [0, 1].
 *  - `isRelevant(claimText, title, abstract, threshold)` — the single gate.
 *  - `relevanceConfidenceScore(claimText, title, abstract)` — score for
 *    use as a multiplier on the adapter's base confidence.
 *  - Threshold defaults: 0.08 minimum (anything below is a false positive).
 *    Adapters should use MIN_RELEVANCE_THRESHOLD for consistency.
 *
 * This module is intentionally dependency-free (no imports from other server
 * files) so it can be used anywhere in the adapter tree without circular deps.
 */

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Minimum Jaccard overlap required for a free-text search result to be
 * considered relevant to the claim. Below this threshold the adapter must
 * return `found: false` with a `low_relevance` flag rather than a false
 * positive.
 *
 * Calibration: a score of 0.08 means ~1 keyword in 12 matches — far too
 * permissive. 0.12 is the minimum meaningful signal. Use 0.15 for adapters
 * that have no other quality gate (Europe PMC, arXiv, OpenAlex keyword path).
 */
export const MIN_RELEVANCE_THRESHOLD = 0.12;

/**
 * Higher threshold for adapters whose APIs already do semantic ranking
 * (Semantic Scholar). We trust the API's ranking more, so we only reject
 * results that are clearly off-topic.
 */
export const SEMANTIC_RELEVANCE_THRESHOLD = 0.1;

// ─── Stop words ───────────────────────────────────────────────────────────────

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
  "we",
  "our",
  "they",
  "their",
  "he",
  "she",
  "his",
  "her",
  "you",
  "your",
  "also",
  "which",
  "who",
  "how",
  "when",
  "where",
  "what",
  "than",
  "more",
  "these",
  "those",
  "such",
  "been",
  "into",
  "over",
  "after",
  "between",
  "both",
  "each",
  "other",
  "some",
  "all",
  "any",
  "most",
  "only",
  "same",
  "so",
  "if",
  "then",
  "because",
  "while",
  "although",
  "however",
  "thus",
]);

// ─── Core utilities ───────────────────────────────────────────────────────────

/**
 * Extract meaningful keywords from a text string.
 * Lowercases, strips punctuation, removes stop words and short tokens.
 */
export function extractRelevanceKeywords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s\-]/g, " ")
      .split(/\s+/)
      .filter(w => w.length >= 3 && !STOP_WORDS.has(w))
  );
}

/**
 * Compute Jaccard-style keyword overlap score between a claim and a document.
 * Returns a value in [0, 1].
 *
 * @param claimText  - The original claim or query text.
 * @param title      - The document title (may be undefined/null).
 * @param abstract   - The document abstract or snippet (may be undefined/null).
 */
export function computeRelevanceScore(
  claimText: string,
  title: string | null | undefined,
  abstract: string | null | undefined
): number {
  const claimKeywords = extractRelevanceKeywords(claimText);
  if (claimKeywords.size === 0) return 0.5; // no claim keywords → can't judge

  const docText = `${title ?? ""} ${abstract ?? ""}`;
  const docKeywords = extractRelevanceKeywords(docText);
  if (docKeywords.size === 0) return 0; // empty document → irrelevant

  let overlap = 0;
  claimKeywords.forEach(kw => {
    if (docKeywords.has(kw)) overlap++;
  });

  const union = claimKeywords.size + docKeywords.size - overlap;
  return union > 0 ? overlap / union : 0;
}

/**
 * Returns true if the document is sufficiently relevant to the claim.
 * Use this as the gate before returning `found: true` from a free-text
 * search path.
 *
 * @param claimText  - The original claim text.
 * @param title      - Document title.
 * @param abstract   - Document abstract or snippet.
 * @param threshold  - Minimum Jaccard score (default: MIN_RELEVANCE_THRESHOLD).
 */
export function isRelevant(
  claimText: string,
  title: string | null | undefined,
  abstract: string | null | undefined,
  threshold = MIN_RELEVANCE_THRESHOLD
): boolean {
  return computeRelevanceScore(claimText, title, abstract) >= threshold;
}

/**
 * Compute a relevance-adjusted confidence score.
 * Multiplies the adapter's base confidence by the relevance score,
 * clamped to a minimum of 0.1 so relevant results are never invisible.
 *
 * @param baseConfidence - The adapter's own confidence score (0–1).
 * @param claimText      - The original claim text.
 * @param title          - Document title.
 * @param abstract       - Document abstract or snippet.
 */
export function relevanceAdjustedConfidence(
  baseConfidence: number,
  claimText: string,
  title: string | null | undefined,
  abstract: string | null | undefined
): number {
  const score = computeRelevanceScore(claimText, title, abstract);
  // Blend: 70% base confidence + 30% relevance signal
  const blended = baseConfidence * 0.7 + score * 0.3;
  return Math.max(0.1, Math.min(0.99, Math.round(blended * 100) / 100));
}
