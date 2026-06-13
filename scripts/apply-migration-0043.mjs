/**
 * apply-migration-0043.mjs
 * Applies Phase 109/110 schema migration to ttruthdesk-platform DB.
 * Run once: node scripts/apply-migration-0043.mjs
 */
import { createConnection } from "mysql2/promise";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { config } from "dotenv";

config();

const __dirname = dirname(fileURLToPath(import.meta.url));
const sqlFile = join(__dirname, "../drizzle/0043_unknown_starbolt.sql");

const statements = readFileSync(sqlFile, "utf8")
  .split("--> statement-breakpoint")
  .map(s => s.trim())
  .filter(Boolean);

const conn = await createConnection(process.env.DATABASE_URL);

let applied = 0;
let skipped = 0;

for (const stmt of statements) {
  try {
    await conn.execute(stmt);
    applied++;
    console.log(`✓ Applied: ${stmt.slice(0, 80).replace(/\n/g, " ")}...`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (
      msg.includes("already exists") ||
      msg.includes("Duplicate key name") ||
      msg.includes("Duplicate index")
    ) {
      skipped++;
      console.log(`⊘ Skipped (already exists): ${stmt.slice(0, 60).replace(/\n/g, " ")}...`);
    } else {
      console.error(`✗ Error: ${msg}`);
      console.error(`  Statement: ${stmt.slice(0, 120)}`);
    }
  }
}

await conn.end();
console.log(`\nMigration 0043 complete: ${applied} applied, ${skipped} skipped.`);
