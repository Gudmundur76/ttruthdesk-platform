/**
 * uniprotAdapter.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * UniProt REST API helper for protein identity verification.
 * Queries the UniProt search API (no auth required) to verify protein names,
 * gene names, and organism associations.
 *
 * API docs: https://www.uniprot.org/help/api_queries
 */

const UNIPROT_SEARCH_API = "https://rest.uniprot.org/uniprotkb/search";

export interface UniProtEntry {
  accession: string;
  proteinName: string;
  geneName: string | null;
  organism: string;
  reviewed: boolean; // true = Swiss-Prot (curated), false = TrEMBL
  url: string;
}

export interface UniProtResult {
  found: boolean;
  entries: UniProtEntry[];
  error: string | null;
}

/**
 * Search UniProt for a protein by name, returning up to `limit` entries.
 * Prioritises reviewed (Swiss-Prot) entries.
 */
export async function searchUniProt(
  proteinName: string,
  limit = 3
): Promise<UniProtResult> {
  const encoded = encodeURIComponent(proteinName);
  const url =
    `${UNIPROT_SEARCH_API}?query=${encoded}&format=json&size=${limit}&sort=score`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) {
      return { found: false, entries: [], error: `UniProt API error: ${res.status}` };
    }
    const data = await res.json();
    const results: UniProtEntry[] = (data?.results ?? []).map(
      (r: Record<string, unknown>) => {
        const protDesc =
          (r?.proteinDescription as Record<string, unknown>)?.recommendedName as Record<string, unknown> | undefined;
        const fullName =
          (protDesc?.fullName as Record<string, unknown>)?.value as string | undefined;
        const genes = r?.genes as Array<Record<string, unknown>> | undefined;
        const geneName =
          (genes?.[0]?.geneName as Record<string, unknown>)?.value as string | undefined ?? null;
        const organism =
          (r?.organism as Record<string, unknown>)?.scientificName as string | undefined ?? "Unknown";
        const accession = (r?.primaryAccession as string) ?? "";
        const reviewed =
          (r?.entryType as string)?.includes("reviewed") ?? false;
        return {
          accession,
          proteinName: fullName ?? proteinName,
          geneName,
          organism,
          reviewed,
          url: `https://www.uniprot.org/uniprotkb/${accession}`,
        };
      }
    );
    return { found: results.length > 0, entries: results, error: null };
  } catch (err) {
    return { found: false, entries: [], error: String(err) };
  }
}

/**
 * Verify a protein name claim against UniProt.
 * Returns a confidence score and flags.
 */
export async function verifyProteinViaUniProt(
  proteinName: string,
  organism?: string | null
): Promise<{ found: boolean; confidenceScore: number; flags: string[]; sourceId: string | null; sourceUrl: string | null }> {
  const result = await searchUniProt(proteinName, 5);
  if (!result.found || result.entries.length === 0) {
    return {
      found: false,
      confidenceScore: 0,
      flags: [`Protein "${proteinName}" not found in UniProt`],
      sourceId: null,
      sourceUrl: null,
    };
  }

  const flags: string[] = [];
  let confidenceScore = 0.5;

  // Boost for reviewed (Swiss-Prot curated) entry
  const reviewed = result.entries.find((e) => e.reviewed);
  const primary = reviewed ?? result.entries[0];

  if (primary.reviewed) {
    confidenceScore += 0.25;
    flags.push(`Swiss-Prot reviewed entry: ${primary.accession}`);
  } else {
    flags.push(`TrEMBL unreviewed entry: ${primary.accession}`);
  }

  // Organism match check
  if (organism) {
    const orgLower = organism.toLowerCase();
    const orgMatch = result.entries.some(
      (e) => e.organism.toLowerCase().includes(orgLower) || orgLower.includes(e.organism.toLowerCase())
    );
    if (orgMatch) {
      confidenceScore += 0.15;
      flags.push(`Organism "${organism}" confirmed in UniProt`);
    } else {
      confidenceScore -= 0.10;
      flags.push(`Organism "${organism}" not found in top UniProt results`);
    }
  }

  return {
    found: true,
    confidenceScore: Math.min(1.0, Math.max(0.0, confidenceScore)),
    flags,
    sourceId: `UniProt:${primary.accession}`,
    sourceUrl: primary.url,
  };
}
