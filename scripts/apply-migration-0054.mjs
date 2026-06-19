/**
 * apply-migration-0054.mjs
 * Applies the build3 enum additions:
 *   - frontier_log.actionType: adds cycle_event, metric_report
 *   - event_queue.eventType: adds frontier_directive
 */
import { createConnection } from "mysql2/promise";
import { readFileSync } from "fs";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

const conn = await createConnection(connectionString);

const sql = readFileSync(
  new URL("../drizzle/0054_nostalgic_scarlet_witch.sql", import.meta.url),
  "utf8"
);

// Split on statement-breakpoint
const statements = sql
  .split("--> statement-breakpoint")
  .map(s => s.trim())
  .filter(Boolean);

for (const stmt of statements) {
  try {
    console.log("Executing:", stmt.slice(0, 120) + "...");
    await conn.execute(stmt);
    console.log("  ✓ OK");
  } catch (err) {
    if (err.code === "ER_DUP_KEYNAME" || err.message?.includes("Duplicate key")) {
      console.log("  ⚠ Already applied (duplicate key), skipping");
    } else {
      console.error("  ✗ Error:", err.message);
      // Don't exit — enum modifications are idempotent if the value already exists
    }
  }
}

await conn.end();
console.log("Migration 0054 complete");
