/**
 * sourcePaperAdapter.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * PMC full-text semantic similarity adapter for claim verification.
 *
 * Strategy (Phase 138):
 *   1. Given a claim text and a PubMed/PMC ID, fetch the abstract via the
 *      PubMed Entrez API (free, no auth required for reasonable rates).
 *   2. Compute a text embedding for both the claim and the abstract using the
 *      Manus built-in LLM API (OpenAI-compatible /v1/embeddings endpoint).
 *   3. Compute cosine similarity between the two embeddings.
 *   4. Cache the abstract embedding in the paper_embeddings table to avoid
 *      re-fetching on subsequent claims against the same paper.
 *   5. Return a verdict based on similarity thresholds:
 *        ≥ 0.75 → "Supported"
 *        0.50–0.74 → "Ambiguous"
 *        < 0.50 → "Insufficient Evidence"
 *
 * The embedding model used is text-embedding-3-small (1536 dims) via the
 * Manus forge API, which is OpenAI-compatible.
 */

import { ENV } from "./_core/env";
import { getDb } from "./db";
import { paperEmbeddings } from "../drizzle/schema";
import { eq } from "drizzle-orm";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SourcePaperVerdict {
  verdict: "Supported" | "Ambiguous" | "Insufficient Evidence";
  rationale: string;
  confidenceScore: number;
  similarityScore: number | null;
  evidenceUrl: string | null;
  abstractSnippet: string | null;
}

// ─── Embedding helper ─────────────────────────────────────────────────────────

const EMBEDDING_MODEL = "text-embedding-3-small";

/**
 * Compute a text embedding vector using the Manus forge API.
 * Returns null if the API is not configured or the call fails.
 */
export async function embedText(text: string): Promise<number[] | null> {
  if (!ENV.forgeApiUrl || !ENV.forgeApiKey) {
    return null;
  }
  const url = `${ENV.forgeApiUrl.replace(/\/$/, "")}/v1/embeddings`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ENV.forgeApiKey}`,
      },
      body: JSON.stringify({ model: EMBEDDING_MODEL, input: text }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      return null;
    }
    const data = await res.json() as {
      data?: Array<{ embedding?: number[] }>;
    };
    return data?.data?.[0]?.embedding ?? null;
  } catch {
    return null;
  }
}

/**
 * Compute cosine similarity between two equal-length vectors.
 * Returns a value in [0, 1] (or 0 if vectors are zero).
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

// ─── PubMed abstract fetcher ──────────────────────────────────────────────────

const PUBMED_EFETCH =
  "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi";

/**
 * Fetch the abstract text for a PubMed ID using the Entrez efetch API.
 * Returns null if the abstract is not available.
 */
export async function fetchPubMedAbstract(
  pmid: string
): Promise<{ abstract: string; title: string; url: string } | null> {
  const url = `${PUBMED_EFETCH}?db=pubmed&id=${encodeURIComponent(pmid)}&rettype=abstract&retmode=text`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(12_000) });
    if (!res.ok) return null;
    const text = await res.text();
    if (!text || text.length < 20) return null;

    // Extract title (first non-empty line) and abstract (rest)
    const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
    const title = lines[0] ?? "";
    const abstract = lines.slice(1).join(" ").substring(0, 2000);

    return {
      abstract,
      title,
      url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
    };
  } catch {
    return null;
  }
}

// ─── DB-cached embedding lookup ───────────────────────────────────────────────

/**
 * Get or compute the embedding for a paper abstract.
 * Caches the result in the paper_embeddings table.
 */
async function getOrComputePaperEmbedding(
  pmid: string,
  abstractText: string
): Promise<number[] | null> {
  const db = await getDb();
  if (!db) return null;

  // Check cache first
  const cached = await db
    .select()
    .from(paperEmbeddings)
    .where(eq(paperEmbeddings.pmid, pmid))
    .limit(1);

  if (cached.length > 0 && cached[0].embedding) {
    try {
      return JSON.parse(cached[0].embedding) as number[];
    } catch {
      // Corrupted cache — recompute
    }
  }

  // Compute fresh embedding
  const embedding = await embedText(abstractText);
  if (!embedding) return null;

  // Upsert into cache
  await db
    .insert(paperEmbeddings)
    .values({
      pmid,
      abstractText: abstractText.substring(0, 4000),
      embedding: JSON.stringify(embedding),
      embeddingModel: EMBEDDING_MODEL,
      createdAt: new Date(),
    })
    .onDuplicateKeyUpdate({
      set: {
        embedding: JSON.stringify(embedding),
        embeddingModel: EMBEDDING_MODEL,
        createdAt: new Date(),
      },
    });

  return embedding;
}

// ─── Main verification function ───────────────────────────────────────────────

/**
 * Verify a claim against a source paper using semantic similarity.
 *
 * @param claimText  The claim to verify
 * @param pmid       PubMed ID of the source paper
 */
export async function verifyClaimAgainstSourcePaper(
  claimText: string,
  pmid: string
): Promise<SourcePaperVerdict> {
  // 1. Fetch the abstract
  const paperData = await fetchPubMedAbstract(pmid);
  if (!paperData) {
    return {
      verdict: "Insufficient Evidence",
      rationale: `PubMed abstract for PMID ${pmid} could not be retrieved.`,
      confidenceScore: 0.1,
      similarityScore: null,
      evidenceUrl: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
      abstractSnippet: null,
    };
  }

  // 2. Get embeddings for both claim and abstract
  const [claimEmbedding, paperEmbedding] = await Promise.all([
    embedText(claimText),
    getOrComputePaperEmbedding(pmid, paperData.abstract),
  ]);

  if (!claimEmbedding || !paperEmbedding) {
    // Embeddings not available — fall back to keyword heuristic
    const claimWordsArr = claimText.toLowerCase().split(/\W+/).filter((w) => w.length > 4);
    const claimWordsSet = new Set(claimWordsArr);
    const abstractWords = paperData.abstract.toLowerCase();
    const matchCount = Array.from(claimWordsSet).filter((w) => abstractWords.includes(w)).length;
    const heuristicScore = Math.min(1.0, matchCount / Math.max(1, claimWordsSet.size));

    const verdict =
      heuristicScore >= 0.4
        ? "Ambiguous"
        : "Insufficient Evidence";

    return {
      verdict,
      rationale: `Embedding API unavailable. Keyword overlap heuristic: ${(heuristicScore * 100).toFixed(0)}% of claim terms found in abstract of PMID ${pmid} ("${paperData.title.substring(0, 80)}").`,
      confidenceScore: heuristicScore * 0.5, // Reduced confidence for heuristic
      similarityScore: heuristicScore,
      evidenceUrl: paperData.url,
      abstractSnippet: paperData.abstract.substring(0, 300),
    };
  }

  // 3. Compute cosine similarity
  const similarity = cosineSimilarity(claimEmbedding, paperEmbedding);

  // 4. Apply verdict thresholds (Phase 138 spec)
  let verdict: SourcePaperVerdict["verdict"];
  let confidenceScore: number;
  let rationale: string;

  if (similarity >= 0.75) {
    verdict = "Supported";
    confidenceScore = 0.6 + (similarity - 0.75) * 1.6; // 0.60 – 1.00
    rationale = `Semantic similarity ${(similarity * 100).toFixed(1)}% (≥75%) between claim and abstract of PMID ${pmid} ("${paperData.title.substring(0, 80)}"). High overlap indicates the source paper supports this claim.`;
  } else if (similarity >= 0.50) {
    verdict = "Ambiguous";
    confidenceScore = 0.3 + (similarity - 0.50) * 1.2; // 0.30 – 0.60
    rationale = `Semantic similarity ${(similarity * 100).toFixed(1)}% (50–75%) between claim and abstract of PMID ${pmid} ("${paperData.title.substring(0, 80)}"). Partial overlap — claim may be related but not directly supported.`;
  } else {
    verdict = "Insufficient Evidence";
    confidenceScore = similarity * 0.6; // 0.00 – 0.30
    rationale = `Semantic similarity ${(similarity * 100).toFixed(1)}% (<50%) between claim and abstract of PMID ${pmid} ("${paperData.title.substring(0, 80)}"). Low overlap — source paper does not appear to support this claim.`;
  }

  return {
    verdict,
    rationale,
    confidenceScore: Math.min(1.0, Math.max(0.0, confidenceScore)),
    similarityScore: similarity,
    evidenceUrl: paperData.url,
    abstractSnippet: paperData.abstract.substring(0, 300),
  };
}

// ─── PMID extraction ──────────────────────────────────────────────────────────

/**
 * Extract PubMed IDs from free text.
 * Matches patterns like "PMID: 12345678", "PMID12345678", "pubmed/12345678".
 */
const PMID_RE = /\b(?:PMID[:\s]?\s*|pubmed\/|PubMed\s+ID[:\s]+)(\d{7,8})\b/gi;

export function extractPmids(text: string): string[] {
  const matches = Array.from(text.matchAll(PMID_RE));
  return Array.from(new Set(matches.map((m) => m[1])));
}
