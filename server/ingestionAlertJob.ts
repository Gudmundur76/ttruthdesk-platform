/**
 * ingestionAlertJob.ts — Phase 129
 *
 * Push-based alerting for the autonomous ingestion pipeline.
 * Called by the Manus heartbeat scheduler (POST /api/scheduled/ingestion-alerts).
 *
 * Checks:
 *   1. Ingestion stall   — no new papers ingested in the last 6h
 *   2. High failure rate — >20% of recent papers in "failed" status
 *
 * Fires notifyOwner() for each triggered alert (deduplicated by a 4h cooldown
 * stored in-memory; resets on process restart — acceptable for a heartbeat job).
 */

import type { Request, Response } from "express";
import { getDb } from "./db";
import { autoIngestedPapers } from "../drizzle/schema";
import { desc, gte } from "drizzle-orm";
import { notifyOwner } from "./_core/notification";
import { logger } from "./logger";

const log = logger("ingestionAlertJob");

// ─── Config ───────────────────────────────────────────────────────────────────

const STALL_THRESHOLD_MS = 6 * 60 * 60 * 1000;       // 6 hours
const FAILURE_RATE_THRESHOLD = 0.20;                   // 20%
const FAILURE_RATE_WINDOW_MS = 24 * 60 * 60 * 1000;   // look back 24h
const ALERT_COOLDOWN_MS = 4 * 60 * 60 * 1000;         // 4h between same-type alerts

// ─── In-memory dedup ──────────────────────────────────────────────────────────

const lastAlertFiredAt = new Map<string, number>();

function shouldFire(alertKey: string): boolean {
  const last = lastAlertFiredAt.get(alertKey) ?? 0;
  return Date.now() - last > ALERT_COOLDOWN_MS;
}

function markFired(alertKey: string): void {
  lastAlertFiredAt.set(alertKey, Date.now());
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AlertCheckResult {
  alertsFired: number;
  skipped: boolean;
  checks: string[];
  durationMs: number;
}

// ─── Main check ───────────────────────────────────────────────────────────────

export async function checkIngestionAlerts(): Promise<AlertCheckResult> {
  const startedAt = Date.now();
  const checks: string[] = [];
  let alertsFired = 0;

  const db = await getDb();
  if (!db) {
    log.warn("[ingestionAlerts] DB unavailable — skipping alert checks");
    return { alertsFired: 0, skipped: true, checks: [], durationMs: Date.now() - startedAt };
  }

  // ── Check 1: Ingestion stall ─────────────────────────────────────────────
  try {
    const rows = await db
      .select()
      .from(autoIngestedPapers)
      .orderBy(desc(autoIngestedPapers.ingestedAt))
      .limit(1);

    if (rows.length > 0) {
      const ageMs = Date.now() - new Date(rows[0].ingestedAt).getTime();
      if (ageMs > STALL_THRESHOLD_MS && shouldFire("stall")) {
        const ageH = Math.round(ageMs / 3_600_000);
        await notifyOwner({
          title: "⚠️ Ingestion Pipeline Stalled",
          content: `No new papers have been ingested in the last ${ageH}h. Last ingestion: ${new Date(rows[0].ingestedAt).toISOString()}`,
        });
        markFired("stall");
        alertsFired++;
        checks.push("stall:fired");
      } else {
        checks.push("stall:ok");
      }
    } else {
      checks.push("stall:no-data");
    }
  } catch (err) {
    log.error("[ingestionAlerts] Stall check failed", { err: String(err) });
    checks.push("stall:error");
  }

  // ── Check 2: High failure rate ───────────────────────────────────────────
  try {
    const windowStart = new Date(Date.now() - FAILURE_RATE_WINDOW_MS);
    const recentRows = await db
      .select()
      .from(autoIngestedPapers)
      .where(gte(autoIngestedPapers.ingestedAt, windowStart));

    if (recentRows.length >= 5) {
      const failedCount = (recentRows as Array<{ status: string }>).filter(
        (r) => r.status === "failed"
      ).length;
      const failureRate = failedCount / recentRows.length;

      if (failureRate > FAILURE_RATE_THRESHOLD && shouldFire("failure_rate")) {
        const pct = Math.round(failureRate * 100);
        await notifyOwner({
          title: "⚠️ High Ingestion Failure Rate",
          content: `${pct}% of papers ingested in the last 24h have failed (${failedCount}/${recentRows.length}). Investigate pipeline errors.`,
        });
        markFired("failure_rate");
        alertsFired++;
        checks.push(`failure_rate:fired(${pct}%)`);
      } else {
        checks.push("failure_rate:ok");
      }
    } else {
      checks.push("failure_rate:insufficient-data");
    }
  } catch (err) {
    log.error("[ingestionAlerts] Failure-rate check failed", { err: String(err) });
    checks.push("failure_rate:error");
  }

  const durationMs = Date.now() - startedAt;
  log.info(`[ingestionAlerts] Done: ${alertsFired} alerts fired in ${durationMs}ms`);

  return { alertsFired, skipped: false, checks, durationMs };
}

// ─── Express handler ──────────────────────────────────────────────────────────

export async function ingestionAlertHandler(
  _req: Request,
  res: Response
): Promise<void> {
  const result = await checkIngestionAlerts();
  res.json({ ok: true, ...result });
}
