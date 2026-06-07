/**
 * verticalAdapters/uniprotVertical.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * UniProt vertical adapter — verifies protein identity claims against the
 * UniProt Knowledge Base (UniProtKB).
 *
 * Source contract:
 *   - Schema: accession, proteinName, geneName, organism, reviewed (Swiss-Prot)
 *   - Health check: GET https://rest.uniprot.org/uniprotkb/search?query=P69905&size=1
 *   - Failure mode: "degrade" — falls back to Insufficient Evidence on API error
 *   - Approval: whitelisted (Priority 2, Source Whitelist Expansion)
 *
 * Deterministic verdict rules:
 *   - protein_name: Swiss-Prot reviewed match → Supported; TrEMBL only → Partially Supported; not found → Insufficient Evidence
 *   - organism: organism confirmed in top results → Supported; not found → Contradicted
 *   - function: function keyword present in reviewed entry → Supported; absent → Insufficient Evidence
 */
import { registerVertical, type VerticalAdapter, type EvidenceResult } from "./types";
import { searchUniProt, verifyProteinViaUniProt } from "../uniprotAdapter";

// ─── Deterministic verdict helpers ────────────────────────────────────────────

function verdictForProteinName(
  proteinName: string,
  reviewed: boolean,
  found: boolean
): { confidenceScore: number; flags: string[] } {
  if (!found) {
    return { confidenceScore: 0.0, flags: [`Protein "${proteinName}" not found in UniProtKB`] };
  }
  if (reviewed) {
    return {
      confidenceScore: 0.95,
      flags: [`Swiss-Prot reviewed entry confirmed for "${proteinName}"`],
    };
  }
  return {
    confidenceScore: 0.65,
    flags: [`TrEMBL unreviewed entry found for "${proteinName}" — not Swiss-Prot curated`],
  };
}

function verdictForOrganism(
  organism: string,
  found: boolean,
  confirmed: boolean
): { confidenceScore: number; flags: string[] } {
  if (!found) {
    return { confidenceScore: 0.0, flags: [`Organism "${organism}" not found in UniProtKB`] };
  }
  if (confirmed) {
    return {
      confidenceScore: 0.92,
      flags: [`Organism "${organism}" confirmed in UniProtKB`],
    };
  }
  return {
    confidenceScore: 0.15,
    flags: [`Organism "${organism}" not confirmed in top UniProtKB results`],
  };
}

// ─── Adapter implementation ────────────────────────────────────────────────────

const uniprotVerticalAdapter: VerticalAdapter = {
  domainKey: "uniprot",
  displayName: "UniProt (Protein Identity)",
  description:
    "Verifies protein identity claims (protein names, gene names, organism associations, " +
    "functional annotations) against the UniProt Knowledge Base (UniProtKB). " +
    "Prioritises Swiss-Prot reviewed entries for maximum confidence.",

  claimExtractorPrompt: `
You are a protein identity claim extractor. Extract every verifiable protein identity claim from the text.
Focus on:
- Protein names (e.g. "haemoglobin", "lysozyme", "insulin", "BRCA1 protein")
- Gene names (e.g. "HBB gene", "LYZ gene", "INS gene")
- Organism associations (e.g. "human haemoglobin", "E. coli lysozyme")
- Functional annotations (e.g. "oxygen transport protein", "antimicrobial enzyme")
- UniProt accession numbers (e.g. "P69905", "P00698")

For each claim, extract:
- claimText: the full claim sentence
- claimType: one of "protein_name", "gene_name", "organism", "function", "uniprot_accession"
- extractedValue: the specific protein name, gene name, organism, or accession

Return JSON array of claims.
`,

  async lookupEvidence(claim: {
    claimText: string;
    extractedValue: string | null;
  }): Promise<EvidenceResult> {
    const query = claim.extractedValue ?? claim.claimText;

    // Detect claim type from the claim text
    const isOrganismClaim =
      /\b(human|mouse|rat|bovine|E\.?\s*coli|yeast|bacterial|mammalian|plant|viral)\b/i.test(
        claim.claimText
      );

    try {
      if (isOrganismClaim) {
        // Extract protein name and organism separately
        const orgMatch = claim.claimText.match(
          /\b(human|mouse|rat|bovine|E\.?\s*coli|yeast|bacterial|mammalian|plant|viral)\b/i
        );
        const organism = orgMatch?.[0] ?? null;
        const result = await verifyProteinViaUniProt(query, organism);
        const { confidenceScore, flags } = verdictForOrganism(
          organism ?? query,
          result.found,
          result.found && (result.flags.some((f) => f.toLowerCase().includes("confirmed")))
        );
        return {
          found: result.found,
          sourceId: result.sourceId,
          sourceUrl: result.sourceUrl,
          evidenceRaw: { query, organism, flags: result.flags } as Record<string, unknown>,
          confidenceScore,
          confidenceFlags: flags,
        };
      }

      // Default: protein name lookup
      const result = await searchUniProt(query, 5);
      const reviewed = result.entries.find((e) => e.reviewed);
      const primary = reviewed ?? result.entries[0] ?? null;
      const { confidenceScore, flags } = verdictForProteinName(
        query,
        !!reviewed,
        result.found
      );
      return {
        found: result.found,
        sourceId: primary ? `UniProt:${primary.accession}` : null,
        sourceUrl: primary?.url ?? null,
        evidenceRaw: {
          query,
          entries: result.entries.slice(0, 3),
          error: result.error,
        } as Record<string, unknown>,
        confidenceScore,
        confidenceFlags: flags,
      };
    } catch (err) {
      return {
        found: false,
        sourceId: null,
        sourceUrl: null,
        evidenceRaw: null,
        confidenceScore: 0.0,
        confidenceFlags: [`UniProt lookup failed: ${String(err)}`],
      };
    }
  },

  discoverySearchTerms: [
    "protein structure function",
    "enzyme mechanism substrate",
    "receptor ligand binding",
    "signal transduction pathway",
    "protein folding misfolding",
  ],
};

registerVertical(uniprotVerticalAdapter);
export default uniprotVerticalAdapter;

// ─── Health check ──────────────────────────────────────────────────────────────

export async function checkUniProtHealth(): Promise<{
  healthy: boolean;
  latencyMs: number;
  error: string | null;
}> {
  const start = Date.now();
  try {
    const res = await fetch(
      "https://rest.uniprot.org/uniprotkb/search?query=P69905&format=json&size=1",
      { signal: AbortSignal.timeout(8_000) }
    );
    const latencyMs = Date.now() - start;
    if (!res.ok) {
      return { healthy: false, latencyMs, error: `HTTP ${res.status}` };
    }
    const data = await res.json();
    const found = Array.isArray(data?.results) && data.results.length > 0;
    return {
      healthy: found,
      latencyMs,
      error: found ? null : "No results returned for test accession P69905",
    };
  } catch (err) {
    return { healthy: false, latencyMs: Date.now() - start, error: String(err) };
  }
}
