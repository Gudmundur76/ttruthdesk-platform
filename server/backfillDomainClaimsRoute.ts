/**
 * server/backfillDomainClaimsRoute.ts — Sprint 40
 * ─────────────────────────────────────────────────────────────────────────────
 * Backfill endpoint for documents that were processed with the old domain-blind
 * extractor and received 0 claims as a result.
 *
 * Provides:
 *   - backfillDomainClaims(opts): queries completed documents with claimCount=0,
 *     infers the correct domain from their rawText, re-runs extractClaims() with
 *     the domain-aware prompt, and inserts the resulting claims.
 *   - registerBackfillDomainClaimsRoute(app, requireCronOrAdmin): wires
 *     POST /api/admin/backfill-domain-claims as a cron/admin endpoint.
 *
 * Design principles:
 *   - Idempotent: skips documents that already have claims after re-check.
 *   - Paginated: processes documents in batches to keep memory bounded.
 *   - Fail-open: individual document failures are logged and counted, not thrown.
 *   - Dry-run mode: pass dryRun=true to preview without writing to DB.
 */

import type { Express, Request, Response, RequestHandler } from "express";
import { eq, and, sql } from "drizzle-orm";
import { getDb } from "./db";
import { documents, claims } from "../drizzle/schema";
import { extractClaims } from "./claimExtractor";
import { inferDomainFromText } from "./domainInference";
import { logger, errData } from "./logger";

const log = logger("backfillDomainClaimsRoute");
const DEFAULT_BATCH_SIZE = 20;

export interface BackfillDomainClaimsOptions {
  /** Maximum number of documents to process in this run. Default: 20. */
  limit?: number;
  /** If true, run inference and extraction but do not write to DB. Default: false. */
  dryRun?: boolean;
}

export interface BackfillDomainClaimsResult {
  /** Documents examined. */
  examined: number;
  /** Documents that already had claims (skipped). */
  alreadyHasClaims: number;
  /** Documents successfully re-extracted with ≥1 new claim. */
  extracted: number;
  /** Total new claims inserted. */
  claimsInserted: number;
  /** Documents that failed during extraction or DB insert. */
  errors: number;
  /** Domain distribution of re-extracted documents. */
  domainBreakdown: Record<string, number>;
}

export async function backfillDomainClaims(
  opts: BackfillDomainClaimsOptions = {}
): Promise<BackfillDomainClaimsResult> {
  const limit = opts.limit ?? DEFAULT_BATCH_SIZE;
  const dryRun = opts.dryRun ?? false;

  const result: BackfillDomainClaimsResult = {
    examined: 0,
    alreadyHasClaims: 0,
    extracted: 0,
    claimsInserted: 0,
    errors: 0,
    domainBreakdown: {},
  };

  const db = await getDb();
  if (!db) {
    log.warn("backfillDomainClaims: DB unavailable — aborting");
    return result;
  }

  // Fetch completed documents with claimCount = 0
  const zeroClaims = await db
    .select({
      id: documents.id,
      rawText: documents.rawText,
      verticalDomain: documents.verticalDomain,
      title: documents.title,
    })
    .from(documents)
    .where(
      and(eq(documents.status, "complete"), sql`${documents.claimCount} = 0`)
    )
    .orderBy(sql`${documents.createdAt} ASC`)
    .limit(limit);

  result.examined = zeroClaims.length;
  log.info(
    `backfillDomainClaims: examining ${zeroClaims.length} zero-claim documents`
  );

  for (const doc of zeroClaims) {
    try {
      // Double-check: re-count claims in DB (may have been added since the query)
      const existingClaims = await db
        .select({ id: claims.id })
        .from(claims)
        .where(eq(claims.documentId, doc.id))
        .limit(1);

      if (existingClaims.length > 0) {
        result.alreadyHasClaims++;
        log.debug(`doc ${doc.id}: already has claims — skipping`);
        continue;
      }

      // Infer domain from rawText (or use existing verticalDomain if already set correctly)
      const rawText = doc.rawText ?? doc.title ?? "";
      const inferredDomain = inferDomainFromText(rawText);

      log.info(
        `doc ${doc.id}: inferred domain '${inferredDomain}' (was '${doc.verticalDomain ?? "null"}') — re-extracting`
      );

      // Track domain distribution
      result.domainBreakdown[inferredDomain] =
        (result.domainBreakdown[inferredDomain] ?? 0) + 1;

      if (dryRun) {
        log.info(
          `[dry-run] doc ${doc.id}: would extract with domain '${inferredDomain}'`
        );
        continue;
      }

      // Re-run claim extraction with the correct domain prompt
      const extracted = await extractClaims(rawText, undefined, inferredDomain);

      if (extracted.length === 0) {
        log.info(
          `doc ${doc.id}: re-extraction returned 0 claims (domain: ${inferredDomain})`
        );
        continue;
      }

      // Insert new claims
      const claimRows = extracted.map(c => ({
        documentId: doc.id,
        claimText: c.claimText,
        claimType: c.claimType, // varchar(64) after Sprint 40 migration
        extractedValue: c.extractedValue ?? null,
        pdbId: c.pdbId ?? null,
        proteinName: c.proteinName ?? null,
        experimentalMethod: c.experimentalMethod ?? null,
        resolution: c.resolution ?? null,
        organism: c.organism ?? null,
        ligand: c.ligand ?? null,
        verticalDomain: inferredDomain,
        status: "pending" as const,
      }));

      await db.insert(claims).values(claimRows);

      // Update document claimCount and verticalDomain
      await db
        .update(documents)
        .set({
          claimCount: extracted.length,
          verticalDomain: inferredDomain,
        })
        .where(eq(documents.id, doc.id));

      result.extracted++;
      result.claimsInserted += extracted.length;
      log.info(
        `doc ${doc.id}: inserted ${extracted.length} claims (domain: ${inferredDomain})`
      );
    } catch (err) {
      result.errors++;
      log.error(`doc ${doc.id}: backfill failed`, errData(err));
    }
  }

  log.info(
    "backfillDomainClaims complete",
    result as unknown as Record<string, unknown>
  );
  return result;
}

export function registerBackfillDomainClaimsRoute(
  app: Express,
  requireCronOrAdmin: RequestHandler
): void {
  app.post(
    "/api/admin/backfill-domain-claims",
    requireCronOrAdmin,
    async (req: Request, res: Response) => {
      const limit = Number(req.body?.limit ?? DEFAULT_BATCH_SIZE);
      const dryRun = req.body?.dryRun === true || req.body?.dryRun === "true";

      if (isNaN(limit) || limit < 1 || limit > 500) {
        res.status(400).json({ error: "limit must be between 1 and 500" });
        return;
      }

      log.info(
        `POST /api/admin/backfill-domain-claims limit=${limit} dryRun=${dryRun}`
      );

      const result = await backfillDomainClaims({ limit, dryRun });
      res.json({ ok: true, dryRun, ...result });
    }
  );
}
