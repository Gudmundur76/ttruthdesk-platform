import { createConnection } from "mysql2/promise";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

const sql = readFileSync(
  join(__dirname, "../drizzle/0045_bored_living_tribunal.sql"),
  "utf8"
).trim();

const conn = await createConnection(process.env.DATABASE_URL);
try {
  for (const stmt of sql.split(";").map(s => s.trim()).filter(Boolean)) {
    console.log("Executing:", stmt.substring(0, 80));
    await conn.execute(stmt);
  }
  console.log("Migration 0045 applied successfully.");
} finally {
  await conn.end();
}
