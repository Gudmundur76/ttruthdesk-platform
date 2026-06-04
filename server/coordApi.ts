/**
 * coordApi.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * REST API for the Manus Coordination Layer.
 *
 * These endpoints are intentionally plain Express REST (not tRPC) so that
 * external Manus tasks can call them without the tRPC client library.
 *
 * Authentication: all /api/coord/* endpoints require the X-Coord-Key header
 * to match COORD_API_KEY env var. If the key is not configured, endpoints
 * return 503.
 *
 * Endpoints:
 *   POST /api/coord/queue/enqueue          — add items to the work queue
 *   POST /api/coord/queue/dequeue          — atomically claim the next item
 *   POST /api/coord/queue/complete         — mark an item done + post result
 *   POST /api/coord/queue/fail             — release an item back to queue
 *   GET  /api/coord/queue/stats            — queue depth per vertical/status
 *
 *   GET  /api/coord/tasks                  — list active tasks
 *   POST /api/coord/tasks/register         — register a new Manus task
 *   POST /api/coord/tasks/heartbeat        — update task heartbeat + phase
 *   POST /api/coord/tasks/complete         — mark a task completed
 *   POST /api/coord/tasks/fail             — mark a task failed
 *   DELETE /api/coord/tasks/:taskId        — remove a task from registry
 *
 *   GET  /api/coord/context/:key           — read a context value
 *   PUT  /api/coord/context/:key           — write a context value
 *   DELETE /api/coord/context/:key         — delete a context value
 *   GET  /api/coord/context               — list context keys by namespace
 *
 *   GET  /api/coord/memory/graph           — export coord_context as KG JSON
 *   POST /api/coord/memory/graph/node      — add a node to the KG
 *   POST /api/coord/memory/graph/edge      — add an edge to the KG
 */

import type { Request, Response } from "express";
import { Router as makeRouter } from "express";
import { and, desc, eq, gt, isNull, lt, or, sql } from "drizzle-orm";
import { getDb } from "./db";
import {
  coordContext,
  coordQueue,
  coordTasks,
} from "../drizzle/schema";

// ─── Auth middleware ──────────────────────────────────────────────────────────

function coordAuth(req: Request, res: Response, next: () => void) {
  const coordApiKey = process.env.COORD_API_KEY ?? "";
  if (!coordApiKey) {
    res
      .status(503)
      .json({ error: "Coordination API not configured (COORD_API_KEY not set)" });
    return;
  }
  const key = req.headers["x-coord-key"] as string | undefined;
  if (!key || key !== coordApiKey) {
    res.status(401).json({ error: "Invalid or missing X-Coord-Key header" });
    return;
  }
  next();
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function minutesAgo(n: number): Date {
  return new Date(Date.now() - n * 60_000);
}

async function requireDb(res: Response) {
  const db = await getDb();
  if (!db) {
    res.status(503).json({ error: "DB unavailable" });
    return null;
  }
  return db;
}

// ─── Router factory ──────────────────────────────────────────────────────────

export function createCoordRouter() {
  const router = makeRouter();
  router.use(coordAuth);

  // ── Queue endpoints ────────────────────────────────────────────────────────

  /**
   * POST /api/coord/queue/enqueue
   * Body: { items: Array<{ vertical, pmid?, doi?, paperUrl?, title?, priority?, source? }> }
   */
  router.post("/queue/enqueue", async (req: Request, res: Response) => {
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
   * POST /api/coord/queue/dequeue
   * Body: { taskId: string, vertical?: string }
   * Atomically claims the highest-priority pending item.
   * Stale claims (claimedAt > 10 min ago) are automatically released.
   */
  router.post("/queue/dequeue", async (req: Request, res: Response) => {
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

      // Release stale claims (> 10 min old) back to pending
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
        .where(
          and(eq(coordQueue.id, next.id), eq(coordQueue.status, "pending"))
        );

      const [claimed] = await db
        .select()
        .from(coordQueue)
        .where(
          and(eq(coordQueue.id, next.id), eq(coordQueue.claimedBy, taskId))
        );

      res.json({ item: claimed ?? null });
    } catch (err: unknown) {
      res.status(500).json({ error: String(err) });
    }
  });

  /**
   * POST /api/coord/queue/complete
   * Body: { itemId: number, taskId: string, result?: object }
   */
  router.post("/queue/complete", async (req: Request, res: Response) => {
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
        .where(
          and(eq(coordQueue.id, itemId), eq(coordQueue.claimedBy, taskId))
        );
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
   * POST /api/coord/queue/fail
   * Body: { itemId: number, taskId: string, errorMsg?: string, retry?: boolean }
   */
  router.post("/queue/fail", async (req: Request, res: Response) => {
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
      const newStatus =
        retry && newRetryCount < 3 ? ("pending" as const) : ("failed" as const);
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
   * GET /api/coord/queue/stats
   */
  router.get("/queue/stats", async (_req: Request, res: Response) => {
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
          stats[row.vertical] = {
            pending: 0,
            claimed: 0,
            completed: 0,
            failed: 0,
            skipped: 0,
            total: 0,
          };
        }
        stats[row.vertical][row.status] = Number(row.count);
        stats[row.vertical].total += Number(row.count);
      }
      res.json({ stats });
    } catch (err: unknown) {
      res.status(500).json({ error: String(err) });
    }
  });

  // ── Task registry endpoints ────────────────────────────────────────────────

  /**
   * GET /api/coord/tasks
   */
  router.get("/tasks", async (_req: Request, res: Response) => {
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

  /**
   * POST /api/coord/tasks/register
   * Body: { taskId, vertical, phase?, manusTaskId?, meta? }
   */
  router.post("/tasks/register", async (req: Request, res: Response) => {
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

  /**
   * POST /api/coord/tasks/heartbeat
   * Body: { taskId, phase?, workItemId? }
   */
  router.post("/tasks/heartbeat", async (req: Request, res: Response) => {
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
      // Build update object with only defined fields
      const updateData: {
        lastHeartbeatAt: Date;
        phase?: string;
        workItemId?: number | null;
      } = { lastHeartbeatAt: new Date() };
      if (phase !== undefined) updateData.phase = phase;
      if (workItemId !== undefined) updateData.workItemId = workItemId;
      await db
        .update(coordTasks)
        .set(updateData)
        .where(eq(coordTasks.taskId, taskId));
      res.json({ ok: true });
    } catch (err: unknown) {
      res.status(500).json({ error: String(err) });
    }
  });

  /**
   * POST /api/coord/tasks/complete
   * Body: { taskId }
   */
  router.post("/tasks/complete", async (req: Request, res: Response) => {
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

  /**
   * POST /api/coord/tasks/fail
   * Body: { taskId, errorMsg? }
   */
  router.post("/tasks/fail", async (req: Request, res: Response) => {
    try {
      const db = await requireDb(res);
      if (!db) return;
      const { taskId, errorMsg } = req.body as {
        taskId: string;
        errorMsg?: string;
      };
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

  /**
   * DELETE /api/coord/tasks/:taskId
   */
  router.delete("/tasks/:taskId", async (req: Request, res: Response) => {
    try {
      const db = await requireDb(res);
      if (!db) return;
      await db
        .delete(coordTasks)
        .where(eq(coordTasks.taskId, req.params.taskId));
      res.json({ ok: true });
    } catch (err: unknown) {
      res.status(500).json({ error: String(err) });
    }
  });

  // ── Context store endpoints ────────────────────────────────────────────────

  /**
   * GET /api/coord/context?namespace=xxx
   * List all context keys in a namespace (non-expired).
   * NOTE: must be registered BEFORE /:key to avoid route conflict.
   */
  router.get("/context", async (req: Request, res: Response) => {
    try {
      const db = await requireDb(res);
      if (!db) return;
      const namespace = (req.query.namespace as string) ?? "global";
      const rows = await db
        .select({
          key: coordContext.key,
          namespace: coordContext.namespace,
          updatedAt: coordContext.updatedAt,
          expiresAt: coordContext.expiresAt,
        })
        .from(coordContext)
        .where(
          and(
            eq(coordContext.namespace, namespace),
            or(
              isNull(coordContext.expiresAt),
              gt(coordContext.expiresAt, new Date())
            )
          )
        )
        .orderBy(desc(coordContext.updatedAt))
        .limit(200);
      res.json({ keys: rows });
    } catch (err: unknown) {
      res.status(500).json({ error: String(err) });
    }
  });

  /**
   * GET /api/coord/context/:key
   */
  router.get("/context/:key(*)", async (req: Request, res: Response) => {
    try {
      const db = await requireDb(res);
      if (!db) return;
      const [row] = await db
        .select()
        .from(coordContext)
        .where(eq(coordContext.key, req.params.key));
      if (!row) {
        res.status(404).json({ error: "Key not found" });
        return;
      }
      if (row.expiresAt && row.expiresAt < new Date()) {
        await db
          .delete(coordContext)
          .where(eq(coordContext.key, req.params.key));
        res.status(404).json({ error: "Key expired" });
        return;
      }
      res.json({ key: row.key, value: row.value, updatedAt: row.updatedAt });
    } catch (err: unknown) {
      res.status(500).json({ error: String(err) });
    }
  });

  /**
   * PUT /api/coord/context/:key
   * Body: { value: any, namespace?: string, ttlSeconds?: number }
   */
  router.put("/context/:key(*)", async (req: Request, res: Response) => {
    try {
      const db = await requireDb(res);
      if (!db) return;
      const { value, namespace, ttlSeconds } = req.body as {
        value: unknown;
        namespace?: string;
        ttlSeconds?: number;
      };
      if (value === undefined) {
        res.status(400).json({ error: "value is required" });
        return;
      }
      const expiresAt = ttlSeconds
        ? new Date(Date.now() + ttlSeconds * 1000)
        : null;
      await db
        .insert(coordContext)
        .values({
          key: req.params.key,
          value: value as Record<string, unknown>,
          namespace: namespace ?? "global",
          expiresAt,
        })
        .onDuplicateKeyUpdate({
          set: {
            value: value as Record<string, unknown>,
            namespace: namespace ?? "global",
            expiresAt,
            updatedAt: new Date(),
          },
        });
      res.json({ ok: true });
    } catch (err: unknown) {
      res.status(500).json({ error: String(err) });
    }
  });

  /**
   * DELETE /api/coord/context/:key
   */
  router.delete("/context/:key(*)", async (req: Request, res: Response) => {
    try {
      const db = await requireDb(res);
      if (!db) return;
      await db
        .delete(coordContext)
        .where(eq(coordContext.key, req.params.key));
      res.json({ ok: true });
    } catch (err: unknown) {
      res.status(500).json({ error: String(err) });
    }
  });

  // ── Knowledge Graph memory endpoints ──────────────────────────────────────
  // Mirrors manus-persistent-drive KnowledgeGraphMemory JSON format.

  /**
   * GET /api/coord/memory/graph
   * Returns: { nodes: { [id]: { label, properties } }, edges: [...] }
   */
  router.get("/memory/graph", async (_req: Request, res: Response) => {
    try {
      const db = await requireDb(res);
      if (!db) return;
      const rows = await db
        .select()
        .from(coordContext)
        .where(
          or(
            eq(coordContext.namespace, "kg:node"),
            eq(coordContext.namespace, "kg:edge")
          )
        );

      const nodes: Record<string, unknown> = {};
      const edges: unknown[] = [];

      for (const row of rows) {
        if (row.namespace === "kg:node") {
          nodes[row.key.replace("kg:node:", "")] = row.value;
        } else if (row.namespace === "kg:edge") {
          edges.push(row.value);
        }
      }

      res.json({ nodes, edges });
    } catch (err: unknown) {
      res.status(500).json({ error: String(err) });
    }
  });

  /**
   * POST /api/coord/memory/graph/node
   * Body: { nodeId, label, properties? }
   * Mirrors KnowledgeGraphMemory.add_node()
   */
  router.post("/memory/graph/node", async (req: Request, res: Response) => {
    try {
      const db = await requireDb(res);
      if (!db) return;
      const { nodeId, label, properties } = req.body as {
        nodeId: string;
        label: string;
        properties?: Record<string, unknown>;
      };
      if (!nodeId || !label) {
        res.status(400).json({ error: "nodeId and label are required" });
        return;
      }
      await db
        .insert(coordContext)
        .values({
          key: `kg:node:${nodeId}`,
          value: { label, properties: properties ?? {} },
          namespace: "kg:node",
        })
        .onDuplicateKeyUpdate({
          set: {
            value: { label, properties: properties ?? {} },
            updatedAt: new Date(),
          },
        });
      res.json({ ok: true, nodeId });
    } catch (err: unknown) {
      res.status(500).json({ error: String(err) });
    }
  });

  /**
   * POST /api/coord/memory/graph/edge
   * Body: { sourceId, targetId, type, properties? }
   * Mirrors KnowledgeGraphMemory.add_relationship()
   */
  router.post("/memory/graph/edge", async (req: Request, res: Response) => {
    try {
      const db = await requireDb(res);
      if (!db) return;
      const { sourceId, targetId, type, properties } = req.body as {
        sourceId: string;
        targetId: string;
        type: string;
        properties?: Record<string, unknown>;
      };
      if (!sourceId || !targetId || !type) {
        res
          .status(400)
          .json({ error: "sourceId, targetId, and type are required" });
        return;
      }
      const edgeId = `${sourceId}__${type}__${targetId}__${Date.now()}`;
      await db.insert(coordContext).values({
        key: `kg:edge:${edgeId}`,
        value: {
          source: sourceId,
          target: targetId,
          type,
          properties: properties ?? {},
        },
        namespace: "kg:edge",
      });
      res.json({ ok: true, edgeId });
    } catch (err: unknown) {
      res.status(500).json({ error: String(err) });
    }
  });

  return router;
}
