import { registerVertical, EvidenceResult, VerticalAdapter } from './types';
import { logger, errData } from "../logger";

const log = logger("verticalAdapters/omim");
const OMIM_API_BASE = 'https://api.omim.org/api';
const USER_AGENT = 'citation-engine/1.0 (citation-engine@citation.is)';

type OmimEntry = {
  mimNumber?: number;
  titles?: { preferredTitle?: string };
  textSectionList?: Array<{ textSection?: { textSectionName?: string } }>;
  clinicalSynopsis?: { inheritance?: string[] };
};

async function fetchOmimEntry(mimNumber: string, apiKey: string): Promise<OmimEntry | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const res = await fetch(
      `${OMIM_API_BASE}/entry?mimNumber=${mimNumber}&include=text,clinicalSynopsis&format=json&apiKey=${apiKey}`,
      { signal: ctrl.signal, headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' } }
    );
    clearTimeout(t);
    if (!res.ok) return null;
    const data = await res.json() as { omim?: { entryList?: Array<{ entry?: OmimEntry }> } };
    return data.omim?.entryList?.[0]?.entry ?? null;
  } catch {
    clearTimeout(t);
    return null;
  }
}

async function searchOmim(query: string, apiKey: string): Promise<string | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 12_000);
  try {
    const res = await fetch(
      `${OMIM_API_BASE}/entry/search?search=${encodeURIComponent(query)}&include=text&format=json&start=0&limit=1&apiKey=${apiKey}`,
      { signal: ctrl.signal, headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' } }
    );
    clearTimeout(t);
    if (!res.ok) return null;
    const data = await res.json() as { omim?: { searchResponse?: { entryList?: Array<{ entry?: { mimNumber?: number } }> } } };
    const mim = data.omim?.searchResponse?.entryList?.[0]?.entry?.mimNumber;
    return mim ? String(mim) : null;
  } catch {
    clearTimeout(t);
    return null;
  }
}

function scoreOmimEntry(entry: OmimEntry): { confidenceScore: number; confidenceFlags: string[] } {
  const title = entry.titles?.preferredTitle ?? 'Unknown';
  const inheritance = entry.clinicalSynopsis?.inheritance ?? [];
  const hasTextSections = (entry.textSectionList?.length ?? 0) > 0;
  const confidenceFlags: string[] = [`OMIM: ${title.slice(0, 80)}`];
  if (inheritance.length > 0) confidenceFlags.push(`Inheritance: ${inheritance.join(', ')}`);
  if (hasTextSections) confidenceFlags.push('Full OMIM entry with text sections');
  return { confidenceScore: hasTextSections ? 0.85 : 0.70, confidenceFlags };
}

/**
 * OMIM (Online Mendelian Inheritance in Man) adapter.
 * Provides gene-disease associations for Mendelian disorders.
 * Requires OMIM_API_KEY env var — gracefully returns not-found if key is absent.
 * Sprint 38 — Tier 1 public database expansion.
 */
const omimAdapter: VerticalAdapter = {
  domainKey: 'omim',
  displayName: 'OMIM',
  description: 'OMIM — Online Mendelian Inheritance in Man: gene-disease associations, inheritance patterns, and molecular basis for 25,000+ genetic disorders',
  claimExtractorPrompt: 'Extract gene names (e.g. BRCA1, CFTR, HTT), MIM numbers (6-digit codes), or disease names from the claim text.',
  discoverySearchTerms: ['genetic disorder', 'Mendelian', 'gene-disease', 'inheritance', 'autosomal dominant', 'autosomal recessive', 'X-linked', 'MIM'],

  async lookupEvidence(claim: { claimText: string; extractedValue: string | null }): Promise<EvidenceResult> {
    const apiKey = process.env.OMIM_API_KEY ?? null;
    if (!apiKey) {
      return { found: false, sourceId: null, sourceUrl: null, evidenceRaw: null, confidenceScore: 0.3, confidenceFlags: ['OMIM_API_KEY not configured'] };
    }

    const query = claim.extractedValue || claim.claimText;
    const mimMatch = query.match(/\b(\d{6})\b/);

    try {
      const mimNumber: string | null = mimMatch ? mimMatch[1] : await searchOmim(query, apiKey);
      if (!mimNumber) {
        return { found: false, sourceId: null, sourceUrl: null, evidenceRaw: null, confidenceScore: 0.3, confidenceFlags: ['Not found in OMIM'] };
      }

      const entry = await fetchOmimEntry(mimNumber, apiKey);
      if (!entry) {
        return { found: false, sourceId: mimNumber, sourceUrl: `https://omim.org/entry/${mimNumber}`, evidenceRaw: null, confidenceScore: 0.5, confidenceFlags: ['OMIM entry found, details unavailable'] };
      }

      const { confidenceScore, confidenceFlags } = scoreOmimEntry(entry);
      return {
        found: true,
        sourceId: mimNumber,
        sourceUrl: `https://omim.org/entry/${mimNumber}`,
        evidenceRaw: entry as unknown as Record<string, unknown>,
        confidenceScore,
        confidenceFlags
      };
    } catch (error: unknown) {
      log.error(`Error looking up OMIM for '${query}':`, errData(error));
      return { found: false, sourceId: null, sourceUrl: null, evidenceRaw: null, confidenceScore: 0.2, confidenceFlags: [`Error: ${(error as Error).message}`] };
    }
  }
};

registerVertical(omimAdapter);
