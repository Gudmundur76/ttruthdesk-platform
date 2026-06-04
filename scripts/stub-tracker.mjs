#!/usr/bin/env node
/**
 * stub-tracker.mjs
 * ────────────────
 * Scans the codebase for stub files and maps each to:
 *   - The test file that covers it (if any)
 *   - Estimated lines of work
 *   - Priority (high/medium/low) based on how many other files import it
 *   - Whether it is in the persistent drive snapshot
 *
 * Usage:
 *   node scripts/stub-tracker.mjs              # human-readable table
 *   node scripts/stub-tracker.mjs --json       # machine-readable JSON
 *   node scripts/stub-tracker.mjs --ci         # exits 1 if stubs exist on main branch
 *   node scripts/stub-tracker.mjs --detail     # show stub lines per file
 */

import { execSync, spawnSync } from "child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { join, resolve, relative, basename, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..");
const DRIVE_PATH = "/home/ubuntu/manus-persistent-drive";
const DRIVE_SERVICES = join(DRIVE_PATH, "data", "protein-truth-desk", "services");
const DRIVE_PAGES = join(DRIVE_PATH, "data", "protein-truth-desk", "pages");

const JSON_MODE = process.argv.includes("--json");
const CI_MODE = process.argv.includes("--ci");
const DETAIL_MODE = process.argv.includes("--detail");

// ─── Colours ────────────────────────────────────────────────────────────────
const c = {
  reset: "\x1b[0m", red: "\x1b[31m", green: "\x1b[32m",
  yellow: "\x1b[33m", blue: "\x1b[34m", bold: "\x1b[1m", dim: "\x1b[2m",
};

// ─── Stub detection patterns ─────────────────────────────────────────────────
const STUB_PATTERNS = [
  { pattern: /\/\/ STUB/i, label: "STUB comment" },
  { pattern: /throw new Error\(['"`]not implemented/i, label: "not-implemented throw" },
  { pattern: /TODO: implement/i, label: "TODO: implement" },
  { pattern: /return \[\];\s*\/\/ stub/i, label: "empty array stub" },
  { pattern: /return null;\s*\/\/ stub/i, label: "null stub" },
  { pattern: /return {};\s*\/\/ stub/i, label: "empty object stub" },
  { pattern: /\/\* stub \*\//i, label: "stub block comment" },
  { pattern: /export (function|const|async function) \w+[^{]*\{\s*\/\/ stub/i, label: "stub function body" },
  { pattern: /export default function[^{]*\{\s*return <div>.*stub.*<\/div>/i, label: "stub React component" },
  { pattern: /return <div className="p-8 text-center">\s*<h1>.*Coming Soon/i, label: "coming-soon stub page" },
];

// ─── Walk a directory for .ts/.tsx files ─────────────────────────────────────
function walkDir(dir, exts = [".ts", ".tsx"]) {
  const files = [];
  if (!existsSync(dir)) return files;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory() && !["node_modules", ".git", "dist", "coverage"].includes(entry.name)) {
      files.push(...walkDir(full, exts));
    } else if (entry.isFile() && exts.some((e) => entry.name.endsWith(e))) {
      files.push(full);
    }
  }
  return files;
}

// ─── Find stubs ──────────────────────────────────────────────────────────────
function findStubs() {
  const serverFiles = walkDir(join(PROJECT_ROOT, "server"));
  const clientFiles = walkDir(join(PROJECT_ROOT, "client", "src"));
  const allFiles = [...serverFiles, ...clientFiles].filter(
    (f) => !f.endsWith(".test.ts") && !f.endsWith(".test.tsx")
  );

  const stubs = [];
  for (const file of allFiles) {
    const content = readFileSync(file, "utf8");
    const matchedPatterns = STUB_PATTERNS.filter((p) => p.pattern.test(content));
    if (matchedPatterns.length === 0) continue;

    const lines = content.split("\n");
    const stubLines = lines
      .map((line, i) => ({ line: i + 1, text: line.trim() }))
      .filter(({ text }) => STUB_PATTERNS.some((p) => p.pattern.test(text)));

    stubs.push({
      file: relative(PROJECT_ROOT, file),
      patterns: matchedPatterns.map((p) => p.label),
      stubLines,
      lineCount: lines.length,
    });
  }
  return stubs;
}

// ─── Find test file for a stub ───────────────────────────────────────────────
function findTestFile(stubFile) {
  const base = basename(stubFile, ".ts").replace(".tsx", "");
  const dir = dirname(join(PROJECT_ROOT, stubFile));

  // Look for <name>.test.ts or <name>.test.tsx
  const candidates = [
    join(dir, `${base}.test.ts`),
    join(dir, `${base}.test.tsx`),
    join(PROJECT_ROOT, "server", `${base}.test.ts`),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return relative(PROJECT_ROOT, c);
  }
  return null;
}

// ─── Count imports of a file ─────────────────────────────────────────────────
function countImporters(stubFile) {
  const base = basename(stubFile, ".ts").replace(".tsx", "");
  try {
    const result = spawnSync(
      "grep",
      ["-rl", "--include=*.ts", "--include=*.tsx", base, "server/", "client/src/"],
      { cwd: PROJECT_ROOT, encoding: "utf8" }
    );
    const files = (result.stdout || "").split("\n").filter(Boolean);
    return files.filter((f) => !f.includes(stubFile)).length;
  } catch {
    return 0;
  }
}

// ─── Check if file is in persistent drive ────────────────────────────────────
function inDrive(stubFile) {
  const base = basename(stubFile);
  return (
    existsSync(join(DRIVE_SERVICES, base)) ||
    existsSync(join(DRIVE_PAGES, base))
  );
}

// ─── Estimate implementation effort ──────────────────────────────────────────
function estimateEffort(stubFile, importerCount) {
  const base = basename(stubFile);
  // Heuristics based on file name patterns
  if (/router|Router/.test(base)) return "medium";
  if (/Service|service/.test(base)) return "high";
  if (/Job|job/.test(base)) return "medium";
  if (/Page|page|\.tsx$/.test(base)) return "medium";
  if (/Adapter|adapter/.test(base)) return "high";
  if (importerCount > 5) return "high";
  if (importerCount > 2) return "medium";
  return "low";
}

// ─── Main ────────────────────────────────────────────────────────────────────
function main() {
  const stubs = findStubs();

  // Enrich each stub
  const enriched = stubs.map((s) => {
    const importerCount = countImporters(s.file);
    return {
      ...s,
      testFile: findTestFile(s.file),
      importerCount,
      inDrive: inDrive(s.file),
      effort: estimateEffort(s.file, importerCount),
      priority: importerCount > 4 ? "high" : importerCount > 1 ? "medium" : "low",
    };
  });

  // Sort by priority then importerCount
  enriched.sort((a, b) => {
    const p = { high: 0, medium: 1, low: 2 };
    return p[a.priority] - p[b.priority] || b.importerCount - a.importerCount;
  });

  if (JSON_MODE) {
    console.log(
      JSON.stringify(
        {
          timestamp: new Date().toISOString(),
          total: enriched.length,
          byPriority: {
            high: enriched.filter((s) => s.priority === "high").length,
            medium: enriched.filter((s) => s.priority === "medium").length,
            low: enriched.filter((s) => s.priority === "low").length,
          },
          stubs: enriched,
        },
        null,
        2
      )
    );
    if (CI_MODE && enriched.length > 0) process.exit(1);
    return;
  }

  // Human-readable output
  console.log(`\n${c.bold}${c.blue}╔══════════════════════════════════════════╗${c.reset}`);
  console.log(`${c.bold}${c.blue}║   Stub Replacement Tracker               ║${c.reset}`);
  console.log(`${c.bold}${c.blue}╚══════════════════════════════════════════╝${c.reset}\n`);

  if (enriched.length === 0) {
    console.log(`${c.green}✓ No stub files detected. Codebase is clean.${c.reset}\n`);
    return;
  }

  const high = enriched.filter((s) => s.priority === "high");
  const medium = enriched.filter((s) => s.priority === "medium");
  const low = enriched.filter((s) => s.priority === "low");

  console.log(`Found ${c.bold}${enriched.length}${c.reset} stub file(s):`);
  console.log(`  ${c.red}High priority:${c.reset}   ${high.length}`);
  console.log(`  ${c.yellow}Medium priority:${c.reset} ${medium.length}`);
  console.log(`  ${c.dim}Low priority:${c.reset}    ${low.length}\n`);

  // Table header
  const col = [38, 8, 8, 8, 6, 5];
  const header = [
    "File".padEnd(col[0]),
    "Priority".padEnd(col[1]),
    "Effort".padEnd(col[2]),
    "Importers".padEnd(col[3]),
    "Test?".padEnd(col[4]),
    "Drive",
  ].join(" │ ");
  console.log(`${c.bold}${header}${c.reset}`);
  console.log("─".repeat(header.length));

  for (const s of enriched) {
    const pColor = s.priority === "high" ? c.red : s.priority === "medium" ? c.yellow : c.dim;
    const row = [
      s.file.padEnd(col[0]).slice(0, col[0]),
      (pColor + s.priority + c.reset).padEnd(col[1] + pColor.length + c.reset.length),
      s.effort.padEnd(col[2]),
      String(s.importerCount).padEnd(col[3]),
      (s.testFile ? `${c.green}yes${c.reset}` : `${c.red}no${c.reset}`).padEnd(col[4] + 9),
      s.inDrive ? `${c.green}yes${c.reset}` : `${c.red}no${c.reset}`,
    ].join(" │ ");
    console.log(row);

    if (DETAIL_MODE && s.stubLines.length > 0) {
      for (const sl of s.stubLines.slice(0, 3)) {
        console.log(`  ${c.dim}L${sl.line}: ${sl.text.slice(0, 80)}${c.reset}`);
      }
    }
  }

  console.log("\n" + "─".repeat(header.length));
  console.log(`\n${c.bold}Recommended replacement order:${c.reset}`);
  for (const s of high.slice(0, 5)) {
    const testNote = s.testFile ? `(test: ${s.testFile})` : "(no test — write test first)";
    console.log(`  1. ${c.red}${s.file}${c.reset} — ${s.importerCount} importers ${c.dim}${testNote}${c.reset}`);
  }

  console.log(
    `\n${c.dim}Run with --detail to see stub lines. Run with --json for machine-readable output.${c.reset}\n`
  );

  if (CI_MODE && enriched.length > 0) process.exit(1);
}

main();
