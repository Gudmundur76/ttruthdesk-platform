/**
 * apply-migration-0055.mjs
 * Applies the build4 new tables:
 *   - event_log: Central event log for audit trail
 *   - convergence_states: Convergence decision snapshots
 *   - preflight_scans: L0 Friction Engine scan records
 *   - preflight_assumptions: L0 assumption detail records
 *   - preflight_constraints: L0 constraint detail records
 */
import { createConnection } from "mysql2/promise";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

const conn = await createConnection(connectionString);

const sql = readFileSync(
  join(__dirname, "../drizzle/0055_loud_xorn.sql"),
  "utf8"
);

// Split on statement-breakpoint
const statements = sql
  .split("--> statement-breakpoint")
  .map(s => s.trim())
  .filter(Boolean);

let applied = 0;
let skipped = 0;
let errors = 0;

for (const stmt of statements) {
  try {
    console.log("Executing:", stmt.slice(0, 120) + (stmt.length > 120 ? "..." : ""));
    await conn.execute(stmt);
    console.log("  ✓ OK");
    applied++;
  } catch (err) {
    if (
      err.code === "ER_TABLE_EXISTS_ERROR" ||
      err.message?.includes("already exists") ||
      err.code === "ER_DUP_KEYNAME" ||
      err.message?.includes("Duplicate key")
    ) {
      console.log("  ⚠ Already applied, skipping");
      skipped++;
    } else {
      console.error("  ✗ Error:", err.message);
      errors++;
    }
  }
}

await conn.end();
console.log(`\nMigration 0055 complete: ${applied} applied, ${skipped} skipped, ${errors} errors`);
if (errors > 0) {
  process.exit(1);
}
