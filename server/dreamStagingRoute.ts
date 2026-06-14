/**
 * dreamStagingRoute.ts — Sprint 0 Fix 3
 * ─────────────────────────────────────────────────────────────────────────────
 * POST /api/admin/dream-staging/:id/review
 *
 * Owner-only admin endpoint to approve or reject a staged dream hypothesis.
 *
 * On approve:
 *   - Updates status to 'approved' and sets reviewedBy/reviewedAt
 *   - Publishes a gap_closed event if the hypothesis has a gapId
 *
 * On reject:
 *   - Updates status to 'rejected' and sets reviewedBy/reviewedAt
 *   - No ingestion occurs
 */
import type { Express, Request, Response } from "express";
import { eq } from "drizzle-orm";
import { getDb } from "./db";
import { dreamStagingQueue } from "../drizzle/schema";
import { publishEvent } from "./autonomousLoop/eventBus";

export function registerDreamStagingRoute(
  app: Express,
  requireOwnerOrAdmin: (req: Request, res: Response, next: () => void) => void
): void {
  app.post(
    "/api/admin/dream-staging/:id/review",
    requireOwnerOrAdmin,
    async (req: Request, res: Response) => {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) {
        res.status(400).json({ ok: false, error: "Invalid id" });
        return;
      }
      const action = req.body?.action as string | undefined;
      if (action !== "approve" && action !== "reject") {
        res
          .status(400)
          .json({ ok: false, error: "action must be 'approve' or 'reject'" });
        return;
      }
      const reviewNote =
        typeof req.body?.note === "string" ? req.body.note : null;

      const db = await getDb();
      if (!db) {
        res.status(503).json({ ok: false, error: "DB unavailable" });
        return;
      }

      // Fetch the staged item
      const rows = await db
        .select()
        .from(dreamStagingQueue)
        .where(eq(dreamStagingQueue.id, id));

      if (rows.length === 0) {
        res.status(404).json({ ok: false, error: "Staged item not found" });
        return;
      }

      const item = rows[0];
      if (item.status !== "pending") {
        res
          .status(409)
          .json({ ok: false, error: `Item already ${item.status}` });
        return;
      }

      const reviewedBy =
        (req as Request & { user?: { openId?: string } }).user?.openId ??
        "admin";
      const reviewedAt = Date.now();

      if (action === "approve") {
        await db
          .update(dreamStagingQueue)
          .set({ status: "approved", reviewedBy, reviewedAt, reviewNote })
          .where(eq(dreamStagingQueue.id, id));

        // Publish gap_closed if hypothesis has a gapId
        const hypothesis = item.hypothesis as Record<string, unknown> | null;
        if (hypothesis && typeof hypothesis.gapId === "number") {
          await publishEvent("gap_closed", {
            gapId: hypothesis.gapId,
            triggeredBy: item.sessionEventId,
            source: "dream_staging_approved",
          });
        }

        res.json({ ok: true, action: "approved", id });
      } else {
        await db
          .update(dreamStagingQueue)
          .set({ status: "rejected", reviewedBy, reviewedAt, reviewNote })
          .where(eq(dreamStagingQueue.id, id));

        res.json({ ok: true, action: "rejected", id });
      }
    }
  );
}
