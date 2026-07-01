/**
 * server/resetStuckDocumentsRoute.ts — Sprint 41
 * ─────────────────────────────────────────────────────────────────────────────
 * Resets documents that are stuck in non-terminal pipeline states back to
 * 'pending' so the swarm extractor agent can pick them up again.
 *
 * A document is considered stuck if it has been in a non-terminal status
 * (pending, extracting, validating, generating_report) for longer than the
 * configured threshold (default: 30 minutes).
 *
 * Provides:
 *   - resetStuckDocuments(opts): queries and resets stuck documents.
 *   - registerResetStuckDocumentsRoute(app, requireCronOrAdmin): wires
 *     POST /api/admin/reset-stuck-documents as a cron/admin endpoint.
 *
 * Design principles:
 *   - Idempotent: only resets documents still in non-terminal status.
 *   - Dry-run mode: pass dryRun=true to preview without writing to DB.
 *   - Fail-open: individual failures are logged and counted, not thrown.
 */

import type { Express, Request, Response, RequestHandler } from "express";
import { lt, sql, and } from "drizzle-orm";
import { getDb } from "./db";
import { documents } from "../drizzle/schema";
import { logger, errData } from "./logger";

const log = logger("resetStuckDocumentsRoute");

const DEFAULT_THRESHOLD_MINUTES = 30;
const _NON_TERMINAL_STATUSES = [
  "pending",
  "extracting",
  "validating",
  "generating_report",
] as const;

export interface ResetStuckDocumentsOptions {
  /** Minutes a document must be stuck before being reset. Default: 30. */
  thresholdMinutes?: number;
  /** If true, preview without writing to DB. Default: false. */
  dryRun?: boolean;
  /** Maximum number of documents to reset in one call. Default: 200. */
  limit?: number;
}

export interface ResetStuckDocumentsResult {
  /** Documents examined (matched the stuck query). */
  examined: number;
  /** Documents reset to 'pending'. */
  reset: number;
  /** Documents that failed to reset. */
  errors: number;
  /** Whether this was a dry run. */
  dryRun: boolean;
  /** Status distribution of the stuck documents. */
  statusBreakdown: Record<string, number>;
}

export async function resetStuckDocuments(
  opts: ResetStuckDocumentsOptions = {}
): Promise<ResetStuckDocumentsResult> {
  const thresholdMinutes = opts.thresholdMinutes ?? DEFAULT_THRESHOLD_MINUTES;
  const dryRun = opts.dryRun ?? false;
  const limit = opts.limit ?? 200;

  const result: ResetStuckDocumentsResult = {
    examined: 0,
    reset: 0,
    errors: 0,
    dryRun,
    statusBreakdown: {},
  };

  const db = await getDb();
  if (!db) {
    log.warn("resetStuckDocuments: DB unavailable — aborting");
    return result;
  }

  const cutoff = new Date(Date.now() - thresholdMinutes * 60 * 1000);

  // Find stuck documents
  const stuckDocs = await db
    .select({ id: documents.id, status: documents.status })
    .from(documents)
    .where(
      and(
        lt(documents.createdAt, cutoff),
        sql`${documents.status} IN ('pending','extracting','validating','generating_report')`
      )
    )
    .limit(limit);

  result.examined = stuckDocs.length;
  log.info(
    `resetStuckDocuments: found ${stuckDocs.length} stuck documents (threshold: ${thresholdMinutes}min)`
  );

  // Track status breakdown
  for (const doc of stuckDocs) {
    const s = doc.status ?? "unknown";
    result.statusBreakdown[s] = (result.statusBreakdown[s] ?? 0) + 1;
  }

  if (dryRun) {
    log.info(
      `[dry-run] would reset ${stuckDocs.length} documents to 'pending'`
    );
    return result;
  }

  // Reset each stuck document to 'pending'
  for (const doc of stuckDocs) {
    try {
      await db
        .update(documents)
        .set({ status: "pending" })
        .where(sql`${documents.id} = ${doc.id}`);
      result.reset++;
      log.debug(`doc ${doc.id}: reset from '${doc.status}' → 'pending'`);
    } catch (err) {
      result.errors++;
      log.error(`doc ${doc.id}: reset failed`, errData(err));
    }
  }

  log.info(
    "resetStuckDocuments complete",
    result as unknown as Record<string, unknown>
  );
  return result;
}

export function registerResetStuckDocumentsRoute(
  app: Express,
  requireCronOrAdmin: RequestHandler
): void {
  app.post(
    "/api/admin/reset-stuck-documents",
    requireCronOrAdmin,
    async (req: Request, res: Response) => {
      const thresholdMinutes = Number(
        req.body?.thresholdMinutes ?? DEFAULT_THRESHOLD_MINUTES
      );
      const dryRun = req.body?.dryRun === true || req.body?.dryRun === "true";
      const limit = Number(req.body?.limit ?? 200);

      if (
        isNaN(thresholdMinutes) ||
        thresholdMinutes < 1 ||
        thresholdMinutes > 1440
      ) {
        res
          .status(400)
          .json({ error: "thresholdMinutes must be between 1 and 1440" });
        return;
      }
      if (isNaN(limit) || limit < 1 || limit > 500) {
        res.status(400).json({ error: "limit must be between 1 and 500" });
        return;
      }

      log.info(
        `POST /api/admin/reset-stuck-documents thresholdMinutes=${thresholdMinutes} dryRun=${dryRun} limit=${limit}`
      );

      const result = await resetStuckDocuments({
        thresholdMinutes,
        dryRun,
        limit,
      });
      res.json({ ok: true, ...result });
    }
  );
}
