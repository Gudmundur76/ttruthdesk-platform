#!/usr/bin/env node
/**
 * manus-session.mjs — Unified session discipline CLI for Protein Truth Desk
 *
 * Usage:
 *   node scripts/manus-session.mjs start [session-id]
 *   node scripts/manus-session.mjs end "feat(claims): add confidence sparkline"
 *   node scripts/manus-session.mjs status
 *   node scripts/manus-session.mjs log-phase <phase-number> <title> <status>
 *
 * This script is the single entry point for all session lifecycle operations.
 * It replaces the separate bootstrap.sh and sync.sh scripts in manus-persistent-drive.
 *
 * What it does:
 *   start  — clones/pulls manus-persistent-drive, loads context, registers session
 *   end    — exports state, updates phase log, pushes to both GitHub repos
 *   status — shows current session state, phase progress, and stub count
 *   log-phase — records a phase completion in the persistent drive
 */

import { execSync, spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");
const DRIVE_PATH = "/home/ubuntu/manus-persistent-drive";
const DRIVE_REPO = "Gudmundur76/manus-persistent-drive";
const PROJECT_REPO = "Gudmundur76/protein-truth-desk";
const SESSION_FILE = path.join(DRIVE_PATH, "context/session-state.json");
const PHASE_LOG = path.join(DRIVE_PATH, "context/phase-log/phase_log.md");
const TODO_FILE = path.join(PROJECT_ROOT, "todo.md");

// ─── Helpers ──────────────────────────────────────────────────────────────────

function run(cmd, opts = {}) {
  try {
    return execSync(cmd, { encoding: "utf8", stdio: opts.silent ? "pipe" : "inherit", ...opts });
  } catch (e) {
    if (!opts.ignoreError) throw e;
    return "";
  }
}

function runSilent(cmd) {
  return run(cmd, { silent: true, ignoreError: true });
}

function loadJson(filePath, fallback = {}) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function saveJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n");
}

function countTodo() {
  if (!fs.existsSync(TODO_FILE)) return { total: 0, done: 0, pending: 0 };
  const lines = fs.readFileSync(TODO_FILE, "utf8").split("\n");
  const done = lines.filter((l) => l.match(/^\s*-\s*\[x\]/i)).length;
  const pending = lines.filter((l) => l.match(/^\s*-\s*\[\s\]/)).length;
  return { total: done + pending, done, pending };
}

function countStubs() {
  const result = runSilent(`grep -rl "^// Stub:" "${PROJECT_ROOT}/server" 2>/dev/null`);
  const files = result.trim().split("\n").filter(Boolean);
  return { count: files.length, files: files.map((f) => path.relative(PROJECT_ROOT, f)) };
}

function getGitHash(repoPath) {
  return runSilent(`git -C "${repoPath}" rev-parse --short HEAD`).trim();
}

function generateSessionId() {
  const now = new Date();
  return `session_${now.toISOString().replace(/[:.]/g, "-").slice(0, 19)}`;
}

// ─── Commands ─────────────────────────────────────────────────────────────────

function cmdStart(sessionId) {
  const sid = sessionId || generateSessionId();
  console.log(`\n🚀 Starting session: ${sid}\n`);

  // 1. Clone or pull manus-persistent-drive
  if (fs.existsSync(DRIVE_PATH)) {
    console.log("📥 Pulling latest from manus-persistent-drive...");
    run(`git -C "${DRIVE_PATH}" pull --rebase origin main`, { ignoreError: true });
  } else {
    console.log("📥 Cloning manus-persistent-drive...");
    run(`gh repo clone ${DRIVE_REPO} "${DRIVE_PATH}"`);
  }

  // 2. Load existing session state
  const state = loadJson(SESSION_FILE, { sessions: [] });
  const todo = countTodo();
  const stubs = countStubs();
  const projectHash = getGitHash(PROJECT_ROOT);

  // 3. Register new session
  const session = {
    id: sid,
    startedAt: new Date().toISOString(),
    endedAt: null,
    projectCommit: projectHash,
    todoAtStart: todo,
    stubsAtStart: stubs.count,
    phasesCompleted: [],
    summary: null,
  };
  state.sessions = state.sessions || [];
  state.sessions.push(session);
  state.currentSession = sid;
  saveJson(SESSION_FILE, state);

  // 4. Print context summary
  const phaseLog = fs.existsSync(PHASE_LOG)
    ? fs.readFileSync(PHASE_LOG, "utf8").split("\n").slice(0, 30).join("\n")
    : "(no phase log yet)";

  console.log("─".repeat(60));
  console.log(`📋 TODO: ${todo.done}/${todo.total} complete (${todo.pending} pending)`);
  console.log(`🔧 Stubs: ${stubs.count} stub files remaining`);
  if (stubs.count > 0) console.log(`   ${stubs.files.slice(0, 5).join(", ")}${stubs.count > 5 ? "..." : ""}`);
  console.log(`📌 Project commit: ${projectHash}`);
  console.log("─".repeat(60));
  console.log("\n📖 Recent phase log:\n");
  console.log(phaseLog);
  console.log("─".repeat(60));
  console.log(`\n✅ Session ${sid} registered. Begin work.\n`);
}

function cmdEnd(message) {
  if (!message) {
    console.error("❌ Usage: manus-session.mjs end \"<commit message>\"");
    process.exit(1);
  }

  console.log("\n📤 Ending session and syncing state...\n");

  // 1. Pull latest drive state
  if (fs.existsSync(DRIVE_PATH)) {
    run(`git -C "${DRIVE_PATH}" pull --rebase origin main`, { ignoreError: true });
  }

  // 2. Update session state
  const state = loadJson(SESSION_FILE, { sessions: [] });
  const currentId = state.currentSession;
  const session = state.sessions?.find((s) => s.id === currentId);
  if (session) {
    session.endedAt = new Date().toISOString();
    session.summary = message;
    session.todoAtEnd = countTodo();
    session.stubsAtEnd = countStubs().count;
    session.projectCommit = getGitHash(PROJECT_ROOT);
  }
  state.currentSession = null;
  saveJson(SESSION_FILE, state);

  // 3. Copy updated project files to drive snapshot
  const snapshotDir = path.join(DRIVE_PATH, "data/protein-truth-desk");
  const dirs = ["schema", "services", "pages", "tests", "todo"];
  for (const d of dirs) fs.mkdirSync(path.join(snapshotDir, d), { recursive: true });

  // Schema
  const schemaFile = path.join(PROJECT_ROOT, "drizzle/schema.ts");
  if (fs.existsSync(schemaFile)) {
    fs.copyFileSync(schemaFile, path.join(snapshotDir, "schema/schema.ts"));
  }

  // Todo
  if (fs.existsSync(TODO_FILE)) {
    fs.copyFileSync(TODO_FILE, path.join(snapshotDir, "todo/todo.md"));
  }

  // Server service files (non-stub, non-core)
  const serverDir = path.join(PROJECT_ROOT, "server");
  const serviceFiles = fs.readdirSync(serverDir)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && !f.startsWith("_"));
  for (const f of serviceFiles) {
    const src = path.join(serverDir, f);
    const content = fs.readFileSync(src, "utf8");
    if (!content.startsWith("// Stub:")) {
      fs.copyFileSync(src, path.join(snapshotDir, "services", f));
    }
  }

  // Test files
  const testFiles = fs.readdirSync(serverDir).filter((f) => f.endsWith(".test.ts"));
  for (const f of testFiles) {
    fs.copyFileSync(path.join(serverDir, f), path.join(snapshotDir, "tests", f));
  }

  // 4. Commit and push drive
  run(`git -C "${DRIVE_PATH}" add -A`);
  const driveStatus = runSilent(`git -C "${DRIVE_PATH}" status --porcelain`);
  if (driveStatus.trim()) {
    run(`git -C "${DRIVE_PATH}" commit -m "sync(session): ${message}"`);
    run(`git -C "${DRIVE_PATH}" push origin main`);
    console.log("✅ manus-persistent-drive updated and pushed.");
  } else {
    console.log("ℹ️  No changes to push to manus-persistent-drive.");
  }

  // 5. Commit and push project repo
  run(`git -C "${PROJECT_ROOT}" add -A`);
  const projectStatus = runSilent(`git -C "${PROJECT_ROOT}" status --porcelain`);
  if (projectStatus.trim()) {
    run(`git -C "${PROJECT_ROOT}" commit -m "${message}"`);
    run(`git -C "${PROJECT_ROOT}" push origin main`);
    console.log("✅ protein-truth-desk pushed to GitHub.");
  } else {
    console.log("ℹ️  No changes to push to protein-truth-desk.");
  }

  const todo = countTodo();
  const stubs = countStubs();
  console.log(`\n📋 Final TODO: ${todo.done}/${todo.total} complete`);
  console.log(`🔧 Stubs remaining: ${stubs.count}`);
  console.log("\n✅ Session ended cleanly.\n");
}

function cmdStatus() {
  const state = loadJson(SESSION_FILE, { sessions: [] });
  const todo = countTodo();
  const stubs = countStubs();
  const projectHash = getGitHash(PROJECT_ROOT);

  console.log("\n📊 Session Status\n" + "─".repeat(60));
  console.log(`Current session: ${state.currentSession ?? "(none)"}`);
  console.log(`Project commit:  ${projectHash}`);
  console.log(`TODO:            ${todo.done}/${todo.total} complete (${todo.pending} pending)`);
  console.log(`Stubs:           ${stubs.count} remaining`);
  if (stubs.count > 0) {
    console.log(`  Files: ${stubs.files.join(", ")}`);
  }

  const sessions = (state.sessions ?? []).slice(-5);
  if (sessions.length > 0) {
    console.log("\n📜 Last 5 sessions:");
    for (const s of sessions.reverse()) {
      const status = s.endedAt ? "✅" : "🔄";
      const duration = s.endedAt
        ? `${Math.round((new Date(s.endedAt) - new Date(s.startedAt)) / 60000)}m`
        : "ongoing";
      console.log(`  ${status} ${s.id} (${duration}): ${s.summary ?? "in progress"}`);
    }
  }
  console.log("─".repeat(60) + "\n");
}

function cmdLogPhase(phaseNum, title, status) {
  if (!phaseNum || !title) {
    console.error("❌ Usage: manus-session.mjs log-phase <number> <title> [done|in-progress|blocked]");
    process.exit(1);
  }

  fs.mkdirSync(path.dirname(PHASE_LOG), { recursive: true });
  const line = `| ${String(phaseNum).padEnd(5)} | ${new Date().toISOString().slice(0, 10)} | ${(status ?? "done").padEnd(11)} | ${title} |\n`;

  if (!fs.existsSync(PHASE_LOG)) {
    fs.writeFileSync(PHASE_LOG, "# Phase Log\n\n| Phase | Date       | Status      | Title |\n|-------|------------|-------------|-------|\n");
  }
  fs.appendFileSync(PHASE_LOG, line);

  // Also update session state
  const state = loadJson(SESSION_FILE, { sessions: [] });
  const session = state.sessions?.find((s) => s.id === state.currentSession);
  if (session) {
    session.phasesCompleted = session.phasesCompleted ?? [];
    session.phasesCompleted.push({ phase: Number(phaseNum), title, status: status ?? "done" });
    saveJson(SESSION_FILE, state);
  }

  console.log(`✅ Phase ${phaseNum} logged: ${title}`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const [,, cmd, ...args] = process.argv;

switch (cmd) {
  case "start":
    cmdStart(args[0]);
    break;
  case "end":
    cmdEnd(args.join(" "));
    break;
  case "status":
    cmdStatus();
    break;
  case "log-phase":
    cmdLogPhase(args[0], args.slice(1, -1).join(" ") || args[1], args[args.length - 1]);
    break;
  default:
    console.log(`
Manus Session CLI — Protein Truth Desk

Commands:
  start [session-id]              Bootstrap from persistent drive, register session
  end "<commit message>"          Sync state, push to both repos, end session
  status                          Show current session state and metrics
  log-phase <n> <title> [status]  Record a phase completion in the phase log

Examples:
  node scripts/manus-session.mjs start
  node scripts/manus-session.mjs log-phase 66 "Quality tooling sprint" done
  node scripts/manus-session.mjs end "chore(quality): add ESLint, Husky, coverage thresholds"
`);
}
