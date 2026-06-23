import { registerVertical, EvidenceResult, VerticalAdapter } from './types';
import { logger, errData } from "../logger";

const log = logger("verticalAdapters/rcsb_pdb");
const PDB_SEARCH_API = 'https://search.rcsb.org/rcsbsearch/v2/query';
const PDB_DATA_API = 'https://data.rcsb.org/rest/v1/core/entry';
const USER_AGENT = 'citation-engine/1.0 (citation-engine@citation.is)';

type PdbEntry = {
  rcsb_entry_info?: { resolution_combined?: number[]; experimental_method?: string; polymer_entity_count_protein?: number };
  struct?: { title?: string };
  citation?: Array<{ pdbx_database_id_doi?: string }>;
};

function scoreXray(resolution: number | null, flags: string[]): number {
  flags.push('X-ray crystallography');
  if (resolution && resolution <= 2.0) { flags.push(`High resolution: ${resolution}Å`); return 0.95; }
  if (resolution && resolution <= 3.0) { flags.push(`Resolution: ${resolution}Å`); return 0.85; }
  if (resolution) flags.push(`Resolution: ${resolution}Å`);
  return 0.75;
}

function scorePdbEntry(entry: PdbEntry): { confidenceScore: number; confidenceFlags: string[] } {
  const method = entry.rcsb_entry_info?.experimental_method ?? null;
  const resolution = entry.rcsb_entry_info?.resolution_combined?.[0] ?? null;
  const proteinCount = entry.rcsb_entry_info?.polymer_entity_count_protein ?? 0;
  const doi = entry.citation?.[0]?.pdbx_database_id_doi ?? null;
  const confidenceFlags: string[] = [];
  let confidenceScore = 0.70;

  if (method === 'X-RAY DIFFRACTION') {
    confidenceScore = scoreXray(resolution ?? null, confidenceFlags);
  } else if (method === 'ELECTRON MICROSCOPY') {
    confidenceFlags.push('Cryo-EM');
    confidenceScore = resolution && resolution <= 3.5 ? 0.92 : 0.85;
    if (resolution) confidenceFlags.push(`Cryo-EM resolution: ${resolution}Å`);
  } else if (method === 'SOLUTION NMR') {
    confidenceFlags.push('NMR');
    confidenceScore = 0.78;
  }

  if (doi) confidenceFlags.push('Peer-reviewed publication');
  if (proteinCount > 0) confidenceFlags.push(`${proteinCount} protein chain(s)`);
  return { confidenceScore, confidenceFlags };
}

async function fetchPdbEntry(entryId: string): Promise<PdbEntry | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const res = await fetch(`${PDB_DATA_API}/${entryId}`, {
      signal: ctrl.signal,
      headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' }
    });
    clearTimeout(t);
    return res.ok ? (res.json() as Promise<PdbEntry>) : null;
  } catch {
    clearTimeout(t);
    return null;
  }
}

async function searchPdbByText(query: string): Promise<{ entryId: string; entryData: PdbEntry } | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 12_000);
  try {
    const res = await fetch(PDB_SEARCH_API, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'User-Agent': USER_AGENT, 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({
        query: { type: 'terminal', service: 'full_text', parameters: { value: query } },
        return_type: 'entry',
        request_options: { paginate: { start: 0, rows: 1 } }
      })
    });
    clearTimeout(t);
    if (!res.ok) return null;
    const result = await res.json() as { result_set?: Array<{ identifier: string }> };
    const entryId = result.result_set?.[0]?.identifier ?? null;
    if (!entryId) return null;
    const entryData = await fetchPdbEntry(entryId);
    return entryData ? { entryId, entryData } : null;
  } catch {
    clearTimeout(t);
    return null;
  }
}

/**
 * RCSB Protein Data Bank (PDB) — direct adapter.
 * Provides experimental 3D protein structures, resolution, experimental method,
 * and binding site data. Complements AlphaFold (predicted) with experimental evidence.
 * Sprint 38 — Tier 1 public database expansion.
 */
const rcsbPdbAdapter: VerticalAdapter = {
  domainKey: 'rcsb_pdb',
  displayName: 'RCSB Protein Data Bank',
  description: 'RCSB PDB — 220,000+ experimentally determined 3D structures of proteins, nucleic acids, and complexes',
  claimExtractorPrompt: 'Extract PDB IDs (4-character alphanumeric codes like 1ABC, 4HHB) or protein names from the claim text.',
  discoverySearchTerms: ['protein structure', 'crystal structure', 'X-ray crystallography', 'cryo-EM', 'binding site', 'active site', 'PDB'],

  async lookupEvidence(claim: { claimText: string; extractedValue: string | null }): Promise<EvidenceResult> {
    const query = claim.extractedValue || claim.claimText;
    const pdbIdMatch = query.match(/\b([1-9][A-Z0-9]{3})\b/i);

    try {
      let entryId: string | null = null;
      let entryData: PdbEntry | null = null;

      if (pdbIdMatch) {
        entryId = pdbIdMatch[1].toUpperCase();
        entryData = await fetchPdbEntry(entryId);
      } else {
        const result = await searchPdbByText(query);
        if (result) { entryId = result.entryId; entryData = result.entryData; }
      }

      if (!entryId || !entryData) {
        return { found: false, sourceId: null, sourceUrl: null, evidenceRaw: null, confidenceScore: 0.2, confidenceFlags: [] };
      }

      const { confidenceScore, confidenceFlags } = scorePdbEntry(entryData);
      return {
        found: true,
        sourceId: entryId,
        sourceUrl: `https://www.rcsb.org/structure/${entryId}`,
        evidenceRaw: entryData as unknown as Record<string, unknown>,
        confidenceScore,
        confidenceFlags
      };
    } catch (error: unknown) {
      log.error(`Error looking up RCSB PDB evidence for '${query}':`, errData(error));
      return { found: false, sourceId: null, sourceUrl: null, evidenceRaw: null, confidenceScore: 0.1, confidenceFlags: [`Error: ${(error as Error).message}`] };
    }
  }
};

registerVertical(rcsbPdbAdapter);
