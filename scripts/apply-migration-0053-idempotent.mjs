/**
 * Idempotent migration 0053 — applies only the statements that haven't been applied yet.
 * Checks each column/table existence before applying.
 */
import { createConnection } from "mysql2/promise";
const conn = await createConnection(process.env.DATABASE_URL);

async function columnExists(table, column) {
  const [rows] = await conn.query(
    `SELECT COUNT(*) as cnt FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  return rows[0].cnt > 0;
}

async function tableExists(table) {
  const [rows] = await conn.query(
    `SELECT COUNT(*) as cnt FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [table]
  );
  return rows[0].cnt > 0;
}

async function indexExists(table, indexName) {
  const [rows] = await conn.query(
    `SELECT COUNT(*) as cnt FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`,
    [table, indexName]
  );
  return rows[0].cnt > 0;
}

async function exec(sql, label) {
  try {
    await conn.execute(sql);
    console.log(`✓ ${label}`);
  } catch (err) {
    console.error(`✗ ${label}: ${err.message}`);
  }
}

try {
  // dream_event_queue table
  if (!(await tableExists("dream_event_queue"))) {
    await exec(
      `CREATE TABLE \`dream_event_queue\` (
        \`id\` int AUTO_INCREMENT NOT NULL,
        \`sessionId\` int NOT NULL,
        \`dreamPriority\` varchar(16) NOT NULL,
        \`evidenceStrength\` float NOT NULL DEFAULT 0,
        \`autoTrigger\` boolean NOT NULL DEFAULT false,
        \`payload\` json NOT NULL,
        \`status\` varchar(16) NOT NULL DEFAULT 'queued',
        \`createdAt\` timestamp NOT NULL DEFAULT (now()),
        \`processedAt\` timestamp,
        CONSTRAINT \`dream_event_queue_id\` PRIMARY KEY(\`id\`)
      )`,
      "CREATE dream_event_queue"
    );
  } else {
    console.log("✓ dream_event_queue already exists");
  }

  // confidence_history columns
  for (const [col, ddl] of [
    ["ruleTriggered", "ALTER TABLE `confidence_history` ADD `ruleTriggered` varchar(4)"],
    ["dreamSessionId", "ALTER TABLE `confidence_history` ADD `dreamSessionId` int"],
    ["oldConfidence", "ALTER TABLE `confidence_history` ADD `oldConfidence` float"],
    ["newConfidence", "ALTER TABLE `confidence_history` ADD `newConfidence` float"],
    ["evidence", "ALTER TABLE `confidence_history` ADD `evidence` text"],
    ["applied", "ALTER TABLE `confidence_history` ADD `applied` boolean DEFAULT false NOT NULL"],
  ]) {
    if (!(await columnExists("confidence_history", col))) {
      await exec(ddl, `confidence_history.${col}`);
    } else {
      console.log(`✓ confidence_history.${col} already exists`);
    }
  }

  // dream_sessions columns
  for (const [col, ddl] of [
    ["maxCycles", "ALTER TABLE `dream_sessions` ADD `maxCycles` int DEFAULT 5 NOT NULL"],
    ["queuePendingAtStart", "ALTER TABLE `dream_sessions` ADD `queuePendingAtStart` int DEFAULT 0 NOT NULL"],
    ["perCycleReports", "ALTER TABLE `dream_sessions` ADD `perCycleReports` json"],
    ["eventsPublished", "ALTER TABLE `dream_sessions` ADD `eventsPublished` int DEFAULT 0 NOT NULL"],
    ["aggregateRiskLevel", "ALTER TABLE `dream_sessions` ADD `aggregateRiskLevel` varchar(16)"],
    ["status", "ALTER TABLE `dream_sessions` ADD `status` varchar(16) DEFAULT 'running' NOT NULL"],
    ["abortReason", "ALTER TABLE `dream_sessions` ADD `abortReason` text"],
  ]) {
    if (!(await columnExists("dream_sessions", col))) {
      await exec(ddl, `dream_sessions.${col}`);
    } else {
      console.log(`✓ dream_sessions.${col} already exists`);
    }
  }

  // knowledge_gaps columns
  for (const [col, ddl] of [
    ["directiveBoost", "ALTER TABLE `knowledge_gaps` ADD `directiveBoost` float DEFAULT 0 NOT NULL"],
    ["rank", "ALTER TABLE `knowledge_gaps` ADD `rank` int"],
    ["detectionCount", "ALTER TABLE `knowledge_gaps` ADD `detectionCount` int DEFAULT 1 NOT NULL"],
    ["lastDetectedAt", "ALTER TABLE `knowledge_gaps` ADD `lastDetectedAt` timestamp DEFAULT (now()) NOT NULL"],
  ]) {
    if (!(await columnExists("knowledge_gaps", col))) {
      await exec(ddl, `knowledge_gaps.${col}`);
    } else {
      console.log(`✓ knowledge_gaps.${col} already exists`);
    }
  }

  // Indexes
  for (const [table, idx, ddl] of [
    ["dream_event_queue", "deq_status_idx", "CREATE INDEX `deq_status_idx` ON `dream_event_queue` (`status`)"],
    ["dream_event_queue", "deq_session_id_idx", "CREATE INDEX `deq_session_id_idx` ON `dream_event_queue` (`sessionId`)"],
    ["dream_event_queue", "deq_priority_strength_idx", "CREATE INDEX `deq_priority_strength_idx` ON `dream_event_queue` (`dreamPriority`,`evidenceStrength`)"],
    ["dream_sessions", "ds_status_idx", "CREATE INDEX `ds_status_idx` ON `dream_sessions` (`status`)"],
  ]) {
    if (!(await indexExists(table, idx))) {
      await exec(ddl, `INDEX ${idx}`);
    } else {
      console.log(`✓ INDEX ${idx} already exists`);
    }
  }

  console.log("\nMigration 0053 complete.");
} finally {
  await conn.end();
}
