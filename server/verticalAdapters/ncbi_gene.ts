import { registerVertical, EvidenceResult, VerticalAdapter } from './types';
import { logger, errData } from "../logger";

const log = logger("verticalAdapters/ncbi_gene");
const EUTILS_BASE = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';
const USER_AGENT = 'citation-engine/1.0 (citation-engine@citation.is)';
const TOOL = 'citation-engine';
const EMAIL = 'citation-engine@citation.is';

type GeneRecord = {
  name?: string;
  description?: string;
  summary?: string;
  organism?: { scientificname?: string };
  chromosome?: string;
  status?: string;
};

async function esearch(term: string): Promise<string | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 12_000);
  try {
    const url = `${EUTILS_BASE}/esearch.fcgi?db=gene&term=${encodeURIComponent(term)}&retmode=json&retmax=1&tool=${TOOL}&email=${EMAIL}`;
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' } });
    clearTimeout(t);
    if (!res.ok) return null;
    const data = await res.json() as { esearchresult?: { idlist?: string[] } };
    return data.esearchresult?.idlist?.[0] ?? null;
  } catch {
    clearTimeout(t);
    return null;
  }
}

async function esummary(geneId: string): Promise<GeneRecord | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const url = `${EUTILS_BASE}/esummary.fcgi?db=gene&id=${geneId}&retmode=json&tool=${TOOL}&email=${EMAIL}`;
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' } });
    clearTimeout(t);
    if (!res.ok) return null;
    const data = await res.json() as { result?: Record<string, GeneRecord> };
    return data.result?.[geneId] ?? null;
  } catch {
    clearTimeout(t);
    return null;
  }
}

function scoreGeneRecord(record: GeneRecord): { confidenceScore: number; confidenceFlags: string[] } {
  const geneName = record.name ?? 'Unknown';
  const organism = record.organism?.scientificname ?? 'Unknown';
  const chromosome = record.chromosome ?? null;
  const description = record.description ?? '';
  const hasSummary = !!record.summary;
  const isDiscontinued = record.status === 'discontinued';

  const confidenceFlags: string[] = [`Gene: ${geneName}`, `Organism: ${organism}`];
  if (chromosome) confidenceFlags.push(`Chromosome: ${chromosome}`);
  if (description) confidenceFlags.push(description.slice(0, 80));

  let confidenceScore = 0.75;
  if (hasSummary) { confidenceScore = 0.85; confidenceFlags.push('Curated gene summary available'); }
  if (isDiscontinued) { confidenceScore = 0.40; confidenceFlags.push('Gene record discontinued'); }
  return { confidenceScore, confidenceFlags };
}

/**
 * NCBI Gene adapter.
 * Provides gene function, expression, pathway, and organism data via Entrez E-utilities.
 * Two-step: esearch to find Gene ID, then esummary to get gene details.
 * Sprint 38 — Tier 1 public database expansion.
 */
const ncbiGeneAdapter: VerticalAdapter = {
  domainKey: 'ncbi_gene',
  displayName: 'NCBI Gene',
  description: 'NCBI Gene database — gene function, expression, pathways, chromosomal location, and organism data for 50M+ gene records',
  claimExtractorPrompt: 'Extract gene names (e.g. BRCA1, TP53, EGFR), gene IDs, or protein names from the claim text.',
  discoverySearchTerms: ['gene function', 'gene expression', 'gene mutation', 'oncogene', 'tumor suppressor', 'pathway', 'chromosome'],

  async lookupEvidence(claim: { claimText: string; extractedValue: string | null }): Promise<EvidenceResult> {
    const query = claim.extractedValue || claim.claimText;
    const searchTerm = /\[organism\]|\[homo sapiens\]|\[mus musculus\]/i.test(query)
      ? query
      : `${query}[Gene Name] AND Homo sapiens[Organism]`;

    try {
      const geneId = await esearch(searchTerm);
      if (!geneId) {
        return { found: false, sourceId: null, sourceUrl: null, evidenceRaw: null, confidenceScore: 0.3, confidenceFlags: ['Gene not found in NCBI Gene'] };
      }

      const record = await esummary(geneId);
      if (!record) {
        return { found: false, sourceId: geneId, sourceUrl: `https://www.ncbi.nlm.nih.gov/gene/${geneId}`, evidenceRaw: null, confidenceScore: 0.5, confidenceFlags: ['Gene found, details unavailable'] };
      }

      const { confidenceScore, confidenceFlags } = scoreGeneRecord(record);
      return {
        found: true,
        sourceId: geneId,
        sourceUrl: `https://www.ncbi.nlm.nih.gov/gene/${geneId}`,
        evidenceRaw: record as unknown as Record<string, unknown>,
        confidenceScore,
        confidenceFlags
      };
    } catch (error: unknown) {
      log.error(`Error looking up NCBI Gene for '${query}':`, errData(error));
      return { found: false, sourceId: null, sourceUrl: null, evidenceRaw: null, confidenceScore: 0.2, confidenceFlags: [`Error: ${(error as Error).message}`] };
    }
  }
};

registerVertical(ncbiGeneAdapter);
