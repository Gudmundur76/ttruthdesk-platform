/**
 * sprint41-reverify-ie-claims.mjs
 * ─────────────────────────────────────────────────────────────────────────────
 * Sprint 41: Targeted claim-level re-verify for Insufficient Evidence claims
 * of types: general_molecular, protein_name, resolution
 *
 * Strategy:
 *   1. Fetch all IE claims of the target types from the DB
 *   2. For each claim, run the new Sprint 41 routing logic
 *   3. Update the verdict in-place (no re-extraction, no new claims)
 *
 * Usage: node scripts/sprint41-reverify-ie-claims.mjs
 */

import mysql from "mysql2/promise";
// Node 22 has native fetch built-in

const DATABASE_URL = process.env.DATABASE_URL;
const BATCH_SIZE = 50;
const CONCURRENCY = 5;
const PDB_SEARCH_API = "https://search.rcsb.org/rcsbsearch/v2/query";
const PDB_DATA_API = "https://data.rcsb.org/rest/v1/core/entry";
const UNIPROT_SEARCH_API = "https://rest.uniprot.org/uniprotkb/search";

const EXACT_TOLERANCE = 0.05;
const CLOSE_TOLERANCE = 0.20;

// ── PDB helpers ────────────────────────────────────────────────────────────

async function searchPdbByProteinName(proteinName, limit = 5) {
  const query = {
    query: {
      type: "terminal",
      service: "full_text",
      parameters: { value: proteinName },
    },
    return_type: "entry",
    request_options: { paginate: { start: 0, rows: limit } },
  };
  try {
    const res = await fetch(PDB_SEARCH_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(query),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data?.result_set?.map(r => r.identifier) ?? [];
  } catch {
    return [];
  }
}

async function fetchPdbResolution(pdbId) {
  try {
    const res = await fetch(`${PDB_DATA_API}/${pdbId.toUpperCase()}`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.rcsb_entry_info?.resolution_combined?.[0] ?? null;
  } catch {
    return null;
  }
}

async function verifyProteinViaUniProt(proteinName) {
  try {
    const url = `${UNIPROT_SEARCH_API}?query=${encodeURIComponent(proteinName)}&format=json&size=1`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    const data = await res.json();
    const result = data?.results?.[0];
    if (!result) return null;
    return {
      accession: result.primaryAccession,
      name: result.uniProtkbId,
      url: `https://www.uniprot.org/uniprotkb/${result.primaryAccession}`,
    };
  } catch {
    return null;
  }
}

// ── Verdict logic ──────────────────────────────────────────────────────────

function extractProteinNameFromText(claimText) {
  const cleaned = claimText
    .replace(/\bPDB[:\s]*[1-9][A-Z0-9]{3}\b/gi, "")
    .replace(/\b[1-9][A-Z0-9]{3}\b/g, "")
    .replace(/\d+\.?\d*\s*[ÅA](\s+resolution)?/gi, "")
    .replace(/\b(X-ray|cryo-EM|NMR|SAXS|crystallography|crystal\s+structure|structure\s+of)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.length > 4 ? cleaned.substring(0, 80) : null;
}

async function verifyResolutionClaim(claim) {
  const proteinName = claim.proteinName ?? extractProteinNameFromText(claim.claimText);
  if (!proteinName || claim.resolution == null) return null;

  const candidates = await searchPdbByProteinName(proteinName, 5);
  if (candidates.length === 0) {
    return {
      verdict: "Insufficient Evidence",
      rationale: `No PDB entries found for protein "${proteinName}". Cannot verify resolution ${claim.resolution} Å.`,
      evidenceUrl: `https://www.rcsb.org/search?query=${encodeURIComponent(proteinName)}`,
    };
  }

  const resolutions = await Promise.allSettled(
    candidates.map(async id => ({ id, res: await fetchPdbResolution(id) }))
  );

  let bestMatch = null;
  for (const r of resolutions) {
    if (r.status !== "fulfilled" || r.value.res == null) continue;
    const diff = Math.abs(r.value.res - claim.resolution);
    if (!bestMatch || diff < bestMatch.diff) {
      bestMatch = { diff, pdbId: r.value.id, dbRes: r.value.res };
    }
  }

  if (!bestMatch) {
    return {
      verdict: "Ambiguous",
      rationale: `Found ${candidates.length} PDB entries for "${proteinName}" but none have resolution data.`,
      evidenceUrl: `https://www.rcsb.org/search?query=${encodeURIComponent(proteinName)}`,
    };
  }

  const { diff, pdbId, dbRes } = bestMatch;
  const url = `https://www.rcsb.org/structure/${pdbId}`;

  if (diff <= EXACT_TOLERANCE) {
    return {
      verdict: "Supported",
      rationale: `Resolution ${claim.resolution} Å matches PDB ${pdbId} (${dbRes} Å, Δ=${diff.toFixed(2)} Å) for protein "${proteinName}".`,
      evidenceUrl: url,
    };
  }
  if (diff <= CLOSE_TOLERANCE) {
    return {
      verdict: "Partially Supported",
      rationale: `Resolution ${claim.resolution} Å is close to PDB ${pdbId} (${dbRes} Å, Δ=${diff.toFixed(2)} Å) for protein "${proteinName}".`,
      evidenceUrl: url,
    };
  }
  return {
    verdict: "Ambiguous",
    rationale: `Best PDB match for "${proteinName}" is ${pdbId} at ${dbRes} Å, but claimed resolution is ${claim.resolution} Å (Δ=${diff.toFixed(2)} Å).`,
    evidenceUrl: url,
  };
}

async function verifyGeneralMolecularClaim(claim) {
  const proteinName = claim.proteinName ?? claim.extractedValue ?? extractProteinNameFromText(claim.claimText);
  if (!proteinName || proteinName.length < 5) return null;

  // Try UniProt first (faster, more reliable for protein names)
  const uniprotResult = await verifyProteinViaUniProt(proteinName);
  if (uniprotResult) {
    return {
      verdict: "Ambiguous",
      rationale: `Protein "${proteinName}" found in UniProt (${uniprotResult.accession}). Specific experimental claim requires PDB verification.`,
      evidenceUrl: uniprotResult.url,
    };
  }

  // Fall back to PDB search
  const candidates = await searchPdbByProteinName(proteinName, 3);
  if (candidates.length === 0) {
    return {
      verdict: "Insufficient Evidence",
      rationale: `Protein "${proteinName}" not found in UniProt or RCSB PDB.`,
      evidenceUrl: `https://www.rcsb.org/search?query=${encodeURIComponent(proteinName)}`,
    };
  }
  return {
    verdict: "Ambiguous",
    rationale: `Protein "${proteinName}" matches ${candidates.length} PDB entries (${candidates.slice(0, 3).join(", ")}). Specific claim requires direct PDB verification.`,
    evidenceUrl: `https://www.rcsb.org/search?query=${encodeURIComponent(proteinName)}`,
  };
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const conn = await mysql.createConnection(DATABASE_URL);
  console.log("Connected to DB");

  // Get total count
  const [[{ total }]] = await conn.execute(
    "SELECT COUNT(*) as total FROM claims WHERE verdict = 'Insufficient Evidence' AND claimType IN ('general_molecular', 'protein_name', 'resolution')"
  );
  console.log(`Total IE claims to re-verify: ${total}`);

  let processed = 0;
  let improved = 0;
  let offset = 0;

  while (offset < total) {
    const [claims] = await conn.execute(
      `SELECT id, claimText, claimType, proteinName, resolution, extractedValue FROM claims WHERE verdict = 'Insufficient Evidence' AND claimType IN ('general_molecular', 'protein_name', 'resolution') ORDER BY id LIMIT ${BATCH_SIZE} OFFSET ${offset}`
    );

    if (claims.length === 0) break;

    // Process in chunks of CONCURRENCY
    for (let i = 0; i < claims.length; i += CONCURRENCY) {
      const chunk = claims.slice(i, i + CONCURRENCY);
      await Promise.all(
        chunk.map(async claim => {
          try {
            let newVerdict = null;

            if (claim.claimType === "resolution") {
              newVerdict = await verifyResolutionClaim(claim);
            } else {
              // general_molecular or protein_name
              newVerdict = await verifyGeneralMolecularClaim(claim);
            }

            if (newVerdict && newVerdict.verdict !== "Insufficient Evidence") {
              await conn.execute(
                "UPDATE claims SET verdict = ?, verdictRationale = ?, pdbEvidenceUrl = ?, pdbEvidenceCheckedAt = NOW(), verdictMethod = 'deterministic_source' WHERE id = ?",
                [newVerdict.verdict, newVerdict.rationale, newVerdict.evidenceUrl, claim.id]
              );
              improved++;
            }
          } catch (err) {
            console.error(`Claim ${claim.id} error:`, err.message);
          }
          processed++;
        })
      );
    }

    offset += BATCH_SIZE;
    console.log(`Progress: ${processed}/${total} processed, ${improved} improved`);
  }

  console.log(`\nDone! Processed: ${processed}, Improved: ${improved}`);

  // Final distribution
  const [dist] = await conn.execute(
    "SELECT verdict, COUNT(*) as cnt FROM claims GROUP BY verdict ORDER BY cnt DESC"
  );
  console.log("\nFinal verdict distribution:");
  dist.forEach(r => console.log(`  ${r.verdict}: ${r.cnt}`));

  await conn.end();
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
