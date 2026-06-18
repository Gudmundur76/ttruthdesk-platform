/**
 * pdbLookupAdapter.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Sprint 41: Protein-name → PDB search → deterministic verdict.
 *
 * Handles the large class of structural biology claims that have:
 *   - A protein name (e.g. "carbamoyl phosphate synthetase")
 *   - A resolution value (e.g. 2.1 Å)
 *   - NO explicit PDB ID in the extracted fields
 *
 * Strategy:
 *   1. Search RCSB PDB by protein name (up to 5 candidates)
 *   2. For each candidate, fetch the full entry
 *   3. If resolution is present in the claim, run deterministic matching
 *      (±0.05 Å = Supported, ±0.20 Å = Partially Supported, else Contradicted)
 *   4. If no resolution in claim, return Ambiguous with candidate list
 *   5. For general_molecular claims with no resolution, route to structuralBiology
 *      adapter for UniProt fallback
 *
 * Resolution tolerance constants (match pdbAdapter.ts):
 *   EXACT_TOLERANCE  = 0.05 Å  → Supported
 *   CLOSE_TOLERANCE  = 0.20 Å  → Partially Supported
 */

import { fetchPdbEntry, searchPdbByProteinName } from "./pdbAdapter";
import type { VerdictResult } from "./pdbAdapter";

const EXACT_TOLERANCE = 0.05;
const CLOSE_TOLERANCE = 0.20;

/** Extract a protein name from free-form claim text */
function extractProteinNameFromText(claimText: string): string | null {
  // Remove resolution patterns and PDB-like codes, return the remainder as protein name
  const cleaned = claimText
    .replace(/\bPDB[:\s]*[1-9][A-Z0-9]{3}\b/gi, "")
    .replace(/\b[1-9][A-Z0-9]{3}\b/g, "")
    .replace(/\d+\.?\d*\s*[ÅA](\s+resolution)?/gi, "")
    .replace(/\b(X-ray|cryo-EM|NMR|SAXS|crystallography|crystal\s+structure|structure\s+of)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  // Return up to 80 chars — enough for a protein name, not too long for PDB search
  return cleaned.length > 4 ? cleaned.substring(0, 80) : null;
}

/**
 * Attempt to verify a resolution claim by searching PDB for the protein name.
 * Returns null if the claim cannot be handled (no protein name extractable).
 */
export async function verifyResolutionByProteinSearch(claim: {
  claimText: string;
  proteinName?: string | null;
  resolution?: number | null;
}): Promise<VerdictResult | null> {
  const proteinName = claim.proteinName ?? extractProteinNameFromText(claim.claimText);
  if (!proteinName) return null;
  if (claim.resolution == null) return null;

  const candidates = await searchPdbByProteinName(proteinName, 5);
  if (candidates.length === 0) {
    return {
      verdict: "Insufficient Evidence",
      rationale: `No PDB entries found for protein "${proteinName}". Cannot verify resolution ${claim.resolution} Å.`,
      evidenceUrl: `https://www.rcsb.org/search?query=${encodeURIComponent(proteinName)}`,
      evidenceRaw: null,
    };
  }

  // Fetch all candidates in parallel, find the best resolution match
  const entries = await Promise.allSettled(
    candidates.map(id => fetchPdbEntry(id))
  );

  let bestMatch: { diff: number; pdbId: string; dbRes: number; url: string } | null = null;

  for (const result of entries) {
    if (result.status !== "fulfilled" || !result.value.found) continue;
    const entry = result.value.entry!;
    if (entry.resolution == null) continue;
    const diff = Math.abs(entry.resolution - claim.resolution);
    if (!bestMatch || diff < bestMatch.diff) {
      bestMatch = { diff, pdbId: entry.pdbId, dbRes: entry.resolution, url: entry.url };
    }
  }

  if (!bestMatch) {
    return {
      verdict: "Ambiguous",
      rationale: `Found ${candidates.length} PDB entries for "${proteinName}" (${candidates.slice(0, 3).join(", ")}) but none have resolution data. Cannot verify ${claim.resolution} Å.`,
      evidenceUrl: `https://www.rcsb.org/search?query=${encodeURIComponent(proteinName)}`,
      evidenceRaw: null,
    };
  }

  const { diff, pdbId, dbRes, url } = bestMatch;

  if (diff <= EXACT_TOLERANCE) {
    return {
      verdict: "Supported",
      rationale: `Resolution ${claim.resolution} Å matches PDB ${pdbId} (${dbRes} Å, Δ=${diff.toFixed(2)} Å) for protein "${proteinName}".`,
      evidenceUrl: url,
      evidenceRaw: null,
    };
  }
  if (diff <= CLOSE_TOLERANCE) {
    return {
      verdict: "Partially Supported",
      rationale: `Resolution ${claim.resolution} Å is close to PDB ${pdbId} (${dbRes} Å, Δ=${diff.toFixed(2)} Å) for protein "${proteinName}". May be a different crystal form.`,
      evidenceUrl: url,
      evidenceRaw: null,
    };
  }

  // Best candidate is too far off — ambiguous (could be a different structure)
  return {
    verdict: "Ambiguous",
    rationale: `Best PDB match for "${proteinName}" is ${pdbId} at ${dbRes} Å, but claimed resolution is ${claim.resolution} Å (Δ=${diff.toFixed(2)} Å). Multiple structures may exist.`,
    evidenceUrl: url,
    evidenceRaw: null,
  };
}

/**
 * Verify a protein_name claim by searching PDB and returning Ambiguous
 * with candidate PDB IDs when found (better than Insufficient Evidence).
 */
export async function verifyProteinNameBySearch(claim: {
  claimText: string;
  proteinName?: string | null;
}): Promise<VerdictResult | null> {
  const proteinName = claim.proteinName ?? extractProteinNameFromText(claim.claimText);
  if (!proteinName || proteinName.length < 5) return null;

  const candidates = await searchPdbByProteinName(proteinName, 3);
  if (candidates.length === 0) {
    return {
      verdict: "Insufficient Evidence",
      rationale: `Protein "${proteinName}" not found in RCSB PDB search.`,
      evidenceUrl: `https://www.rcsb.org/search?query=${encodeURIComponent(proteinName)}`,
      evidenceRaw: null,
    };
  }

  return {
    verdict: "Ambiguous",
    rationale: `Protein "${proteinName}" matches ${candidates.length} PDB entries (${candidates.slice(0, 3).join(", ")}). Specific PDB ID required for definitive verification.`,
    evidenceUrl: `https://www.rcsb.org/search?query=${encodeURIComponent(proteinName)}`,
    evidenceRaw: null,
  };
}
