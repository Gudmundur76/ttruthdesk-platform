import { createConnection } from "mysql2/promise";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const sql = readFileSync(join(__dirname, "../drizzle/0058_clever_calypso.sql"), "utf8");

const conn = await createConnection(process.env.DATABASE_URL);
// Strip Drizzle-generated statement-breakpoint comments and split on semicolons
const statements = sql
  .replace(/--> statement-breakpoint/g, "")
  .split(";")
  .map(s => s.trim())
  .filter(Boolean);
for (const stmt of statements) {
  try {
    await conn.execute(stmt);
    console.log("✅ Applied:", stmt.slice(0, 80));
  } catch (err) {
    if (err.code === "ER_DUP_FIELDNAME") {
      console.log("⏭  Already exists:", stmt.slice(0, 80));
    } else {
      throw err;
    }
  }
}
await conn.end();
console.log("Migration 0058 complete.");
