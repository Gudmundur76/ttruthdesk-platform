/**
 * apply-migration-0044.mjs
 * Applies drizzle/0044_yielding_landau.sql to the ttruthdesk-platform DB.
 */
import { createConnection } from "mysql2/promise";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const sql = readFileSync(
  join(__dirname, "../drizzle/0044_yielding_landau.sql"),
  "utf8"
);

const conn = await createConnection(process.env.DATABASE_URL);

// Split on drizzle statement-breakpoint marker
const statements = sql
  .split("--> statement-breakpoint")
  .map(s => s.trim())
  .filter(Boolean);

for (const stmt of statements) {
  console.log("Executing:", stmt.slice(0, 80), "...");
  await conn.execute(stmt);
}

await conn.end();
console.log("Migration 0044 applied successfully.");
