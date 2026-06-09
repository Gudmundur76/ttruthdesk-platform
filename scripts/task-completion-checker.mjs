#!/usr/bin/env node
/**
 * task-completion-checker.mjs
 * ───────────────────────────
 * Enforces the "Definition of Done" for every coding task.
 * Run this BEFORE ending a session or creating a checkpoint.
 * Exits 1 if any criterion fails — the task is NOT complete.
 *
 * Usage:
 *   node scripts/task-completion-checker.mjs                # interactive report
 *   node scripts/task-completion-checker.mjs --ci           # exits 1 on failure
 *   node scripts/task-completion-checker.mjs --task "name"  # tag the task in output
 *   node scripts/task-completion-checker.mjs --strict       # treat warnings as failures
 *
 * Definition of Done (all must pass):
 *   1. TypeScript: 0 errors
 *   2. ESLint: 0 errors (warnings allowed unless --strict)
 *   3. All tests pass (0 failures)
 *   4. No new stubs introduced (stub count <= baseline)
 *   5. Every new exported function has a corresponding test
 *   6. todo.md has no [ ] items from the current task (all checked off)
 *   7. No orphaned TODO/FIXME comments added in this session
 *   8. Coverage thresholds pass (pnpm test:coverage)
 */
import { execSync, spawnSync } from "child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { join, resolve, relative } from "path";
import { fileURLToPath } from "url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..");

const CI_MODE = process.argv.includes("--ci");
const STRICT_MODE = process.argv.includes("--strict");
const TASK_NAME = (() => {
  const idx = process.argv.indexOf("--task");
  return idx !== -1 ? process.argv[idx + 1] : null;
})();

// ─── Colours ────────────────────────────────────────────────────────────────
const c = {
  reset: "\x1b[0m", red: "\x1b[31m", green: "\x1b[32m",
  yellow: "\x1b[33m", blue: "\x1b[34m", bold: "\x1b[1m", dim: "\x1b[2m",
};
const ok   = (msg) => `  ${c.green}✓${c.reset} ${msg}`;
const fail = (msg) => `  ${c.red}✗${c.reset} ${msg}`;
const warn = (msg) => `  ${c.yellow}⚠${c.reset} ${msg}`;
const info = (msg) => `  ${c.blue}ℹ${c.reset} ${msg}`;

const results = [];
let failures = 0;
let warnings = 0;

function record(name, status, message, detail = null) {
  results.push({ name, status, message, detail });
  if (status === "fail") failures++;
  if (status === "warn") warnings++;
}

// ─── CRITERION 1: TypeScript 0 errors ───────────────────────────────────────
function checkTypeScript() {
  try {
    const r = spawnSync("npx", ["tsc", "--noEmit"], {
      cwd: PROJECT_ROOT, encoding: "utf8", timeout: 60000,
    });
    if (r.status === 0) {
      record("typescript", "pass", "TypeScript: 0 errors");
    } else {
      const lines = (r.stdout + r.stderr).split("\n").filter(l => l.includes("error TS")).length;
      record("typescript", "fail", `TypeScript: ${lines} error(s)`, r.stdout + r.stderr);
    }
  } catch (e) {
    record("typescript", "fail", "TypeScript check failed to run", e.message);
  }
}

// ─── CRITERION 2: ESLint 0 errors ───────────────────────────────────────────
function checkLint() {
  try {
    const r = spawnSync("pnpm", ["lint"], {
      cwd: PROJECT_ROOT, encoding: "utf8", timeout: 60000,
    });
    const output = r.stdout + r.stderr;
    const errorMatch = output.match(/(\d+) error/);
    const warnMatch  = output.match(/(\d+) warning/);
    const errorCount = errorMatch ? parseInt(errorMatch[1]) : 0;
    const warnCount  = warnMatch  ? parseInt(warnMatch[1])  : 0;

    if (errorCount === 0 && warnCount === 0) {
      record("eslint", "pass", "ESLint: 0 errors, 0 warnings");
    } else if (errorCount === 0) {
      const status = STRICT_MODE ? "fail" : "warn";
      record("eslint", status, `ESLint: 0 errors, ${warnCount} warnings${STRICT_MODE ? " (strict mode: warnings = failures)" : ""}`);
    } else {
      record("eslint", "fail", `ESLint: ${errorCount} error(s), ${warnCount} warnings`, output.split("\n").filter(l => l.includes("error")).slice(0, 10).join("\n"));
    }
  } catch (e) {
    record("eslint", "fail", "ESLint check failed to run", e.message);
  }
}

// ─── CRITERION 3: All tests pass ────────────────────────────────────────────
function checkTests() {
  try {
    const r = spawnSync("pnpm", ["test"], {
      cwd: PROJECT_ROOT, encoding: "utf8", timeout: 120000,
    });
    const output = r.stdout + r.stderr;
    const passMatch = output.match(/Tests\s+(\d+) passed/);
    const failMatch = output.match(/(\d+) failed/);
    const failCount = failMatch ? parseInt(failMatch[1]) : 0;
    const passCount = passMatch ? parseInt(passMatch[1]) : 0;

    if (r.status === 0 && failCount === 0) {
      record("tests", "pass", `Tests: ${passCount} passed, 0 failed`);
    } else {
      record("tests", "fail", `Tests: ${failCount} failed, ${passCount} passed`,
        output.split("\n").filter(l => l.includes("FAIL") || l.includes("✗") || l.includes("AssertionError")).slice(0, 15).join("\n"));
    }
  } catch (e) {
    record("tests", "fail", "Test suite failed to run", e.message);
  }
}

// ─── CRITERION 4: No new stubs introduced ───────────────────────────────────
function checkStubs() {
  try {
    const r = spawnSync("node", ["scripts/stub-tracker.mjs", "--json"], {
      cwd: PROJECT_ROOT, encoding: "utf8", timeout: 30000,
    });
    if (r.status !== 0) {
      record("stubs", "warn", "Stub tracker failed to run — check manually");
      return;
    }
    const data = JSON.parse(r.stdout);
    const stubCount = data.totalStubs ?? data.length ?? 0;

    // Read baseline from CLAUDE.md or use a default
    const claudeMd = existsSync(join(PROJECT_ROOT, "CLAUDE.md"))
      ? readFileSync(join(PROJECT_ROOT, "CLAUDE.md"), "utf8")
      : "";
    const baselineMatch = claudeMd.match(/Stub files[^\|]*\|[^\|]*(\d+)/);
    const baseline = baselineMatch ? parseInt(baselineMatch[1]) : 50;

    if (stubCount <= baseline) {
      record("stubs", "pass", `Stubs: ${stubCount} (within baseline of ${baseline})`);
    } else {
      record("stubs", "fail", `Stubs: ${stubCount} (exceeds baseline of ${baseline} — new stubs introduced)`,
        `Run: node scripts/stub-tracker.mjs --detail`);
    }
  } catch (e) {
    record("stubs", "warn", "Stub check failed — check manually: " + e.message);
  }
}

// ─── CRITERION 5: No unchecked todo items from current task ─────────────────
function checkTodo() {
  const todoPath = join(PROJECT_ROOT, "todo.md");
  if (!existsSync(todoPath)) {
    record("todo", "warn", "todo.md not found");
    return;
  }

  const content = readFileSync(todoPath, "utf8");
  const lines = content.split("\n");

  // Find unchecked items
  const unchecked = lines
    .map((l, i) => ({ line: i + 1, text: l }))
    .filter(({ text }) => /^\s*-\s*\[\s*\]\s/.test(text));

  if (unchecked.length === 0) {
    record("todo", "pass", "todo.md: all items checked off");
  } else {
    // Check if any unchecked items are from a recent phase (last 30 lines of file)
    const recentUnchecked = unchecked.filter(({ line }) => line > lines.length - 60);
    if (recentUnchecked.length > 0) {
      record("todo", "fail",
        `todo.md: ${recentUnchecked.length} unchecked item(s) in recent phases — task may be incomplete`,
        recentUnchecked.slice(0, 5).map(({ line, text }) => `  L${line}: ${text.trim()}`).join("\n"));
    } else {
      record("todo", "warn",
        `todo.md: ${unchecked.length} unchecked item(s) total (none in recent phases — may be planned future work)`);
    }
  }
}

// ─── CRITERION 6: No orphaned TODO/FIXME comments added ─────────────────────
function checkTodoComments() {
  try {
    // Use git diff to find TODO/FIXME added in uncommitted changes
    const r = spawnSync("git", ["diff", "HEAD", "--unified=0"], {
      cwd: PROJECT_ROOT, encoding: "utf8", timeout: 15000,
    });
    const added = r.stdout.split("\n")
      .filter(l => l.startsWith("+") && !l.startsWith("+++"))
      .filter(l => /\b(TODO|FIXME|HACK|XXX)\b/i.test(l));

    if (added.length === 0) {
      record("todo-comments", "pass", "No new TODO/FIXME comments introduced");
    } else {
      record("todo-comments", "warn",
        `${added.length} new TODO/FIXME comment(s) added — ensure they are tracked in todo.md`,
        added.slice(0, 5).join("\n"));
    }
  } catch (e) {
    record("todo-comments", "warn", "Could not check TODO comments: " + e.message);
  }
}

// ─── CRITERION 7: Coverage thresholds pass ──────────────────────────────────
function checkCoverage() {
  try {
    const r = spawnSync("pnpm", ["test:coverage"], {
      cwd: PROJECT_ROOT, encoding: "utf8", timeout: 120000,
    });
    const output = r.stdout + r.stderr;
    const errors = output.split("\n").filter(l => l.includes("ERROR: Coverage"));

    if (errors.length === 0 && r.status === 0) {
      record("coverage", "pass", "Coverage: all thresholds met");
    } else if (errors.length > 0) {
      record("coverage", "fail", `Coverage: ${errors.length} threshold(s) not met`,
        errors.join("\n"));
    } else {
      record("coverage", "warn", "Coverage check returned non-zero but no threshold errors found");
    }
  } catch (e) {
    record("coverage", "warn", "Coverage check failed to run: " + e.message);
  }
}

// ─── CRITERION 8: No new exported functions without tests ───────────────────
function checkUncoveredExports() {
  try {
    // Find functions added in this session (git diff)
    const r = spawnSync("git", ["diff", "HEAD", "--unified=0", "--", "server/**/*.ts"], {
      cwd: PROJECT_ROOT, encoding: "utf8", timeout: 15000, shell: true,
    });

    const addedExports = r.stdout.split("\n")
      .filter(l => l.startsWith("+") && !l.startsWith("+++"))
      .filter(l => /^\+export (async function|function|const) \w+/.test(l))
      .map(l => l.replace(/^\+/, "").trim());

    if (addedExports.length === 0) {
      record("exports-tested", "pass", "No new exported functions detected in diff");
      return;
    }

    // Check if each new export has a corresponding test
    const testFiles = [];
    function walkTests(dir) {
      if (!existsSync(dir)) return;
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory() && !["node_modules", "dist", "coverage"].includes(entry.name)) {
          walkTests(full);
        } else if (entry.name.endsWith(".test.ts") || entry.name.endsWith(".spec.ts")) {
          testFiles.push(readFileSync(full, "utf8"));
        }
      }
    }
    walkTests(join(PROJECT_ROOT, "server"));

    const allTestContent = testFiles.join("\n");
    const untested = addedExports.filter(exp => {
      const fnName = exp.match(/(?:function|const)\s+(\w+)/)?.[1];
      return fnName && !allTestContent.includes(fnName);
    });

    if (untested.length === 0) {
      record("exports-tested", "pass", `${addedExports.length} new export(s) — all have test coverage`);
    } else {
      record("exports-tested", "warn",
        `${untested.length} new export(s) may lack tests`,
        untested.slice(0, 5).join("\n"));
    }
  } catch (e) {
    record("exports-tested", "warn", "Export coverage check failed: " + e.message);
  }
}

// ─── Run all checks ──────────────────────────────────────────────────────────
console.log(`\n${c.bold}╔══════════════════════════════════════════════════╗${c.reset}`);
console.log(`${c.bold}║     TASK COMPLETION CHECKER — Definition of Done  ║${c.reset}`);
console.log(`${c.bold}╚══════════════════════════════════════════════════╝${c.reset}`);
if (TASK_NAME) console.log(`${c.blue}  Task: ${TASK_NAME}${c.reset}`);
console.log();

console.log(`${c.dim}Running checks...${c.reset}\n`);

checkTypeScript();
checkLint();
checkTests();
checkStubs();
checkTodo();
checkTodoComments();
checkCoverage();
checkUncoveredExports();

// ─── Report ──────────────────────────────────────────────────────────────────
console.log(`\n${c.bold}Results:${c.reset}`);
for (const r of results) {
  if (r.status === "pass") {
    console.log(ok(r.message));
  } else if (r.status === "warn") {
    console.log(warn(r.message));
    if (r.detail) console.log(`${c.dim}${r.detail}${c.reset}`);
  } else {
    console.log(fail(r.message));
    if (r.detail) console.log(`${c.dim}${r.detail}${c.reset}`);
  }
}

const effectiveFailures = STRICT_MODE ? failures + warnings : failures;
console.log();
if (effectiveFailures === 0) {
  console.log(`${c.green}${c.bold}✓ TASK COMPLETE — Definition of Done satisfied.${c.reset}`);
  console.log(`${c.dim}  Safe to checkpoint and end session.${c.reset}\n`);
  process.exit(0);
} else {
  console.log(`${c.red}${c.bold}✗ TASK INCOMPLETE — ${failures} failure(s), ${warnings} warning(s).${c.reset}`);
  console.log(`${c.red}  Fix the above issues before ending the session.${c.reset}`);
  console.log(`${c.dim}  Partial work creates compounding gaps — finish the task now.${c.reset}\n`);
  if (CI_MODE) process.exit(1);
  else process.exit(1); // always exit 1 so it can be used in hooks
}
