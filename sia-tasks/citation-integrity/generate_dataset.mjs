/**
 * Citation Integrity Dataset Generator
 *
 * Exports claim-source pairs from the platform database into the SIA task format.
 * Produces:
 *   - data/public/claims.jsonl   (200 pairs — visible to the agent)
 *   - data/private/ground_truth.jsonl (100 pairs — held out for evaluation)
 *
 * Usage:
 *   node generate_dataset.mjs
 *
 * Requires DATABASE_URL in environment (same as the platform server).
 */

import { createConnection } from "mysql2/promise";
import { writeFileSync, mkdirSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import "dotenv/config";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, "data", "public");
const PRIVATE_DIR = join(__dirname, "data", "private");

mkdirSync(PUBLIC_DIR, { recursive: true });
mkdirSync(PRIVATE_DIR, { recursive: true });

// ---------------------------------------------------------------------------
// Database query — pull verified claims with their evidence sources
// ---------------------------------------------------------------------------

const QUERY = `
  SELECT
    c.id          AS claim_id,
    c.claim_text,
    c.verdict     AS citation_state,
    c.confidence,
    e.title       AS source_title,
    e.abstract    AS source_abstract,
    e.full_text   AS source_full_text,
    e.domain,
    c.source_passage,
    c.misrepresentation_pattern
  FROM claims c
  JOIN evidence e ON e.claim_id = c.id
  WHERE c.verdict IN ('verified', 'contested', 'implied', 'beyond_evidence')
    AND c.confidence IS NOT NULL
    AND e.abstract IS NOT NULL
    AND LENGTH(c.claim_text) > 20
  ORDER BY c.created_at DESC
  LIMIT 400
`;

async function main() {
  const conn = await createConnection(process.env.DATABASE_URL);

  console.log("Querying platform database for claim-source pairs...");
  const [rows] = await conn.execute(QUERY);
  await conn.end();

  console.log(`Found ${rows.length} claim-source pairs`);

  if (rows.length < 100) {
    console.warn(
      `Warning: only ${rows.length} pairs found. Need at least 100 for a meaningful dataset.`
    );
    console.warn(
      "Run the autonomous ingestion pipeline to populate more claims before generating the dataset."
    );
  }

  // Shuffle deterministically for reproducibility
  const shuffled = [...rows].sort((a, b) =>
    String(a.claim_id).localeCompare(String(b.claim_id))
  );

  // Split: first 200 for public (agent-visible), next 100 for private (held-out)
  const publicPairs = shuffled.slice(0, 200);
  const privatePairs = shuffled.slice(200, 300);

  // ---------------------------------------------------------------------------
  // Write public claims.jsonl (no ground truth fields)
  // ---------------------------------------------------------------------------
  const publicLines = publicPairs.map((row) =>
    JSON.stringify({
      claim_id: String(row.claim_id),
      claim_text: row.claim_text,
      source_title: row.source_title,
      source_abstract: row.source_abstract,
      source_full_text: row.source_full_text || null,
      domain: row.domain || "protein_biology",
    })
  );
  writeFileSync(join(PUBLIC_DIR, "claims.jsonl"), publicLines.join("\n") + "\n");
  console.log(`Wrote ${publicLines.length} claims to data/public/claims.jsonl`);

  // ---------------------------------------------------------------------------
  // Write private ground_truth.jsonl (includes citation state and passage)
  // ---------------------------------------------------------------------------
  const privateLines = privatePairs.map((row) =>
    JSON.stringify({
      claim_id: String(row.claim_id),
      citation_state: row.citation_state,
      confidence: row.confidence,
      source_passage: row.source_passage || null,
      misrepresentation_pattern: row.misrepresentation_pattern || null,
    })
  );
  writeFileSync(
    join(PRIVATE_DIR, "ground_truth.jsonl"),
    privateLines.join("\n") + "\n"
  );
  console.log(
    `Wrote ${privateLines.length} ground truth records to data/private/ground_truth.jsonl`
  );

  // ---------------------------------------------------------------------------
  // Print distribution summary
  // ---------------------------------------------------------------------------
  const stateCounts = {};
  for (const row of privatePairs) {
    stateCounts[row.citation_state] = (stateCounts[row.citation_state] || 0) + 1;
  }
  console.log("\nGround truth citation state distribution:");
  for (const [state, count] of Object.entries(stateCounts)) {
    console.log(`  ${state}: ${count}`);
  }
}

main().catch((err) => {
  console.error("Dataset generation failed:", err.message);
  process.exit(1);
});
