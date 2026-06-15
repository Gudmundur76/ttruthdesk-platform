/**
 * export-opencitations.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Exports citation.is claim metadata in OpenCitations CSV format for manual
 * deposit at https://opencitations.net/deposit
 *
 * OpenCitations CSV format (COCI/CROCI):
 *   citing,cited,creation,timespan,journal_sc,author_sc
 *
 * For citation.is we export:
 *   - citing: the claim's source DOI (the paper that makes the claim)
 *   - cited:  the evidence DOI (the paper that supports/refutes the claim)
 *   - creation: the claim's createdAt date
 *   - timespan: empty (we don't track citation timespan)
 *   - journal_sc: false (not self-citation)
 *   - author_sc:  false (not self-citation)
 *
 * Usage:
 *   npx tsx scripts/export-opencitations.ts > opencitations-deposit.csv
 *
 * Then submit the CSV at: https://opencitations.net/deposit
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { db } from "../server/db.js";
import { claims, pubmedResults } from "../drizzle/schema.js";
import { eq, isNotNull, sql } from "drizzle-orm";
import { createWriteStream } from "fs";
import { join } from "path";

const OUTPUT_FILE = join(process.cwd(), "opencitations-deposit.csv");

interface OpenCitationsRow {
  citing: string;
  cited: string;
  creation: string;
  timespan: string;
  journal_sc: "true" | "false";
  author_sc: "true" | "false";
}

function formatDate(d: Date | string | null): string {
  if (!d) return "";
  const date = d instanceof Date ? d : new Date(d);
  return date.toISOString().split("T")[0] ?? "";
}

function normaliseDoi(doi: string | null | undefined): string {
  if (!doi) return "";
  // Strip URL prefix if present
  return doi.replace(/^https?:\/\/doi\.org\//i, "").trim();
}

async function main() {
  console.error("Fetching claims with source DOIs from citation.is...");

  // Get all claims that have a source DOI and at least one evidence DOI
  const claimsWithEvidence = await db
    .select({
      claimId: claims.id,
      sourceDoi: claims.sourceDoi,
      createdAt: claims.createdAt,
      evidenceDois: sql<string[]>`
        COALESCE(
          JSON_ARRAYAGG(${pubmedResults.doi}),
          JSON_ARRAY()
        )
      `,
    })
    .from(claims)
    .leftJoin(pubmedResults, eq(pubmedResults.claimId, claims.id))
    .where(isNotNull(claims.sourceDoi))
    .groupBy(claims.id, claims.sourceDoi, claims.createdAt);

  const rows: OpenCitationsRow[] = [];

  for (const claim of claimsWithEvidence) {
    const citing = normaliseDoi(claim.sourceDoi);
    if (!citing) continue;

    const creation = formatDate(claim.createdAt);
    const evidenceDois = (claim.evidenceDois ?? []).filter(Boolean);

    if (evidenceDois.length === 0) {
      // No evidence DOIs — still export the source DOI with empty cited
      // (useful for OpenCitations to know the paper exists in our corpus)
      rows.push({
        citing,
        cited: "",
        creation,
        timespan: "",
        journal_sc: "false",
        author_sc: "false",
      });
    } else {
      for (const evidenceDoi of evidenceDois) {
        const cited = normaliseDoi(evidenceDoi);
        if (!cited || cited === citing) continue; // skip self-citations
        rows.push({
          citing,
          cited,
          creation,
          timespan: "",
          journal_sc: "false",
          author_sc: "false",
        });
      }
    }
  }

  // Write CSV
  const out = createWriteStream(OUTPUT_FILE);
  out.write("citing,cited,creation,timespan,journal_sc,author_sc\n");
  for (const row of rows) {
    out.write(
      `"${row.citing}","${row.cited}","${row.creation}","${row.timespan}","${row.journal_sc}","${row.author_sc}"\n`
    );
  }
  out.end();

  console.error(`✅ Exported ${rows.length} citation rows to ${OUTPUT_FILE}`);
  console.error("");
  console.error("Next steps:");
  console.error("  1. Review the CSV: head -20 opencitations-deposit.csv");
  console.error("  2. Submit at: https://opencitations.net/deposit");
  console.error("  3. Email deposit@opencitations.net with subject:");
  console.error(
    '     "citation.is — Open Registry of Verified Scientific Claims — Deposit Request"'
  );
}

main().catch(err => {
  console.error("Error:", err);
  process.exit(1);
});
