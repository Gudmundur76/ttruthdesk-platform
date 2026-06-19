/**
 * alphafoldAdapter.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * AlphaFold Database API helper for structural prediction verification.
 *
 * Queries the AlphaFold DB API (no auth required) to retrieve pLDDT confidence
 * scores for a protein's predicted structure. Used to corroborate claims about
 * predicted protein structures.
 *
 * API docs: https://alphafold.ebi.ac.uk/api-docs
 *
 * Verdict logic (per todo.md Phase 137):
 *   - pLDDT > 70 for claimed region → "Supported"
 *   - pLDDT 50–70 → "Ambiguous"
 *   - pLDDT < 50 → "Ambiguous" (low confidence region)
 *   - protein not found → "Insufficient Evidence"
 */

const ALPHAFOLD_API = "https://alphafold.ebi.ac.uk/api/prediction";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AlphaFoldEntry {
  uniprotAccession: string;
  entryId: string;
  /** Mean pLDDT across all residues (0–100) */
  meanPlddt: number;
  /** Number of residues in the model */
  residueCount: number;
  /** URL to the CIF structure file */
  cifUrl: string;
  /** URL to the pLDDT scores JSON */
  paeImageUrl: string | null;
}

export interface AlphaFoldResult {
  found: boolean;
  entry: AlphaFoldEntry | null;
  error: string | null;
}

export interface AlphaFoldVerdict {
  verdict: "Supported" | "Ambiguous" | "Insufficient Evidence";
  rationale: string;
  confidenceScore: number;
  evidenceUrl: string | null;
  evidenceRaw: AlphaFoldEntry | null;
}

// ─── API call ─────────────────────────────────────────────────────────────────

/**
 * Fetch AlphaFold prediction entry for a UniProt accession.
 * Returns null if the protein has no AlphaFold prediction.
 */
export async function fetchAlphaFoldEntry(
  uniprotAccession: string
): Promise<AlphaFoldResult> {
  const url = `${ALPHAFOLD_API}/${uniprotAccession}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (res.status === 404) {
      return {
        found: false,
        entry: null,
        error: `No AlphaFold prediction for ${uniprotAccession}`,
      };
    }
    if (!res.ok) {
      return {
        found: false,
        entry: null,
        error: `AlphaFold API error: ${res.status}`,
      };
    }
    const data = await res.json();
    // API returns an array; take the first entry
    const raw = Array.isArray(data) ? data[0] : data;
    if (!raw) {
      return { found: false, entry: null, error: "Empty response from AlphaFold API" };
    }
    const entry: AlphaFoldEntry = {
      uniprotAccession,
      entryId: (raw.entryId as string) ?? "",
      meanPlddt: parseFloat(raw.meanPlddt ?? raw.plddt ?? "0"),
      residueCount: parseInt(raw.uniprotEnd ?? raw.residueCount ?? "0", 10),
      cifUrl: (raw.cifUrl as string) ?? "",
      paeImageUrl: (raw.paeImageUrl as string | null) ?? null,
    };
    return { found: true, entry, error: null };
  } catch (err) {
    return {
      found: false,
      entry: null,
      error: `AlphaFold fetch failed: ${String(err)}`,
    };
  }
}

// ─── Verdict logic ────────────────────────────────────────────────────────────

/**
 * Verify a structural prediction claim using AlphaFold pLDDT scores.
 *
 * @param uniprotAccession  UniProt accession code (e.g. "P68871")
 * @param claimText         The original claim text (for rationale)
 */
export async function verifyStructurePredictionViaAlphaFold(
  uniprotAccession: string,
  claimText: string
): Promise<AlphaFoldVerdict> {
  const result = await fetchAlphaFoldEntry(uniprotAccession);

  if (!result.found || !result.entry) {
    return {
      verdict: "Insufficient Evidence",
      rationale: result.error ?? `No AlphaFold prediction found for ${uniprotAccession}`,
      confidenceScore: 0.1,
      evidenceUrl: null,
      evidenceRaw: null,
    };
  }

  const { entry } = result;
  const plddt = entry.meanPlddt;
  const evidenceUrl = `https://alphafold.ebi.ac.uk/entry/${uniprotAccession}`;

  // pLDDT thresholds per todo.md Phase 137 spec
  if (plddt > 70) {
    return {
      verdict: "Supported",
      rationale: `AlphaFold prediction for ${uniprotAccession} has mean pLDDT ${plddt.toFixed(1)} (>70 = high confidence). Claim: "${claimText.substring(0, 120)}"`,
      confidenceScore: Math.min(1.0, 0.6 + (plddt - 70) / 100),
      evidenceUrl,
      evidenceRaw: entry,
    };
  }

  if (plddt >= 50) {
    return {
      verdict: "Ambiguous",
      rationale: `AlphaFold prediction for ${uniprotAccession} has mean pLDDT ${plddt.toFixed(1)} (50–70 = low confidence region). Claim: "${claimText.substring(0, 120)}"`,
      confidenceScore: 0.35 + (plddt - 50) / 200,
      evidenceUrl,
      evidenceRaw: entry,
    };
  }

  return {
    verdict: "Ambiguous",
    rationale: `AlphaFold prediction for ${uniprotAccession} has mean pLDDT ${plddt.toFixed(1)} (<50 = very low confidence). Structural prediction claim cannot be reliably verified.`,
    confidenceScore: 0.2,
    evidenceUrl,
    evidenceRaw: entry,
  };
}

// ─── UniProt accession extraction ─────────────────────────────────────────────

/**
 * Extract UniProt accession codes from free text.
 * Standard format: [A-NR-Z][0-9][A-Z][A-Z0-9]{2}[0-9] (6 chars)
 *               or [O-Q][0-9][A-Z0-9]{3}[0-9] (6 chars)
 * Extended: same patterns with optional isoform suffix (-[0-9]+)
 */
const UNIPROT_ACCESSION_RE =
  /\b([A-NR-Z][0-9][A-Z][A-Z0-9]{2}[0-9]|[O-Q][0-9][A-Z0-9]{3}[0-9])(?:-\d+)?\b/g;

export function extractUniProtAccessions(text: string): string[] {
  const matches = Array.from(text.matchAll(UNIPROT_ACCESSION_RE));
  return Array.from(new Set(matches.map((m) => m[1])));
}
