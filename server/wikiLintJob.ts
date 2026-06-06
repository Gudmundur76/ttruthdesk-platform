/**
 * wikiLintJob.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Heartbeat handler for the DB-backed wiki lint job.
 * Registered at POST /api/scheduled/wiki-engine-lint
 *
 * Runs weekly to:
 *   1. Lint all wiki_pages (contradictions, orphans, stale pages)
 *   2. Rebuild the wiki_index catalog
 *   3. Notify the owner with a summary
 *
 * Security: requires x-heartbeat-secret header (checked by requireCronOrAdmin).
 */

import type { Request, Response } from "express";
import { lintWiki, buildIndex } from "./wikiEngine";
import { notifyOwner } from "./_core/notification";

export async function wikiEngineLintJobHandler(req: Request, res: Response): Promise<void> {
  const start = Date.now();
  try {
    console.log("[WikiEngineLint] Starting DB wiki lint pass…");

    // 1. Run lint
    const result = await lintWiki();

    // 2. Rebuild index
    await buildIndex();

    const duration = Date.now() - start;

    // 3. Notify owner
    const summary = [
      `Wiki lint complete (${duration}ms)`,
      `Contradictions: ${result.contradictions.length}`,
      `Orphan pages: ${result.orphanSlugs.length}`,
      `Stale pages: ${result.stalePageSlugs.length}`,
      `Missing cross-refs: ${result.missingCrossRefs.length}`,
      "",
      result.summary,
    ].join("\n");

    await notifyOwner({
      title: "Wiki Engine Lint Report",
      content: summary,
    }).catch(() => {
      /* non-fatal */
    });

    console.log("[WikiEngineLint] Done.", summary);

    res.json({
      ok: true,
      duration,
      contradictions: result.contradictions.length,
      orphanSlugs: result.orphanSlugs.length,
      stalePageSlugs: result.stalePageSlugs.length,
      missingCrossRefs: result.missingCrossRefs.length,
      summary: result.summary,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[WikiEngineLint] Error:", err);
    res.status(500).json({
      ok: false,
      error: String(err),
      timestamp: new Date().toISOString(),
    });
  }
}
