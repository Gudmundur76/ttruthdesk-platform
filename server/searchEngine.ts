/**
 * searchEngine.ts
 *
 * TiDB-compatible claim and entity search using LIKE-based relevance scoring.
 * TiDB Serverless does not support FULLTEXT indexes, so we use a multi-term
 * LIKE approach with server-side relevance ranking.
 *
 * Strategy:
 * 1. Tokenise the query into terms (≥3 chars, stop-word filtered)
 * 2. Build a WHERE clause matching any term in claimText / title / canonicalName
 * 3. Fetch up to 500 candidates and rank them in-process by:
 *    - Exact phrase match bonus (+50)
 *    - Per-term frequency in text (+10 per occurrence, capped at 30)
 *    - Verdict weight (Supported/Contradicted > Ambiguous > unscored)
 *    - Confidence score bonus (0–10)
 *    - Recency bonus (newer documents score higher)
 * 4. Return top-N sorted by composite relevance score
 */

import { sql, or, like, and, eq, desc, isNotNull } from "drizzle-orm";
import { getDb } from "./db";
import { claims, documents, graphEntities } from "../drizzle/schema";

// ─── Stop words ───────────────────────────────────────────────────────────────

const STOP_WORDS = new Set([
  "the", "and", "for", "are", "but", "not", "you", "all", "can", "had",
  "her", "was", "one", "our", "out", "day", "get", "has", "him", "his",
  "how", "its", "may", "new", "now", "old", "see", "two", "way", "who",
  "boy", "did", "she", "use", "that", "with", "this", "from", "they",
  "have", "been", "more", "when", "were", "will", "your", "said", "each",
  "which", "their", "time", "than", "into", "then", "some", "could",
  "these", "other", "also", "would", "about", "there", "after", "being",
]);

// ─── Tokeniser ────────────────────────────────────────────────────────────────

export function tokenise(query: string): string[] {
  return query
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !STOP_WORDS.has(t))
    .slice(0, 8); // cap at 8 terms to keep query fast
}

// ─── Verdict weight ───────────────────────────────────────────────────────────

const VERDICT_WEIGHT: Record<string, number> = {
  "Supported": 10,
  "Contradicted": 9,
  "Partially Supported": 8,
  "Ambiguous": 5,
  "Insufficient Evidence": 4,
  "Needs Expert Review": 3,
  "Out of Scope": 1,
};

// ─── In-process relevance scorer ─────────────────────────────────────────────

function scoreClaimResult(
  claim: { claimText: string; verdict: string | null; confidenceScore: number | null; createdAt: Date | string },
  terms: string[],
  phrase: string
): number {
  const text = claim.claimText.toLowerCase();
  let score = 0;

  // Exact phrase match
  if (text.includes(phrase)) score += 50;

  // Per-term frequency (capped)
  for (const term of terms) {
    let count = 0;
    let idx = 0;
    while ((idx = text.indexOf(term, idx)) !== -1) {
      count++;
      idx += term.length;
    }
    score += Math.min(count * 10, 30);
  }

  // Verdict weight
  score += VERDICT_WEIGHT[claim.verdict ?? ""] ?? 0;

  // Confidence bonus (0–10)
  if (claim.confidenceScore !== null) {
    score += Math.round((claim.confidenceScore ?? 0) * 10);
  }

  // Recency bonus: papers from last 2 years get +5
  const createdMs = claim.createdAt instanceof Date
    ? claim.createdAt.getTime()
    : new Date(claim.createdAt).getTime();
  const ageYears = (Date.now() - createdMs) / (1000 * 60 * 60 * 24 * 365);
  if (ageYears < 2) score += 5;

  return score;
}

// ─── Claim search ─────────────────────────────────────────────────────────────

export interface ClaimSearchResult {
  id: number;
  claimText: string;
  verdict: string | null;
  confidenceScore: number | null;
  documentId: number;
  documentTitle: string | null;
  verticalDomain: string | null;
  relevanceScore: number;
}

export async function searchClaims(
  query: string,
  opts: { limit?: number; verticalDomain?: string; verdict?: string } = {}
): Promise<ClaimSearchResult[]> {
  const { limit = 20, verticalDomain, verdict } = opts;
  const terms = tokenise(query);
  if (terms.length === 0) return [];

  const phrase = query.toLowerCase().replace(/[^a-z0-9\s-]/g, " ").trim();

  const db = await getDb();
  if (!db) return [];

  // Build LIKE conditions — any term in claimText
  const likeConditions = terms.map((t) => like(claims.claimText, `%${t}%`));

  const filters = [or(...likeConditions)!];
  if (verticalDomain) {
    filters.push(eq(documents.verticalDomain, verticalDomain));
  }
  if (verdict) {
    filters.push(sql`${claims.verdict} = ${verdict}`);
  }

  const rows = await db
    .select({
      id: claims.id,
      claimText: claims.claimText,
      verdict: claims.verdict,
      confidenceScore: claims.confidenceScore,
      documentId: claims.documentId,
      documentTitle: documents.title,
      verticalDomain: documents.verticalDomain,
      createdAt: claims.createdAt,
    })
    .from(claims)
    .innerJoin(documents, eq(claims.documentId, documents.id))
    .where(and(...filters))
    .limit(500); // fetch wide, rank narrow

  // Rank in-process
  const scored = rows.map((row) => ({
    id: row.id,
    claimText: row.claimText,
    verdict: row.verdict ?? null,
    confidenceScore: row.confidenceScore ?? null,
    documentId: row.documentId,
    documentTitle: row.documentTitle ?? null,
    verticalDomain: row.verticalDomain ?? null,
    relevanceScore: scoreClaimResult(
      { claimText: row.claimText, verdict: row.verdict ?? null, confidenceScore: row.confidenceScore ?? null, createdAt: row.createdAt },
      terms,
      phrase
    ),
  }));

  scored.sort((a, b) => b.relevanceScore - a.relevanceScore);
  return scored.slice(0, limit);
}

// ─── Entity search ────────────────────────────────────────────────────────────

export interface EntitySearchResult {
  id: number;
  canonicalName: string;
  entityType: string;
  firstSeenDocumentId: number | null;
  relationCount: number;
  relevanceScore: number;
}

export async function searchEntities(
  query: string,
  opts: { limit?: number } = {}
): Promise<EntitySearchResult[]> {
  const { limit = 10 } = opts;
  const terms = tokenise(query);
  if (terms.length === 0) return [];

  const phrase = query.toLowerCase().replace(/[^a-z0-9\s-]/g, " ").trim();

  const db = await getDb();
  if (!db) return [];

  const likeConditions = terms.map((t) => like(graphEntities.canonicalName, `%${t}%`));

  const rows = await db
    .select({
      id: graphEntities.id,
      canonicalName: graphEntities.canonicalName,
      entityType: graphEntities.entityType,
      firstSeenDocumentId: graphEntities.firstSeenDocumentId,
    })
    .from(graphEntities)
    .where(or(...likeConditions))
    .limit(200);

  const scored = rows.map((row) => {
    const name = row.canonicalName.toLowerCase();
    let score = 0;
    if (name === phrase) score += 100;
    else if (name.includes(phrase)) score += 50;
    for (const t of terms) {
      if (name.includes(t)) score += 20;
    }
    return { ...row, relationCount: 0, relevanceScore: score };
  });

  scored.sort((a, b) => b.relevanceScore - a.relevanceScore);
  return scored.slice(0, limit);
}

// ─── Unified search ───────────────────────────────────────────────────────────

export interface UnifiedSearchResult {
  claims: ClaimSearchResult[];
  entities: EntitySearchResult[];
  totalClaims: number;
  totalEntities: number;
  queryTerms: string[];
  durationMs: number;
}

export async function unifiedSearch(
  query: string,
  opts: { claimLimit?: number; entityLimit?: number; verticalDomain?: string; verdict?: string } = {}
): Promise<UnifiedSearchResult> {
  const start = Date.now();
  const terms = tokenise(query);

  const [claimsResult, entitiesResult] = await Promise.all([
    searchClaims(query, { limit: opts.claimLimit ?? 20, verticalDomain: opts.verticalDomain, verdict: opts.verdict }),
    searchEntities(query, { limit: opts.entityLimit ?? 5 }),
  ]);

  return {
    claims: claimsResult,
    entities: entitiesResult,
    totalClaims: claimsResult.length,
    totalEntities: entitiesResult.length,
    queryTerms: terms,
    durationMs: Date.now() - start,
  };
}
