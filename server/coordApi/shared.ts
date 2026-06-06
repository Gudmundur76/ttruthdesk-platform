/**
 * coordApi/shared.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Shared auth middleware and DB helper used by all coordApi sub-routers.
 */
import { createHash, timingSafeEqual } from "crypto";
import type { Request, Response } from "express";
import { getDb } from "../db";
import { ENV } from "../_core/env";

export function coordAuth(req: Request, res: Response, next: () => void) {
  const coordApiKey = ENV.coordApiKey;
  if (!coordApiKey) {
    res.status(503).json({ error: "Coordination API not configured (COORD_API_KEY not set)" });
    return;
  }
  const key = req.headers["x-coord-key"] as string | undefined;
  if (!key) {
    res.status(401).json({ error: "Missing X-Coord-Key header" });
    return;
  }
  const expected = Buffer.from(createHash("sha256").update(coordApiKey).digest());
  const provided = Buffer.from(createHash("sha256").update(key).digest());
  if (!timingSafeEqual(expected, provided)) {
    res.status(401).json({ error: "Invalid X-Coord-Key header" });
    return;
  }
  next();
}

export function minutesAgo(n: number): Date {
  return new Date(Date.now() - n * 60_000);
}

export async function requireDb(res: Response) {
  const db = await getDb();
  if (!db) {
    res.status(503).json({ error: "DB unavailable" });
    return null;
  }
  return db;
}
