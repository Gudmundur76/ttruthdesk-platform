import { createConnection } from "mysql2/promise";

const conn = await createConnection(process.env.DATABASE_URL);

try {
  // TiDB does not support DEFAULT ('[]') for JSON columns — omit the default
  // and handle it in application code instead.
  await conn.execute(`
    CREATE TABLE IF NOT EXISTS \`vertical_configs\` (
      \`id\` int AUTO_INCREMENT NOT NULL,
      \`domainKey\` varchar(64) NOT NULL,
      \`displayName\` varchar(128) NOT NULL,
      \`description\` text,
      \`meshTerms\` json,
      \`sourceWhitelist\` json,
      \`qualityTier\` varchar(16) NOT NULL DEFAULT 'draft',
      \`enabled\` boolean NOT NULL DEFAULT true,
      \`createdAt\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
      \`updatedAt\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT \`vertical_configs_id\` PRIMARY KEY(\`id\`),
      CONSTRAINT \`vertical_configs_domainKey_unique\` UNIQUE(\`domainKey\`)
    )
  `);
  console.log("✓ vertical_configs table created");

  // Indexes (ignore if already exist)
  try {
    await conn.execute("CREATE INDEX `vc_domain_key_idx` ON `vertical_configs` (`domainKey`)");
    console.log("✓ vc_domain_key_idx created");
  } catch (e) {
    if (e.code === "ER_DUP_KEYNAME") console.log("  vc_domain_key_idx already exists, skipping");
    else throw e;
  }
  try {
    await conn.execute("CREATE INDEX `vc_enabled_idx` ON `vertical_configs` (`enabled`)");
    console.log("✓ vc_enabled_idx created");
  } catch (e) {
    if (e.code === "ER_DUP_KEYNAME") console.log("  vc_enabled_idx already exists, skipping");
    else throw e;
  }

  console.log("Migration complete.");
} finally {
  await conn.end();
}
