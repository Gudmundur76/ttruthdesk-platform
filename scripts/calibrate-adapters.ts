/**
 * calibrate-adapters.ts
 * CLI entry point for `pnpm calibrate:adapters`.
 * Run with: pnpm calibrate:adapters [--adapters=a,b] [--concurrency=4] [--csv=out.csv] [--json=out.json]
 */
import { writeFileSync } from "node:fs";
import { runBatchCalibration } from "../server/verticalAdapters/calibration/batchCalibration";
import { exportReportToCsv } from "../server/verticalAdapters/calibration/calibrationReport";

// ─── Parse CLI args ──────────────────────────────────────────────────────────
const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const [k, v] = arg.replace(/^--/, "").split("=");
    return [k, v ?? "true"];
  })
);

const adapterIds = args["adapters"] ? String(args["adapters"]).split(",") : undefined;
const concurrency = args["concurrency"] ? Number(args["concurrency"]) : 4;
const csvPath = args["csv"] ? String(args["csv"]) : null;
const jsonPath = args["json"] ? String(args["json"]) : null;

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
} catch (err: unknown) {
  console.error("\n❌  Calibration failed:", (err as Error).message);
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
const rows = [...report.summaries].sort((a, b) => a.avgF1 - b.avgF1);

const colW = [30, 10, 9, 9, 6, 8];
const header = ["Adapter", "Precision", "Recall", "F1", "Group", "Errors"];
const pad = (s: string | number, w: number) => String(s).padEnd(w);

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

// Exit non-zero if any G1/G2/G3 adapters found (useful for CI)
const failing = report.groupCounts.G1 + report.groupCounts.G2 + report.groupCounts.G3;
if (failing > 0) {
  console.log(`\n⚠   ${failing} adapter(s) need prompt attention (G1/G2/G3).`);
  process.exit(1);
}
process.exit(0);
