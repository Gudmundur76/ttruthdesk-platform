/**
 * backfillWikiRoute.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * POST /api/admin/backfill-wiki
 *
 * Iterates all completed documents and calls compileDocumentToWiki for each.
 * After all documents are processed, regenerates /llms.txt from the live graph.
 *
 * Authentication: owner-only (OWNER_OPEN_ID check via JWT session).
 * Rate-limited: runs sequentially with 200ms delay between documents to avoid
 * hammering the LLM API.
 *
 * Response:
 * {
 *   ok: true,
 *   total: number,
 *   succeeded: number,
 *   failed: number,
 *   errors: string[],
 *   llmsTxtLength: number
 * }
 */

import type { Express, Request, Response } from "express";
import { getAllCompletedDocuments } from "./db";
import { compileDocumentToWiki, storeLlmsTxt } from "./wikiCompiler";
import { sdk } from "./_core/sdk";
import { ENV } from "./_core/env";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function registerBackfillWikiRoute(app: Express): void {
  app.post("/api/admin/backfill-wiki", async (req: Request, res: Response) => {
    // Owner-only auth check
    const user = await sdk.authenticateRequest(req);
    if (!user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    if (user.openId !== ENV.ownerOpenId) {
      res.status(403).json({ error: "Owner access required" });
      return;
    }

    const origin =
      process.env.VITE_APP_URL ??
      `${req.protocol}://${req.get("host") ?? "protein-desk-5r5rzpyg.manus.space"}`;

    const docs = await getAllCompletedDocuments(500);
    let succeeded = 0;
    let failed = 0;
    const errors: string[] = [];

    console.log(`[BackfillWiki] Starting backfill for ${docs.length} completed documents`);

    for (const doc of docs) {
      try {
        await compileDocumentToWiki(doc.id);
        succeeded++;
        console.log(`[BackfillWiki] ✓ Document ${doc.id} (${doc.title ?? "untitled"})`);
      } catch (err) {
        failed++;
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`Document ${doc.id}: ${msg}`);
        console.error(`[BackfillWiki] ✗ Document ${doc.id}: ${msg}`);
      }
      // Throttle to avoid LLM rate limits
      await sleep(300);
    }

    // Regenerate llms.txt from the now-populated graph
    let llmsTxtLength = 0;
    try {
      const llmsTxt = await storeLlmsTxt(origin);
      llmsTxtLength = llmsTxt.length;
      console.log(`[BackfillWiki] ✓ llms.txt regenerated (${llmsTxtLength} chars)`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`llms.txt regeneration: ${msg}`);
      console.error(`[BackfillWiki] ✗ llms.txt regeneration failed: ${msg}`);
    }

    res.json({
      ok: true,
      total: docs.length,
      succeeded,
      failed,
      errors: errors.slice(0, 20), // cap error list
      llmsTxtLength,
    });
  });

  // GET variant for quick status check (no processing)
  app.get("/api/admin/backfill-wiki/status", async (req: Request, res: Response) => {
    const user = await sdk.authenticateRequest(req);
    if (!user || user.openId !== ENV.ownerOpenId) {
      res.status(403).json({ error: "Owner access required" });
      return;
    }
    const docs = await getAllCompletedDocuments(500);
    res.json({ completedDocuments: docs.length });
  });
}
