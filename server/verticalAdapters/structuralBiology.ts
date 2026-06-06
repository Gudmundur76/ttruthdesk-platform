/**
 * verticalAdapters/structuralBiology.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Structural biology vertical: verifies molecular claims against the
 * RCSB Protein Data Bank (PDB).
 *
 * This is the reference implementation — the first and most mature vertical.
 */

import { registerVertical, type VerticalAdapter, type EvidenceResult } from "./types";
import { verifyProteinViaUniProt } from "../uniprotAdapter";

const PDB_ID_RE = /\b([1-9][A-Z0-9]{3})\b/gi;

async function lookupPdb(pdbId: string): Promise<EvidenceResult> {
  try {
    const res = await fetch(`https://data.rcsb.org/rest/v1/core/entry/${pdbId.toUpperCase()}`);
    if (!res.ok) {
      return {
        found: false,
        sourceId: pdbId,
        sourceUrl: null,
        evidenceRaw: null,
        confidenceScore: 0.3,
        confidenceFlags: [`PDB entry ${pdbId} not found (HTTP ${res.status})`],
      };
    }
    const data = await res.json() as Record<string, unknown>;
    return {
      found: true,
      sourceId: pdbId.toUpperCase(),
      sourceUrl: `https://www.rcsb.org/structure/${pdbId.toUpperCase()}`,
      evidenceRaw: data as Record<string, unknown>,
      confidenceScore: 0.95,
      confidenceFlags: [],
    };
  } catch (err) {
    return {
      found: false,
      sourceId: pdbId,
      sourceUrl: null,
      evidenceRaw: null,
      confidenceScore: 0.2,
      confidenceFlags: [`PDB lookup failed: ${String(err)}`],
    };
  }
}

const structuralBiologyAdapter: VerticalAdapter = {
  domainKey: "structural_biology",
  displayName: "Structural Biology",
  description:
    "Verifies molecular claims (crystal structures, cryo-EM, resolution, binding sites) " +
    "against the RCSB Protein Data Bank (PDB). Covers X-ray crystallography, NMR, " +
    "cryo-electron microscopy, and related experimental methods.",

  claimExtractorPrompt: `
You are a structural biology claim extractor. Extract every verifiable molecular claim from the text.
Focus on:
- PDB IDs (4-character alphanumeric codes like 1LYZ, 4HHB, 6VXX)
- Protein names and their structural properties
- Experimental methods: X-ray crystallography, cryo-EM, NMR, SAXS
- Resolution values in Angstroms (e.g. "1.8 Å resolution")
- Organism sources (e.g. "human lysozyme", "E. coli")
- Ligands, cofactors, and binding partners
- Claims about binding affinity confirmed by structural data
For each claim, extract the PDB ID if mentioned, the protein name, the method, and the resolution.
`,

  async lookupEvidence(claim) {
    const matches = Array.from(claim.claimText.matchAll(PDB_ID_RE));
    const extractedId = claim.extractedValue?.match(/^[1-9][A-Z0-9]{3}$/i)?.[0];
    const pdbId = extractedId ?? matches[0]?.[1] ?? null;

    if (!pdbId) {
      // No PDB ID — try UniProt as fallback for protein name verification
      const proteinName = claim.extractedValue ?? claim.claimText.substring(0, 80);
      const uniprotResult = await verifyProteinViaUniProt(proteinName);
      if (uniprotResult.found) {
        return {
          found: true,
          sourceId: uniprotResult.sourceId,
          sourceUrl: uniprotResult.sourceUrl,
          evidenceRaw: null,
          confidenceScore: uniprotResult.confidenceScore,
          confidenceFlags: [
            "No PDB ID found — verified via UniProt instead",
            ...uniprotResult.flags,
          ],
        };
      }
      return {
        found: false,
        sourceId: null,
        sourceUrl: null,
        evidenceRaw: null,
        confidenceScore: 0.2,
        confidenceFlags: [
          "No PDB ID found in claim — cannot perform direct database lookup",
          "Protein name not found in UniProt",
        ],
      };
    }
    return lookupPdb(pdbId);
  },

  discoverySearchTerms: [
    "crystal structure protein[Title/Abstract] AND open access[Filter]",
    "cryo-EM structure[Title/Abstract] AND open access[Filter]",
    "X-ray crystallography protein[Title/Abstract] AND open access[Filter]",
    "protein binding affinity structure[Title/Abstract] AND open access[Filter]",
    "antibody structure PDB[Title/Abstract] AND open access[Filter]",
    "deCODE genetics[Affiliation] AND open access[Filter]",
    "Stefansson K[Author] AND protein[Title/Abstract]",
  ],
};

registerVertical(structuralBiologyAdapter);
export default structuralBiologyAdapter;
