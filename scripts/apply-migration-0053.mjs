import { createConnection } from "mysql2/promise";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
const __dirname = dirname(fileURLToPath(import.meta.url));
const sql = readFileSync(
  join(__dirname, "../drizzle/0053_ambitious_black_tarantula.sql"),
  "utf8"
).trim();
const conn = await createConnection(process.env.DATABASE_URL);
try {
  // Split on --> statement-breakpoint and semicolons
  const stmts = sql
    .split("--> statement-breakpoint")
    .flatMap(s => s.split(";"))
    .map(s => s.trim())
    .filter(Boolean);
  for (const stmt of stmts) {
    console.log("Executing:", stmt.substring(0, 100));
    await conn.execute(stmt);
  }
  console.log("Migration 0053 applied successfully.");
} catch (err) {
  console.error("Migration failed:", err.message);
  process.exit(1);
} finally {
  await conn.end();
}
