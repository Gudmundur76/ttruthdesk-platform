import mysql from "mysql2/promise";
import { readFileSync } from "fs";

const sql = readFileSync(
  new URL("../drizzle/0057_pink_hellion.sql", import.meta.url),
  "utf-8"
);

const conn = await mysql.createConnection(process.env.DATABASE_URL);
const statements = sql.split("--> statement-breakpoint").map((s) => s.trim()).filter(Boolean);
for (const stmt of statements) {
  await conn.execute(stmt);
}
await conn.end();
console.log("Migration 0057 applied successfully.");
