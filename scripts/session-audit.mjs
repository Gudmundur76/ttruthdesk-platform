#!/usr/bin/env node
/**
 * session-audit.mjs
 *
 * LLM-powered semantic completeness evaluator.
 * Reads todo.md + git diff and asks the LLM:
 *   "Does the code match the todo items marked complete?"
 *
 * Exit 0 = session is complete
 * Exit 1 = session has incomplete work (prints what is missing)
 *
 * Usage:
 *   pnpm session:audit           — standard check
 *   pnpm session:audit --strict  — also fails on any [x] item with no matching code change
 *   pnpm session:audit --json    — outputs JSON result for CI
 */

import { execSync } from "child_process";
import { readFileSync, existsSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const STRICT = process.argv.includes("--strict");
const JSON_OUTPUT = process.argv.includes("--json");
const FORGE_URL = process.env.BUILT_IN_FORGE_API_URL;
const FORGE_KEY = process.env.BUILT_IN_FORGE_API_KEY;

// ─── Helpers ────────────────────────────────────────────────────────────────

function run(cmd, opts = {}) {
  try {
    return execSync(cmd, { cwd: ROOT, encoding: "utf8", ...opts }).trim();
  } catch {
    return "";
  }
}

function readFile(path) {
  const full = join(ROOT, path);
  return existsSync(full) ? readFileSync(full, "utf8") : null;
}

function log(msg) {
  if (!JSON_OUTPUT) console.log(msg);
}

function err(msg) {
  if (!JSON_OUTPUT) console.error(msg);
}

// ─── Gather context ──────────────────────────────────────────────────────────

log("\n🔍 Session Audit — Semantic Completeness Check\n");

// 1. Read todo.md
const todoRaw = readFile("todo.md");
if (!todoRaw) {
  err("❌ todo.md not found. Cannot audit.");
  process.exit(1);
}

// Extract the last 3 phases (most recent work)
const phases = todoRaw.split(/^## Phase /m).filter(Boolean);
const recentPhases = phases.slice(-3).map((p) => "## Phase " + p);
const recentTodo = recentPhases.join("\n");

// 2. Get git diff (staged + unstaged vs last commit)
const gitDiff = run("git diff HEAD --stat --no-color") || "No changes since last commit";
const gitDiffDetail = run("git diff HEAD --no-color -- '*.ts' '*.tsx' '*.mjs'").slice(0, 8000) || "";

// 3. Get recent commit messages
const recentCommits = run("git log --oneline -10") || "No commits";

// 4. Check for HANDOFF.md (indicates previous incomplete session)
const handoff = readFile("HANDOFF.md");

// 5. Get stub count
let stubCount = 0;
try {
  const stubOutput = run("node scripts/stub-tracker.mjs --json 2>/dev/null || echo '{}'");
  const stubData = JSON.parse(stubOutput || "{}");
  stubCount = stubData.total || 0;
} catch {
  stubCount = -1; // unknown
}

// 6. Get test status
const testStatus = run("pnpm test --run --reporter=verbose 2>&1 | tail -5") || "unknown";

// 7. Get TypeScript status
const tsStatus = run("npx tsc --noEmit 2>&1 | tail -3") || "clean";

// ─── Build LLM prompt ────────────────────────────────────────────────────────

const systemPrompt = `You are a senior engineering auditor. Your job is to determine whether a coding session is TRULY COMPLETE or has INCOMPLETE work.

You will be given:
1. The most recent todo.md phases (what was planned and marked done)
2. The git diff (what code actually changed)
3. Recent commit messages
4. Test status and TypeScript status

Your job is to find gaps between what is marked [x] in todo.md and what is actually implemented in code.

Be strict. A task is NOT complete if:
- It is marked [x] in todo.md but no corresponding code change exists in the diff
- It is marked [x] but the implementation is a stub (TODO, FIXME, placeholder, throw new Error)
- Tests are failing or TypeScript has errors
- A new feature was added but no tests were written for it

Output a JSON object with this exact shape:
{
  "verdict": "COMPLETE" | "INCOMPLETE",
  "confidence": 0-100,
  "completedCorrectly": ["list of todo items that are genuinely done"],
  "suspiciousItems": ["list of todo items marked done but questionable"],
  "missingWork": ["list of specific things that appear incomplete"],
  "stubsFound": ["list of any stubs or placeholders found"],
  "recommendation": "one sentence summary of what to do next"
}`;

const userMessage = `## Recent Todo.md Phases (last 3)

${recentTodo}

## Git Diff Summary (what code changed)

${gitDiff}

## Git Diff Detail (TypeScript/TSX changes, first 8000 chars)

${gitDiffDetail || "(no TypeScript changes detected)"}

## Recent Commits

${recentCommits}

## Test Status

${testStatus}

## TypeScript Status

${tsStatus}

## Stub Count

${stubCount === -1 ? "unknown" : `${stubCount} stubs found in codebase`}

${handoff ? `## Previous HANDOFF.md Found\n\n${handoff.slice(0, 2000)}` : ""}

Please audit this session and return the JSON verdict.`;

// ─── Call LLM ────────────────────────────────────────────────────────────────

if (!FORGE_URL || !FORGE_KEY) {
  err("⚠️  BUILT_IN_FORGE_API_URL or BUILT_IN_FORGE_API_KEY not set.");
  err("   Running in OFFLINE mode — mechanical checks only.\n");

  // Fallback: mechanical check only
  const uncheckedItems = (todoRaw.match(/^- \[ \]/gm) || []).length;
  const result = {
    verdict: uncheckedItems > 0 ? "INCOMPLETE" : "COMPLETE",
    confidence: 70,
    completedCorrectly: [],
    suspiciousItems: [],
    missingWork: uncheckedItems > 0 ? [`${uncheckedItems} unchecked todo items remain`] : [],
    stubsFound: [],
    recommendation:
      uncheckedItems > 0
        ? `Complete the ${uncheckedItems} unchecked todo items before ending the session.`
        : "All todo items are checked. Run pnpm task:done for full mechanical verification.",
  };

  if (JSON_OUTPUT) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    printResult(result);
  }
  process.exit(result.verdict === "COMPLETE" ? 0 : 1);
}

log("📡 Calling LLM evaluator...\n");

let llmResult;
try {
  const response = await fetch(`${FORGE_URL}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${FORGE_KEY}`,
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-5",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
      response_format: { type: "json_object" },
      max_tokens: 2000,
    }),
  });

  if (!response.ok) {
    throw new Error(`LLM API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  llmResult = JSON.parse(content);
} catch (e) {
  err(`⚠️  LLM call failed: ${e.message}`);
  err("   Falling back to mechanical check.\n");

  const uncheckedItems = (todoRaw.match(/^- \[ \]/gm) || []).length;
  llmResult = {
    verdict: uncheckedItems > 0 ? "INCOMPLETE" : "COMPLETE",
    confidence: 60,
    completedCorrectly: [],
    suspiciousItems: [],
    missingWork: uncheckedItems > 0 ? [`${uncheckedItems} unchecked todo items remain`] : [],
    stubsFound: [],
    recommendation:
      uncheckedItems > 0
        ? `Complete the ${uncheckedItems} unchecked todo items.`
        : "All todo items checked. LLM audit unavailable — run pnpm task:done.",
  };
}

// ─── Output result ────────────────────────────────────────────────────────────

if (JSON_OUTPUT) {
  console.log(JSON.stringify(llmResult, null, 2));
} else {
  printResult(llmResult);
}

// Save audit result to .session-audit.json for CI and HANDOFF generation
writeFileSync(join(ROOT, ".session-audit.json"), JSON.stringify(llmResult, null, 2));

// Exit code
const isComplete = llmResult.verdict === "COMPLETE" && (!STRICT || llmResult.suspiciousItems?.length === 0);
process.exit(isComplete ? 0 : 1);

// ─── Pretty printer ───────────────────────────────────────────────────────────

function printResult(result) {
  const icon = result.verdict === "COMPLETE" ? "✅" : "❌";
  const conf = result.confidence ? ` (${result.confidence}% confidence)` : "";

  console.log(`${icon} Session Audit: ${result.verdict}${conf}\n`);

  if (result.completedCorrectly?.length > 0) {
    console.log("✓ Completed correctly:");
    result.completedCorrectly.forEach((item) => console.log(`  • ${item}`));
    console.log();
  }

  if (result.suspiciousItems?.length > 0) {
    console.log("⚠️  Suspicious (marked done but questionable):");
    result.suspiciousItems.forEach((item) => console.log(`  • ${item}`));
    console.log();
  }

  if (result.missingWork?.length > 0) {
    console.log("🔴 Missing work:");
    result.missingWork.forEach((item) => console.log(`  • ${item}`));
    console.log();
  }

  if (result.stubsFound?.length > 0) {
    console.log("🔧 Stubs found:");
    result.stubsFound.forEach((item) => console.log(`  • ${item}`));
    console.log();
  }

  if (result.recommendation) {
    console.log(`💡 Recommendation: ${result.recommendation}\n`);
  }

  if (result.verdict === "INCOMPLETE") {
    console.log("Run `pnpm handoff` to generate a HANDOFF.md before ending this session.\n");
  }
}
