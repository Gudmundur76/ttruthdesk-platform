import { createConnection } from "mysql2/promise";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL not set");

const conn = await createConnection(url);

const statements = [
  `CREATE TABLE IF NOT EXISTS \`wiki_index\` (
    \`id\` int AUTO_INCREMENT NOT NULL,
    \`content\` text NOT NULL,
    \`pageCount\` int NOT NULL DEFAULT 0,
    \`lastBuiltAt\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT \`wiki_index_id\` PRIMARY KEY(\`id\`)
  )`,
  `CREATE TABLE IF NOT EXISTS \`wiki_log\` (
    \`id\` int AUTO_INCREMENT NOT NULL,
    \`action\` enum('ingest','lint','query','update') NOT NULL,
    \`slug\` varchar(256),
    \`summary\` text NOT NULL,
    \`pagesAffected\` int NOT NULL DEFAULT 0,
    \`documentId\` int,
    \`recordedAt\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT \`wiki_log_id\` PRIMARY KEY(\`id\`)
  )`,
  `CREATE TABLE IF NOT EXISTS \`wiki_pages\` (
    \`id\` int AUTO_INCREMENT NOT NULL,
    \`slug\` varchar(256) NOT NULL,
    \`title\` varchar(512) NOT NULL,
    \`category\` enum('entity','concept','synthesis','source_summary') NOT NULL DEFAULT 'entity',
    \`content\` text NOT NULL,
    \`sourceCount\` int NOT NULL DEFAULT 0,
    \`inboundLinks\` json NOT NULL,
    \`outboundLinks\` json NOT NULL,
    \`avgConfidence\` float DEFAULT 0,
    \`verticalDomain\` varchar(64) NOT NULL DEFAULT 'structural_biology',
    \`lastCompiledAt\` timestamp NULL,
    \`createdAt\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    \`updatedAt\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT \`wiki_pages_id\` PRIMARY KEY(\`id\`),
    CONSTRAINT \`wiki_pages_slug_unique\` UNIQUE(\`slug\`)
  )`,
  `CREATE INDEX IF NOT EXISTS \`wl_action_idx\` ON \`wiki_log\` (\`action\`)`,
  `CREATE INDEX IF NOT EXISTS \`wl_recorded_at_idx\` ON \`wiki_log\` (\`recordedAt\`)`,
  `CREATE INDEX IF NOT EXISTS \`wl_document_id_idx\` ON \`wiki_log\` (\`documentId\`)`,
  `CREATE INDEX IF NOT EXISTS \`wp_category_idx\` ON \`wiki_pages\` (\`category\`)`,
  `CREATE INDEX IF NOT EXISTS \`wp_vertical_idx\` ON \`wiki_pages\` (\`verticalDomain\`)`,
  `CREATE INDEX IF NOT EXISTS \`wp_updated_at_idx\` ON \`wiki_pages\` (\`updatedAt\`)`,
];

for (const sql of statements) {
  try {
    await conn.execute(sql);
    console.log("OK:", sql.slice(0, 60).replace(/\s+/g, " ").trim());
  } catch (e) {
    if (e.message.includes("already exists") || e.message.includes("Duplicate key")) {
      console.log("SKIP (already exists):", sql.slice(0, 60).replace(/\s+/g, " ").trim());
    } else {
      console.error("FAIL:", e.message);
      await conn.end();
      process.exit(1);
    }
  }
}

await conn.end();
console.log("Migration 0020 complete.");
