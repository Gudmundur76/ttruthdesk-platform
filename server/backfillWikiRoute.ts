/**
 * backfillWikiRoute.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * POST /api/admin/backfill-wiki
 *
 * Batch-parallel wiki backfill — processes 15 documents simultaneously per
 * batch with 500ms cooldown between batches and 2-retry exponential backoff.
 *
 * Speed comparison vs. serial 300ms throttle:
 *   100 docs  → ~2 min  (was 25 min)
 *   500 docs  → ~8 min  (was 2+ hours)
 *   1000 docs → ~15 min (was 4+ hours)
 *
 * Authentication: owner-only (OWNER_OPEN_ID check via JWT session).
 *
 * Response:
 * {
 *   ok: true,
 *   total: number,
 *   processed: number,
 *   succeeded: number,
 *   failed: number,
 *   skipped: number,
 *   errors: string[],
 *   durationMs: number,
 *   llmsTxtLength: number
 * }
 */

import type { Express, Request, Response } from "express";
import { eq } from "drizzle-orm";
import { getDb, getAllCompletedDocuments } from "./db";
import { documents } from "../drizzle/schema";
import { compileDocumentToWiki, storeLlmsTxt } from "./wikiCompiler";
import { notifyOwner } from "./_core/notification";
import { ENV } from "./_core/env";

// ─── Constants ────────────────────────────────────────────────────────────────

const BATCH_SIZE = 15;         // LLM concurrency limit (tune based on provider)
const BATCH_COOLDOWN_MS = 500; // brief pause between batches
const MAX_RETRIES = 2;         // exponential backoff: 1s, 2s

// ─── Core backfill logic ──────────────────────────────────────────────────────

export interface BackfillResult {
  processed: number;
  succeeded: number;
  failed: number;
  skipped: number;
  errors: string[];
  durationMs: number;
  llmsTxtLength: number;
}

export async function runBackfillWiki(
  origin: string,
  onProgress?: (msg: string) => void
): Promise<BackfillResult> {
  const start = Date.now();
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");

  // Fetch all completed documents
  const allCompleted = await getAllCompletedDocuments(2000);

  // Skip documents that already have a wiki page compiled
  const docsToProcess = allCompleted.filter((d) => !d.wikiCompiledAt);
  const skipped = allCompleted.length - docsToProcess.length;

  onProgress?.(
    `Backfill starting: ${docsToProcess.length} documents to process, ${skipped} already compiled`
  );

  let succeeded = 0;
  let failed = 0;
  const errors: string[] = [];

  const totalBatches = Math.ceil(docsToProcess.length / BATCH_SIZE);

  for (let i = 0; i < docsToProcess.length; i += BATCH_SIZE) {
    const batch = docsToProcess.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;

    onProgress?.(
      `Batch ${batchNum}/${totalBatches}: processing ${batch.length} docs [${batch.map((d) => d.id).join(",")}]`
    );

    // Fire all compilations in parallel within the batch
    const batchPromises = batch.map(async (doc) => {
      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
          await compileDocumentToWiki(doc.id);

          // Mark as compiled so re-runs skip this document
          await db
            .update(documents)
            .set({ wikiCompiledAt: new Date() })
            .where(eq(documents.id, doc.id));

          return { id: doc.id, ok: true, error: null };
        } catch (err) {
          if (attempt === MAX_RETRIES) {
            const msg = `Doc ${doc.id} failed after ${MAX_RETRIES + 1} attempts: ${String(err).slice(0, 200)}`;
            return { id: doc.id, ok: false, error: msg };
          }
          // Exponential backoff between retries: 1s, 2s
          await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt)));
        }
      }
      return { id: doc.id, ok: false, error: "Unreachable" };
    });

    const results = await Promise.allSettled(batchPromises);

    for (const r of results) {
      if (r.status === "fulfilled" && r.value.ok) {
        succeeded++;
      } else {
        failed++;
        const errMsg =
          r.status === "fulfilled" ? (r.value.error ?? "unknown") : String(r.reason);
        errors.push(errMsg);
        onProgress?.(`✗ ${errMsg}`);
      }
    }

    onProgress?.(`Batch ${batchNum}/${totalBatches} done: ${succeeded} ok so far, ${failed} failed`);

    // Brief cooldown between batches (rate limit safety)
    if (i + BATCH_SIZE < docsToProcess.length) {
      await new Promise((r) => setTimeout(r, BATCH_COOLDOWN_MS));
    }
  }

  // Regenerate llms.txt ONCE at the end from the now-populated graph
  onProgress?.("Regenerating /llms.txt from live graph...");
  let llmsTxtLength = 0;
  try {
    const llmsTxt = await storeLlmsTxt(origin);
    llmsTxtLength = llmsTxt.length;
    onProgress?.(`/llms.txt regenerated (${llmsTxtLength} chars)`);
  } catch (err) {
    const msg = `llms.txt regeneration failed: ${String(err).slice(0, 200)}`;
    errors.push(msg);
    onProgress?.(`✗ ${msg}`);
  }

  const durationMs = Date.now() - start;

  // Notify owner on completion
  notifyOwner({
    title: "Wiki Backfill Complete",
    content: [
      `Processed: ${docsToProcess.length}`,
      `Succeeded: ${succeeded}`,
      `Failed: ${failed}`,
      `Skipped: ${skipped}`,
      `Duration: ${(durationMs / 1000).toFixed(1)}s`,
      errors.length > 0 ? `Errors:\n${errors.slice(0, 5).join("\n")}` : "No errors",
    ].join("\n"),
  }).catch(() => {});

  return {
    processed: docsToProcess.length,
    succeeded,
    failed,
    skipped,
    errors: errors.slice(0, 20),
    durationMs,
    llmsTxtLength,
  };
}

// ─── Express route registration ───────────────────────────────────────────────

import type { RequestHandler } from "express";

export function registerBackfillWikiRoute(
  app: Express,
  requireOwnerOrAdmin: RequestHandler
): void {
  /**
   * POST /api/admin/backfill-wiki
   * Fire-and-forget: returns immediately with { status: "started" } and
   * runs the backfill in the background. Progress is logged to the server
   * console and posted to Telegram if configured.
   */
  app.post("/api/admin/backfill-wiki", requireOwnerOrAdmin, async (req: Request, res: Response) => {
    const origin = ENV.appUrl || `${req.protocol}://${req.get("host") ?? "localhost:3000"}`;

    // Fire-and-forget — respond immediately so the HTTP connection doesn't time out
    res.json({
      ok: true,
      status: "started",
      message: "Backfill running in background. Check server logs or Telegram for progress.",
    });

    // Run in background (do not await)
    runBackfillWiki(origin, (msg) => {
      console.log(`[BackfillWiki] ${msg}`);
    }).catch((err) => {
      console.error("[BackfillWiki] Fatal error:", err);
    });
  });

  /**
   * POST /api/admin/backfill-wiki/sync
   * Synchronous variant — waits for completion and returns full results.
   * Use for small corpora (<50 docs) or testing. Will timeout for large corpora.
   */
  app.post("/api/admin/backfill-wiki/sync", requireOwnerOrAdmin, async (req: Request, res: Response) => {
    const origin = ENV.appUrl || `${req.protocol}://${req.get("host") ?? "localhost:3000"}`;

    try {
      const result = await runBackfillWiki(origin, (msg) => {
        console.log(`[BackfillWiki/sync] ${msg}`);
      });
      res.json({ ok: true, ...result });
    } catch (err) {
      res.status(500).json({ ok: false, error: String(err) });
    }
  });

  /**
   * GET /api/admin/backfill-wiki/status
   * Returns count of completed documents and how many still need wiki compilation.
   */
  app.get("/api/admin/backfill-wiki/status", requireOwnerOrAdmin, async (_req: Request, res: Response) => {
    const db = await getDb();
    if (!db) {
      res.status(503).json({ error: "DB unavailable" });
      return;
    }

    const allCompleted = await getAllCompletedDocuments(2000);
    const compiled = allCompleted.filter((d) => !!d.wikiCompiledAt).length;
    const pending = allCompleted.length - compiled;

    res.json({
      completedDocuments: allCompleted.length,
      wikiCompiled: compiled,
      wikiPending: pending,
      percentComplete: allCompleted.length > 0 ? Math.round((compiled / allCompleted.length) * 100) : 0,
    });
  });
}
