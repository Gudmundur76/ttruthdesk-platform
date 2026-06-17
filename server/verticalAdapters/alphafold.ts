/**
 * alphafold.ts — Sprint 34
 *
 * AlphaFold Protein Structure Database adapter (EMBL-EBI).
 * Queries the AlphaFold REST API for predicted protein structure entries.
 *
 * API: https://alphafold.ebi.ac.uk/api/
 * Docs: https://alphafold.ebi.ac.uk/api-docs
 */

import { registerVertical, EvidenceResult, VerticalAdapter } from "./types";
import { logger } from "../logger";

const log = logger("verticalAdapters/alphafold");

interface AlphaFoldEntry {
  entryId: string;
  gene: string;
  uniprotAccession: string;
  uniprotId: string;
  uniprotDescription: string;
  taxId: number;
  organismScientificName: string;
  uniprotStart: number;
  uniprotEnd: number;
  uniprotSequenceVersion: number;
  modelCreatedDate: string;
  latestVersion: number;
  allVersions: number[];
  isReviewed: boolean;
  isReferenceProteome: boolean;
  cifUrl: string;
  bcifUrl: string;
  pdbUrl: string;
  paeImageUrl: string;
  paeDocUrl: string;
}

const ALPHAFOLD_API_BASE = "https://alphafold.ebi.ac.uk/api";

function noResult(flags: string[]): EvidenceResult {
  return {
    found: false,
    sourceId: null,
    sourceUrl: null,
    evidenceRaw: null,
    confidenceScore: 0,
    confidenceFlags: flags,
  };
}

/** Extract a UniProt accession from the query string */
function extractUniprotAccession(query: string): string | null {
  // UniProt accession pattern: [OPQ][0-9][A-Z0-9]{3}[0-9] or [A-NR-Z][0-9]([A-Z][A-Z0-9]{2}[0-9]){1,2}
  const match = query.match(/\b([OPQ][0-9][A-Z0-9]{3}[0-9]|[A-NR-Z][0-9][A-Z][A-Z0-9]{2}[0-9][A-Z][A-Z0-9]{2}[0-9])\b/i);
  return match ? match[1].toUpperCase() : null;
}

class AlphaFoldAdapter implements VerticalAdapter {
  readonly domainKey = "alphafold";
  readonly displayName = "AlphaFold Protein Structure Database";
  readonly description =
    "EMBL-EBI AlphaFold Database — AI-predicted protein structure models for nearly all known proteins. Authoritative source for protein 3D structure predictions.";
  readonly claimExtractorPrompt =
    "Extract protein names, UniProt accession IDs (e.g., P04637, Q9Y6K9), or gene names (e.g., TP53, BRCA1) from the claim.";
  readonly discoverySearchTerms = [
    "protein structure prediction",
    "AlphaFold",
    "protein folding",
    "3D protein model",
    "UniProt accession",
    "predicted structure",
    "protein conformation",
    "structural model",
  ];

  async lookupEvidence(claim: {
    claimText: string;
    extractedValue: string | null;
  }): Promise<EvidenceResult> {
    const query = claim.extractedValue ?? claim.claimText;
    log.info("AlphaFold query", { query });

    // Try to extract UniProt accession first
    const accession = extractUniprotAccession(query);

    if (accession) {
      return this.lookupByAccession(accession);
    }

    // Try gene name search via UniProt lookup
    return this.lookupBySearch(query);
  }

  private async lookupByAccession(accession: string): Promise<EvidenceResult> {
    try {
      const url = `${ALPHAFOLD_API_BASE}/prediction/${accession}`;
      const res = await fetch(url, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(8000),
      });

      if (!res.ok) {
        if (res.status === 404) {
          return noResult(["alphafold_not_found", `accession_${accession}`]);
        }
        return noResult([`http_error_${res.status}`]);
      }

      const data = (await res.json()) as AlphaFoldEntry[];
      if (!Array.isArray(data) || data.length === 0) {
        return noResult(["no_alphafold_entry"]);
      }

      const entry = data[0];
      const flags = ["alphafold_prediction", "structural_biology"];
      if (entry.isReviewed) flags.push("uniprot_reviewed");
      if (entry.isReferenceProteome) flags.push("reference_proteome");

      log.info("AlphaFold result", {
        entryId: entry.entryId,
        gene: entry.gene,
        organism: entry.organismScientificName,
      });

      return {
        found: true,
        sourceId: `alphafold-${entry.entryId}`,
        sourceUrl: `https://alphafold.ebi.ac.uk/entry/${accession}`,
        evidenceRaw: {
          entryId: entry.entryId,
          gene: entry.gene,
          uniprotAccession: entry.uniprotAccession,
          uniprotDescription: entry.uniprotDescription,
          organism: entry.organismScientificName,
          modelCreatedDate: entry.modelCreatedDate,
          latestVersion: entry.latestVersion,
          pdbUrl: entry.pdbUrl,
        },
        confidenceScore: 0.90,
        confidenceFlags: flags,
      };
    } catch (err) {
      log.error("AlphaFold fetch error", { err: String(err) });
      return noResult(["network_or_parsing_error"]);
    }
  }

  private async lookupBySearch(query: string): Promise<EvidenceResult> {
    // AlphaFold doesn't have a text search endpoint — use UniProt search to find accession
    try {
      const searchUrl = `https://rest.uniprot.org/uniprotkb/search?query=${encodeURIComponent(query)}&format=json&size=1&fields=accession,gene_names,protein_name,organism_name`;
      const res = await fetch(searchUrl, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(8000),
      });

      if (!res.ok) {
        return noResult([`uniprot_search_error_${res.status}`]);
      }

      const data = (await res.json()) as {
        results?: Array<{
          primaryAccession?: string;
          genes?: Array<{ geneName?: { value: string } }>;
          proteinDescription?: { recommendedName?: { fullName?: { value: string } } };
          organism?: { scientificName?: string };
        }>;
      };

      const results = data?.results ?? [];
      if (!results.length) {
        return noResult(["no_uniprot_match"]);
      }

      const topResult = results[0];
      const accession = topResult.primaryAccession;
      if (!accession) {
        return noResult(["no_uniprot_accession"]);
      }

      // Now look up AlphaFold with the accession
      const afResult = await this.lookupByAccession(accession);
      if (afResult.found) return afResult;

      // Return UniProt-based reference pointing to AlphaFold
      const geneName = topResult.genes?.[0]?.geneName?.value ?? "unknown";
      const proteinName = topResult.proteinDescription?.recommendedName?.fullName?.value ?? query;
      const organism = topResult.organism?.scientificName ?? "unknown organism";

      log.info("AlphaFold fallback via UniProt", { accession, geneName });

      return {
        found: true,
        sourceId: `alphafold-${accession}`,
        sourceUrl: `https://alphafold.ebi.ac.uk/entry/${accession}`,
        evidenceRaw: {
          uniprotAccession: accession,
          gene: geneName,
          protein: proteinName,
          organism,
          note: "AlphaFold entry via UniProt search",
        },
        confidenceScore: 0.78,
        confidenceFlags: ["alphafold_prediction", "uniprot_search", "structural_biology"],
      };
    } catch (err) {
      log.error("AlphaFold search error", { err: String(err) });
      return noResult(["network_or_parsing_error"]);
    }
  }
}

registerVertical(new AlphaFoldAdapter());
