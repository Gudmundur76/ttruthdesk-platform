/**
 * PDB Evidence Adapter
 * Validates molecular claims against the RCSB Protein Data Bank
 * using the public Search API and Data API (no auth required).
 */

export interface PdbEntry {
  pdbId: string;
  title: string;
  experimentalMethod: string | null;
  resolution: number | null;
  releaseDate: string | null;
  organisms: string[];
  entities: string[];
  ligands: string[];
  url: string;
}

export interface PdbValidationResult {
  found: boolean;
  entry: PdbEntry | null;
  error: string | null;
}

const PDB_DATA_API = "https://data.rcsb.org/rest/v1/core/entry";
const PDB_SEARCH_API = "https://search.rcsb.org/rcsbsearch/v2/query";

/** Fetch a single PDB entry by its 4-character ID */
export async function fetchPdbEntry(pdbId: string): Promise<PdbValidationResult> {
  const id = pdbId.trim().toUpperCase();
  try {
    const res = await fetch(`${PDB_DATA_API}/${id}`, { signal: AbortSignal.timeout(10_000) });
    if (res.status === 404) return { found: false, entry: null, error: "PDB ID not found" };
    if (!res.ok) return { found: false, entry: null, error: `PDB API error: ${res.status}` };

    const data = await res.json();

    // Fetch polymer entities for protein names
    let entities: string[] = [];
    let organisms: string[] = [];
    try {
      const polymerRes = await fetch(
        `https://data.rcsb.org/rest/v1/core/polymer_entity/${id}/1`,
        { signal: AbortSignal.timeout(10_000) }
      );
      if (polymerRes.ok) {
        const polymerData = await polymerRes.json();
        const desc = polymerData?.rcsb_polymer_entity?.pdbx_description;
        if (desc) entities = [desc];
        const orgNames: string[] =
          polymerData?.rcsb_entity_source_organism?.map(
            (o: { ncbi_scientific_name?: string }) => o.ncbi_scientific_name
          ).filter(Boolean) ?? [];
        organisms = orgNames;
      }
    } catch {
      // non-fatal
    }

    // Fetch ligands (non-polymer entities)
    let ligands: string[] = [];
    try {
      const ligRes = await fetch(
        `https://data.rcsb.org/rest/v1/core/nonpolymer_entity/${id}/1`,
        { signal: AbortSignal.timeout(10_000) }
      );
      if (ligRes.ok) {
        const ligData = await ligRes.json();
        const compId = ligData?.pdbx_entity_nonpoly?.comp_id;
        if (compId) ligands = [compId];
      }
    } catch {
      // non-fatal
    }

    const method =
      data?.exptl?.[0]?.method ??
      data?.rcsb_entry_info?.experimental_method ??
      null;

    const resolution =
      data?.rcsb_entry_info?.resolution_combined?.[0] ??
      data?.refine?.[0]?.ls_d_res_high ??
      null;

    const releaseDate =
      data?.rcsb_accession_info?.initial_release_date ??
      data?.struct?.pdbx_descriptor ??
      null;

    const entry: PdbEntry = {
      pdbId: id,
      title: data?.struct?.title ?? data?.entry?.id ?? id,
      experimentalMethod: method,
      resolution: resolution ? parseFloat(String(resolution)) : null,
      releaseDate: releaseDate ? String(releaseDate).substring(0, 10) : null,
      organisms,
      entities,
      ligands,
      url: `https://www.rcsb.org/structure/${id}`,
    };

    return { found: true, entry, error: null };
  } catch (err) {
    return { found: false, entry: null, error: String(err) };
  }
}

/** Search PDB by protein name, returning up to 5 candidate IDs */
export async function searchPdbByProteinName(
  proteinName: string,
  limit = 5
): Promise<string[]> {
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
    return (
      data?.result_set?.map((r: { identifier: string }) => r.identifier) ?? []
    );
  } catch {
    return [];
  }
}

/** Normalise a method string for comparison */
function normaliseMethod(m: string): string {
  return m.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export type VerdictLabel =
  | "Supported"
  | "Contradicted"
  | "Partially Supported"
  | "Ambiguous"
  | "Insufficient Evidence"
  | "Out of Scope"
  | "Needs Expert Review";

export interface VerdictResult {
  verdict: VerdictLabel;
  rationale: string;
  evidenceUrl: string | null;
  evidenceRaw: PdbEntry | null;
}

/** Core verdict logic for a single claim */
export async function verdictForClaim(claim: {
  claimType: string;
  pdbId?: string | null;
  proteinName?: string | null;
  experimentalMethod?: string | null;
  resolution?: number | null;
  organism?: string | null;
  ligand?: string | null;
  extractedValue?: string | null;
}): Promise<VerdictResult> {
  // ── PDB ID claims ──────────────────────────────────────────────────────────
  if (claim.claimType === "pdb_id" && claim.pdbId) {
    const result = await fetchPdbEntry(claim.pdbId);
    if (!result.found) {
      return {
        verdict: "Contradicted",
        rationale: `PDB ID ${claim.pdbId} does not exist in the RCSB Protein Data Bank.`,
        evidenceUrl: `https://www.rcsb.org/structure/${claim.pdbId}`,
        evidenceRaw: null,
      };
    }
    return {
      verdict: "Supported",
      rationale: `PDB ID ${claim.pdbId} exists in RCSB PDB: "${result.entry!.title}".`,
      evidenceUrl: result.entry!.url,
      evidenceRaw: result.entry,
    };
  }

  // ── Experimental method claims ─────────────────────────────────────────────
  if (claim.claimType === "experimental_method" && claim.pdbId && claim.experimentalMethod) {
    const result = await fetchPdbEntry(claim.pdbId);
    if (!result.found) {
      return {
        verdict: "Insufficient Evidence",
        rationale: `Cannot verify method: PDB ID ${claim.pdbId} not found.`,
        evidenceUrl: null,
        evidenceRaw: null,
      };
    }
    const dbMethod = result.entry!.experimentalMethod;
    if (!dbMethod) {
      return {
        verdict: "Ambiguous",
        rationale: `PDB entry ${claim.pdbId} found but experimental method not recorded.`,
        evidenceUrl: result.entry!.url,
        evidenceRaw: result.entry,
      };
    }
    if (
      normaliseMethod(dbMethod).includes(normaliseMethod(claim.experimentalMethod)) ||
      normaliseMethod(claim.experimentalMethod).includes(normaliseMethod(dbMethod))
    ) {
      return {
        verdict: "Supported",
        rationale: `PDB ${claim.pdbId} confirms method: ${dbMethod}.`,
        evidenceUrl: result.entry!.url,
        evidenceRaw: result.entry,
      };
    }
    return {
      verdict: "Contradicted",
      rationale: `Claimed method "${claim.experimentalMethod}" contradicts PDB record "${dbMethod}" for ${claim.pdbId}.`,
      evidenceUrl: result.entry!.url,
      evidenceRaw: result.entry,
    };
  }

  // ── Resolution claims ──────────────────────────────────────────────────────
  if (claim.claimType === "resolution" && claim.pdbId && claim.resolution != null) {
    const result = await fetchPdbEntry(claim.pdbId);
    if (!result.found) {
      return {
        verdict: "Insufficient Evidence",
        rationale: `Cannot verify resolution: PDB ID ${claim.pdbId} not found.`,
        evidenceUrl: null,
        evidenceRaw: null,
      };
    }
    const dbRes = result.entry!.resolution;
    if (dbRes == null) {
      return {
        verdict: "Ambiguous",
        rationale: `PDB ${claim.pdbId} found but resolution not recorded (may be NMR or EM).`,
        evidenceUrl: result.entry!.url,
        evidenceRaw: result.entry,
      };
    }
    const diff = Math.abs(dbRes - claim.resolution);
    if (diff <= 0.05) {
      return {
        verdict: "Supported",
        rationale: `Claimed resolution ${claim.resolution} Å matches PDB record ${dbRes} Å (Δ=${diff.toFixed(2)} Å).`,
        evidenceUrl: result.entry!.url,
        evidenceRaw: result.entry,
      };
    }
    if (diff <= 0.2) {
      return {
        verdict: "Partially Supported",
        rationale: `Claimed resolution ${claim.resolution} Å is close but not exact to PDB record ${dbRes} Å (Δ=${diff.toFixed(2)} Å).`,
        evidenceUrl: result.entry!.url,
        evidenceRaw: result.entry,
      };
    }
    return {
      verdict: "Contradicted",
      rationale: `Claimed resolution ${claim.resolution} Å contradicts PDB record ${dbRes} Å (Δ=${diff.toFixed(2)} Å).`,
      evidenceUrl: result.entry!.url,
      evidenceRaw: result.entry,
    };
  }

  // ── Organism claims ────────────────────────────────────────────────────────
  if (claim.claimType === "organism" && claim.pdbId && claim.organism) {
    const result = await fetchPdbEntry(claim.pdbId);
    if (!result.found) {
      return {
        verdict: "Insufficient Evidence",
        rationale: `Cannot verify organism: PDB ID ${claim.pdbId} not found.`,
        evidenceUrl: null,
        evidenceRaw: null,
      };
    }
    const orgs = result.entry!.organisms.map((o) => o.toLowerCase());
    const claimedOrg = claim.organism.toLowerCase();
    if (orgs.some((o) => o.includes(claimedOrg) || claimedOrg.includes(o))) {
      return {
        verdict: "Supported",
        rationale: `Organism "${claim.organism}" confirmed in PDB ${claim.pdbId}: ${result.entry!.organisms.join(", ")}.`,
        evidenceUrl: result.entry!.url,
        evidenceRaw: result.entry,
      };
    }
    if (orgs.length === 0) {
      return {
        verdict: "Ambiguous",
        rationale: `PDB ${claim.pdbId} found but organism data unavailable.`,
        evidenceUrl: result.entry!.url,
        evidenceRaw: result.entry,
      };
    }
    return {
      verdict: "Contradicted",
      rationale: `Claimed organism "${claim.organism}" not found in PDB ${claim.pdbId} (recorded: ${result.entry!.organisms.join(", ")}).`,
      evidenceUrl: result.entry!.url,
      evidenceRaw: result.entry,
    };
  }

  // ── Protein name claims ────────────────────────────────────────────────────
  if (claim.claimType === "protein_name" && claim.proteinName) {
    const candidates = await searchPdbByProteinName(claim.proteinName, 3);
    if (candidates.length === 0) {
      return {
        verdict: "Insufficient Evidence",
        rationale: `No PDB entries found matching protein name "${claim.proteinName}".`,
        evidenceUrl: null,
        evidenceRaw: null,
      };
    }
    return {
      verdict: "Ambiguous",
      rationale: `Protein name "${claim.proteinName}" matches ${candidates.length} PDB entries (e.g. ${candidates.slice(0, 3).join(", ")}). Specific PDB ID required for definitive verification.`,
      evidenceUrl: `https://www.rcsb.org/search?query=${encodeURIComponent(claim.proteinName)}`,
      evidenceRaw: null,
    };
  }

  // ── Ligand claims ──────────────────────────────────────────────────────────
  if (claim.claimType === "ligand" && claim.pdbId && claim.ligand) {
    const result = await fetchPdbEntry(claim.pdbId);
    if (!result.found) {
      return {
        verdict: "Insufficient Evidence",
        rationale: `Cannot verify ligand: PDB ID ${claim.pdbId} not found.`,
        evidenceUrl: null,
        evidenceRaw: null,
      };
    }
    const ligands = result.entry!.ligands.map((l) => l.toUpperCase());
    if (ligands.some((l) => l === claim.ligand!.toUpperCase())) {
      return {
        verdict: "Supported",
        rationale: `Ligand "${claim.ligand}" confirmed in PDB ${claim.pdbId}.`,
        evidenceUrl: result.entry!.url,
        evidenceRaw: result.entry,
      };
    }
    return {
      verdict: "Needs Expert Review",
      rationale: `Ligand "${claim.ligand}" not found in non-polymer entities for PDB ${claim.pdbId}. Manual expert review recommended.`,
      evidenceUrl: result.entry!.url,
      evidenceRaw: result.entry,
    };
  }

  // ── General molecular / out of scope ──────────────────────────────────────
  return {
    verdict: "Out of Scope",
    rationale:
      "This claim type cannot be automatically verified against the Protein Data Bank. Expert review recommended.",
    evidenceUrl: null,
    evidenceRaw: null,
  };
}
