import mysql from "mysql2/promise";

const conn = await mysql.createConnection(process.env.DATABASE_URL);

try {
  await conn.execute(`
    CREATE TABLE IF NOT EXISTS \`saved_research\` (
      \`id\` int AUTO_INCREMENT NOT NULL,
      \`userId\` int NOT NULL,
      \`question\` text NOT NULL,
      \`claimsJson\` json NOT NULL,
      \`totalPapers\` int NOT NULL DEFAULT 0,
      \`supportedClaims\` int NOT NULL DEFAULT 0,
      \`claimsAnalysed\` int NOT NULL DEFAULT 0,
      \`createdAt\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (\`id\`),
      INDEX \`sr_user_id_idx\` (\`userId\`)
    )
  `);
  console.log("✓ saved_research table created");
} catch (e) {
  if (e.code === "ER_TABLE_EXISTS_ERROR" || String(e.message).includes("already exists")) {
    console.log("✓ saved_research table already exists — skipping");
  } else {
    console.error("✗", e.message);
    process.exit(1);
  }
}

await conn.end();
