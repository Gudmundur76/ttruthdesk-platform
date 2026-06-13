/**
 * server/embeddingBackfillJob.ts
 * Phase 124a — Bulk-index all eligible claims (Supported / Partially Supported)
 * into the TurboVec sidecar.
 *
 * Design:
 *   - Paginated DB scan so memory stays bounded regardless of corpus size.
 *   - Fire-and-forget per claim — errors are counted but never fatal.
 *   - Skips entirely when the sidecar is unavailable (returns zero counts).
 *   - Exported as a plain async function so it can be called from:
 *       • A tRPC admin procedure
 *       • A heartbeat / cron job
 *       • The CLI (`node -e "require('./embeddingBackfillJob').runEmbeddingBackfill()"`)
 */
import { getDb } from "./db";
import { indexClaim, isSidecarAvailable } from "./vectorStore";
import { logger, errData } from "./logger";
import { claims } from "../drizzle/schema";
import { inArray } from "drizzle-orm";

const log = logger("embeddingBackfillJob");

export interface EmbeddingBackfillOptions {
  /** Number of claims to fetch per DB page. Default: 100. */
  batchSize?: number;
}

export interface EmbeddingBackfillResult {
  /** Claims successfully sent to the sidecar. */
  indexed: number;
  /** Claims skipped (sidecar unavailable or DB unavailable). */
  skipped: number;
  /** Claims that threw during indexClaim(). */
  errors: number;
}

const ELIGIBLE_VERDICTS = ["Supported", "Partially Supported"] as const;

export async function runEmbeddingBackfill(
  opts: EmbeddingBackfillOptions = {}
): Promise<EmbeddingBackfillResult> {
  const batchSize = opts.batchSize ?? 100;
  const result: EmbeddingBackfillResult = { indexed: 0, skipped: 0, errors: 0 };

  // Short-circuit if the sidecar is not running
  if (!(await isSidecarAvailable())) {
    log.warn("[embeddingBackfill] Sidecar unavailable — skipping backfill");
    return result;
  }

  const db = await getDb();
  if (!db) {
    log.warn("[embeddingBackfill] DB unavailable — skipping backfill");
    return result;
  }

  let offset = 0;
  let totalProcessed = 0;

  while (true) {
    const rows = await db
      .select({
        id: claims.id,
        claimText: claims.claimText,
        verdict: claims.verdict,
      })
      .from(claims)
      .where(inArray(claims.verdict, [...ELIGIBLE_VERDICTS]))
      .limit(batchSize)
      .offset(offset);

    if (rows.length === 0) break;

    for (const row of rows) {
      if (!row.claimText) {
        result.skipped++;
        continue;
      }
      try {
        await indexClaim(row.id, row.claimText);
        result.indexed++;
      } catch (err) {
        log.warn(
          `[embeddingBackfill] indexClaim failed for claim ${row.id}:`,
          errData(err)
        );
        result.errors++;
      }
    }

    totalProcessed += rows.length;
    offset += batchSize;

    if (rows.length < batchSize) break; // last page
  }

  log.info(
    `[embeddingBackfill] Complete — indexed: ${result.indexed}, errors: ${result.errors}, total scanned: ${totalProcessed}`
  );
  return result;
}
