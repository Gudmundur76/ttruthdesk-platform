#!/usr/bin/env node
/**
 * context-snapshot.mjs
 *
 * Writes CONTEXT_SNAPSHOT.md — a dense, structured snapshot of the entire
 * project state. Designed to be the FIRST file read at the start of any new
 * session so the agent has full context without needing to re-read every file.
 *
 * This is the direct answer to the context window problem:
 * Instead of the agent losing context mid-session, this script captures
 * everything that matters into a single file that fits in one read.
 *
 * Usage:
 *   pnpm context:snapshot     — generate CONTEXT_SNAPSHOT.md
 *   pnpm context:snapshot --watch  — regenerate every 10 minutes
 */

import { execSync } from "child_process";
import { readFileSync, existsSync, writeFileSync, readdirSync, statSync } from "fs";
import { join, dirname, relative } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

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

function truncate(str, maxLen = 2000) {
  if (!str) return "_empty_";
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen) + `\n... (truncated, ${str.length - maxLen} more chars)`;
}

function countLines(str) {
  return str ? str.split("\n").length : 0;
}

// ─── Gather project state ─────────────────────────────────────────────────────

const now = new Date().toISOString();
const branch = run("git branch --show-current") || "unknown";
const lastCommit = run("git log --oneline -1") || "no commits";
const recentCommits = run("git log --oneline -10") || "none";
const uncommittedFiles = run("git status --short") || "none";

// Todo summary
const todoRaw = readFile("todo.md") || "";
const todoLines = todoRaw.split("\n");
const checkedCount = (todoRaw.match(/^- \[x\]/gm) || []).length;
const uncheckedCount = (todoRaw.match(/^- \[ \]/gm) || []).length;
const uncheckedItems = todoLines
  .filter((l) => l.trim().startsWith("- [ ]"))
  .map((l) => l.trim())
  .join("\n") || "_none_";

// Current phase
let currentPhase = "Unknown";
for (let i = 0; i < todoLines.length; i++) {
  if (todoLines[i].startsWith("## ")) currentPhase = todoLines[i].replace(/^#+\s*/, "");
  if (todoLines[i].trim().startsWith("- [ ]")) break;
}

// Schema summary
const schemaSrc = readFile("drizzle/schema.ts") || "";
const tableNames = [...schemaSrc.matchAll(/^export const (\w+) = \w+Table/gm)].map((m) => m[1]);

// Server router summary
const routerSrc = readFile("server/routers.ts") || "";
const procedures = [...routerSrc.matchAll(/(\w+):\s*(publicProcedure|protectedProcedure)/g)].map((m) => m[1]);

// Key server files
const serverFiles = readdirSync(join(ROOT, "server"))
  .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && !f.startsWith("_"))
  .sort();

// Key client pages
const pagesDir = join(ROOT, "client/src/pages");
const pageFiles = existsSync(pagesDir)
  ? readdirSync(pagesDir).filter((f) => f.endsWith(".tsx"))
  : [];

// Heartbeat jobs
const heartbeatOutput = run("manus-heartbeat list 2>/dev/null | grep '\"name\"' | head -20") || "unknown";

// Test status
const testSummary = run("pnpm test --run 2>&1 | tail -3") || "unknown";

// TypeScript status
const tsStatus = run("npx tsc --noEmit 2>&1 | tail -3") || "clean";

// Lint status
const lintStatus = run("pnpm lint 2>&1 | tail -3") || "unknown";

// Coverage thresholds from vitest.config.ts
const vitestConfig = readFile("vitest.config.ts") || "";
const thresholdMatch = vitestConfig.match(/thresholds:\s*\{([^}]+)\}/s);
const thresholds = thresholdMatch ? thresholdMatch[1].trim() : "not configured";

// Stub count
const stubSummary = run("node scripts/stub-tracker.mjs 2>/dev/null | grep -E 'Total|OVERDUE|P0|P1' | head -5") || "unknown";

// Drift summary
const driftSummary = run("node scripts/drift-detector.mjs 2>/dev/null | tail -10") || "unknown";

// HANDOFF.md
const handoff = readFile("HANDOFF.md");

// Session audit result
const auditResult = existsSync(join(ROOT, ".session-audit.json"))
  ? JSON.parse(readFileSync(join(ROOT, ".session-audit.json"), "utf8"))
  : null;

// Key env vars available
const envSrc = readFile("server/_core/env.ts") || "";
const envVars = [...envSrc.matchAll(/(\w+):\s*z\./g)].map((m) => m[1]);

// ─── Write CONTEXT_SNAPSHOT.md ────────────────────────────────────────────────

const snapshot = `# CONTEXT_SNAPSHOT.md — Full Project State

> **Generated:** ${now}
> **Branch:** ${branch}
> **Last commit:** ${lastCommit}
> **READ THIS FIRST** at the start of every session.

---

## 🎯 What This Project Is

**Protein Truth Desk** — a scientific claim verification platform that:
- Ingests research papers (PubMed, PMC, bioRxiv, manual upload)
- Extracts protein/structural biology claims using LLM
- Verifies claims against PDB (Protein Data Bank) and other evidence sources
- Produces audit reports with verdicts (Supported / Contradicted / Insufficient Evidence / etc.)
- Exposes a public claims registry and knowledge graph
- Runs an autonomous loop (5 layers: Friction → Self-Prompt → Frontier → Truth → Meta)

**Stack:** React 19 + Tailwind 4 + Express 4 + tRPC 11 + Drizzle ORM + MySQL/TiDB

---

## 📋 Current Work Status

**Current phase:** ${currentPhase}
**Todo progress:** ${checkedCount} done / ${uncheckedCount} remaining

**Uncompleted items:**
${uncheckedItems}

${
  auditResult
    ? `**Last session audit:** ${auditResult.verdict} (${auditResult.confidence}% confidence)
**Recommendation:** ${auditResult.recommendation}`
    : "_No session audit result found. Run `pnpm session:audit` to check._"
}

${handoff ? `⚠️ **HANDOFF.md exists** — previous session was incomplete. Read HANDOFF.md first.\n` : ""}

---

## 🗄️ Database Schema

**Tables (${tableNames.length} total):**
${tableNames.map((t) => `- \`${t}\``).join("\n")}

Schema file: \`drizzle/schema.ts\`
Migrations: \`drizzle/migrations/\`
DB helpers: \`server/db.ts\`

---

## 🔌 tRPC Procedures (${procedures.length} total)

${procedures.slice(0, 40).map((p) => `\`${p}\``).join(", ")}${procedures.length > 40 ? ` ... and ${procedures.length - 40} more` : ""}

Router file: \`server/routers.ts\`

---

## 📁 Key Server Files

${serverFiles.map((f) => `- \`server/${f}\``).join("\n")}

---

## 📄 Client Pages

${pageFiles.map((f) => `- \`client/src/pages/${f}\``).join("\n")}

Routes registered in: \`client/src/App.tsx\`

---

## ⏱️ Heartbeat Jobs (Scheduled)

\`\`\`
${heartbeatOutput}
\`\`\`

Scheduled endpoints in: \`server/_core/index.ts\` (search for \`/api/scheduled/\`)

---

## 🤖 Autonomous Loop Architecture

The platform has a 5-layer autonomous loop (\`server/autonomousLoop/\`):

| Layer | File | Purpose |
|-------|------|---------|
| L1 — Friction | \`frictionLayer.ts\` | Handles document_submitted, manual_review_complete |
| L2 — Self-Prompt | \`selfPromptLayer.ts\` | LLM decides next action (drain_queue, reverify_stale, recalibrate_confidence, etc.) |
| L3 — Frontier | \`frontierLayer.ts\` | Gap detection, hypothesis generation, evidence pursuit |
| L3 — Truth | \`truthLayer.ts\` | PDB re-verification, source_data_changed, paper_discovered |
| L4 — Meta | \`metaLayer.ts\` | Code guardian, pipeline guardian (7 invariants), alert routing |

Event bus: \`server/autonomousLoop/eventBus.ts\`
Orchestrator: \`server/autonomousLoop/loopOrchestrator.ts\`

---

## 🔧 Available Environment Variables

${envVars.map((v) => `\`${v}\``).join(", ")}

Env config: \`server/_core/env.ts\`

---

## ✅ Quality Gates

**TypeScript:**
\`\`\`
${tsStatus}
\`\`\`

**Tests:**
\`\`\`
${testSummary}
\`\`\`

**Lint:**
\`\`\`
${lintStatus}
\`\`\`

**Coverage thresholds:**
\`\`\`
${thresholds}
\`\`\`

**Stubs:**
\`\`\`
${stubSummary}
\`\`\`

---

## 📝 Recent Git History

\`\`\`
${recentCommits}
\`\`\`

**Uncommitted changes:**
\`\`\`
${uncommittedFiles}
\`\`\`

---

## 🚀 Key Commands

\`\`\`bash
pnpm check          # TypeScript type check
pnpm lint           # ESLint (must be 0 errors)
pnpm test           # Run all tests
pnpm test:coverage  # Run tests with coverage
pnpm task:done      # Full mechanical quality gate (run before ending session)
pnpm session:audit  # LLM semantic completeness check
pnpm handoff        # Generate HANDOFF.md if session is incomplete
pnpm handoff --clear # Delete HANDOFF.md when session is complete
pnpm context:snapshot # Regenerate this file
pnpm drift          # Run drift detector
pnpm stubs          # Run stub tracker
\`\`\`

---

## 📐 Architecture Decisions

- **tRPC-first**: all backend calls go through tRPC procedures, no raw fetch/axios
- **Drizzle ORM**: schema-first, migrations via \`pnpm drizzle-kit generate\` + \`webdev_execute_sql\`
- **S3 storage**: all files via \`storagePut\`/\`storageGet\` helpers, never local disk
- **UTC timestamps**: all DB timestamps as Unix ms, convert to local time in UI
- **Server-side LLM**: all LLM calls in tRPC procedures via \`invokeLLM\`, never client-side
- **Autonomous loop**: events published to \`eventBus.publish()\`, processed by \`loopOrchestrator.processEvent()\`

---

_This file is auto-generated by \`pnpm context:snapshot\`. Regenerate after major changes._
`;

writeFileSync(join(ROOT, "CONTEXT_SNAPSHOT.md"), snapshot);

console.log(`✅ CONTEXT_SNAPSHOT.md generated (${countLines(snapshot)} lines)`);
console.log(`   Todo: ${checkedCount} done, ${uncheckedCount} remaining`);
console.log(`   Tables: ${tableNames.length}, Procedures: ${procedures.length}`);
console.log(`   Branch: ${branch}`);
console.log(`\n   Read CONTEXT_SNAPSHOT.md at the start of every new session.\n`);
