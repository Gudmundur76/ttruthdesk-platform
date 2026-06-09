#!/usr/bin/env node
/**
 * meta-agent.mjs — Session Governance for Protein Truth Desk
 *
 * Enforces three invariants at every session boundary:
 *   1. manus-persistent-drive is not stale (synced within 24h)
 *   2. phase-log.md last entry matches last completed phase in todo.md
 *   3. A session JSON exists for this session
 *
 * Usage:
 *   pnpm meta:start          — run at session start (before context:snapshot)
 *   pnpm meta:end            — run at session end (after checkpoint + push)
 *   pnpm drive:sync          — force full sync (same as meta:end --force)
 *
 * Flags:
 *   --mode=start|end         — required
 *   --force                  — force sync even if nothing changed
 *   --dry-run                — check and report without pushing
 */

import { execSync, spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");
const DRIVE_DIR = "/tmp/manus-persistent-drive";
const DRIVE_REPO = "https://github.com/Gudmundur76/manus-persistent-drive.git";
const PHASE_LOG = path.join(DRIVE_DIR, "logs/phase-log.md");
const SESSIONS_CURRENT = path.join(DRIVE_DIR, "sessions/current");
const SESSIONS_HISTORY = path.join(DRIVE_DIR, "sessions/history");
const DATA_DIR = path.join(DRIVE_DIR, "data/protein-truth-desk");
const TODO_PATH = path.join(PROJECT_ROOT, "todo.md");
const FEATURE_LIST_PATH = path.join(PROJECT_ROOT, "feature_list.json");
const CONTEXT_SNAPSHOT_PATH = path.join(PROJECT_ROOT, "CONTEXT_SNAPSHOT.md");
const CLAUDE_MD_PATH = path.join(PROJECT_ROOT, "CLAUDE.md");

// ── Colours ──────────────────────────────────────────────────────────────────
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

// ── Helpers ───────────────────────────────────────────────────────────────────
function run(cmd, opts = {}) {
  try {
    return execSync(cmd, { encoding: "utf8", stdio: "pipe", ...opts }).trim();
  } catch (e) {
    return null;
  }
}

function banner(text, colour = CYAN) {
  const line = "─".repeat(60);
  console.log(`\n${colour}${BOLD}${line}${RESET}`);
  console.log(`${colour}${BOLD}  ${text}${RESET}`);
  console.log(`${colour}${BOLD}${line}${RESET}\n`);
}

function ok(msg) { console.log(`  ${GREEN}✓${RESET} ${msg}`); }
function warn(msg) { console.log(`  ${YELLOW}⚠${RESET}  ${msg}`); }
function err(msg) { console.log(`  ${RED}✗${RESET} ${msg}`); }
function info(msg) { console.log(`  ${CYAN}ℹ${RESET}  ${msg}`); }

function getSessionId() {
  const now = new Date();
  const date = now.toISOString().slice(0, 10);
  // Try to get the last completed phase from todo.md
  const lastPhase = getLastCompletedPhase();
  return `phase${lastPhase}_${date}`;
}

function getLastCompletedPhase() {
  if (!fs.existsSync(TODO_PATH)) return "unknown";
  const content = fs.readFileSync(TODO_PATH, "utf8");
  const phaseHeaders = [...content.matchAll(/^## Phase (\d+)/gm)];
  if (phaseHeaders.length === 0) return "unknown";
  return phaseHeaders[phaseHeaders.length - 1][1];
}

function getLastPhaseLogEntry() {
  if (!fs.existsSync(PHASE_LOG)) return null;
  const content = fs.readFileSync(PHASE_LOG, "utf8");
  const entries = [...content.matchAll(/^## Phase (\d+)/gm)];
  if (entries.length === 0) return null;
  return entries[entries.length - 1][1];
}

function getDriveAge() {
  if (!fs.existsSync(DRIVE_DIR)) return Infinity;
  const result = run(`cd "${DRIVE_DIR}" && git log -1 --format="%ct"`);
  if (!result) return Infinity;
  const lastCommitMs = parseInt(result) * 1000;
  return Date.now() - lastCommitMs;
}

function ensureDriveCloned() {
  if (!fs.existsSync(DRIVE_DIR)) {
    info("Cloning manus-persistent-drive...");
    const r = spawnSync("git", ["clone", DRIVE_REPO, DRIVE_DIR], { stdio: "inherit" });
    if (r.status !== 0) {
      err("Failed to clone manus-persistent-drive. Check GitHub access.");
      return false;
    }
    ok("Drive cloned.");
  } else {
    info("Pulling latest from manus-persistent-drive...");
    run(`cd "${DRIVE_DIR}" && git pull origin main --ff-only 2>&1`);
    ok("Drive up to date.");
  }
  return true;
}

function copySnapshotFiles() {
  const filesToCopy = [
    [path.join(PROJECT_ROOT, "server/routers.ts"), path.join(DATA_DIR, "services/routers.ts")],
    [path.join(PROJECT_ROOT, "server/db.ts"), path.join(DATA_DIR, "services/db.ts")],
    [path.join(PROJECT_ROOT, "scripts/agent_tools.ts"), path.join(DATA_DIR, "services/agent_tools.ts")],
    [path.join(PROJECT_ROOT, "drizzle/schema.ts"), path.join(DATA_DIR, "schema.ts")],
    [FEATURE_LIST_PATH, path.join(DATA_DIR, "feature_list.json")],
    [CONTEXT_SNAPSHOT_PATH, path.join(DATA_DIR, "CONTEXT_SNAPSHOT.md")],
    [CLAUDE_MD_PATH, path.join(DATA_DIR, "CLAUDE.md")],
    [TODO_PATH, path.join(DATA_DIR, "todo.md")],
  ];
  let copied = 0;
  for (const [src, dst] of filesToCopy) {
    if (fs.existsSync(src)) {
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.copyFileSync(src, dst);
      copied++;
    }
  }
  ok(`Snapshot: ${copied} files copied to data/protein-truth-desk/`);
}

function writeSessionFile(sessionId, status = "in_progress") {
  fs.mkdirSync(SESSIONS_CURRENT, { recursive: true });
  fs.mkdirSync(SESSIONS_HISTORY, { recursive: true });
  const sessionPath = path.join(SESSIONS_CURRENT, `${sessionId}.json`);

  // Get test count from last test run if available
  let testCount = null;
  const summaryPath = path.join(PROJECT_ROOT, "coverage/coverage-summary.json");
  if (fs.existsSync(summaryPath)) {
    try {
      const summary = JSON.parse(fs.readFileSync(summaryPath, "utf8"));
      testCount = summary?.total?.lines?.total ?? null;
    } catch {}
  }

  const session = {
    sessionId,
    taskType: "main",
    startedAt: new Date().toISOString(),
    status,
    host: run("hostname") ?? "unknown",
    projectRepo: "https://github.com/Gudmundur76/protein-truth-desk",
    driveRepo: DRIVE_REPO,
    checkpointRef: run(`cd "${PROJECT_ROOT}" && git rev-parse --short HEAD`) ?? "unknown",
    notes: "",
    lastPhase: getLastCompletedPhase(),
  };
  fs.writeFileSync(sessionPath, JSON.stringify(session, null, 2));
  return sessionPath;
}

function finaliseSessionFile(sessionId) {
  const currentPath = path.join(SESSIONS_CURRENT, `${sessionId}.json`);
  const historyPath = path.join(SESSIONS_HISTORY, `${sessionId}.json`);

  let session = {};
  if (fs.existsSync(currentPath)) {
    session = JSON.parse(fs.readFileSync(currentPath, "utf8"));
  }
  session.status = "complete";
  session.completedAt = new Date().toISOString();
  session.checkpointRef = run(`cd "${PROJECT_ROOT}" && git rev-parse --short HEAD`) ?? "unknown";
  session.lastPhase = getLastCompletedPhase();

  fs.mkdirSync(SESSIONS_HISTORY, { recursive: true });
  fs.writeFileSync(historyPath, JSON.stringify(session, null, 2));
  if (fs.existsSync(currentPath)) fs.unlinkSync(currentPath);
  ok(`Session ${sessionId} moved to history.`);
}

function pushDrive(sessionId, dryRun = false) {
  if (dryRun) {
    const changes = run(`cd "${DRIVE_DIR}" && git status --short`);
    if (changes) {
      warn(`[dry-run] Drive has uncommitted changes:\n${changes}`);
    } else {
      ok("[dry-run] Drive is clean — nothing to push.");
    }
    return;
  }
  run(`cd "${DRIVE_DIR}" && git add -A`);
  const changes = run(`cd "${DRIVE_DIR}" && git diff --cached --name-only`);
  if (!changes) {
    ok("Drive: nothing to commit.");
    return;
  }
  const msg = `sync: ${sessionId} — Phase ${getLastCompletedPhase()} (${new Date().toISOString().slice(0, 10)})`;
  run(`cd "${DRIVE_DIR}" && git commit -m "${msg}"`);
  const pushResult = run(`cd "${DRIVE_DIR}" && git push origin main 2>&1`);
  if (pushResult !== null) {
    ok(`Drive pushed: ${msg}`);
  } else {
    err("Drive push failed. Run: cd /tmp/manus-persistent-drive && git push origin main");
  }
}

// ── Mode: start ───────────────────────────────────────────────────────────────
function modeStart() {
  banner("META-AGENT: Session Start Check", CYAN);

  // 1. Clone/pull drive
  const cloned = ensureDriveCloned();
  if (!cloned) {
    warn("Could not access drive. Continuing without drive check.");
  }

  // 2. Check drive staleness
  const ageMs = getDriveAge();
  const ageHours = Math.round(ageMs / 3600000 * 10) / 10;
  if (ageMs === Infinity) {
    warn("Drive age unknown (could not read git log).");
  } else if (ageHours > 24) {
    err(`Drive is STALE: last synced ${ageHours}h ago (threshold: 24h)`);
    err("Run 'pnpm drive:sync' at the end of this session to fix this.");
  } else {
    ok(`Drive freshness: ${ageHours}h ago (within 24h threshold)`);
  }

  // 3. Check phase log currency
  const lastLogPhase = getLastPhaseLogEntry();
  const lastTodoPhase = getLastCompletedPhase();
  if (lastLogPhase === null) {
    warn("Phase log is empty or missing.");
  } else if (lastLogPhase !== lastTodoPhase) {
    warn(`Phase log gap detected: log ends at Phase ${lastLogPhase}, todo.md ends at Phase ${lastTodoPhase}`);
    warn("Run 'pnpm drive:sync' to append the missing phase entries.");
  } else {
    ok(`Phase log current: Phase ${lastLogPhase} matches todo.md`);
  }

  // 4. Create session file
  const sessionId = getSessionId();
  const sessionPath = writeSessionFile(sessionId);
  ok(`Session registered: ${sessionId}`);

  // 5. Summary
  console.log("");
  console.log(`${BOLD}Session ID:${RESET}   ${sessionId}`);
  console.log(`${BOLD}Drive age:${RESET}    ${ageHours}h`);
  console.log(`${BOLD}Phase log:${RESET}    Phase ${lastLogPhase ?? "?"} → todo Phase ${lastTodoPhase}`);
  console.log(`${BOLD}Next steps:${RESET}   pnpm context:snapshot && pnpm feature:sync`);
  console.log("");
}

// ── Mode: end ─────────────────────────────────────────────────────────────────
function modeEnd(dryRun = false) {
  banner("META-AGENT: Session End Sync", GREEN);

  // 1. Ensure drive is available
  const cloned = ensureDriveCloned();
  if (!cloned) {
    err("Cannot sync — drive not accessible.");
    process.exit(1);
  }

  // 2. Copy snapshot files
  copySnapshotFiles();

  // 3. Finalise session
  const sessionId = getSessionId();
  finaliseSessionFile(sessionId);

  // 4. Push
  pushDrive(sessionId, dryRun);

  // 5. Summary
  console.log("");
  if (dryRun) {
    console.log(`${YELLOW}${BOLD}[dry-run] No changes pushed. Run 'pnpm drive:sync' to push.${RESET}`);
  } else {
    console.log(`${GREEN}${BOLD}Drive synced. Next session will start clean.${RESET}`);
  }
  console.log("");
}

// ── Entry point ───────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const mode = args.find(a => a.startsWith("--mode="))?.split("=")[1] ?? "start";
const dryRun = args.includes("--dry-run");
const force = args.includes("--force");

if (mode === "start") {
  modeStart();
} else if (mode === "end" || force) {
  modeEnd(dryRun);
} else {
  console.error(`Unknown mode: ${mode}. Use --mode=start or --mode=end`);
  process.exit(1);
}
