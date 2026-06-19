/**
 * telemetryCollector.ts — Unified Layer Telemetry Service
 *
 * Provides a single `emitLayerTelemetry()` helper that every autonomous loop
 * layer (L0–L5) calls to record start/end/error rows in the `layer_telemetry`
 * table. This closes the "telemetryCollector.ts service" audit gap.
 *
 * Design principles:
 *   - Non-fatal: telemetry failures NEVER propagate to callers
 *   - Correlation IDs: callers pass a correlationId so start/end rows are linked
 *   - Typed layer enum: enforced at compile time
 *   - Thin wrapper: no business logic — only writes to DB
 *
 * Usage:
 *   const corrId = randomUUID();
 *   await emitLayerTelemetry("L1_TRUTH", "start", corrId, { eventQueueId: event.id });
 *   try {
 *     const result = await runTruthLayer(event);
 *     await emitLayerTelemetry("L1_TRUTH", "end", corrId, { durationMs, success: true });
 *   } catch (err) {
 *     await emitLayerTelemetry("L1_TRUTH", "error", corrId, { errorCode: "LAYER_ERROR" });
 *   }
 */

import { getDb } from "./db";
import { layerTelemetry } from "../drizzle/schema";
import { logger } from "./logger";

const log = logger("telemetryCollector");

// ─── Types ────────────────────────────────────────────────────────────────────

export type TelemetryLayer =
  | "L0_FRICTION"
  | "L1_TRUTH"
  | "L2_SELF_PROMPT"
  | "L3_FRONTIER"
  | "L4_META"
  | "L5_DREAM"
  | "ORCHESTRATOR";

export type TelemetryEventType = "start" | "end" | "error";

export interface TelemetryOptions {
  /** The event_queue row ID that triggered this layer run */
  eventQueueId?: number;
  /** Duration in milliseconds (for "end" events) */
  durationMs?: number;
  /** Whether the layer completed successfully (for "end" events) */
  success?: boolean;
  /** Short error code (for "error" events) */
  errorCode?: string;
  /** SHA-256 hash of the input payload (optional) */
  payloadHash?: string;
  /** Additional structured metadata */
  meta?: Record<string, unknown>;
}

// ─── Core Helper ─────────────────────────────────────────────────────────────

/**
 * Emit a single telemetry row to `layer_telemetry`.
 * Non-fatal — any DB error is logged and swallowed.
 */
export async function emitLayerTelemetry(
  layer: TelemetryLayer,
  eventType: TelemetryEventType,
  correlationId: string,
  opts?: TelemetryOptions
): Promise<void> {
  try {
    const db = await getDb();
    if (!db) return;
    await db.insert(layerTelemetry).values({
      layer,
      eventType,
      correlationId,
      eventQueueId: opts?.eventQueueId,
      durationMs: opts?.durationMs,
      success: opts?.success ?? eventType !== "error",
      errorCode: opts?.errorCode,
      payloadHash: opts?.payloadHash,
      metadataJson: opts?.meta,
    });
  } catch (err) {
    // Telemetry is non-fatal — log at debug level only
    log.debug(
      `[TelemetryCollector] Failed to write ${layer}/${eventType}: ${String(err)}`
    );
  }
}

// ─── Convenience Wrappers ────────────────────────────────────────────────────

/**
 * Emit a "start" telemetry row and return the correlationId.
 * Callers should pass this ID to emitLayerEnd / emitLayerError.
 */
export async function emitLayerStart(
  layer: TelemetryLayer,
  correlationId: string,
  opts?: Pick<TelemetryOptions, "eventQueueId" | "payloadHash" | "meta">
): Promise<void> {
  await emitLayerTelemetry(layer, "start", correlationId, opts);
}

/**
 * Emit an "end" telemetry row with duration and success flag.
 */
export async function emitLayerEnd(
  layer: TelemetryLayer,
  correlationId: string,
  startMs: number,
  opts?: Pick<TelemetryOptions, "eventQueueId" | "meta">
): Promise<void> {
  await emitLayerTelemetry(layer, "end", correlationId, {
    ...opts,
    durationMs: Date.now() - startMs,
    success: true,
  });
}

/**
 * Emit an "error" telemetry row.
 */
export async function emitLayerError(
  layer: TelemetryLayer,
  correlationId: string,
  errorCode: string,
  opts?: Pick<TelemetryOptions, "eventQueueId" | "durationMs" | "meta">
): Promise<void> {
  await emitLayerTelemetry(layer, "error", correlationId, {
    ...opts,
    success: false,
    errorCode,
  });
}

// ─── Query Helpers ────────────────────────────────────────────────────────────

export interface LayerTelemetrySummary {
  layer: TelemetryLayer;
  totalRuns: number;
  successRate: number;
  avgDurationMs: number | null;
  lastRunAt: Date | null;
  errorCount: number;
}

/**
 * Get a summary of recent telemetry for a specific layer.
 * Returns null if DB is unavailable.
 */
export async function getLayerTelemetrySummary(
  layer: TelemetryLayer,
  windowHours = 24
): Promise<LayerTelemetrySummary | null> {
  try {
    const db = await getDb();
    if (!db) return null;

    const windowMs = windowHours * 60 * 60 * 1000;
    const since = new Date(Date.now() - windowMs);

    const rows = await db
      .select()
      .from(layerTelemetry)
      .where(
        // Filter by layer and time window using raw SQL via Drizzle
        // We use a JS-side filter here to avoid importing sql`` template
        // (this is a low-frequency admin query, not a hot path)
        undefined as never
      );

    // JS-side filter (acceptable for admin/dashboard use)
    const filtered = rows.filter(
      r =>
        r.layer === layer &&
        r.eventType === "end" &&
        r.createdAt >= since
    );

    const errorRows = rows.filter(
      r =>
        r.layer === layer &&
        r.eventType === "error" &&
        r.createdAt >= since
    );

    const totalRuns = filtered.length;
    const successCount = filtered.filter(r => r.success).length;
    const durations = filtered
      .map(r => r.durationMs)
      .filter((d): d is number => d !== null);
    const avgDurationMs =
      durations.length > 0
        ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
        : null;
    const lastRunAt =
      filtered.length > 0
        ? filtered.reduce((a, b) => (a.createdAt > b.createdAt ? a : b))
            .createdAt
        : null;

    return {
      layer,
      totalRuns,
      successRate: totalRuns > 0 ? successCount / totalRuns : 0,
      avgDurationMs,
      lastRunAt,
      errorCount: errorRows.length,
    };
  } catch {
    return null;
  }
}
