#!/usr/bin/env node
/**
 * generate-handoff.mjs
 *
 * Auto-generates HANDOFF.md — a structured snapshot of incomplete session state.
 * Written when a session ends with unfinished work so the next session can
 * resume exactly where this one stopped.
 *
 * Usage:
 *   pnpm handoff              — generate HANDOFF.md from current state
 *   pnpm handoff --force      — overwrite existing HANDOFF.md
 *   pnpm handoff --clear      — delete HANDOFF.md (session fully complete)
 */

import { execSync } from "child_process";
import { readFileSync, existsSync, writeFileSync, unlinkSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const FORCE = process.argv.includes("--force");
const CLEAR = process.argv.includes("--clear");
const HANDOFF_PATH = join(ROOT, "HANDOFF.md");

function run(cmd) {
  try {
    return execSync(cmd, { cwd: ROOT, encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

function readFile(path) {
  const full = join(ROOT, path);
  return existsSync(full) ? readFileSync(full, "utf8") : null;
}

// ─── Clear mode ───────────────────────────────────────────────────────────────

if (CLEAR) {
  if (existsSync(HANDOFF_PATH)) {
    unlinkSync(HANDOFF_PATH);
    console.log("✅ HANDOFF.md cleared — session marked complete.");
  } else {
    console.log("ℹ️  No HANDOFF.md found — nothing to clear.");
  }
  process.exit(0);
}

// ─── Guard: don't overwrite unless forced ─────────────────────────────────────

if (existsSync(HANDOFF_PATH) && !FORCE) {
  console.log("⚠️  HANDOFF.md already exists. Use --force to overwrite.");
  console.log("   Or run `pnpm handoff --clear` if the session is complete.");
  process.exit(0);
}

// ─── Gather state ─────────────────────────────────────────────────────────────

const now = new Date().toISOString();
const branch = run("git branch --show-current") || "unknown";
const lastCommit = run("git log --oneline -1") || "no commits";
const uncommittedFiles = run("git status --short") || "none";
const recentCommits = run("git log --oneline -5") || "none";

// Read todo.md — find unchecked items
const todoRaw = readFile("todo.md") || "";
const uncheckedItems = todoRaw
  .split("\n")
  .filter((line) => line.trim().startsWith("- [ ]"))
  .map((line) => line.trim());

// Find the current phase (last phase header before unchecked items)
const todoLines = todoRaw.split("\n");
let currentPhase = "Unknown";
for (let i = 0; i < todoLines.length; i++) {
  if (todoLines[i].startsWith("## Phase") || todoLines[i].startsWith("## ")) {
    currentPhase = todoLines[i].replace(/^#+\s*/, "");
  }
  if (todoLines[i].trim().startsWith("- [ ]")) break;
}

// Read session audit result if available
const auditResult = existsSync(join(ROOT, ".session-audit.json"))
  ? JSON.parse(readFileSync(join(ROOT, ".session-audit.json"), "utf8"))
  : null;

// Get TypeScript errors
const tsErrors = run("npx tsc --noEmit 2>&1 | grep 'error TS' | head -10") || "none";

// Get failing tests
const testOutput = run("pnpm test --run 2>&1 | tail -20") || "unknown";
const failingTests = run("pnpm test --run 2>&1 | grep 'FAIL\\|× ' | head -10") || "none";

// Get stub count
const stubOutput = run("node scripts/stub-tracker.mjs 2>/dev/null | tail -5") || "unknown";

// ─── Generate HANDOFF.md ──────────────────────────────────────────────────────

const handoffContent = `# HANDOFF.md — Incomplete Session State

> **Generated:** ${now}
> **Branch:** ${branch}
> **Last commit:** ${lastCommit}
> **Status:** ⚠️ SESSION INCOMPLETE — resume required

---

## What Was Being Worked On

**Current phase:** ${currentPhase}

${
  auditResult
    ? `**LLM Audit verdict:** ${auditResult.verdict} (${auditResult.confidence}% confidence)

**Recommendation:** ${auditResult.recommendation}`
    : ""
}

---

## Uncompleted Todo Items

${
  uncheckedItems.length > 0
    ? uncheckedItems.map((item) => item).join("\n")
    : "_No unchecked items found in todo.md — check for partial implementations._"
}

---

## Missing Work (from LLM audit)

${
  auditResult?.missingWork?.length > 0
    ? auditResult.missingWork.map((item) => `- ${item}`).join("\n")
    : "_Run `pnpm session:audit` to get LLM analysis of missing work._"
}

---

## Suspicious Items (marked done but questionable)

${
  auditResult?.suspiciousItems?.length > 0
    ? auditResult.suspiciousItems.map((item) => `- ${item}`).join("\n")
    : "_None identified._"
}

---

## Current Code State

**Uncommitted files:**
\`\`\`
${uncommittedFiles || "none"}
\`\`\`

**Recent commits:**
\`\`\`
${recentCommits}
\`\`\`

**TypeScript errors:**
\`\`\`
${tsErrors}
\`\`\`

**Failing tests:**
\`\`\`
${failingTests}
\`\`\`

**Stub tracker:**
\`\`\`
${stubOutput}
\`\`\`

---

## How to Resume This Session

1. Read this file first: \`cat HANDOFF.md\`
2. Read the current todo.md to understand what is incomplete: \`grep -n "\\[ \\]" todo.md\`
3. Read CONTEXT_SNAPSHOT.md if it exists for full project state
4. Fix TypeScript errors first: \`pnpm check\`
5. Make failing tests pass: \`pnpm test\`
6. Complete the unchecked todo items above in order
7. Run \`pnpm task:done\` to verify mechanical completeness
8. Run \`pnpm session:audit\` to verify semantic completeness
9. If both pass, run \`pnpm handoff --clear\` to delete this file
10. Commit: \`git add -A && git commit -m "chore: complete handoff items from previous session"\`

---

## Context for Next Session

This project is **Protein Truth Desk** — a scientific claim verification platform.
Key files: \`server/routers.ts\`, \`drizzle/schema.ts\`, \`server/db.ts\`, \`client/src/App.tsx\`
Test command: \`pnpm test\`
Type check: \`pnpm check\`
Full quality gate: \`pnpm task:done\`
Semantic audit: \`pnpm session:audit\`

---

_This file was auto-generated by \`pnpm handoff\`. Delete it with \`pnpm handoff --clear\` when the session is complete._
`;

writeFileSync(HANDOFF_PATH, handoffContent);

console.log("📋 HANDOFF.md generated successfully.\n");
console.log(`   Branch: ${branch}`);
console.log(`   Uncompleted items: ${uncheckedItems.length}`);
if (auditResult) {
  console.log(`   LLM verdict: ${auditResult.verdict} (${auditResult.confidence}% confidence)`);
}
console.log("\n   Share this file with the next session to resume where you left off.");
console.log("   Run `pnpm handoff --clear` when the session is complete.\n");
