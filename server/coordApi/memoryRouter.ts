/**
 * coordApi/memoryRouter.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Knowledge Graph memory endpoints — mirrors manus-persistent-drive
 * KnowledgeGraphMemory JSON format.
 * Extracted from coordApi.ts (was lines 620–739).
 */
import type { Request, Response } from "express";
import { Router as makeRouter } from "express";
import { eq, or } from "drizzle-orm";
import { coordContext } from "../../drizzle/schema";
import { requireDb } from "./shared";

export function createMemoryRouter() {
  const router = makeRouter();

  /**
   * GET /memory/graph
   * Returns: { nodes: { [id]: { label, properties } }, edges: [...] }
   */
  router.get("/graph", async (_req: Request, res: Response) => {
    try {
      const db = await requireDb(res);
      if (!db) return;
      const rows = await db
        .select()
        .from(coordContext)
        .where(or(eq(coordContext.namespace, "kg:node"), eq(coordContext.namespace, "kg:edge")));
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
   * POST /memory/graph/node
   * Body: { nodeId, label, properties? }
   */
  router.post("/graph/node", async (req: Request, res: Response) => {
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
          set: { value: { label, properties: properties ?? {} }, updatedAt: new Date() },
        });
      res.json({ ok: true, nodeId });
    } catch (err: unknown) {
      res.status(500).json({ error: String(err) });
    }
  });

  /**
   * POST /memory/graph/edge
   * Body: { sourceId, targetId, type, properties? }
   */
  router.post("/graph/edge", async (req: Request, res: Response) => {
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
        res.status(400).json({ error: "sourceId, targetId, and type are required" });
        return;
      }
      const edgeId = `${sourceId}__${type}__${targetId}__${Date.now()}`;
      await db.insert(coordContext).values({
        key: `kg:edge:${edgeId}`,
        value: { source: sourceId, target: targetId, type, properties: properties ?? {} },
        namespace: "kg:edge",
      });
      res.json({ ok: true, edgeId });
    } catch (err: unknown) {
      res.status(500).json({ error: String(err) });
    }
  });

  return router;
}
