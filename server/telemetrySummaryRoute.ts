/**
 * telemetrySummaryRoute.ts
 *
 * GET /api/telemetry/summary
 *
 * Returns a summary of recent `verification.completed` events for
 * self-direct to poll. No authentication required — internal use only.
 *
 * Query params:
 *   windowHours  — look-back window in hours (default: 24, max: 168)
 *
 * Response shape:
 *   {
 *     ok: true,
 *     windowHours: number,
 *     summary: TelemetrySummary,
 *     generatedAt: string,
 *   }
 */
import type { Express } from "express";
import { verificationEventStore } from "./verificationEventStore";

export function registerTelemetrySummaryRoute(app: Express): void {
  app.get("/api/telemetry/summary", (req, res) => {
    const rawWindow = Number(req.query["windowHours"] ?? 24);
    const windowHours = Number.isFinite(rawWindow)
      ? Math.min(Math.max(rawWindow, 1), 168)
      : 24;

    const summary = verificationEventStore.getSummary(
      windowHours * 60 * 60 * 1000
    );

    res.json({
      ok: true,
      windowHours,
      summary,
      generatedAt: new Date().toISOString(),
    });
  });
}
