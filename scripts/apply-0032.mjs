import { createConnection } from "mysql2/promise";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL not set");

const conn = await createConnection(url);

const statements = [
  `CREATE TABLE IF NOT EXISTS \`discovery_runs\` (
    \`id\` int AUTO_INCREMENT NOT NULL,
    \`verticalKey\` varchar(64) NOT NULL,
    \`status\` enum('running','complete','failed') NOT NULL DEFAULT 'running',
    \`currentPhase\` varchar(32) DEFAULT 'match',
    \`sourcesMatched\` int NOT NULL DEFAULT 0,
    \`sourcesProbed\` int NOT NULL DEFAULT 0,
    \`adaptersGenerated\` int NOT NULL DEFAULT 0,
    \`registeredSources\` json,
    \`adapterFiles\` json,
    \`errorMessage\` text,
    \`runLog\` json,
    \`startedAt\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    \`completedAt\` timestamp NULL,
    CONSTRAINT \`discovery_runs_id\` PRIMARY KEY(\`id\`)
  )`,
  `CREATE TABLE IF NOT EXISTS \`micron_deployments\` (
    \`id\` int AUTO_INCREMENT NOT NULL,
    \`verticalKey\` varchar(64) NOT NULL,
    \`displayName\` varchar(256) NOT NULL,
    \`domain\` varchar(512),
    \`deployTarget\` enum('vercel','netlify','docker','ipfs') NOT NULL,
    \`status\` enum('pending','building','deployed','failed','cancelled') NOT NULL DEFAULT 'pending',
    \`siteUrl\` varchar(2048),
    \`config\` json,
    \`errorMessage\` text,
    \`userId\` int NOT NULL,
    \`deployedAt\` timestamp NULL,
    \`createdAt\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    \`updatedAt\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT \`micron_deployments_id\` PRIMARY KEY(\`id\`)
  )`,
  `CREATE TABLE IF NOT EXISTS \`source_registry_entries\` (
    \`id\` int AUTO_INCREMENT NOT NULL,
    \`sourceId\` varchar(128) NOT NULL,
    \`displayName\` varchar(256) NOT NULL,
    \`baseUrl\` varchar(2048) NOT NULL,
    \`category\` enum('protein_structure','sequence','literature','clinical','chemistry','genomics','nutrition','regulatory','other') NOT NULL DEFAULT 'other',
    \`approvalStatus\` enum('pending','approved','rejected') NOT NULL DEFAULT 'pending',
    \`isHealthy\` tinyint(1) NOT NULL DEFAULT 1,
    \`lastHealthCheckAt\` timestamp NULL,
    \`lastHealthStatus\` int,
    \`verticals\` json,
    \`adapterStub\` text,
    \`discoveryRunId\` int,
    \`schemaDescription\` text,
    \`rateLimitRpm\` int,
    \`createdAt\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    \`updatedAt\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT \`source_registry_entries_id\` PRIMARY KEY(\`id\`),
    CONSTRAINT \`source_registry_entries_sourceId_unique\` UNIQUE(\`sourceId\`)
  )`,
  `CREATE INDEX \`dr_vertical_key_idx\` ON \`discovery_runs\` (\`verticalKey\`)`,
  `CREATE INDEX \`dr_status_idx\` ON \`discovery_runs\` (\`status\`)`,
  `CREATE INDEX \`dr_started_at_idx\` ON \`discovery_runs\` (\`startedAt\`)`,
  `CREATE INDEX \`md_vertical_key_idx\` ON \`micron_deployments\` (\`verticalKey\`)`,
  `CREATE INDEX \`md_status_idx\` ON \`micron_deployments\` (\`status\`)`,
  `CREATE INDEX \`md_user_idx\` ON \`micron_deployments\` (\`userId\`)`,
  `CREATE INDEX \`sre_category_idx\` ON \`source_registry_entries\` (\`category\`)`,
];

for (const sql of statements) {
  try {
    await conn.execute(sql);
    console.log("OK:", sql.slice(0, 60).replace(/\s+/g, " ").trim());
  } catch (e) {
    const skip = ["ER_TABLE_EXISTS_ERROR", "ER_DUP_KEYNAME", "ER_DUP_INDEX"];
    if (skip.includes(e.code)) {
      console.log("SKIP:", sql.slice(0, 60).replace(/\s+/g, " ").trim());
    } else {
      console.error("FAIL:", e.code, e.message.slice(0, 120));
    }
  }
}

await conn.end();
console.log("Migration 0032 complete.");
