/**
 * Claim Similarity Engine
 *
 * Detects near-duplicate and semantically similar claims across documents
 * using TF-IDF weighted cosine similarity. Pure TypeScript — no external ML
 * dependencies required, runs entirely in the Node.js process.
 *
 * Algorithm:
 *  1. Tokenise + stem each claim text (lowercase, strip punctuation, remove stopwords)
 *  2. Build a TF-IDF vocabulary across all claims in the corpus
 *  3. Represent each claim as a sparse TF-IDF vector
 *  4. Compute pairwise cosine similarity for the query claim against the corpus
 *  5. Return top-K matches above a configurable threshold
 */

import { getDb } from "./db";
import { claims, documents } from "../drizzle/schema";
import { desc, eq, ne, and, isNotNull } from "drizzle-orm";

// ─── Stopwords ────────────────────────────────────────────────────────────────

const STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "but", "in", "on", "at", "to", "for", "of",
  "with", "by", "from", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "could", "should",
  "may", "might", "shall", "can", "that", "this", "these", "those", "it", "its",
  "not", "no", "nor", "so", "yet", "both", "either", "neither", "each", "few",
  "more", "most", "other", "some", "such", "than", "too", "very", "just", "as",
  "if", "then", "because", "while", "although", "though", "since", "until",
  "after", "before", "when", "where", "which", "who", "whom", "whose", "how",
  "all", "any", "both", "each", "every", "much", "many", "own", "same", "also",
  "into", "through", "during", "including", "without", "between", "among",
  "however", "therefore", "thus", "hence", "whereas", "whether", "about",
  "against", "along", "around", "across", "behind", "below", "above", "over",
  "under", "up", "down", "out", "off", "here", "there", "now", "then",
]);

// ─── Tokeniser ────────────────────────────────────────────────────────────────

function tokenise(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));
}

// Simple suffix-stripping stemmer (Porter-lite)
function stem(word: string): string {
  return word
    .replace(/ations?$/, "ate")
    .replace(/ings?$/, "")
    .replace(/edly$/, "")
    .replace(/edly$/, "")
    .replace(/ness$/, "")
    .replace(/ment$/, "")
    .replace(/ful$/, "")
    .replace(/ous$/, "")
    .replace(/ive$/, "")
    .replace(/ize$/, "")
    .replace(/ise$/, "")
    .replace(/ical$/, "ic")
    .replace(/ies$/, "y")
    .replace(/ied$/, "y")
    .replace(/ing$/, "")
    .replace(/tion$/, "t")
    .replace(/ers?$/, "")
    .replace(/ly$/, "")
    .replace(/ed$/, "")
    .replace(/s$/, "");
}

function processText(text: string): string[] {
  return tokenise(text).map(stem).filter((t) => t.length > 1);
}

// ─── TF-IDF ───────────────────────────────────────────────────────────────────

type SparseVector = Map<string, number>;

function termFrequency(tokens: string[]): Map<string, number> {
  const tf = new Map<string, number>();
  for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
  const len = tokens.length || 1;
  Array.from(tf.entries()).forEach(([k, v]) => tf.set(k, v / len));
  return tf;
}

function buildIdf(corpus: string[][]): Map<string, number> {
  const docCount = corpus.length;
  const df = new Map<string, number>();
  for (const tokens of corpus) {
    Array.from(new Set(tokens)).forEach((t) => df.set(t, (df.get(t) ?? 0) + 1));
  }
  const idf = new Map<string, number>();
  Array.from(df.entries()).forEach(([term, count]) => {
    idf.set(term, Math.log((docCount + 1) / (count + 1)) + 1);
  });
  return idf;
}

function tfidfVector(tokens: string[], idf: Map<string, number>): SparseVector {
  const tf = termFrequency(tokens);
  const vec: SparseVector = new Map();
  Array.from(tf.entries()).forEach(([term, tfVal]) => {
    const idfVal = idf.get(term) ?? 1;
    vec.set(term, tfVal * idfVal);
  });
  return vec;
}

function cosineSimilarity(a: SparseVector, b: SparseVector): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  Array.from(a.entries()).forEach(([term, aVal]) => {
    const bVal = b.get(term) ?? 0;
    dot += aVal * bVal;
    normA += aVal * aVal;
  });
  Array.from(b.values()).forEach((bVal) => { normB += bVal * bVal; });
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom > 0 ? dot / denom : 0;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export interface SimilarClaim {
  claimId: number;
  documentId: number;
  documentTitle: string;
  claimText: string;
  verdict: string | null;
  confidenceScore: number | null;
  similarity: number;
}

export interface SimilarityOptions {
  /** Minimum cosine similarity to include in results (0–1). Default 0.35 */
  threshold?: number;
  /** Maximum number of results to return. Default 10 */
  topK?: number;
  /** Exclude claims from the same document. Default true */
  excludeSameDocument?: boolean;
}

/**
 * Find claims similar to the given query text across the entire corpus.
 * Loads up to 5,000 recent claims for the TF-IDF corpus.
 */
export async function findSimilarClaims(
  queryText: string,
  options: SimilarityOptions = {}
): Promise<SimilarClaim[]> {
  const { threshold = 0.35, topK = 10 } = options;

  const db = await getDb();
  if (!db) return [];

  // Load corpus — join with documents for title
  const rows = await db
    .select({
      claimId: claims.id,
      documentId: claims.documentId,
      documentTitle: documents.title,
      claimText: claims.claimText,
      verdict: claims.verdict,
      confidenceScore: claims.confidenceScore,
    })
    .from(claims)
    .innerJoin(documents, eq(claims.documentId, documents.id))
    .where(isNotNull(claims.claimText))
    .orderBy(desc(claims.id))
    .limit(5000);

  if (rows.length === 0) return [];

  // Build corpus tokens
  const corpusTokens = rows.map((r) => processText(r.claimText ?? ""));
  const queryTokens = processText(queryText);

  // Build IDF over corpus + query
  const allTokenSets = [...corpusTokens, queryTokens];
  const idf = buildIdf(allTokenSets);

  // Vectorise query
  const queryVec = tfidfVector(queryTokens, idf);

  // Score each corpus entry
  const scored: (SimilarClaim & { _score: number })[] = [];
  for (let i = 0; i < rows.length; i++) {
    const corpusVec = tfidfVector(corpusTokens[i], idf);
    const sim = cosineSimilarity(queryVec, corpusVec);
    if (sim >= threshold) {
      scored.push({
        claimId: rows[i].claimId,
        documentId: rows[i].documentId,
        documentTitle: rows[i].documentTitle ?? "Untitled",
        claimText: rows[i].claimText ?? "",
        verdict: rows[i].verdict ?? null,
        confidenceScore: rows[i].confidenceScore ?? null,
        similarity: Math.round(sim * 1000) / 1000,
        _score: sim,
      });
    }
  }

  // Sort by similarity descending, take top-K
  scored.sort((a, b) => b._score - a._score);
  return scored.slice(0, topK).map(({ _score: _s, ...rest }) => rest);
}

/**
 * Find similar claims to an existing claim by its ID.
 * Automatically excludes the source claim itself.
 */
export async function findSimilarToClaimId(
  claimId: number,
  options: SimilarityOptions = {}
): Promise<SimilarClaim[]> {
  const db = await getDb();
  if (!db) return [];

  const [source] = await db
    .select({ claimText: claims.claimText, documentId: claims.documentId })
    .from(claims)
    .where(eq(claims.id, claimId))
    .limit(1);

  if (!source?.claimText) return [];

  const results = await findSimilarClaims(source.claimText, options);

  // Exclude the source claim itself
  return results.filter((r) => r.claimId !== claimId);
}

/**
 * Detect near-duplicate claims within a single document.
 * Returns pairs of claims with similarity above the threshold.
 */
export async function detectDuplicatesInDocument(
  documentId: number,
  threshold = 0.8
): Promise<Array<{ claimA: number; claimB: number; similarity: number; textA: string; textB: string }>> {
  const db = await getDb();
  if (!db) return [];

  const rows = await db
    .select({ id: claims.id, claimText: claims.claimText })
    .from(claims)
    .where(and(eq(claims.documentId, documentId), isNotNull(claims.claimText)));

  if (rows.length < 2) return [];

  const tokens = rows.map((r) => processText(r.claimText ?? ""));
  const idf = buildIdf(tokens);
  const vecs = tokens.map((t) => tfidfVector(t, idf));

  const pairs: Array<{ claimA: number; claimB: number; similarity: number; textA: string; textB: string }> = [];

  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const sim = cosineSimilarity(vecs[i], vecs[j]);
      if (sim >= threshold) {
        pairs.push({
          claimA: rows[i].id,
          claimB: rows[j].id,
          similarity: Math.round(sim * 1000) / 1000,
          textA: rows[i].claimText ?? "",
          textB: rows[j].claimText ?? "",
        });
      }
    }
  }

  return pairs.sort((a, b) => b.similarity - a.similarity);
}
