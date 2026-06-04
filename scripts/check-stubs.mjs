#!/usr/bin/env node
/**
 * check-stubs.mjs — Scan for stub files and report them
 *
 * Usage:
 *   node scripts/check-stubs.mjs          # Print report to console
 *   node scripts/check-stubs.mjs --json   # Output JSON (for quality dashboard)
 *   node scripts/check-stubs.mjs --ci     # Exit 1 if any stubs exist on main branch
 */

import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = path.resolve(__dirname, "../server");

function getStubFiles() {
  const results = [];
  const files = fs.readdirSync(SERVER_DIR).filter((f) => f.endsWith(".ts"));

  for (const file of files) {
    const fullPath = path.join(SERVER_DIR, file);
    const content = fs.readFileSync(fullPath, "utf8");
    const firstLine = content.split("\n")[0];

    if (firstLine.startsWith("// Stub:")) {
      const stubNote = firstLine.replace("// Stub:", "").trim();
      const lineCount = content.split("\n").filter((l) => l.trim()).length;
      const exports = content.match(/^export (async function|function|const) (\w+)/gm) ?? [];

      results.push({
        file: `server/${file}`,
        stubNote,
        lineCount,
        exports: exports.map((e) => e.split(" ").pop()),
        isTestFile: false,
      });
    }
  }

  return results;
}

function getCurrentBranch() {
  try {
    return execSync("git rev-parse --abbrev-ref HEAD", { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

const stubs = getStubFiles();
const branch = getCurrentBranch();
const isJson = process.argv.includes("--json");
const isCi = process.argv.includes("--ci");

if (isJson) {
  console.log(
    JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        branch,
        stubCount: stubs.length,
        stubs,
      },
      null,
      2,
    ),
  );
} else {
  console.log(`\n🔧 Stub File Report — ${new Date().toISOString().slice(0, 10)}`);
  console.log(`   Branch: ${branch}`);
  console.log(`   Total stubs: ${stubs.length}\n`);

  if (stubs.length === 0) {
    console.log("   ✅ No stub files found. All implementations are real.\n");
  } else {
    for (const s of stubs) {
      console.log(`   📄 ${s.file}`);
      console.log(`      Note: ${s.stubNote}`);
      console.log(`      Exports: ${s.exports.join(", ")}`);
      console.log(`      Lines: ${s.lineCount}`);
      console.log();
    }

    if (branch === "main") {
      console.log(`   ⚠️  WARNING: ${stubs.length} stub(s) are committed to main.`);
      console.log("   These should be replaced with real implementations.\n");
    }
  }
}

if (isCi && branch === "main" && stubs.length > 0) {
  console.error(`\n❌ CI: ${stubs.length} stub file(s) on main branch. Replace before deploying.\n`);
  process.exit(1);
}
