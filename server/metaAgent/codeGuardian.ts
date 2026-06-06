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

export interface CodeGuardianReport {
  agentName: "codeGuardianAgent";
  healthScore: number;
  healthGrade: "A" | "B" | "C" | "D" | "F";
  codeDrift: CodeDriftReport;
  stubLedger: StubLedgerReport;
  overdueEscalations: StubEscalation[];
  pipelineGuardian: PipelineGuardianReport;
  allFindings: MetaFinding[];
  criticalCount: number;
  warningCount: number;
  startedAt: string;
  completedAt: string;
  durationMs: number;
}

// ─── Health Score ─────────────────────────────────────────────────────────────

function computeHealthScore(
  codeDrift: CodeDriftReport,
  stubLedger: StubLedgerReport,
  pipeline: PipelineGuardianReport
): number {
  let score = 100;

  // Drift findings
  const driftFindings = [
    codeDrift.schemaDrift,
    codeDrift.apiDrift,
    codeDrift.testDrift,
    codeDrift.dependencyDrift,
    codeDrift.configDrift,
    codeDrift.disciplineDrift,
  ];
  for (const f of driftFindings) {
    if (f.severity === "critical") score -= 10;
    else if (f.severity === "warning") score -= 5;
  }

  // Stub debt
  for (const stub of stubLedger.stubs) {
    if (stub.status === "overdue") {
      if (stub.priority === "P0") score -= 2;
      else if (stub.priority === "P1") score -= 1;
      else score -= 0.5;
    }
  }

  // Pipeline invariants
  for (const inv of pipeline.invariants) {
    if (inv.status === "fail") score -= 3;
    else if (inv.status === "warn") score -= 1;
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

  console.log("[MetaAgent] codeGuardianAgent starting — running all 4 layers");

  // Layer 1 + 2 run in parallel (both are mostly sync/file-based)
  // Layer 3 requires DB so runs concurrently
  const [codeDrift, stubLedger, pipeline] = await Promise.all([
    detectCodeDrift(),
    Promise.resolve(buildStubLedger()),
    runPipelineGuardian(),
  ]);

  const overdueEscalations = getOverdueEscalations(stubLedger);

  // Assemble all findings for routing
  const allFindings: MetaFinding[] = [
    // Drift findings
    driftFindingToMetaFinding(codeDrift.schemaDrift),
    driftFindingToMetaFinding(codeDrift.apiDrift),
    driftFindingToMetaFinding(codeDrift.testDrift),
    driftFindingToMetaFinding(codeDrift.dependencyDrift),
    driftFindingToMetaFinding(codeDrift.configDrift),
    driftFindingToMetaFinding(codeDrift.disciplineDrift),
    // Pipeline invariants
    ...pipeline.invariants.map(invariantResultToMetaFinding),
    // Stub escalations (as warning/critical findings)
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
    })),
  ];

  // Layer 4: route all findings
  await routeFindings(allFindings);

  const healthScore = computeHealthScore(codeDrift, stubLedger, pipeline);
  const healthGrade = scoreToGrade(healthScore);
  const criticalCount = allFindings.filter((f) => f.severity === "critical").length;
  const warningCount = allFindings.filter((f) => f.severity === "warning").length;
  const completedAt = new Date().toISOString();
  const durationMs = Date.now() - startMs;

  console.log(
    `[MetaAgent] codeGuardianAgent complete in ${durationMs}ms — ` +
    `Health: ${healthScore}/100 (${healthGrade}), ` +
    `${criticalCount} critical, ${warningCount} warnings`
  );

  return {
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
  };
}
