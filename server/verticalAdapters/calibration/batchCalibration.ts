/**
 * batchCalibration.ts
 * Batch runner over all registered adapters. FR-CAL-03.
 */
import { listVerticals } from "../types";
import { calibrateAdapterFull } from "./adapterCalibration";
import { buildCalibrationReport } from "./calibrationReport";
import type { CalibrationReport } from "./calibrationReport";
import { TEST_DOCUMENTS } from "./testDocuments";

export interface BatchCalibrationOptions {
  adapterIds?: string[];
  concurrency?: number;
}

/**
 * Run calibration across all (or a subset of) registered adapters.
 * Returns a CalibrationReport with per-adapter summaries and group counts.
 */
export async function runBatchCalibration(
  options: BatchCalibrationOptions = {}
): Promise<CalibrationReport> {
  const allAdapters = listVerticals();
  const targetAdapters = options.adapterIds
    ? allAdapters.filter((a) => options.adapterIds!.includes(a.domainKey))
    : allAdapters;

  const concurrency = options.concurrency ?? 4;
  const summaries = [];

  // Process in batches of `concurrency`
  for (let i = 0; i < targetAdapters.length; i += concurrency) {
    const batch = targetAdapters.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map((adapter) => calibrateAdapterFull(adapter, TEST_DOCUMENTS))
    );
    summaries.push(...batchResults);
  }

  const runId = `batch-${Date.now()}`;
  return buildCalibrationReport(runId, summaries);
}
