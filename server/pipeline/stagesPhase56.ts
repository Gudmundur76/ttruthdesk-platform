/**
 * stagesPhase56.ts — Pipeline stages 6-10 for PRD-L1 Phases 5-6.
 */
import type { StageFn } from "./stageRegistry";
import { randomUUID } from "crypto";

// ── Stage 6: CompositeTruthEngine ─────────────────────────────────────────────
export const compositeTruthEngineStage: StageFn = async (ctx) => {
  const claims = (ctx.extractedClaims as Array<{ verdict?: string; confidenceScore?: number }>) ?? [];
  if (claims.length === 0) {
    return { outcome: "SKIP", reason: "No claims to score" };
  }
  const scored = claims.filter(c => c.confidenceScore !== null && c.confidenceScore !== undefined);
  const avgConfidence = scored.length > 0
    ? scored.reduce((sum, c) => sum + (c.confidenceScore ?? 0), 0) / scored.length
    : 0;
  const supported = claims.filter(c => c.verdict === "Supported").length;
  const compositeScore = claims.length > 0 ? supported / claims.length * avgConfidence : 0;
  const compositeLabel = compositeScore >= 0.8 ? "verified_faithful"
    : compositeScore >= 0.5 ? "partially_supported"
    : compositeScore >= 0.2 ? "contested"
    : "insufficient_evidence";
  return {
    outcome: "PASS",
    data: { compositeScore, compositeLabel },
    reason: `Composite truth score: ${compositeScore.toFixed(2)} (${compositeLabel})`,
  };
};

// ── Stage 7: ReportGenerator ──────────────────────────────────────────────────
export const reportGeneratorStage: StageFn = async (ctx) => {
  try {
    const { getDb } = await import("../db");
    const { auditReports } = await import("../../drizzle/schema");
    const { eq } = await import("drizzle-orm");
    const db = await getDb();
    if (!db) return { outcome: "SKIP", reason: "Database unavailable" };
    const existing = await db.select().from(auditReports)
      .where(eq(auditReports.documentId, ctx.documentId)).limit(1);
    const reportUrl = existing[0]?.htmlStorageUrl ?? null;
    return {
      outcome: "PASS",
      data: { reportUrl: reportUrl ?? undefined },
      reason: reportUrl ? "Report already generated" : "Report pending generation",
    };
  } catch (err) {
    return { outcome: "FAIL", reason: `ReportGenerator failed: ${String(err)}` };
  }
};

// ── Stage 8: ConfidenceTrend ──────────────────────────────────────────────────
export const confidenceTrendStage: StageFn = async (ctx) => {
  try {
    const { getClaimsByDocument } = await import("../db");
    const claims = await getClaimsByDocument(ctx.documentId);
    const scores = claims
      .filter(c => c.confidenceScore !== null && c.confidenceScore !== undefined)
      .map(c => c.confidenceScore as number);
    const avg = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
    return {
      outcome: "PASS",
      data: { confidenceTrend: { avg, count: scores.length } },
      reason: `Confidence trend: avg=${avg?.toFixed(2) ?? "N/A"} over ${scores.length} claims`,
    };
  } catch (err) {
    return { outcome: "FAIL", reason: `ConfidenceTrend failed: ${String(err)}` };
  }
};

// ── Stage 9: PredictionRecord ─────────────────────────────────────────────────
export const predictionRecordStage: StageFn = async (ctx) => {
  try {
    const { getDb } = await import("../db");
    const { layerTelemetry } = await import("../../drizzle/schema");
    const db = await getDb();
    if (!db) return { outcome: "SKIP", reason: "Database unavailable" };
    const [result] = await db.insert(layerTelemetry).values({
      layer: "L1_TRUTH",
      eventType: "end",
      correlationId: ctx.correlationId ?? null,
      success: true,
      metadataJson: {
        type: "prediction_record",
        documentId: ctx.documentId,
        compositeScore: ctx.compositeScore ?? null,
        compositeLabel: ctx.compositeLabel ?? null,
        recordedAt: Date.now(),
      },
    });
    return {
      outcome: "PASS",
      data: { predictionId: result.insertId },
      reason: `Prediction record created (id=${result.insertId})`,
    };
  } catch (err) {
    return { outcome: "SKIP", reason: `PredictionRecord skipped: ${String(err)}` };
  }
};

// ── Stage 10: PipelineAuditor ─────────────────────────────────────────────────
export const pipelineAuditorStage: StageFn = async (ctx) => {
  const computedCorrelationId = ctx.correlationId ?? randomUUID();
  const auditEntry = {
    documentId: ctx.documentId,
    correlationId: computedCorrelationId,
    compositeScore: ctx.compositeScore ?? null,
    compositeLabel: ctx.compositeLabel ?? null,
    reportUrl: ctx.reportUrl ?? null,
    auditedAt: Date.now(),
  };
  return {
    outcome: "PASS",
    data: { auditTrail: [auditEntry], correlationId: computedCorrelationId },
    reason: `Pipeline audit complete (correlationId=${computedCorrelationId})`,
  };
};
