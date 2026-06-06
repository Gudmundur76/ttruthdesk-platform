/**
 * coordApi/queueRouter.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Queue endpoints: enqueue, dequeue, complete, fail, stats
 * Extracted from coordApi.ts (was lines 101–330).
 */
import type { Request, Response } from "express";
import { Router as makeRouter } from "express";
import { and, desc, eq, lt, sql } from "drizzle-orm";
import { coordQueue, coordTasks } from "../../drizzle/schema";
import { minutesAgo, requireDb } from "./shared";

export function createQueueRouter() {
  const router = makeRouter();

  /**
   * POST /queue/enqueue
   * Body: { items: Array<{ vertical, pmid?, doi?, paperUrl?, title?, priority?, source? }> }
   */
  router.post("/enqueue", async (req: Request, res: Response) => {
    try {
      const db = await requireDb(res);
      if (!db) return;
      const { items } = req.body as {
        items: Array<{
          vertical: string;
          pmid?: string;
          doi?: string;
          paperUrl?: string;
          title?: string;
          priority?: number;
          source?: string;
        }>;
      };
      if (!Array.isArray(items) || items.length === 0) {
        res.status(400).json({ error: "items must be a non-empty array" });
        return;
      }
      const unique = items.filter(
        (item, idx, arr) =>
          !item.pmid || arr.findIndex((x) => x.pmid === item.pmid) === idx
      );
      await db.insert(coordQueue).values(
        unique.map((item) => ({
          vertical: item.vertical,
          pmid: item.pmid ?? null,
          doi: item.doi ?? null,
          paperUrl: item.paperUrl ?? null,
          title: item.title ?? null,
          priority: item.priority ?? 0,
          source: item.source ?? "manual",
          status: "pending" as const,
        }))
      );
      res.json({ inserted: unique.length });
    } catch (err: unknown) {
      res.status(500).json({ error: String(err) });
    }
  });

  /**
   * POST /queue/dequeue
   * Body: { taskId: string, vertical?: string }
   * Atomically claims the highest-priority pending item.
   * Stale claims (claimedAt > 10 min ago) are automatically released.
   */
  router.post("/dequeue", async (req: Request, res: Response) => {
    try {
      const db = await requireDb(res);
      if (!db) return;
      const { taskId, vertical } = req.body as {
        taskId: string;
        vertical?: string;
      };
      if (!taskId) {
        res.status(400).json({ error: "taskId is required" });
        return;
      }
      // Release stale claims (>10 min) back to pending
      await db
        .update(coordQueue)
        .set({ status: "pending", claimedBy: null, claimedAt: null })
        .where(
          and(
            eq(coordQueue.status, "claimed"),
            lt(coordQueue.claimedAt, minutesAgo(10))
          )
        );
      const conditions = [eq(coordQueue.status, "pending")];
      if (vertical) conditions.push(eq(coordQueue.vertical, vertical));
      const [next] = await db
        .select()
        .from(coordQueue)
        .where(and(...conditions))
        .orderBy(desc(coordQueue.priority), coordQueue.createdAt)
        .limit(1);
      if (!next) {
        res.json({ item: null });
        return;
      }
      await db
        .update(coordQueue)
        .set({ status: "claimed", claimedBy: taskId, claimedAt: new Date() })
        .where(and(eq(coordQueue.id, next.id), eq(coordQueue.status, "pending")));
      const [claimed] = await db
        .select()
        .from(coordQueue)
        .where(and(eq(coordQueue.id, next.id), eq(coordQueue.claimedBy, taskId)));
      res.json({ item: claimed ?? null });
    } catch (err: unknown) {
      res.status(500).json({ error: String(err) });
    }
  });

  /**
   * POST /queue/complete
   * Body: { itemId: number, taskId: string, result?: object }
   */
  router.post("/complete", async (req: Request, res: Response) => {
    try {
      const db = await requireDb(res);
      if (!db) return;
      const { itemId, taskId, result } = req.body as {
        itemId: number;
        taskId: string;
        result?: Record<string, unknown>;
      };
      if (!itemId || !taskId) {
        res.status(400).json({ error: "itemId and taskId are required" });
        return;
      }
      await db
        .update(coordQueue)
        .set({ status: "completed", result: result ?? null, completedAt: new Date() })
        .where(and(eq(coordQueue.id, itemId), eq(coordQueue.claimedBy, taskId)));
      await db
        .update(coordTasks)
        .set({
          itemsCompleted: sql`${coordTasks.itemsCompleted} + 1`,
          lastHeartbeatAt: new Date(),
        })
        .where(eq(coordTasks.taskId, taskId));
      res.json({ ok: true });
    } catch (err: unknown) {
      res.status(500).json({ error: String(err) });
    }
  });

  /**
   * POST /queue/fail
   * Body: { itemId: number, taskId: string, errorMsg?: string, retry?: boolean }
   */
  router.post("/fail", async (req: Request, res: Response) => {
    try {
      const db = await requireDb(res);
      if (!db) return;
      const { itemId, taskId, errorMsg, retry = true } = req.body as {
        itemId: number;
        taskId: string;
        errorMsg?: string;
        retry?: boolean;
      };
      if (!itemId || !taskId) {
        res.status(400).json({ error: "itemId and taskId are required" });
        return;
      }
      const [item] = await db
        .select()
        .from(coordQueue)
        .where(eq(coordQueue.id, itemId));
      if (!item) {
        res.status(404).json({ error: "Item not found" });
        return;
      }
      const newRetryCount = (item.retryCount ?? 0) + 1;
      const newStatus = retry && newRetryCount < 3 ? ("pending" as const) : ("failed" as const);
      await db
        .update(coordQueue)
        .set({
          status: newStatus,
          claimedBy: null,
          claimedAt: null,
          errorMsg: errorMsg ?? null,
          retryCount: newRetryCount,
        })
        .where(eq(coordQueue.id, itemId));
      res.json({ ok: true, status: newStatus, retryCount: newRetryCount });
    } catch (err: unknown) {
      res.status(500).json({ error: String(err) });
    }
  });

  /**
   * GET /queue/stats
   */
  router.get("/stats", async (_req: Request, res: Response) => {
    try {
      const db = await requireDb(res);
      if (!db) return;
      const rows = await db
        .select({
          vertical: coordQueue.vertical,
          status: coordQueue.status,
          count: sql<number>`COUNT(*)`,
        })
        .from(coordQueue)
        .groupBy(coordQueue.vertical, coordQueue.status);
      const stats: Record<string, Record<string, number>> = {};
      for (const row of rows) {
        if (!stats[row.vertical]) {
          stats[row.vertical] = { pending: 0, claimed: 0, completed: 0, failed: 0, skipped: 0, total: 0 };
        }
        stats[row.vertical][row.status] = Number(row.count);
        stats[row.vertical].total += Number(row.count);
      }
      res.json({ stats });
    } catch (err: unknown) {
      res.status(500).json({ error: String(err) });
    }
  });

  return router;
}
