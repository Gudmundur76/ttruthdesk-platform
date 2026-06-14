/**
 * server/backfillEmbeddingsRoute.ts — Sprint 0 Fix 4
 * ─────────────────────────────────────────────────────────────────────────────
 * Embedding Schema + Backfill Endpoint
 *
 * Provides:
 *   - backfillMissingEmbeddings(opts): queries claims without embeddings,
 *     calls the embeddings API, and upserts into claim_embeddings.
 *   - registerBackfillEmbeddingsRoute(app, requireOwnerOrAdmin): wires
 *     POST /api/admin/backfill-embeddings as an admin-only endpoint.
 *
 * Design principles:
 *   - Fail-open: DB or API unavailability returns zero counts, never throws.
 *   - Paginated: processes claims in batches to keep memory bounded.
 *   - Idempotent: uses onDuplicateKeyUpdate so re-runs are safe.
 */
import type { Express, Request, Response, RequestHandler } from "express";
import { notInArray } from "drizzle-orm";
import { getDb } from "./db";
import { claims, claimEmbeddings } from "../drizzle/schema";
import { logger, errData } from "./logger";

const log = logger("backfillEmbeddingsRoute");

const DEFAULT_LIMIT = 100;
const EMBEDDING_MODEL = "text-embedding-3-small";

export interface BackfillEmbeddingsOptions {
  /** Maximum number of claims to embed in this run. Default: 100. */
  limit?: number;
}

export interface BackfillEmbeddingsResult {
  /** Claims for which an embedding was requested. */
  processed: number;
  /** Embeddings successfully inserted/updated. */
  inserted: number;
  /** Claims that failed during API call or DB upsert. */
  errors: number;
}

/**
 * Fetches claims that do not yet have an embedding, calls the embeddings API,
 * and upserts the results into claim_embeddings.
 */
export async function backfillMissingEmbeddings(
  opts: BackfillEmbeddingsOptions = {}
): Promise<BackfillEmbeddingsResult> {
  const limit = opts.limit ?? DEFAULT_LIMIT;
  const result: BackfillEmbeddingsResult = {
    processed: 0,
    inserted: 0,
    errors: 0,
  };

  const db = await getDb();
  if (!db) {
    log.warn("[backfillEmbeddings] DB unavailable — skipping");
    return result;
  }

  const apiUrl = process.env.BUILT_IN_FORGE_API_URL;
  const apiKey = process.env.BUILT_IN_FORGE_API_KEY;
  if (!apiUrl || !apiKey) {
    log.warn(
      "[backfillEmbeddings] Missing BUILT_IN_FORGE_API_URL or BUILT_IN_FORGE_API_KEY — skipping"
    );
    return result;
  }

  // Load IDs that already have embeddings
  const existingRows = await db
    .select({ claimId: claimEmbeddings.claimId })
    .from(claimEmbeddings);
  const existingIds = existingRows.map((r: { claimId: number }) => r.claimId);

  // Fetch claims without embeddings (paginated)
  let offset = 0;
  const batchSize = Math.min(limit, 50); // API batch cap

  while (result.processed < limit) {
    const remaining = limit - result.processed;
    const fetchSize = Math.min(batchSize, remaining);

    const claimRows = await db
      .select({ id: claims.id, claimText: claims.claimText })
      .from(claims)
      .where(
        existingIds.length > 0 ? notInArray(claims.id, existingIds) : undefined
      )
      .limit(fetchSize)
      .offset(offset);

    if (claimRows.length === 0) break;

    // Build texts for batch embedding
    const texts = claimRows
      .filter(
        (r: { id: number; claimText: string }) =>
          r.claimText && r.claimText.trim().length > 0
      )
      .map((r: { id: number; claimText: string }) => r.claimText.trim());

    if (texts.length === 0) {
      offset += claimRows.length;
      continue;
    }

    // Call embeddings API
    let embeddingData: Array<{ index: number; embedding: number[] }> = [];
    try {
      const resp = await fetch(`${apiUrl}/v1/embeddings`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ model: EMBEDDING_MODEL, input: texts }),
      });
      if (!resp.ok) {
        log.warn(
          `[backfillEmbeddings] API returned ${resp.status} for batch at offset ${offset}`
        );
        result.errors += texts.length;
        offset += claimRows.length;
        continue;
      }
      const json = (await resp.json()) as {
        data: Array<{ index: number; embedding: number[] }>;
      };
      embeddingData = json.data ?? [];
    } catch (err) {
      log.warn("[backfillEmbeddings] API call failed:", errData(err));
      result.errors += texts.length;
      offset += claimRows.length;
      continue;
    }

    // Upsert embeddings
    const validClaims = claimRows.filter(
      (r: { id: number; claimText: string }) =>
        r.claimText && r.claimText.trim().length > 0
    );
    for (let i = 0; i < embeddingData.length; i++) {
      const claim = validClaims[embeddingData[i].index] ?? validClaims[i];
      if (!claim) continue;
      try {
        await db
          .insert(claimEmbeddings)
          .values({
            claimId: claim.id,
            embedding: embeddingData[i].embedding,
            model: EMBEDDING_MODEL,
            indexedAt: Date.now(),
          })
          .onDuplicateKeyUpdate({
            set: {
              embedding: embeddingData[i].embedding,
              model: EMBEDDING_MODEL,
              indexedAt: Date.now(),
            },
          });
        result.inserted++;
        // Track as already embedded so subsequent pages skip it
        existingIds.push(claim.id);
      } catch (err) {
        log.warn(
          `[backfillEmbeddings] Upsert failed for claim ${claim.id}:`,
          errData(err)
        );
        result.errors++;
      }
    }

    result.processed += claimRows.length;
    offset += claimRows.length;

    if (claimRows.length < fetchSize) break; // last page
  }

  log.info(
    `[backfillEmbeddings] Done — processed: ${result.processed}, inserted: ${result.inserted}, errors: ${result.errors}`
  );
  return result;
}

// ─── Express route registration ───────────────────────────────────────────────

/**
 * POST /api/scheduled/backfill-embeddings
 * Synchronously runs the backfill and returns the result.
 * Registered under /api/scheduled/ so it can be triggered by the heartbeat
 * cron system (requireCronOrAdmin). For large corpora, consider running in
 * background; for typical Sprint 0 use the synchronous response is fine
 * (limit defaults to 100).
 */
export function registerBackfillEmbeddingsRoute(
  app: Express,
  requireCronOrAdmin: RequestHandler
): void {
  app.post(
    "/api/scheduled/backfill-embeddings",
    requireCronOrAdmin,
    async (req: Request, res: Response) => {
      const limitRaw = req.body?.limit;
      const limit =
        typeof limitRaw === "number" && limitRaw > 0
          ? Math.min(limitRaw, 1000)
          : DEFAULT_LIMIT;

      try {
        const result = await backfillMissingEmbeddings({ limit });
        res.json({ ok: true, ...result });
      } catch (err) {
        log.warn(
          "[backfillEmbeddings] Unhandled error in route:",
          errData(err)
        );
        res
          .status(500)
          .json({
            ok: false,
            error: "Internal error during embedding backfill",
          });
      }
    }
  );
}
