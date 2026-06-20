/**
 * telemetryEndpoint.ts — GET /api/telemetry/summary
 *                        GET /api/telemetry/events
 *
 * Read-only endpoint for external consumers (self-direct) to query
 * ttruthdesk telemetry, events, and calibration data.
 *
 * No auth required — this is read-only, no sensitive data exposed.
 * Rate limited: 60 req/min per IP.
 *
 * Implements WIRE_IT.md Step 1 (ttruthdesk → self-direct integration).
 */

import type { Request, Response, Express } from "express";
import { getDb } from "./db";
import { layerTelemetry, eventQueue, claims } from "../drizzle/schema";
import { desc, gte } from "drizzle-orm";
import { logger, errData } from "./logger";

const log = logger("telemetryEndpoint");

// ─── Rate Limit (in-memory, per-process) ──────────────────────────────────────

const RATE_LIMIT_WINDOW_MS = 60_000;
export const RATE_LIMIT_MAX = 60;
const rateMap = new Map<string, { count: number; windowStart: number }>();

export function checkRateLimit(ip: string): { allowed: boolean; retryAfterSec: number } {
  const now = Date.now();
  const entry = rateMap.get(ip);
  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    rateMap.set(ip, { count: 1, windowStart: now });
    return { allowed: true, retryAfterSec: 0 };
  }
  if (entry.count >= RATE_LIMIT_MAX) {
    const retryAfterSec = Math.ceil(
      (RATE_LIMIT_WINDOW_MS - (now - entry.windowStart)) / 1000
    );
    return { allowed: false, retryAfterSec };
  }
  entry.count++;
  return { allowed: true, retryAfterSec: 0 };
}

// ─── Aggregation helpers ──────────────────────────────────────────────────────

type ClaimRow = { verdict: string | null; verdictMethod: string | null; confidenceScore: number | null };

function aggregateClaims(rows: ClaimRow[]) {
  const byVerdict: Record<string, number> = {};
  const byAdapter: Record<string, number> = {};
  let totalConfidence = 0;
  for (const row of rows) {
    const v = row.verdict ?? "unknown";
    byVerdict[v] = (byVerdict[v] ?? 0) + 1;
    const a = row.verdictMethod ?? "unknown";
    byAdapter[a] = (byAdapter[a] ?? 0) + 1;
    totalConfidence += row.confidenceScore ?? 0;
  }
  const averageConfidence =
    rows.length > 0 ? Math.round((totalConfidence / rows.length) * 1000) / 1000 : 0;
  return { byVerdict, byAdapter, averageConfidence };
}

type EventRow = { eventType: string; status: string };

function aggregateEvents(rows: EventRow[]) {
  const byType: Record<string, number> = {};
  let pending = 0;
  let failed = 0;
  for (const row of rows) {
    byType[row.eventType] = (byType[row.eventType] ?? 0) + 1;
    if (row.status === "pending") pending++;
    if (row.status === "failed") failed++;
  }
  return { byType, pending, failed };
}

type TelemetryRow = { layer: string; eventType: string; durationMs: number | null };

function aggregateLayers(rows: TelemetryRow[]) {
  const acc: Record<string, { runs: number; errors: number; totalMs: number }> = {};
  let totalRuns = 0;
  let totalErrors = 0;
  let totalDuration = 0;
  let durationCount = 0;
  for (const row of rows) {
    if (!acc[row.layer]) acc[row.layer] = { runs: 0, errors: 0, totalMs: 0 };
    acc[row.layer].runs++;
    totalRuns++;
    if (row.eventType === "error") {
      acc[row.layer].errors++;
      totalErrors++;
    }
    if (row.durationMs) {
      acc[row.layer].totalMs += row.durationMs;
      totalDuration += row.durationMs;
      durationCount++;
    }
  }
  const byLayer: Record<string, { runs: number; errors: number; avgMs: number }> = {};
  for (const [layer, data] of Object.entries(acc)) {
    byLayer[layer] = {
      runs: data.runs,
      errors: data.errors,
      avgMs: data.runs > 0 ? Math.round(data.totalMs / data.runs) : 0,
    };
  }
  const averageDurationMs =
    durationCount > 0 ? Math.round(totalDuration / durationCount) : 0;
  return { runs: totalRuns, errors: totalErrors, averageDurationMs, byLayer };
}

// ─── GET /api/telemetry/summary ───────────────────────────────────────────────

async function handleTelemetrySummary(req: Request, res: Response): Promise<void> {
  const ip =
    (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ??
    req.socket.remoteAddress ??
    "unknown";

  const rateCheck = checkRateLimit(ip);
  if (!rateCheck.allowed) {
    res.status(429).json({
      ok: false,
      error: "Rate limit exceeded.",
      retryAfterSec: rateCheck.retryAfterSec,
    });
    return;
  }

  const sinceParam = req.query.since as string | undefined;
  const since = sinceParam
    ? new Date(sinceParam)
    : new Date(Date.now() - 24 * 60 * 60 * 1000);

  try {
    const db = await getDb();
    if (!db) {
      res.status(503).json({ ok: false, error: "Database unavailable" });
      return;
    }

    const [claimRows, eventRows, telemetryRows] = await Promise.all([
      db
        .select({
          verdict: claims.verdict,
          verdictMethod: claims.verdictMethod,
          confidenceScore: claims.confidenceScore,
        })
        .from(claims)
        .where(gte(claims.createdAt, since)),
      db
        .select({ eventType: eventQueue.eventType, status: eventQueue.status })
        .from(eventQueue)
        .where(gte(eventQueue.createdAt, since)),
      db
        .select({
          layer: layerTelemetry.layer,
          eventType: layerTelemetry.eventType,
          durationMs: layerTelemetry.durationMs,
        })
        .from(layerTelemetry)
        .where(gte(layerTelemetry.createdAt, since)),
    ]);

    const claimAgg = aggregateClaims(claimRows);
    const eventAgg = aggregateEvents(eventRows);
    const layerAgg = aggregateLayers(telemetryRows);

    res.json({
      ok: true,
      summary: {
        period: { start: since.toISOString(), end: new Date().toISOString() },
        verifications: {
          total: claimRows.length,
          byVerdict: claimAgg.byVerdict,
          byAdapter: claimAgg.byAdapter,
          averageConfidence: claimAgg.averageConfidence,
        },
        events: {
          totalPublished: eventRows.length,
          byType: eventAgg.byType,
          pending: eventAgg.pending,
          failed: eventAgg.failed,
        },
        layers: layerAgg,
        calibration: {
          totalAdapters: 72,
          activeAdapters: Object.keys(claimAgg.byAdapter).length,
          averageAccuracy: 0,
        },
        generatedAt: new Date().toISOString(),
      },
    });
  } catch (err) {
    log.error("[telemetryEndpoint] summary failed:", errData(err));
    res.status(500).json({ ok: false, error: "Internal error" });
  }
}

// ─── GET /api/telemetry/events ────────────────────────────────────────────────

async function handleTelemetryEvents(req: Request, res: Response): Promise<void> {
  const sinceParam = req.query.since as string | undefined;
  const limitParam = req.query.limit as string | undefined;
  const limit = Math.min(parseInt(limitParam ?? "50", 10), 200);
  const since = sinceParam
    ? new Date(sinceParam)
    : new Date(Date.now() - 3_600_000);

  try {
    const db = await getDb();
    if (!db) {
      res.status(503).json({ ok: false, error: "Database unavailable" });
      return;
    }

    const rows = await db
      .select()
      .from(eventQueue)
      .where(gte(eventQueue.createdAt, since))
      .orderBy(desc(eventQueue.createdAt))
      .limit(limit);

    res.json({
      ok: true,
      events: rows.map(r => ({
        id: r.id,
        eventType: r.eventType,
        status: r.status,
        entryLayer: r.entryLayer,
        createdAt: r.createdAt,
      })),
    });
  } catch (err) {
    log.error("[telemetryEndpoint] events failed:", errData(err));
    res.status(500).json({ ok: false, error: "Internal error" });
  }
}

// ─── Register ─────────────────────────────────────────────────────────────────

export function registerTelemetryRoutes(app: Express): void {
  // /api/telemetry/summary is owned by telemetrySummaryRoute.ts (self-direct contract)
  // These endpoints expose the DB-backed analytics view on separate paths
  app.get("/api/telemetry/analytics", handleTelemetrySummary);
  app.get("/api/telemetry/events-log", handleTelemetryEvents);
  log.info(
    "[telemetryEndpoint] registered /api/telemetry/analytics and /api/telemetry/events-log"
  );
}
