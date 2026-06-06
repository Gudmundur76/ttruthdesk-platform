/**
 * stubLedger.ts — Layer 2: Stub Lifecycle Management
 *
 * Scans the codebase for stub markers and tracks them as debt instruments.
 * Every stub is a promise with an expiry date. Overdue stubs are escalated.
 *
 * Stub markers recognised:
 *   // STUB: <id> [P0|P1|P2] <description>
 *   // TODO(stub): <description>
 *   // @stub <id> <description>
 *   return { stub: true, ... }
 *   throw new Error("stub") or "not implemented"
 *
 * Priority defaults:
 *   P0 — 3 days deadline
 *   P1 — 14 days deadline
 *   P2 — 30 days deadline
 */

import { readFileSync, readdirSync, statSync } from "fs";
import { join, relative } from "path";

export type StubPriority = "P0" | "P1" | "P2";
export type StubStatus = "open" | "overdue" | "resolved" | "wontfix";

export interface StubEntry {
  id: string;
  file: string;
  line: number;
  priority: StubPriority;
  description: string;
  estimatedLines: number;
  createdAt: Date;
  deadlineAt: Date;
  status: StubStatus;
  blockingPhases: number[];
  daysOverdue: number;
}

export interface StubLedgerReport {
  total: number;
  open: number;
  overdue: number;
  byPriority: Record<StubPriority, number>;
  stubs: StubEntry[];
  checkedAt: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const PROJECT_ROOT = join(__dirname, "..", "..");
const DEADLINE_DAYS: Record<StubPriority, number> = { P0: 3, P1: 14, P2: 30 };

// Directories to scan (relative to project root)
const SCAN_DIRS = ["server", "client/src", "shared"];
// Files/dirs to skip
const SKIP_PATTERNS = [
  /node_modules/,
  /\.test\.ts$/,
  /\.d\.ts$/,
  /drizzle\/migrations/,
  /pnpm-lock/,
];

// ─── Stub Pattern Matchers ────────────────────────────────────────────────────

interface RawStub {
  file: string;
  line: number;
  priority: StubPriority;
  id: string;
  description: string;
}

const STUB_PATTERNS: Array<{
  regex: RegExp;
  extract: (match: RegExpMatchArray, file: string, lineNo: number) => RawStub | null;
}> = [
  {
    // // STUB: salmon:pubchemLookup [P1] PubChem compound lookup not yet implemented
    regex: /\/\/\s*STUB:\s*([^\s\[]+)\s*(?:\[(P[012])\])?\s*(.*)/i,
    extract: (m, file, line) => ({
      file,
      line,
      id: m[1].trim(),
      priority: (m[2] as StubPriority) ?? "P1",
      description: m[3].trim() || "No description",
    }),
  },
  {
    // // TODO(stub): description
    regex: /\/\/\s*TODO\(stub\):\s*(.*)/i,
    extract: (m, file, line) => ({
      file,
      line,
      id: `${relative(PROJECT_ROOT, file)}:${line}`,
      priority: "P2",
      description: m[1].trim(),
    }),
  },
  {
    // // @stub id description
    regex: /\/\/\s*@stub\s+([^\s]+)\s+(.*)/i,
    extract: (m, file, line) => ({
      file,
      line,
      id: m[1].trim(),
      priority: "P1",
      description: m[2].trim(),
    }),
  },
  {
    // throw new Error("stub") or throw new Error("not implemented")
    regex: /throw\s+new\s+Error\s*\(\s*["'`](stub|not implemented|TODO|STUB)[^"'`]*["'`]\s*\)/i,
    extract: (m, file, line) => ({
      file,
      line,
      id: `${relative(PROJECT_ROOT, file)}:${line}`,
      priority: "P1",
      description: `Unimplemented: ${m[0].slice(0, 80)}`,
    }),
  },
  {
    // return { stub: true
    regex: /return\s+\{[^}]*stub:\s*true/i,
    extract: (m, file, line) => ({
      file,
      line,
      id: `${relative(PROJECT_ROOT, file)}:${line}`,
      priority: "P2",
      description: `Stub return value at line ${line}`,
    }),
  },
];

// ─── File Scanner ─────────────────────────────────────────────────────────────

function collectSourceFiles(dir: string): string[] {
  const files: string[] = [];
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(dir, entry.name);
      const rel = relative(PROJECT_ROOT, full);
      if (SKIP_PATTERNS.some((p) => p.test(rel))) continue;
      if (entry.isDirectory()) {
        files.push(...collectSourceFiles(full));
      } else if (
        entry.isFile() &&
        (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx"))
      ) {
        files.push(full);
      }
    }
  } catch { /* skip unreadable dirs */ }
  return files;
}

function getFileCreatedAt(filePath: string): Date {
  try {
    const stat = statSync(filePath);
    return stat.birthtime || stat.mtime;
  } catch {
    return new Date();
  }
}

// ─── Main Scanner ─────────────────────────────────────────────────────────────

export function scanStubs(): RawStub[] {
  const allFiles: string[] = [];
  for (const dir of SCAN_DIRS) {
    allFiles.push(...collectSourceFiles(join(PROJECT_ROOT, dir)));
  }

  const rawStubs: RawStub[] = [];
  const seenIds = new Set<string>();

  for (const file of allFiles) {
    let content: string;
    try {
      content = readFileSync(file, "utf-8");
    } catch {
      continue;
    }
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      for (const pattern of STUB_PATTERNS) {
        const match = line.match(pattern.regex);
        if (match) {
          const stub = pattern.extract(match, file, i + 1);
          if (stub && !seenIds.has(stub.id)) {
            seenIds.add(stub.id);
            rawStubs.push(stub);
          }
        }
      }
    }
  }

  return rawStubs;
}

// ─── Ledger Builder ───────────────────────────────────────────────────────────

/**
 * Converts raw stub scan results into full StubEntry records with deadlines,
 * status, and overdue calculations.
 */
export function buildStubLedger(): StubLedgerReport {
  const rawStubs = scanStubs();
  const now = new Date();

  const entries: StubEntry[] = rawStubs.map((raw) => {
    const createdAt = getFileCreatedAt(raw.file);
    const deadlineDays = DEADLINE_DAYS[raw.priority];
    const deadlineAt = new Date(createdAt.getTime() + deadlineDays * 24 * 60 * 60 * 1000);
    const daysOverdue = Math.max(0, Math.floor((now.getTime() - deadlineAt.getTime()) / (24 * 60 * 60 * 1000)));
    const status: StubStatus = daysOverdue > 0 ? "overdue" : "open";

    return {
      id: raw.id,
      file: relative(PROJECT_ROOT, raw.file),
      line: raw.line,
      priority: raw.priority,
      description: raw.description,
      estimatedLines: 20, // conservative default; refined by LLM in future
      createdAt,
      deadlineAt,
      status,
      blockingPhases: [], // populated by orchestrator when known
      daysOverdue,
    };
  });

  // Sort: overdue P0 first, then by daysOverdue desc
  entries.sort((a, b) => {
    const priorityOrder = { P0: 0, P1: 1, P2: 2 };
    if (a.status === "overdue" && b.status !== "overdue") return -1;
    if (b.status === "overdue" && a.status !== "overdue") return 1;
    if (priorityOrder[a.priority] !== priorityOrder[b.priority]) {
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    }
    return b.daysOverdue - a.daysOverdue;
  });

  const byPriority: Record<StubPriority, number> = { P0: 0, P1: 0, P2: 0 };
  for (const e of entries) byPriority[e.priority]++;

  return {
    total: entries.length,
    open: entries.filter((e) => e.status === "open").length,
    overdue: entries.filter((e) => e.status === "overdue").length,
    byPriority,
    stubs: entries,
    checkedAt: now.toISOString(),
  };
}

// ─── Overdue Escalation ───────────────────────────────────────────────────────

export interface StubEscalation {
  stub: StubEntry;
  escalationReason: string;
  suggestedAction: string;
}

/**
 * Returns stubs that should be escalated:
 *   - P0 stubs that are overdue at all
 *   - P1 stubs overdue by more than 7 days
 *   - P2 stubs overdue by more than 21 days
 */
export function getOverdueEscalations(ledger: StubLedgerReport): StubEscalation[] {
  return ledger.stubs
    .filter((s) => {
      if (s.priority === "P0" && s.daysOverdue > 0) return true;
      if (s.priority === "P1" && s.daysOverdue > 7) return true;
      if (s.priority === "P2" && s.daysOverdue > 21) return true;
      return false;
    })
    .map((stub) => ({
      stub,
      escalationReason: `${stub.priority} stub "${stub.id}" is ${stub.daysOverdue} day(s) overdue.`,
      suggestedAction: `Implement or mark as wontfix: ${stub.file}:${stub.line} — ${stub.description}`,
    }));
}
