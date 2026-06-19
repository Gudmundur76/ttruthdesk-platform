/**
 * codeGuardian.ts — Meta-Agent Orchestrator (Agent 7: codeGuardianAgent)
 *
 * Orchestrates all four meta-agent layers in sequence:
 *   1. Code Drift Detection (codeDriftService)
 *   2. Stub Ledger (stubLedger)
 *   3. Pipeline Invariants (pipelineGuardian)
 *   4. Alert Routing (alertRouter)
 *
 * Produces a single CodeGuardianReport with a composite health score (0–100)
 * and persists all findings to meta_agent_checks.
 *
 * Health Score formula:
 *   - Start at 100
 *   - -10 per critical finding
 *   - -5 per warning finding
 *   - -2 per overdue P0 stub
 *   - -1 per overdue P1 stub
 *   - -0.5 per overdue P2 stub
 *   - -3 per failed pipeline invariant
 *   - -1 per warned pipeline invariant
 *   Minimum: 0
 *
 * PRD-L4 Phases 5–6:
 *   - Promise.allSettled for fault isolation (one layer failure doesn't abort all)
 *   - 60s max-duration abort with timedOut flag
 *   - Grade-threshold alerting (D or F triggers critical finding)
 *   - Persists summary row to meta_agent_checks
 *   - Emits layer_telemetry start/end/error rows for every run
 *   - Propagates correlationId through all sub-operations
 */

import { detectCodeDrift, type CodeDriftReport } from "./codeDriftService";
import { buildStubLedger, getOverdueEscalations, type StubLedgerReport, type StubEscalation } from "./stubLedger";
import { runPipelineGuardian, type PipelineGuardianReport } from "./pipelineGuardian";
import {
  routeFindings,
  driftFindingToMetaFinding,
  invariantResultToMetaFinding,
  type MetaFinding,
} from "./alertRouter";
import { getDb } from "../db";
import { layerTelemetry, metaAgentChecks } from "../../drizzle/schema";
import { logger } from "../logger";

const log = logger("metaAgent/codeGuardian");

const MAX_DURATION_MS = 60_000;

// ─── Telemetry helpers ────────────────────────────────────────────────────────

async function emitTelemetry(
  eventType: "start" | "end" | "error",
  correlationId: string,
  opts?: { durationMs?: number; success?: boolean; errorCode?: string; meta?: Record<string, unknown> }
): Promise<void> {
  try {
    const db = await getDb();
    if (!db) return;
    await db.insert(layerTelemetry).values({
      layer: "L4_META",
      eventType,
      correlationId,
      durationMs: opts?.durationMs,
      success: opts?.success ?? true,
      errorCode: opts?.errorCode,
      metadataJson: opts?.meta,
    });
  } catch {
    // Telemetry is non-fatal — never throw
  }
}

async function persistCheckSummary(report: CodeGuardianReport): Promise<void> {
  try {
    const db = await getDb();
    if (!db) return;
    await db.insert(metaAgentChecks).values({
      agentName: "codeGuardianAgent",
      checkType: "guardianSummary",
      finding: {
        healthScore: report.healthScore,
        healthGrade: report.healthGrade,
        criticalCount: report.criticalCount,
        warningCount: report.warningCount,
        durationMs: report.durationMs,
        timedOut: report.timedOut,
        correlationId: report.correlationId,
      },
      actionTaken: report.criticalCount > 0 ? "alerted" : "ok",
    });
  } catch {
    // Persistence is non-fatal
  }
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CodeGuardianReport {
  agentName: "codeGuardianAgent";
  healthScore: number;
  healthGrade: "A" | "B" | "C" | "D" | "F" | "TIMEOUT";
  codeDrift: CodeDriftReport | null;
  stubLedger: StubLedgerReport | null;
  overdueEscalations: StubEscalation[];
  pipelineGuardian: PipelineGuardianReport | null;
  allFindings: MetaFinding[];
  criticalCount: number;
  warningCount: number;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  /** true if the 60s max-duration abort fired */
  timedOut: boolean;
  /** correlationId for this run's telemetry chain */
  correlationId: string;
  /** Layers that failed (fault isolation) */
  faultedLayers: string[];
}

// ─── Health Score ─────────────────────────────────────────────────────────────

function computeHealthScore(
  codeDrift: CodeDriftReport | null,
  stubLedger: StubLedgerReport | null,
  pipeline: PipelineGuardianReport | null
): number {
  let score = 100;

  if (codeDrift) {
    const driftFindings = [
      codeDrift.schemaDrift,
      codeDrift.apiDrift,
      codeDrift.testDrift,
      codeDrift.dependencyDrift,
      codeDrift.configDrift,
      codeDrift.disciplineDrift,
    ].filter(Boolean);
    for (const f of driftFindings) {
      if (f!.severity === "critical") score -= 10;
      else if (f!.severity === "warning") score -= 5;
    }
  }

  if (stubLedger) {
    for (const stub of stubLedger.stubs) {
      if (stub.status === "overdue") {
        if (stub.priority === "P0") score -= 2;
        else if (stub.priority === "P1") score -= 1;
        else score -= 0.5;
      }
    }
  }

  if (pipeline) {
    // Cap total pipeline penalty at 30 points to prevent a single batch of
    // stale invariant failures from zeroing the score. Each failing invariant
    // costs 3 points; each warning costs 1 point; total capped at -30.
    let pipelinePenalty = 0;
    for (const inv of pipeline.invariants) {
      if (inv.status === "fail") pipelinePenalty += 3;
      else if (inv.status === "warn") pipelinePenalty += 1;
    }
    score -= Math.min(pipelinePenalty, 30);
  }

  return Math.max(0, Math.round(score));
}

function scoreToGrade(score: number): CodeGuardianReport["healthGrade"] {
  if (score >= 90) return "A";
  if (score >= 75) return "B";
  if (score >= 60) return "C";
  if (score >= 40) return "D";
  return "F";
}

// ─── Main Orchestrator ────────────────────────────────────────────────────────

export async function runCodeGuardian(): Promise<CodeGuardianReport> {
  const startedAt = new Date().toISOString();
  const startMs = Date.now();
  const correlationId = crypto.randomUUID();

  log.info("[MetaAgent] codeGuardianAgent starting — running all 4 layers");
  await emitTelemetry("start", correlationId);

  // 60s max-duration abort
  let abortTimer: ReturnType<typeof setTimeout> | null = null;
  const abortPromise = new Promise<CodeGuardianReport>((resolve) => {
    abortTimer = setTimeout(() => {
      resolve({
        agentName: "codeGuardianAgent",
        healthScore: 0,
        healthGrade: "TIMEOUT",
        codeDrift: null,
        stubLedger: null,
        overdueEscalations: [],
        pipelineGuardian: null,
        allFindings: [],
        criticalCount: 0,
        warningCount: 0,
        startedAt,
        completedAt: new Date().toISOString(),
        durationMs: MAX_DURATION_MS,
        timedOut: true,
        correlationId,
        faultedLayers: ["timeout"],
      });
    }, MAX_DURATION_MS);
  });

  const runPromise = (async (): Promise<CodeGuardianReport> => {
    try {
      // Run all 3 layers with fault isolation via Promise.allSettled
      const [driftResult, stubResult, pipelineResult] = await Promise.allSettled([
        detectCodeDrift(),
        Promise.resolve(buildStubLedger()),
        runPipelineGuardian(),
      ]);

      const faultedLayers: string[] = [];
      const codeDrift = driftResult.status === "fulfilled" ? driftResult.value : null;
      const stubLedger = stubResult.status === "fulfilled" ? stubResult.value : null;
      const pipeline = pipelineResult.status === "fulfilled" ? pipelineResult.value : null;

      if (driftResult.status === "rejected") faultedLayers.push("codeDrift");
      if (stubResult.status === "rejected") faultedLayers.push("stubLedger");
      if (pipelineResult.status === "rejected") faultedLayers.push("pipelineGuardian");

      const overdueEscalations = stubLedger ? getOverdueEscalations(stubLedger) : [];

      // Assemble all findings for routing
      const allFindings: MetaFinding[] = [];

      if (codeDrift) {
        const driftFields = [
          codeDrift.schemaDrift,
          codeDrift.apiDrift,
          codeDrift.testDrift,
          codeDrift.dependencyDrift,
          codeDrift.configDrift,
          codeDrift.disciplineDrift,
        ].filter(Boolean);
        allFindings.push(...driftFields.map(f => driftFindingToMetaFinding(f!)));
      }

      if (pipeline) {
        allFindings.push(...pipeline.invariants.map(invariantResultToMetaFinding));
      }

      allFindings.push(
        ...overdueEscalations.map((esc) => ({
          checkType: `stubLedger.${esc.stub.priority}`,
          severity: (esc.stub.priority === "P0" ? "critical" : "warning") as MetaFinding["severity"],
          confidence: 0.9,
          summary: esc.escalationReason,
          details: {
            stubId: esc.stub.id,
            file: esc.stub.file,
            line: esc.stub.line,
            daysOverdue: esc.stub.daysOverdue,
            suggestedAction: esc.suggestedAction,
          },
        }))
      );

      const healthScore = computeHealthScore(codeDrift, stubLedger, pipeline);
      const healthGrade = scoreToGrade(healthScore);

      // Grade-threshold alerting: D or F triggers a critical finding
      if (healthGrade === "D" || healthGrade === "F") {
        allFindings.push({
          checkType: "gradeThreshold",
          severity: "critical",
          confidence: 1.0,
          summary: `Health grade dropped to ${healthGrade} (score: ${healthScore}/100)`,
          details: { healthScore, healthGrade, faultedLayers },
        });
      }

      // Layer 4: route all findings
      await routeFindings(allFindings);

      const criticalCount = allFindings.filter((f) => f.severity === "critical").length;
      const warningCount = allFindings.filter((f) => f.severity === "warning").length;
      const completedAt = new Date().toISOString();
      const durationMs = Date.now() - startMs;

      const report: CodeGuardianReport = {
        agentName: "codeGuardianAgent",
        healthScore,
        healthGrade,
        codeDrift,
        stubLedger,
        overdueEscalations,
        pipelineGuardian: pipeline,
        allFindings,
        criticalCount,
        warningCount,
        startedAt,
        completedAt,
        durationMs,
        timedOut: false,
        correlationId,
        faultedLayers,
      };

      await emitTelemetry("end", correlationId, {
        durationMs,
        success: true,
        meta: { healthScore, healthGrade, criticalCount, warningCount, faultedLayers },
      });

      await persistCheckSummary(report);

      log.info(
        `[MetaAgent] codeGuardianAgent complete in ${durationMs}ms — ` +
        `Health: ${healthScore}/100 (${healthGrade}), ` +
        `${criticalCount} critical, ${warningCount} warnings` +
        (faultedLayers.length > 0 ? `, faulted: ${faultedLayers.join(",")}` : "")
      );

      return report;
    } catch (err) {
      const durationMs = Date.now() - startMs;
      await emitTelemetry("error", correlationId, {
        durationMs,
        success: false,
        errorCode: (err as Error)?.name ?? "UNKNOWN",
      });
      throw err;
    }
  })();

  try {
    return await Promise.race([runPromise, abortPromise]);
  } finally {
    if (abortTimer) clearTimeout(abortTimer);
  }
}
