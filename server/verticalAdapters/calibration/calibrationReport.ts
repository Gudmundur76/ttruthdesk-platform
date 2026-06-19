/**
 * calibrationReport.ts
 * Score computation, group summary, CSV export, and A/B comparison. FR-CAL-03, FR-CAL-08.
 */
import type { AdapterCalibrationSummary, ClaimCalibrationResult } from "./adapterCalibration";

export interface CalibrationReport {
  runId: string;
  timestamp: string;
  totalAdapters: number;
  summaries: AdapterCalibrationSummary[];
  groupCounts: Record<"G1" | "G2" | "G3" | "G4", number>;
  avgF1Overall: number;
  avgPrecisionOverall: number;
  avgRecallOverall: number;
}

export interface ABComparisonResult {
  adapterId: string;
  beforeF1: number;
  afterF1: number;
  delta: number;
  improved: boolean;
  beforeGroup: string;
  afterGroup: string;
}

/**
 * Build a CalibrationReport from a list of adapter summaries.
 */
export function buildCalibrationReport(
  runId: string,
  summaries: AdapterCalibrationSummary[]
): CalibrationReport {
  const groupCounts: Record<"G1" | "G2" | "G3" | "G4", number> = {
    G1: 0,
    G2: 0,
    G3: 0,
    G4: 0,
  };
  for (const s of summaries) {
    groupCounts[s.failureGroup]++;
  }

  const n = summaries.length || 1;
  const avgF1Overall = summaries.reduce((acc, s) => acc + s.avgF1, 0) / n;
  const avgPrecisionOverall = summaries.reduce((acc, s) => acc + s.avgPrecision, 0) / n;
  const avgRecallOverall = summaries.reduce((acc, s) => acc + s.avgRecall, 0) / n;

  return {
    runId,
    timestamp: new Date().toISOString(),
    totalAdapters: summaries.length,
    summaries,
    groupCounts,
    avgF1Overall,
    avgPrecisionOverall,
    avgRecallOverall,
  };
}

/**
 * Export a CalibrationReport to CSV string.
 * Columns: adapterId, avgPrecision, avgRecall, avgF1, failureGroup, totalErrors
 */
export function exportReportToCsv(report: CalibrationReport): string {
  const header = "adapterId,avgPrecision,avgRecall,avgF1,failureGroup,totalErrors";
  const rows = report.summaries.map((s) =>
    [
      s.adapterId,
      s.avgPrecision.toFixed(4),
      s.avgRecall.toFixed(4),
      s.avgF1.toFixed(4),
      s.failureGroup,
      s.totalErrors,
    ].join(",")
  );
  return [header, ...rows].join("\n");
}

/**
 * Compare two calibration reports (before/after a prompt change) and return per-adapter deltas.
 */
export function compareCalibrationResults(
  before: CalibrationReport,
  after: CalibrationReport
): ABComparisonResult[] {
  const beforeMap = new Map(before.summaries.map((s) => [s.adapterId, s]));
  const results: ABComparisonResult[] = [];

  for (const afterSummary of after.summaries) {
    const beforeSummary = beforeMap.get(afterSummary.adapterId);
    if (!beforeSummary) continue;
    const delta = afterSummary.avgF1 - beforeSummary.avgF1;
    results.push({
      adapterId: afterSummary.adapterId,
      beforeF1: beforeSummary.avgF1,
      afterF1: afterSummary.avgF1,
      delta,
      improved: delta > 0,
      beforeGroup: beforeSummary.failureGroup,
      afterGroup: afterSummary.failureGroup,
    });
  }

  return results.sort((a, b) => b.delta - a.delta);
}

/**
 * Summarise a ClaimCalibrationResult array into per-document stats.
 */
export function summariseDocumentResults(
  results: ClaimCalibrationResult[]
): Record<string, { precision: number; recall: number; f1: number }> {
  const out: Record<string, { precision: number; recall: number; f1: number }> = {};
  for (const r of results) {
    out[r.documentId] = {
      precision: r.precisionScore,
      recall: r.recallScore,
      f1: r.f1Score,
    };
  }
  return out;
}
