/**
 * calibrate-adapters.mjs
 * CLI entry point for `pnpm calibrate:adapters`.
 * Runs the full adapter calibration batch and prints a summary report.
 *
 * Usage:
 *   pnpm calibrate:adapters                          # all adapters
 *   pnpm calibrate:adapters --adapters=protein,legal # subset
 *   pnpm calibrate:adapters --concurrency=8          # custom concurrency
 *   pnpm calibrate:adapters --csv=report.csv         # export CSV
 *   pnpm calibrate:adapters --json=report.json       # export JSON
 */
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import { writeFileSync } from "node:fs";

register("tsx/esm", pathToFileURL("./"));

const { runBatchCalibration } = await import(
  "./server/verticalAdapters/calibration/batchCalibration.ts"
);
const { exportReportToCsv } = await import(
  "./server/verticalAdapters/calibration/calibrationReport.ts"
);

// ─── Parse CLI args ──────────────────────────────────────────────────────────
const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const [k, v] = arg.replace(/^--/, "").split("=");
    return [k, v ?? true];
  })
);

const adapterIds = args.adapters ? String(args.adapters).split(",") : undefined;
const concurrency = args.concurrency ? Number(args.concurrency) : 4;
const csvPath = args.csv ? String(args.csv) : null;
const jsonPath = args.json ? String(args.json) : null;

// ─── Run ─────────────────────────────────────────────────────────────────────
console.log("\n🔬  Protein Truth Desk — Adapter Calibration Pipeline");
console.log("─".repeat(56));
console.log(`  Adapters    : ${adapterIds ? adapterIds.join(", ") : "ALL"}`);
console.log(`  Concurrency : ${concurrency}`);
console.log("─".repeat(56));

const startMs = Date.now();

let report;
try {
  report = await runBatchCalibration({ adapterIds, concurrency });
} catch (err) {
  console.error("\n❌  Calibration failed:", err.message);
  process.exit(1);
}

const elapsed = ((Date.now() - startMs) / 1000).toFixed(1);

// ─── Summary ─────────────────────────────────────────────────────────────────
console.log(`\n✅  Calibration complete in ${elapsed}s`);
console.log("─".repeat(56));
console.log(`  Total adapters : ${report.totalAdapters}`);
console.log(`  Avg Precision  : ${(report.avgPrecisionOverall * 100).toFixed(1)}%`);
console.log(`  Avg Recall     : ${(report.avgRecallOverall * 100).toFixed(1)}%`);
console.log(`  Avg F1         : ${(report.avgF1Overall * 100).toFixed(1)}%`);
console.log("");
console.log("  Failure group distribution:");
console.log(`    G1 (under-extraction)  : ${report.groupCounts.G1}`);
console.log(`    G2 (over-extraction)   : ${report.groupCounts.G2}`);
console.log(`    G3 (low support rate)  : ${report.groupCounts.G3}`);
console.log(`    G4 (acceptable)        : ${report.groupCounts.G4}`);
console.log("─".repeat(56));

// ─── Per-adapter table ────────────────────────────────────────────────────────
const rows = report.adapterSummaries
  .slice()
  .sort((a, b) => a.avgF1 - b.avgF1);

const colW = [30, 10, 9, 9, 6, 8];
const header = ["Adapter", "Precision", "Recall", "F1", "Group", "Errors"];
const pad = (s, w) => String(s).padEnd(w);

console.log("\n" + header.map((h, i) => pad(h, colW[i])).join("  "));
console.log("─".repeat(colW.reduce((a, b) => a + b + 2, 0)));

for (const s of rows) {
  console.log(
    [
      pad(s.adapterId, colW[0]),
      pad((s.avgPrecision * 100).toFixed(1) + "%", colW[1]),
      pad((s.avgRecall * 100).toFixed(1) + "%", colW[2]),
      pad((s.avgF1 * 100).toFixed(1) + "%", colW[3]),
      pad(s.failureGroup, colW[4]),
      pad(s.totalErrors, colW[5]),
    ].join("  ")
  );
}

// ─── Exports ──────────────────────────────────────────────────────────────────
if (csvPath) {
  writeFileSync(csvPath, exportReportToCsv(report), "utf8");
  console.log(`\n📄  CSV exported to: ${csvPath}`);
}
if (jsonPath) {
  writeFileSync(jsonPath, JSON.stringify(report, null, 2), "utf8");
  console.log(`📄  JSON exported to: ${jsonPath}`);
}

const failing = report.groupCounts.G1 + report.groupCounts.G2 + report.groupCounts.G3;
if (failing > 0) {
  console.log(`\n⚠   ${failing} adapter(s) need prompt attention (G1/G2/G3).`);
  process.exit(1);
}
process.exit(0);
