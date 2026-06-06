/**
 * coordApi/contextRouter.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Context store + knowledge graph memory endpoints.
 * Extracted from coordApi.ts (was lines 510–739).
 */
import type { Request, Response } from "express";
import { Router as makeRouter } from "express";
import { and, desc, eq, gt, isNull, or } from "drizzle-orm";
import { coordContext } from "../../drizzle/schema";
import { requireDb } from "./shared";

export function createContextRouter() {
  const router = makeRouter();

  /**
   * GET /context?namespace=xxx
   * List all context keys in a namespace (non-expired).
   * NOTE: must be registered BEFORE /:key to avoid route conflict.
   */
  router.get("/", async (req: Request, res: Response) => {
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
            or(isNull(coordContext.expiresAt), gt(coordContext.expiresAt, new Date()))
          )
        )
        .orderBy(desc(coordContext.updatedAt))
        .limit(200);
      res.json({ keys: rows });
    } catch (err: unknown) {
      res.status(500).json({ error: String(err) });
    }
  });

  /** GET /context/:key */
  router.get("/:key(*)", async (req: Request, res: Response) => {
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
        await db.delete(coordContext).where(eq(coordContext.key, req.params.key));
        res.status(404).json({ error: "Key expired" });
        return;
      }
      res.json({ key: row.key, value: row.value, updatedAt: row.updatedAt });
    } catch (err: unknown) {
      res.status(500).json({ error: String(err) });
    }
  });

  /** PUT /context/:key — upsert with optional TTL */
  router.put("/:key(*)", async (req: Request, res: Response) => {
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
      const expiresAt = ttlSeconds ? new Date(Date.now() + ttlSeconds * 1000) : null;
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

  /** DELETE /context/:key */
  router.delete("/:key(*)", async (req: Request, res: Response) => {
    try {
      const db = await requireDb(res);
      if (!db) return;
      await db.delete(coordContext).where(eq(coordContext.key, req.params.key));
      res.json({ ok: true });
    } catch (err: unknown) {
      res.status(500).json({ error: String(err) });
    }
  });

  return router;
}
