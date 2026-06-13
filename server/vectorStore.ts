/**
 * vectorStore.ts — TurboVec bridge + SQL fallback
 * ================================================
 * Wraps the Python FastAPI sidecar (vectorSidecar.py) with:
 *   - Graceful degradation: if the sidecar is unreachable, falls back to
 *     MySQL FULLTEXT search so the feature works on Cloud Run (Node-only).
 *   - Lazy indexing: on first search, fetches all unindexed claims from the
 *     DB and pushes them to the sidecar in a single batch.
 *   - Incremental indexing: callers invoke `indexClaim()` after inserting
 *     a new claim so the index stays fresh without a full rebuild.
 */

import { getDb } from "./db";
import { claims, documents } from "../drizzle/schema";
import { eq, like, or, isNotNull, sql } from "drizzle-orm";
import { logger, errData } from "./logger";
const log = logger("vectorStore");

const SIDECAR_URL = process.env.VECTOR_SIDECAR_URL ?? "http://127.0.0.1:5001";
const SIDECAR_TIMEOUT_MS = 3_000;

// ─── Sidecar health ───────────────────────────────────────────────────────────

let _sidecarAvailable: boolean | null = null;
let _lastHealthCheck = 0;
const HEALTH_TTL_MS = 30_000;

export async function isSidecarAvailable(): Promise<boolean> {
  const now = Date.now();
  if (_sidecarAvailable !== null && now - _lastHealthCheck < HEALTH_TTL_MS) {
    return _sidecarAvailable;
  }
  try {
    const res = await fetch(`${SIDECAR_URL}/health`, {
      signal: AbortSignal.timeout(SIDECAR_TIMEOUT_MS),
    });
    _sidecarAvailable = res.ok;
  } catch {
    _sidecarAvailable = false;
  }
  _lastHealthCheck = now;
  return _sidecarAvailable;
}

// ─── Lazy full-index bootstrap ────────────────────────────────────────────────

let _indexBootstrapped = false;

async function bootstrapIndexIfNeeded(): Promise<void> {
  if (_indexBootstrapped) return;
  _indexBootstrapped = true; // optimistic — prevents concurrent bootstraps

  try {
    const db = await getDb();
    if (!db) return;

    // Fetch all claims that have text
    const rows = await db
      .select({ id: claims.id, claimText: claims.claimText })
      .from(claims)
      .where(isNotNull(claims.claimText))
      .limit(10_000);

    if (rows.length === 0) return;

    const items = rows
      .filter(r => r.claimText && r.claimText.trim().length > 0)
      .map(r => ({ id: r.id, text: r.claimText! }));

    if (items.length === 0) return;

    await fetch(`${SIDECAR_URL}/index`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items }),
      signal: AbortSignal.timeout(30_000),
    });

    log.info(`[vectorStore] Bootstrapped ${items.length} claims into sidecar`);
  } catch (err) {
    _indexBootstrapped = false; // allow retry on next call
    log.warn("[vectorStore] Bootstrap failed:", errData(err));
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export interface SearchOptions {
  query: string;
  topK?: number;
  vertical?: string;
  verdict?: string;
}

export interface SearchHit {
  claimId: number;
  score: number;
  claimText: string;
  verdict: string | null;
  documentId: number | null;
  documentTitle: string | null;
  verticalDomain: string | null;
  source: "vector" | "fulltext";
}

/**
 * Search claims using TurboVec semantic search.
 * Falls back to MySQL FULLTEXT search if the sidecar is unavailable.
 */
export async function searchClaims(opts: SearchOptions): Promise<SearchHit[]> {
  const topK = opts.topK ?? 10;

  if (await isSidecarAvailable()) {
    await bootstrapIndexIfNeeded();
    return vectorSearch(opts, topK);
  }

  return fulltextSearch(opts, topK);
}

/**
 * Index a single claim in the sidecar (call after inserting a new claim).
 * Silently no-ops if the sidecar is unavailable.
 */
export async function indexClaim(claimId: number, text: string): Promise<void> {
  if (!(await isSidecarAvailable())) return;
  try {
    await fetch(`${SIDECAR_URL}/index`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: [{ id: claimId, text }] }),
      signal: AbortSignal.timeout(SIDECAR_TIMEOUT_MS),
    });
  } catch {
    // Fire-and-forget — index failures are non-fatal
  }
}

// ─── Vector search path ───────────────────────────────────────────────────────

async function vectorSearch(
  opts: SearchOptions,
  topK: number
): Promise<SearchHit[]> {
  const res = await fetch(`${SIDECAR_URL}/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query: opts.query,
      top_k: topK * 3, // over-fetch to allow post-filter by vertical/verdict
    }),
    signal: AbortSignal.timeout(SIDECAR_TIMEOUT_MS),
  });

  if (!res.ok) throw new Error(`Sidecar search failed: ${res.status}`);

  const data = (await res.json()) as {
    results: Array<{ id: number; score: number }>;
  };

  if (data.results.length === 0) return [];

  const claimIds = data.results.map(r => r.id);
  const scoreMap = new Map(data.results.map(r => [r.id, r.score]));

  const db = await getDb();
  if (!db) return [];

  const rows = await db
    .select({
      id: claims.id,
      claimText: claims.claimText,
      verdict: claims.verdict,
      documentId: claims.documentId,
      documentTitle: documents.title,
      verticalDomain: documents.verticalDomain,
    })
    .from(claims)
    .leftJoin(documents, eq(claims.documentId, documents.id))
    .where(
      sql`${claims.id} IN (${sql.join(
        claimIds.map(id => sql`${id}`),
        sql`, `
      )})`
    );

  let hits: SearchHit[] = rows.map(r => ({
    claimId: r.id,
    score: scoreMap.get(r.id) ?? 0,
    claimText: r.claimText ?? "",
    verdict: r.verdict,
    documentId: r.documentId,
    documentTitle: r.documentTitle,
    verticalDomain: r.verticalDomain,
    source: "vector" as const,
  }));

  // Post-filter
  if (opts.vertical)
    hits = hits.filter(h => h.verticalDomain === opts.vertical);
  if (opts.verdict) hits = hits.filter(h => h.verdict === opts.verdict);

  // Sort by score descending and trim to topK
  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, topK);
}

// ─── SQL FULLTEXT fallback ────────────────────────────────────────────────────

async function fulltextSearch(
  opts: SearchOptions,
  topK: number
): Promise<SearchHit[]> {
  const db = await getDb();
  if (!db) return [];

  const terms = opts.query
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 8)
    .map(t => `%${t}%`);

  if (terms.length === 0) return [];

  // Build OR-of-LIKE conditions for each term
  const conditions = terms.map(term => like(claims.claimText, term));

  const whereClause =
    conditions.length === 1 ? conditions[0] : or(...conditions)!;

  const rows = await db
    .select({
      id: claims.id,
      claimText: claims.claimText,
      verdict: claims.verdict,
      documentId: claims.documentId,
      documentTitle: documents.title,
      verticalDomain: documents.verticalDomain,
    })
    .from(claims)
    .leftJoin(documents, eq(claims.documentId, documents.id))
    .where(whereClause)
    .limit(topK * 3);

  let hits: SearchHit[] = rows.map(r => ({
    claimId: r.id,
    score: 0.5, // uniform score for SQL fallback
    claimText: r.claimText ?? "",
    verdict: r.verdict,
    documentId: r.documentId,
    documentTitle: r.documentTitle,
    verticalDomain: r.verticalDomain,
    source: "fulltext" as const,
  }));

  if (opts.vertical)
    hits = hits.filter(h => h.verticalDomain === opts.vertical);
  if (opts.verdict) hits = hits.filter(h => h.verdict === opts.verdict);

  return hits.slice(0, topK);
}
