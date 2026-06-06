/**
 * coordApi/tasksRouter.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Task registry endpoints: list, register, heartbeat, complete, fail, delete
 * Extracted from coordApi.ts (was lines 330–510).
 */
import type { Request, Response } from "express";
import { Router as makeRouter } from "express";
import { and, desc, eq, gt, or } from "drizzle-orm";
import { coordTasks } from "../../drizzle/schema";
import { minutesAgo, requireDb } from "./shared";

export function createTasksRouter() {
  const router = makeRouter();

  /** GET /tasks — active + recently failed tasks */
  router.get("/", async (_req: Request, res: Response) => {
    try {
      const db = await requireDb(res);
      if (!db) return;
      const tasks = await db
        .select()
        .from(coordTasks)
        .where(
          or(
            eq(coordTasks.status, "running"),
            eq(coordTasks.status, "pending"),
            eq(coordTasks.status, "stalled"),
            and(
              eq(coordTasks.status, "failed"),
              gt(coordTasks.startedAt, minutesAgo(60))
            )
          )
        )
        .orderBy(desc(coordTasks.startedAt));
      res.json({ tasks });
    } catch (err: unknown) {
      res.status(500).json({ error: String(err) });
    }
  });

  /** POST /tasks/register — register or re-activate a task */
  router.post("/register", async (req: Request, res: Response) => {
    try {
      const db = await requireDb(res);
      if (!db) return;
      const { taskId, vertical, phase, manusTaskId, meta } = req.body as {
        taskId: string;
        vertical: string;
        phase?: string;
        manusTaskId?: string;
        meta?: Record<string, unknown>;
      };
      if (!taskId || !vertical) {
        res.status(400).json({ error: "taskId and vertical are required" });
        return;
      }
      await db
        .insert(coordTasks)
        .values({
          taskId,
          vertical,
          phase: phase ?? "idle",
          manusTaskId: manusTaskId ?? null,
          meta: meta ?? null,
          status: "running",
        })
        .onDuplicateKeyUpdate({
          set: {
            status: "running",
            phase: phase ?? "idle",
            manusTaskId: manusTaskId ?? null,
            lastHeartbeatAt: new Date(),
          },
        });
      const [task] = await db
        .select()
        .from(coordTasks)
        .where(eq(coordTasks.taskId, taskId));
      res.json({ task });
    } catch (err: unknown) {
      res.status(500).json({ error: String(err) });
    }
  });

  /** POST /tasks/heartbeat — update phase and last-seen timestamp */
  router.post("/heartbeat", async (req: Request, res: Response) => {
    try {
      const db = await requireDb(res);
      if (!db) return;
      const { taskId, phase, workItemId } = req.body as {
        taskId: string;
        phase?: string;
        workItemId?: number;
      };
      if (!taskId) {
        res.status(400).json({ error: "taskId is required" });
        return;
      }
      const updateData: { lastHeartbeatAt: Date; phase?: string; workItemId?: number | null } = {
        lastHeartbeatAt: new Date(),
      };
      if (phase !== undefined) updateData.phase = phase;
      if (workItemId !== undefined) updateData.workItemId = workItemId;
      await db.update(coordTasks).set(updateData).where(eq(coordTasks.taskId, taskId));
      res.json({ ok: true });
    } catch (err: unknown) {
      res.status(500).json({ error: String(err) });
    }
  });

  /** POST /tasks/complete */
  router.post("/complete", async (req: Request, res: Response) => {
    try {
      const db = await requireDb(res);
      if (!db) return;
      const { taskId } = req.body as { taskId: string };
      if (!taskId) {
        res.status(400).json({ error: "taskId is required" });
        return;
      }
      await db
        .update(coordTasks)
        .set({ status: "completed", completedAt: new Date() })
        .where(eq(coordTasks.taskId, taskId));
      res.json({ ok: true });
    } catch (err: unknown) {
      res.status(500).json({ error: String(err) });
    }
  });

  /** POST /tasks/fail */
  router.post("/fail", async (req: Request, res: Response) => {
    try {
      const db = await requireDb(res);
      if (!db) return;
      const { taskId, errorMsg } = req.body as { taskId: string; errorMsg?: string };
      if (!taskId) {
        res.status(400).json({ error: "taskId is required" });
        return;
      }
      await db
        .update(coordTasks)
        .set({ status: "failed", errorMsg: errorMsg ?? null, completedAt: new Date() })
        .where(eq(coordTasks.taskId, taskId));
      res.json({ ok: true });
    } catch (err: unknown) {
      res.status(500).json({ error: String(err) });
    }
  });

  /** DELETE /tasks/:taskId */
  router.delete("/:taskId", async (req: Request, res: Response) => {
    try {
      const db = await requireDb(res);
      if (!db) return;
      await db.delete(coordTasks).where(eq(coordTasks.taskId, req.params.taskId));
      res.json({ ok: true });
    } catch (err: unknown) {
      res.status(500).json({ error: String(err) });
    }
  });

  return router;
}
