#!/usr/bin/env node
/**
 * session-integrity.mjs
 * ─────────────────────
 * Mandatory pre-code gate for every Manus session.
 * Run this BEFORE writing any code. Exits 1 if any check fails.
 *
 * Usage:
 *   node scripts/session-integrity.mjs              # interactive report
 *   node scripts/session-integrity.mjs --ci         # exits 1 on any failure
 *   node scripts/session-integrity.mjs --json       # machine-readable output
 *   node scripts/session-integrity.mjs --fix        # auto-fix what can be fixed
 */

import { execSync, spawnSync } from "child_process";
import { existsSync, readFileSync, statSync } from "fs";
import { join, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..");
const DRIVE_PATH = "/home/ubuntu/manus-persistent-drive";
const CI_MODE = process.argv.includes("--ci");
const JSON_MODE = process.argv.includes("--json");
const FIX_MODE = process.argv.includes("--fix");

// ─── Colours ────────────────────────────────────────────────────────────────
const c = {
  reset: "\x1b[0m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
};
const ok = (msg) => `${c.green}✓${c.reset} ${msg}`;
const fail = (msg) => `${c.red}✗${c.reset} ${msg}`;
const warn = (msg) => `${c.yellow}⚠${c.reset} ${msg}`;
const info = (msg) => `${c.blue}ℹ${c.reset} ${msg}`;

// ─── Check results accumulator ──────────────────────────────────────────────
const results = [];
let failures = 0;
let warnings = 0;

function record(name, status, message, detail = null, fix = null) {
  results.push({ name, status, message, detail, fix });
  if (status === "fail") failures++;
  if (status === "warn") warnings++;
}

// ─── CHECK 1: Persistent drive present and current ──────────────────────────
function checkPersistentDrive() {
  if (!existsSync(DRIVE_PATH)) {
    record(
      "persistent-drive",
      "fail",
      "manus-persistent-drive not found at " + DRIVE_PATH,
      "Run: gh repo clone Gudmundur76/manus-persistent-drive /home/ubuntu/manus-persistent-drive",
      FIX_MODE
        ? () =>
            execSync(
              "gh repo clone Gudmundur76/manus-persistent-drive /home/ubuntu/manus-persistent-drive",
              { stdio: "inherit" }
            )
        : null
    );
    return;
  }

  // Check it's a git repo
  const gitDir = join(DRIVE_PATH, ".git");
  if (!existsSync(gitDir)) {
    record("persistent-drive", "fail", "manus-persistent-drive is not a git repository");
    return;
  }

  // Check last pull freshness (warn if > 4 hours old)
  try {
    const fetchHead = join(DRIVE_PATH, ".git", "FETCH_HEAD");
    if (existsSync(fetchHead)) {
      const age = Date.now() - statSync(fetchHead).mtimeMs;
      const hours = age / 1000 / 60 / 60;
      if (hours > 4) {
        record(
          "persistent-drive",
          "warn",
          `manus-persistent-drive last pulled ${hours.toFixed(1)}h ago — consider pulling`,
          "Run: cd /home/ubuntu/manus-persistent-drive && git pull",
          FIX_MODE
            ? () =>
                execSync("cd /home/ubuntu/manus-persistent-drive && git pull", {
                  stdio: "inherit",
                })
            : null
        );
      } else {
        record("persistent-drive", "ok", `manus-persistent-drive current (pulled ${hours.toFixed(1)}h ago)`);
      }
    } else {
      record("persistent-drive", "warn", "manus-persistent-drive has never been pulled — run git pull");
    }
  } catch {
    record("persistent-drive", "warn", "Could not check manus-persistent-drive freshness");
  }
}

// ─── CHECK 2: Phase log exists and has entries ───────────────────────────────
function checkPhaseLog() {
  const phaseLogPath = join(DRIVE_PATH, "context", "phase-log", "phase_log.md");
  if (!existsSync(phaseLogPath)) {
    record("phase-log", "fail", "Phase log not found at " + phaseLogPath);
    return;
  }

  const content = readFileSync(phaseLogPath, "utf8");
  const lines = content.split("\n").filter((l) => l.trim().startsWith("|"));
  const phaseCount = lines.length - 2; // subtract header rows

  if (phaseCount < 1) {
    record("phase-log", "warn", "Phase log exists but has no entries");
  } else {
    // Extract last phase
    const lastLine = lines[lines.length - 1];
    record("phase-log", "ok", `Phase log has ${phaseCount} entries. Last: ${lastLine.split("|")[1]?.trim() ?? "?"}`);
  }
}

// ─── CHECK 3: todo.md in sync with phase log ─────────────────────────────────
function checkTodoSync() {
  const todoPath = join(PROJECT_ROOT, "todo.md");
  if (!existsSync(todoPath)) {
    record("todo-sync", "fail", "todo.md not found in project root");
    return;
  }

  const todo = readFileSync(todoPath, "utf8");
  const pending = (todo.match(/^- \[ \]/gm) || []).length;
  const done = (todo.match(/^- \[x\]/gm) || []).length;
  const total = pending + done;

  // Check drive copy exists
  const driveTodo = join(DRIVE_PATH, "data", "protein-truth-desk", "todo", "todo.md");
  if (!existsSync(driveTodo)) {
    record(
      "todo-sync",
      "warn",
      `todo.md not synced to persistent drive (${done}/${total} complete, ${pending} pending)`
    );
    return;
  }

  const driveTodoContent = readFileSync(driveTodo, "utf8");
  const driveDone = (driveTodoContent.match(/^- \[x\]/gm) || []).length;

  if (driveDone < done) {
    record(
      "todo-sync",
      "warn",
      `todo.md drift: local has ${done} done, drive has ${driveDone} done — run sync`
    );
  } else {
    record("todo-sync", "ok", `todo.md in sync (${done}/${total} complete, ${pending} pending)`);
  }
}

// ─── CHECK 4: TypeScript compiles with 0 errors ──────────────────────────────
function checkTypeScript() {
  try {
    const result = spawnSync("npx", ["tsc", "--noEmit", "--pretty", "false"], {
      cwd: PROJECT_ROOT,
      encoding: "utf8",
      timeout: 60000,
    });
    if (result.status === 0) {
      record("typescript", "ok", "TypeScript: 0 errors");
    } else {
      const errors = (result.stdout + result.stderr).split("\n").filter((l) => l.includes("error TS")).length;
      record(
        "typescript",
        "fail",
        `TypeScript: ${errors} error(s)`,
        (result.stdout + result.stderr).split("\n").filter((l) => l.includes("error TS")).slice(0, 5).join("\n")
      );
    }
  } catch {
    record("typescript", "warn", "TypeScript check timed out or failed to run");
  }
}

// ─── CHECK 5: Test suite passes ──────────────────────────────────────────────
function checkTests() {
  try {
    const result = spawnSync(
      "pnpm",
      ["test", "--reporter=verbose", "--run"],
      {
        cwd: PROJECT_ROOT,
        encoding: "utf8",
        timeout: 120000,
      }
    );
    const output = result.stdout + result.stderr;
    const passMatch = output.match(/(\d+) passed/);
    const failMatch = output.match(/(\d+) failed/);
    const passed = passMatch ? parseInt(passMatch[1]) : 0;
    const failed = failMatch ? parseInt(failMatch[1]) : 0;

    if (result.status === 0) {
      record("tests", "ok", `Tests: ${passed} passing, 0 failing`);
    } else {
      record(
        "tests",
        "fail",
        `Tests: ${passed} passing, ${failed} failing`,
        output.split("\n").filter((l) => l.includes("FAIL") || l.includes("✗")).slice(0, 8).join("\n")
      );
    }
  } catch {
    record("tests", "warn", "Test suite timed out or failed to run");
  }
}

// ─── CHECK 6: Stub count gate ────────────────────────────────────────────────
function checkStubs() {
  const stubPatterns = [
    /\/\/ STUB/i,
    /throw new Error\(['"]not implemented/i,
    /TODO: implement/i,
    /return \[\]; \/\/ stub/i,
    /return null; \/\/ stub/i,
    /return {}; \/\/ stub/i,
  ];

  const stubFiles = [];
  try {
    const result = spawnSync(
      "grep",
      ["-rl", "--include=*.ts", "--include=*.tsx", "STUB\\|not implemented\\|TODO: implement", "server/", "client/src/"],
      { cwd: PROJECT_ROOT, encoding: "utf8" }
    );
    const files = (result.stdout || "").split("\n").filter(Boolean);

    for (const file of files) {
      const fullPath = join(PROJECT_ROOT, file);
      if (!existsSync(fullPath)) continue;
      const content = readFileSync(fullPath, "utf8");
      if (stubPatterns.some((p) => p.test(content))) {
        stubFiles.push(file);
      }
    }
  } catch {
    // grep not available or no matches
  }

  const STUB_THRESHOLD = 20; // warn above this, fail above 2x
  if (stubFiles.length === 0) {
    record("stubs", "ok", "No stub files detected");
  } else if (stubFiles.length <= STUB_THRESHOLD) {
    record(
      "stubs",
      "warn",
      `${stubFiles.length} stub file(s) detected — replace before shipping`,
      stubFiles.slice(0, 10).join("\n")
    );
  } else {
    record(
      "stubs",
      "fail",
      `${stubFiles.length} stub files exceed threshold (${STUB_THRESHOLD}) — critical debt`,
      stubFiles.slice(0, 15).join("\n")
    );
  }
}

// ─── CHECK 7: ESLint errors (not warnings) ───────────────────────────────────
function checkLint() {
  try {
    const result = spawnSync(
      "pnpm",
      ["lint", "--format=json"],
      { cwd: PROJECT_ROOT, encoding: "utf8", timeout: 60000 }
    );
    // Try to parse JSON output
    let errorCount = 0;
    let warnCount = 0;
    try {
      // Find JSON array in output
      const jsonStart = result.stdout.indexOf("[");
      if (jsonStart >= 0) {
        const parsed = JSON.parse(result.stdout.slice(jsonStart));
        for (const file of parsed) {
          errorCount += file.errorCount || 0;
          warnCount += file.warningCount || 0;
        }
      }
    } catch {
      // Fall back to line counting
      errorCount = (result.stdout + result.stderr).split("\n").filter((l) => / error /.test(l)).length;
    }

    if (errorCount === 0 && warnCount === 0) {
      record("lint", "ok", "ESLint: 0 errors, 0 warnings");
    } else if (errorCount === 0) {
      record("lint", "warn", `ESLint: 0 errors, ${warnCount} warnings`);
    } else {
      record(
        "lint",
        "fail",
        `ESLint: ${errorCount} error(s), ${warnCount} warning(s) — pre-commit hook will block commits`,
        "Run: pnpm lint to see details"
      );
    }
  } catch {
    record("lint", "warn", "ESLint check failed to run");
  }
}

// ─── CHECK 8: Node modules installed ─────────────────────────────────────────
function checkDeps() {
  const nmPath = join(PROJECT_ROOT, "node_modules");
  if (!existsSync(nmPath)) {
    record(
      "deps",
      "fail",
      "node_modules missing — run pnpm install",
      null,
      FIX_MODE ? () => execSync("pnpm install", { cwd: PROJECT_ROOT, stdio: "inherit" }) : null
    );
  } else {
    record("deps", "ok", "node_modules present");
  }
}

// ─── Run all checks ──────────────────────────────────────────────────────────
async function main() {
  if (!JSON_MODE) {
    console.log(`\n${c.bold}${c.blue}╔══════════════════════════════════════════╗${c.reset}`);
    console.log(`${c.bold}${c.blue}║   Manus Session Integrity Check          ║${c.reset}`);
    console.log(`${c.bold}${c.blue}╚══════════════════════════════════════════╝${c.reset}\n`);
    console.log(`${c.dim}Project: ${PROJECT_ROOT}${c.reset}`);
    console.log(`${c.dim}Drive:   ${DRIVE_PATH}${c.reset}\n`);
  }

  // Run checks (TypeScript and tests are slow — run them last)
  checkDeps();
  checkPersistentDrive();
  checkPhaseLog();
  checkTodoSync();
  checkStubs();
  checkLint();
  checkTypeScript();
  checkTests();

  // Apply fixes if requested
  if (FIX_MODE) {
    for (const r of results) {
      if (r.fix && typeof r.fix === "function") {
        console.log(`\n${c.yellow}Fixing: ${r.name}...${c.reset}`);
        try {
          r.fix();
        } catch (e) {
          console.error(`Fix failed: ${e.message}`);
        }
      }
    }
  }

  // Output results
  if (JSON_MODE) {
    const summary = {
      timestamp: new Date().toISOString(),
      project: PROJECT_ROOT,
      passed: results.filter((r) => r.status === "ok").length,
      warnings,
      failures,
      checks: results.map(({ fix, ...r }) => r),
    };
    console.log(JSON.stringify(summary, null, 2));
  } else {
    for (const r of results) {
      if (r.status === "ok") console.log(ok(r.message));
      else if (r.status === "warn") console.log(warn(r.message));
      else console.log(fail(r.message));
      if (r.detail) {
        console.log(`  ${c.dim}${r.detail.replace(/\n/g, "\n  ")}${c.reset}`);
      }
    }

    console.log(`\n${c.bold}─── Summary ─────────────────────────────────${c.reset}`);
    const passed = results.filter((r) => r.status === "ok").length;
    console.log(`  ${c.green}Passed:${c.reset}   ${passed}/${results.length}`);
    console.log(`  ${c.yellow}Warnings:${c.reset} ${warnings}`);
    console.log(`  ${c.red}Failures:${c.reset} ${failures}`);

    if (failures > 0) {
      console.log(
        `\n${c.red}${c.bold}SESSION BLOCKED — fix the ${failures} failure(s) above before writing code.${c.reset}`
      );
      console.log(
        `${c.dim}This is not optional. Skipping this check is how 27 phases of work got lost.${c.reset}\n`
      );
    } else if (warnings > 0) {
      console.log(
        `\n${c.yellow}Session has ${warnings} warning(s) — proceed with caution and resolve before end of session.${c.reset}\n`
      );
    } else {
      console.log(`\n${c.green}${c.bold}All checks passed — session is clean. Start coding.${c.reset}\n`);
    }
  }

  if (CI_MODE && failures > 0) process.exit(1);
}

main().catch((e) => {
  console.error("session-integrity check crashed:", e);
  process.exit(1);
});
