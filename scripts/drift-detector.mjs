#!/usr/bin/env node
/**
 * drift-detector.mjs
 * ──────────────────
 * Compares the current project state against the manus-persistent-drive snapshot.
 * Reports files that have changed, been added, or been deleted since the last sync.
 * Also checks schema drift (tables in schema.ts vs tables in drive snapshot).
 *
 * Usage:
 *   node scripts/drift-detector.mjs              # human-readable diff summary
 *   node scripts/drift-detector.mjs --json       # machine-readable JSON
 *   node scripts/drift-detector.mjs --schema     # schema-only drift check
 *   node scripts/drift-detector.mjs --sync       # update drive snapshot (requires git push)
 */

import { execSync, spawnSync } from "child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from "fs";
import { join, resolve, relative, basename } from "path";
import { fileURLToPath } from "url";
import { createHash } from "crypto";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..");
const DRIVE_PATH = "/home/ubuntu/manus-persistent-drive";

const JSON_MODE = process.argv.includes("--json");
const SCHEMA_ONLY = process.argv.includes("--schema");
const SYNC_MODE = process.argv.includes("--sync");

// ─── Colours ────────────────────────────────────────────────────────────────
const c = {
  reset: "\x1b[0m", red: "\x1b[31m", green: "\x1b[32m",
  yellow: "\x1b[33m", blue: "\x1b[34m", bold: "\x1b[1m", dim: "\x1b[2m",
};

function sha256(content) {
  return createHash("sha256").update(content).digest("hex").slice(0, 12);
}

// ─── Walk a directory ────────────────────────────────────────────────────────
function walkDir(dir, exts = [".ts", ".tsx", ".md", ".json"]) {
  const files = [];
  if (!existsSync(dir)) return files;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory() && !["node_modules", ".git", "dist", "coverage", ".manus-logs"].includes(entry.name)) {
      files.push(...walkDir(full, exts));
    } else if (entry.isFile() && exts.some((e) => entry.name.endsWith(e))) {
      files.push(full);
    }
  }
  return files;
}

// ─── Build a hash map of drive snapshot files ─────────────────────────────────
function buildDriveMap() {
  const map = new Map();
  const driveDataDir = join(DRIVE_PATH, "data", "protein-truth-desk");
  if (!existsSync(driveDataDir)) return map;

  const files = walkDir(driveDataDir);
  for (const f of files) {
    const key = basename(f);
    const content = readFileSync(f, "utf8");
    map.set(key, { path: f, hash: sha256(content), size: content.length });
  }
  return map;
}

// ─── Build a hash map of current project files ───────────────────────────────
function buildProjectMap() {
  const map = new Map();
  const dirs = [
    join(PROJECT_ROOT, "server"),
    join(PROJECT_ROOT, "client", "src", "pages"),
    join(PROJECT_ROOT, "drizzle"),
  ];

  for (const dir of dirs) {
    const files = walkDir(dir);
    for (const f of files) {
      const key = basename(f);
      const content = readFileSync(f, "utf8");
      map.set(key, { path: relative(PROJECT_ROOT, f), hash: sha256(content), size: content.length });
    }
  }

  // Always include todo.md and schema.ts
  for (const special of ["todo.md", "CLAUDE.md"]) {
    const full = join(PROJECT_ROOT, special);
    if (existsSync(full)) {
      const content = readFileSync(full, "utf8");
      map.set(special, { path: special, hash: sha256(content), size: content.length });
    }
  }

  return map;
}

// ─── Schema drift check ───────────────────────────────────────────────────────
function checkSchemaDrift() {
  const schemaPath = join(PROJECT_ROOT, "drizzle", "schema.ts");
  const driveSchemaPath = join(DRIVE_PATH, "data", "protein-truth-desk", "schema", "schema.ts");

  if (!existsSync(schemaPath)) return { error: "schema.ts not found in project" };
  if (!existsSync(driveSchemaPath)) return { error: "schema.ts not found in persistent drive" };

  const projectSchema = readFileSync(schemaPath, "utf8");
  const driveSchema = readFileSync(driveSchemaPath, "utf8");

  const extractTables = (content) =>
    [...content.matchAll(/export const (\w+) = \w+Table\(/g)].map((m) => m[1]);

  const projectTables = extractTables(projectSchema);
  const driveTables = extractTables(driveSchema);

  const added = projectTables.filter((t) => !driveTables.includes(t));
  const removed = driveTables.filter((t) => !projectTables.includes(t));
  const unchanged = projectTables.filter((t) => driveTables.includes(t));

  return {
    projectTableCount: projectTables.length,
    driveTableCount: driveTables.length,
    added,
    removed,
    unchanged: unchanged.length,
    inSync: added.length === 0 && removed.length === 0,
  };
}

// ─── Sync mode: copy changed files to drive ───────────────────────────────────
function syncToDrive(drifted) {
  const driveDataDir = join(DRIVE_PATH, "data", "protein-truth-desk");
  let synced = 0;

  for (const item of drifted) {
    if (item.status === "added" || item.status === "modified") {
      const src = join(PROJECT_ROOT, item.projectPath);
      if (!existsSync(src)) continue;

      // Determine destination directory
      let destDir;
      if (item.file.endsWith(".test.ts") || item.file.endsWith(".test.tsx")) {
        destDir = join(driveDataDir, "tests");
      } else if (item.file.endsWith(".tsx") && item.projectPath.includes("pages")) {
        destDir = join(driveDataDir, "pages");
      } else if (item.projectPath.includes("server")) {
        destDir = join(driveDataDir, "services");
      } else if (item.projectPath.includes("drizzle")) {
        destDir = join(driveDataDir, "schema");
      } else {
        destDir = join(driveDataDir, "misc");
      }

      mkdirSync(destDir, { recursive: true });
      const dest = join(destDir, item.file);
      writeFileSync(dest, readFileSync(src));
      synced++;
    }
  }

  // Also sync todo.md and CLAUDE.md
  for (const special of ["todo.md", "CLAUDE.md"]) {
    const src = join(PROJECT_ROOT, special);
    if (existsSync(src)) {
      const destDir = special === "todo.md"
        ? join(driveDataDir, "todo")
        : join(DRIVE_PATH, "context");
      mkdirSync(destDir, { recursive: true });
      writeFileSync(join(destDir, special), readFileSync(src));
      synced++;
    }
  }

  return synced;
}

// ─── Main ────────────────────────────────────────────────────────────────────
function main() {
  if (!existsSync(DRIVE_PATH)) {
    const msg = "manus-persistent-drive not found. Run: gh repo clone Gudmundur76/manus-persistent-drive /home/ubuntu/manus-persistent-drive";
    if (JSON_MODE) {
      console.log(JSON.stringify({ error: msg }));
    } else {
      console.error(`${c.red}✗ ${msg}${c.reset}`);
    }
    process.exit(1);
  }

  const schemaDrift = checkSchemaDrift();

  if (SCHEMA_ONLY) {
    if (JSON_MODE) {
      console.log(JSON.stringify({ schema: schemaDrift }, null, 2));
    } else {
      console.log(`\n${c.bold}Schema Drift Check${c.reset}`);
      if (schemaDrift.error) {
        console.log(`${c.red}✗ ${schemaDrift.error}${c.reset}`);
      } else if (schemaDrift.inSync) {
        console.log(`${c.green}✓ Schema in sync (${schemaDrift.projectTableCount} tables)${c.reset}`);
      } else {
        if (schemaDrift.added.length > 0) {
          console.log(`${c.yellow}+ Tables added to project (not in drive): ${schemaDrift.added.join(", ")}${c.reset}`);
        }
        if (schemaDrift.removed.length > 0) {
          console.log(`${c.red}- Tables in drive but not in project: ${schemaDrift.removed.join(", ")}${c.reset}`);
        }
      }
    }
    return;
  }

  const driveMap = buildDriveMap();
  const projectMap = buildProjectMap();

  const drifted = [];

  // Files in project but not in drive (added)
  for (const [key, pv] of projectMap) {
    if (!driveMap.has(key)) {
      drifted.push({ file: key, status: "added", projectPath: pv.path, drivePath: null, projectHash: pv.hash });
    } else {
      const dv = driveMap.get(key);
      if (pv.hash !== dv.hash) {
        drifted.push({
          file: key,
          status: "modified",
          projectPath: pv.path,
          drivePath: relative(DRIVE_PATH, dv.path),
          projectHash: pv.hash,
          driveHash: dv.hash,
          projectSize: pv.size,
          driveSize: dv.size,
        });
      }
    }
  }

  // Files in drive but not in project (deleted from project)
  for (const [key, dv] of driveMap) {
    if (!projectMap.has(key)) {
      drifted.push({
        file: key,
        status: "deleted",
        projectPath: null,
        drivePath: relative(DRIVE_PATH, dv.path),
        driveHash: dv.hash,
      });
    }
  }

  if (SYNC_MODE) {
    const synced = syncToDrive(drifted);
    if (!JSON_MODE) {
      console.log(`${c.green}✓ Synced ${synced} file(s) to manus-persistent-drive${c.reset}`);
      console.log(`${c.dim}Run: cd /home/ubuntu/manus-persistent-drive && git add -A && git commit -m "chore: sync project snapshot" && git push${c.reset}\n`);
    }
    return;
  }

  if (JSON_MODE) {
    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      driftCount: drifted.length,
      schema: schemaDrift,
      drift: drifted,
    }, null, 2));
    return;
  }

  // Human-readable output
  console.log(`\n${c.bold}${c.blue}╔══════════════════════════════════════════╗${c.reset}`);
  console.log(`${c.bold}${c.blue}║   Drift Detector                         ║${c.reset}`);
  console.log(`${c.bold}${c.blue}╚══════════════════════════════════════════╝${c.reset}\n`);

  // Schema section
  if (schemaDrift.error) {
    console.log(`${c.yellow}⚠ Schema: ${schemaDrift.error}${c.reset}`);
  } else if (schemaDrift.inSync) {
    console.log(`${c.green}✓ Schema: in sync (${schemaDrift.projectTableCount} tables)${c.reset}`);
  } else {
    console.log(`${c.yellow}⚠ Schema drift detected:${c.reset}`);
    if (schemaDrift.added.length > 0) {
      console.log(`  ${c.green}+ Added:${c.reset} ${schemaDrift.added.join(", ")}`);
    }
    if (schemaDrift.removed.length > 0) {
      console.log(`  ${c.red}- Removed:${c.reset} ${schemaDrift.removed.join(", ")}`);
    }
  }
  console.log();

  if (drifted.length === 0) {
    console.log(`${c.green}✓ No file drift detected. Project and drive are in sync.${c.reset}\n`);
    return;
  }

  const added = drifted.filter((d) => d.status === "added");
  const modified = drifted.filter((d) => d.status === "modified");
  const deleted = drifted.filter((d) => d.status === "deleted");

  console.log(`${c.bold}File drift: ${drifted.length} change(s)${c.reset}`);
  console.log(`  ${c.green}Added:${c.reset}    ${added.length}`);
  console.log(`  ${c.yellow}Modified:${c.reset} ${modified.length}`);
  console.log(`  ${c.red}Deleted:${c.reset}  ${deleted.length}\n`);

  if (added.length > 0) {
    console.log(`${c.green}${c.bold}Added (in project, not in drive):${c.reset}`);
    for (const d of added) console.log(`  + ${d.projectPath}`);
    console.log();
  }

  if (modified.length > 0) {
    console.log(`${c.yellow}${c.bold}Modified (hash differs):${c.reset}`);
    for (const d of modified) {
      const sizeDiff = d.projectSize - d.driveSize;
      const sign = sizeDiff >= 0 ? "+" : "";
      console.log(`  ~ ${d.projectPath} ${c.dim}(${sign}${sizeDiff} bytes)${c.reset}`);
    }
    console.log();
  }

  if (deleted.length > 0) {
    console.log(`${c.red}${c.bold}Deleted (in drive, not in project):${c.reset}`);
    for (const d of deleted) console.log(`  - ${d.drivePath}`);
    console.log();
  }

  console.log(`${c.dim}Run with --sync to copy changed files to the drive.${c.reset}`);
  console.log(`${c.dim}Then: cd /home/ubuntu/manus-persistent-drive && git add -A && git commit -m "chore: sync" && git push${c.reset}\n`);
}

main();
