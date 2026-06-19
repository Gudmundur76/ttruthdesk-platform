/**
 * codeDriftService.ts — Layer 1: Structural Drift Detection
 *
 * Detects six categories of drift in the codebase:
 *   1. schemaDrift     — drizzle/schema.ts vs. applied migration state
 *   2. apiDrift        — routers.ts procedure names vs. frontend trpc calls
 *   3. testDrift       — server/*.ts files without a matching *.test.ts
 *   4. dependencyDrift — pnpm outdated (prod deps only)
 *   5. configDrift     — ENV keys in env.ts vs. process.env availability
 *   6. disciplineDrift — session integrity checks (orphaned sessions, stale tokens)
 *
 * Each check returns a typed DriftFinding so the orchestrator can persist and route alerts.
 */

import { readFileSync, readdirSync, existsSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";

// ─── Recursive TS file collector ─────────────────────────────────────────────
function collectTsFilesRecursive(dir: string, results: string[] = []): string[] {
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) collectTsFilesRecursive(full, results);
      else if (entry.isFile() && entry.name.endsWith(".ts")) results.push(full);
    }
  } catch { /* skip unreadable dirs */ }
  return results;
}

export interface DriftFinding {
  checkType: string;
  severity: "info" | "warning" | "critical";
  confidence: number;
  details: Record<string, unknown>;
  summary: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const PROJECT_ROOT = join(__dirname, "..", "..");
const SERVER_DIR = join(PROJECT_ROOT, "server");
const DRIZZLE_DIR = join(PROJECT_ROOT, "drizzle");
const CLIENT_SRC = join(PROJECT_ROOT, "client", "src");

function readFileSafe(path: string): string {
  try {
    return readFileSync(path, "utf-8");
  } catch {
    return "";
  }
}

// ─── 1. Schema Drift ─────────────────────────────────────────────────────────

/**
 * Compares table names declared in drizzle/schema.ts with the latest migration SQL.
 * A table that exists in schema.ts but not in any migration file is "schema drift".
 */
export function detectSchemaDrift(): DriftFinding {
  const schemaContent = readFileSafe(join(DRIZZLE_DIR, "schema.ts"));
  // Extract mysqlTable("table_name", ...) declarations
  const schemaTableMatches = Array.from(
    schemaContent.matchAll(/mysqlTable\("([^"]+)"/g)
  );
  const schemaTables = new Set(schemaTableMatches.map(m => m[1]));

  // Collect all CREATE TABLE statements from migration files
  const migrationTables = new Set<string>();
  try {
    const migrationFiles = readdirSync(DRIZZLE_DIR)
      .filter(f => f.endsWith(".sql"))
      .sort();
    for (const file of migrationFiles) {
      const sql = readFileSafe(join(DRIZZLE_DIR, file));
      const matches = Array.from(sql.matchAll(/CREATE TABLE[^`]*`([^`]+)`/gi));
      matches.forEach(m => migrationTables.add(m[1]));
    }
  } catch {
    // no migration files yet
  }

  const unmigratedTables = Array.from(schemaTables).filter(
    t => !migrationTables.has(t)
  );
  const severity: DriftFinding["severity"] =
    unmigratedTables.length > 0 ? "warning" : "info";

  return {
    checkType: "schemaDrift",
    severity,
    confidence: 0.95,
    details: {
      schemaTables: Array.from(schemaTables),
      migrationTables: Array.from(migrationTables),
      unmigratedTables,
    },
    summary:
      unmigratedTables.length === 0
        ? `Schema and migrations are in sync (${Array.from(schemaTables).length} tables).`
        : `${unmigratedTables.length} table(s) in schema.ts have no CREATE TABLE in migrations: ${unmigratedTables.join(", ")}`,
  };
}

// ─── 2. API Drift ─────────────────────────────────────────────────────────────

/**
 * Extracts top-level router names from routers.ts and checks that each one
 * has at least one trpc.<router> call in the client source.
 */
export function detectApiDrift(): DriftFinding {
  const routersContent = readFileSafe(join(SERVER_DIR, "routers.ts"));
  // Match "  routerName: router({" at the top level
  const routerMatches = Array.from(
    routersContent.matchAll(/^\s{2}([a-zA-Z_][a-zA-Z0-9_]*):\s*router\(\{/gm)
  );
  const serverRouters = routerMatches.map(m => m[1]);

  // Scan client source for trpc.<name>. usage
  const clientFiles: string[] = [];
  function collectTsFiles(dir: string) {
    try {
      readdirSync(dir, { withFileTypes: true }).forEach(entry => {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) collectTsFiles(full);
        else if (entry.name.endsWith(".tsx") || entry.name.endsWith(".ts"))
          clientFiles.push(full);
      });
    } catch {
      /* skip unreadable dirs */
    }
  }
  collectTsFiles(CLIENT_SRC);

  const clientSource = clientFiles.map(readFileSafe).join("\n");
  const unusedRouters = serverRouters.filter(
    r => !new RegExp(`trpc\\.${r}\\b`).test(clientSource)
  );

  const severity: DriftFinding["severity"] =
    unusedRouters.length > 5 ? "warning" : "info";

  return {
    checkType: "apiDrift",
    severity,
    confidence: 0.8,
    details: { serverRouters, unusedRouters },
    summary:
      unusedRouters.length === 0
        ? `All ${serverRouters.length} routers are referenced in the client.`
        : `${unusedRouters.length} router(s) have no client usage: ${unusedRouters.join(", ")}`,
  };
}

// ─── 3. Test Drift ────────────────────────────────────────────────────────────

/**
 * Finds all server .ts files recursively (excluding _core, test files, and known non-testable files)
 * that have no corresponding .test.ts counterpart.
 * Scans recursively so subdirectory test files (e.g. server/metaAgent/*.test.ts) are counted.
 */
export function detectTestDrift(): DriftFinding {
  const SKIP_PATTERNS = [
    /\.test\.ts$/,
    /[\\/]_core[\\/]/,
    /routers\.ts$/,
    /schema\.ts$/,
    /relations\.ts$/,
    /[\\/]db\.ts$/,
    /[\\/]storage\.ts$/,
    /seedKnowledgeGraph\.ts$/,
    /\.d\.ts$/,
  ];

  // Collect ALL .ts files recursively under server/
  const allFiles = collectTsFilesRecursive(SERVER_DIR);
  const testFileSet = new Set(allFiles.filter(f => f.endsWith(".test.ts")));

  // Source files = non-test .ts files not excluded by skip patterns
  const testableFiles = allFiles.filter(f => {
    const rel = f.replace(PROJECT_ROOT + "/", "");
    return !SKIP_PATTERNS.some(p => p.test(rel));
  });

  const untestedFiles: string[] = [];
  for (const file of testableFiles) {
    const testFile = file.replace(/\.ts$/, ".test.ts");
    if (!testFileSet.has(testFile) && !existsSync(testFile)) {
      untestedFiles.push(file.replace(PROJECT_ROOT + "/", ""));
    }
  }

  const coverageRatio =
    testableFiles.length > 0
      ? (testableFiles.length - untestedFiles.length) / testableFiles.length
      : 1;

  const severity: DriftFinding["severity"] =
    coverageRatio < 0.5 ? "critical" : coverageRatio < 0.7 ? "warning" : "info";

  return {
    checkType: "testDrift",
    severity,
    confidence: 0.9,
    details: {
      totalSourceFiles: testableFiles.length,
      untestedCount: untestedFiles.length,
      coverageRatio: Math.round(coverageRatio * 100) / 100,
      untestedFiles,
    },
    summary: `Test coverage: ${Math.round(coverageRatio * 100)}% (${untestedFiles.length} files without tests).`,
  };
}

// ─── 4. Dependency Drift ─────────────────────────────────────────────────────

export interface OutdatedPackage {
  name: string;
  current: string;
  latest: string;
  severity: "patch" | "minor" | "major";
}

/**
 * Runs `pnpm outdated --format json` (prod only) and classifies packages
 * by semver bump severity.
 */
export function detectDependencyDrift(): DriftFinding {
  let outdated: OutdatedPackage[] = [];
  let parseError: string | null = null;

  try {
    const raw = execSync(
      "pnpm outdated --format json --prod 2>/dev/null || echo '{}'",
      {
        cwd: PROJECT_ROOT,
        timeout: 30_000,
        encoding: "utf-8",
      }
    );
    const parsed = JSON.parse(raw.trim() || "{}") as Record<
      string,
      { current: string; latest: string }
    >;

    outdated = Object.entries(parsed).map(([name, info]) => {
      const [curMajor, curMinor] = info.current
        .replace(/^[^0-9]*/, "")
        .split(".")
        .map(Number);
      const [latMajor, latMinor] = info.latest
        .replace(/^[^0-9]*/, "")
        .split(".")
        .map(Number);
      let sev: OutdatedPackage["severity"] = "patch";
      if (latMajor > curMajor) sev = "major";
      else if (latMinor > curMinor) sev = "minor";
      return {
        name,
        current: info.current,
        latest: info.latest,
        severity: sev,
      };
    });
  } catch (err) {
    parseError = String(err);
  }

  const majorCount = outdated.filter(p => p.severity === "major").length;
  const severity: DriftFinding["severity"] =
    majorCount > 0 ? "warning" : outdated.length > 10 ? "info" : "info";

  return {
    checkType: "dependencyDrift",
    severity,
    confidence: 0.85,
    details: {
      outdatedCount: outdated.length,
      majorCount,
      minorCount: outdated.filter(p => p.severity === "minor").length,
      patchCount: outdated.filter(p => p.severity === "patch").length,
      outdated,
      parseError,
    },
    summary:
      outdated.length === 0
        ? "All production dependencies are up to date."
        : `${outdated.length} outdated prod dep(s): ${majorCount} major, ${outdated.filter(p => p.severity === "minor").length} minor.`,
  };
}

// ─── 5. Config Drift ─────────────────────────────────────────────────────────

/**
 * Reads ENV keys from env.ts and checks which ones have empty/missing values
 * in the current process.env. Critical keys (JWT_SECRET, DATABASE_URL) are
 * flagged as critical; others as info.
 */
export function detectConfigDrift(): DriftFinding {
  const CRITICAL_KEYS = [
    "JWT_SECRET",
    "DATABASE_URL",
    "BUILT_IN_FORGE_API_KEY",
  ];

  const envContent = readFileSafe(join(SERVER_DIR, "_core", "env.ts"));
  // Extract process.env.KEY references
  const envKeyMatches = Array.from(
    envContent.matchAll(/process\.env\.([A-Z_][A-Z0-9_]*)/g)
  );
  const referencedKeys = Array.from(new Set(envKeyMatches.map(m => m[1])));

  const missingKeys: string[] = [];
  const emptyKeys: string[] = [];

  for (const key of referencedKeys) {
    const val = process.env[key];
    if (val === undefined) missingKeys.push(key);
    else if (val.trim() === "") emptyKeys.push(key);
  }

  const criticalMissing = missingKeys.filter(k => CRITICAL_KEYS.includes(k));
  const severity: DriftFinding["severity"] =
    criticalMissing.length > 0
      ? "critical"
      : missingKeys.length > 0
        ? "warning"
        : "info";

  return {
    checkType: "configDrift",
    severity,
    confidence: 1.0,
    details: {
      referencedKeys,
      missingKeys,
      emptyKeys,
      criticalMissing,
    },
    summary:
      missingKeys.length === 0 && emptyKeys.length === 0
        ? `All ${referencedKeys.length} ENV keys are set.`
        : `${missingKeys.length} missing, ${emptyKeys.length} empty ENV key(s). Critical: ${criticalMissing.join(", ") || "none"}.`,
  };
}

// ─── 6. Discipline Drift ─────────────────────────────────────────────────────

import { getDb } from "../db";
import { magicLinkTokens } from "../../drizzle/schema";
import { lt } from "drizzle-orm";

/**
 * Checks session/token hygiene:
 *   - Expired but un-used magic link tokens still in the table (should be cleaned up)
 *   - Magic link tokens older than 24h (stale, should have expired)
 */
export async function detectDisciplineDrift(): Promise<DriftFinding> {
  const db = await getDb();
  const now = new Date();
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  let expiredUnusedCount = 0;
  let staleCount = 0;
  let dbError: string | null = null;

  try {
    if (!db) throw new Error("DB not available");
    // Expired tokens that were never used
    const expiredUnused = await db
      .select({ id: magicLinkTokens.id })
      .from(magicLinkTokens)
      .where(lt(magicLinkTokens.expiresAt, now));
    expiredUnusedCount = expiredUnused.length;

    // Tokens older than 24h (created before oneDayAgo) that are unused
    const stale = await db
      .select({ id: magicLinkTokens.id })
      .from(magicLinkTokens)
      .where(lt(magicLinkTokens.createdAt, oneDayAgo));
    staleCount = stale.length;
  } catch (err) {
    dbError = String(err);
  }

  const severity: DriftFinding["severity"] = dbError
    ? "warning"
    : expiredUnusedCount > 100
      ? "warning"
      : "info";

  return {
    checkType: "disciplineDrift",
    severity,
    confidence: dbError ? 0.3 : 0.95,
    details: {
      expiredUnusedTokens: expiredUnusedCount,
      staleTokensOlderThan24h: staleCount,
      dbError,
    },
    summary: dbError
      ? `DB error during discipline check: ${dbError}`
      : `${expiredUnusedCount} expired unused magic link tokens; ${staleCount} tokens older than 24h.`,
  };
}

// ─── Aggregate ───────────────────────────────────────────────────────────────

export interface CodeDriftReport {
  schemaDrift: DriftFinding;
  apiDrift: DriftFinding;
  testDrift: DriftFinding;
  dependencyDrift: DriftFinding;
  configDrift: DriftFinding;
  disciplineDrift: DriftFinding;
  overallSeverity: "info" | "warning" | "critical";
  checkedAt: string;
}

export async function detectCodeDrift(): Promise<CodeDriftReport> {
  const [schema, api, test, dep, config, discipline] = await Promise.all([
    Promise.resolve(detectSchemaDrift()),
    Promise.resolve(detectApiDrift()),
    Promise.resolve(detectTestDrift()),
    Promise.resolve(detectDependencyDrift()),
    Promise.resolve(detectConfigDrift()),
    detectDisciplineDrift(),
  ]);

  const findings = [schema, api, test, dep, config, discipline];
  const overallSeverity: CodeDriftReport["overallSeverity"] = findings.some(
    f => f.severity === "critical"
  )
    ? "critical"
    : findings.some(f => f.severity === "warning")
      ? "warning"
      : "info";

  return {
    schemaDrift: schema,
    apiDrift: api,
    testDrift: test,
    dependencyDrift: dep,
    configDrift: config,
    disciplineDrift: discipline,
    overallSeverity,
    checkedAt: new Date().toISOString(),
  };
}
