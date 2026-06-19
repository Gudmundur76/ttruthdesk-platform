/**
 * apply-migration-0056.mjs
 * Adds confidence, ttlMinutes, expiresAt columns to frontier_directives.
 */
import { createConnection } from "mysql2/promise";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main() {
  const conn = await createConnection(process.env.DATABASE_URL);
  try {
    const sql = readFileSync(
      join(__dirname, "../drizzle/0056_good_mojo.sql"),
      "utf-8"
    );
    const statements = sql
      .split("--> statement-breakpoint")
      .map(s => s.trim())
      .filter(Boolean);

    for (const stmt of statements) {
      console.log("Executing:", stmt.slice(0, 80) + "...");
      await conn.execute(stmt);
    }
    console.log("✅ Migration 0056 applied successfully.");
  } finally {
    await conn.end();
  }
}

main().catch(err => {
  console.error("❌ Migration failed:", err.message);
  process.exit(1);
});
