/**
 * cronRunLogger.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Lightweight helper for recording cron job execution results to the
 * cron_run_log table. Called at the end of each scheduled job handler.
 *
 * Usage:
 *   const t0 = Date.now();
 *   // ... do work ...
 *   await logCronRun("discovery-loop-daily", "ok", Date.now() - t0, "Ingested 12 papers");
 */

import { getDb } from "./db";
import { cronRunLog } from "../drizzle/schema";

export type CronRunStatus = "ok" | "error" | "skipped";

/**
 * Write a single run record to cron_run_log.
 * Non-fatal — if the DB write fails, logs a warning but does not throw.
 */
export async function logCronRun(
  jobName: string,
  status: CronRunStatus,
  durationMs: number,
  summary?: string,
  errorMessage?: string
): Promise<void> {
  try {
    const db = await getDb();
    if (!db) return;
    await db.insert(cronRunLog).values({
      jobName,
      status,
      durationMs,
      summary: summary ?? null,
      errorMessage: errorMessage ?? null,
    });
  } catch (err) {
    console.warn(`[CronRunLogger] Failed to write run record for ${jobName}:`, err);
  }
}

/**
 * Convenience wrapper: records a run and returns the result object.
 * Useful for wrapping an entire job in a try/catch.
 *
 * @example
 *   const result = await withCronLog("discovery-loop-daily", async () => {
 *     const count = await runDiscovery();
 *     return `Ingested ${count} papers`;
 *   });
 */
export async function withCronLog(
  jobName: string,
  fn: () => Promise<string>
): Promise<{ status: CronRunStatus; summary: string; durationMs: number }> {
  const t0 = Date.now();
  try {
    const summary = await fn();
    const durationMs = Date.now() - t0;
    await logCronRun(jobName, "ok", durationMs, summary);
    return { status: "ok", summary, durationMs };
  } catch (err) {
    const durationMs = Date.now() - t0;
    const errorMessage = err instanceof Error ? err.message : String(err);
    await logCronRun(jobName, "error", durationMs, undefined, errorMessage);
    return { status: "error", summary: errorMessage, durationMs };
  }
}
