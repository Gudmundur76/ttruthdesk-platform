import { registerVertical, EvidenceResult, VerticalAdapter } from './types';
import { logger, errData } from "../logger";

const log = logger("verticalAdapters/dbsnp");
const VARIATION_API = 'https://api.ncbi.nlm.nih.gov/variation/v0/refsnp';
const EUTILS_BASE = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';
const USER_AGENT = 'citation-engine/1.0 (citation-engine@citation.is)';
const TOOL = 'citation-engine';
const EMAIL = 'citation-engine@citation.is';

type RefSnpData = {
  refsnp_id?: string;
  primary_snapshot_data?: {
    allele_annotations?: Array<{
      assembly_annotation?: Array<{ genes?: Array<{ locus?: string }> }>;
      frequency?: Array<{ allele_count?: number; total_count?: number }>;
      clinical?: Array<{ clinical_significances?: string[]; disease_names?: string[] }>;
    }>;
    variant_type?: string;
  };
};

function extractRsFields(data: RefSnpData): { genes: string[]; clinicalSigs: string[]; maf: number | null; variantType: string | null } {
  const alleleAnnotations = data.primary_snapshot_data?.allele_annotations ?? [];
  const genes: string[] = [];
  const clinicalSigs: string[] = [];
  let maf: number | null = null;
  const variantType = data.primary_snapshot_data?.variant_type ?? null;

  for (const ann of alleleAnnotations) {
    for (const asm of ann.assembly_annotation ?? []) {
      for (const gene of asm.genes ?? []) {
        if (gene.locus) genes.push(gene.locus);
      }
    }
    for (const clin of ann.clinical ?? []) {
      clinicalSigs.push(...(clin.clinical_significances ?? []));
    }
    if (maf === null) {
      const freq = ann.frequency?.[0];
      if (freq?.allele_count != null && freq.total_count) {
        maf = freq.allele_count / freq.total_count;
      }
    }
  }
  return { genes, clinicalSigs, maf, variantType };
}

function scoreRsVariant(genes: string[], clinicalSigs: string[], maf: number | null, variantType: string | null, rsId: string): EvidenceResult {
  const confidenceFlags: string[] = [`rsID: ${rsId}`];
  if (variantType) confidenceFlags.push(`Type: ${variantType}`);
  if (genes.length > 0) confidenceFlags.push(`Gene(s): ${Array.from(new Set(genes)).slice(0, 3).join(', ')}`);
  if (maf !== null) confidenceFlags.push(`MAF: ${(maf * 100).toFixed(3)}%`);
  if (clinicalSigs.length > 0) confidenceFlags.push(`Clinical: ${Array.from(new Set(clinicalSigs)).join(', ')}`);
  if (maf !== null && maf > 0.01) confidenceFlags.push('Common variant (MAF >1%)');

  const isPathogenic = clinicalSigs.some(s => s.toLowerCase().includes('pathogenic'));
  const isBenign = clinicalSigs.some(s => s.toLowerCase().includes('benign'));
  const confidenceScore = isPathogenic ? 0.90 : isBenign ? 0.85 : 0.80;

  return {
    found: true,
    sourceId: rsId,
    sourceUrl: `https://www.ncbi.nlm.nih.gov/snp/${rsId}`,
    evidenceRaw: {} as Record<string, unknown>,
    confidenceScore,
    confidenceFlags
  };
}

async function lookupByRsId(rsNumber: string): Promise<EvidenceResult> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 12_000);

  const res = await fetch(`${VARIATION_API}/${rsNumber}`, {
    signal: controller.signal,
    headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' }
  });
  clearTimeout(timeoutId);

  if (!res.ok) {
    const notFound = res.status === 404;
    return {
      found: false,
      sourceId: notFound ? `rs${rsNumber}` : null,
      sourceUrl: null,
      evidenceRaw: null,
      confidenceScore: 0.3,
      confidenceFlags: [notFound ? 'rsID not found in dbSNP' : `HTTP ${res.status}`]
    };
  }

  const data = await res.json() as RefSnpData;
  const rsId = `rs${data.refsnp_id ?? rsNumber}`;
  const { genes, clinicalSigs, maf, variantType } = extractRsFields(data);
  const result = scoreRsVariant(genes, clinicalSigs, maf, variantType, rsId);
  return { ...result, evidenceRaw: data as unknown as Record<string, unknown> };
}

async function lookupByKeyword(query: string): Promise<EvidenceResult> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 12_000);

  const searchUrl = `${EUTILS_BASE}/esearch.fcgi?db=snp&term=${encodeURIComponent(query)}&retmode=json&retmax=1&tool=${TOOL}&email=${EMAIL}`;
  const res = await fetch(searchUrl, {
    signal: controller.signal,
    headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' }
  });
  clearTimeout(timeoutId);

  if (!res.ok) {
    return { found: false, sourceId: null, sourceUrl: null, evidenceRaw: null, confidenceScore: 0.3, confidenceFlags: [`HTTP ${res.status}`] };
  }

  const data = await res.json() as { esearchresult?: { idlist?: string[]; count?: string } };
  const idList = data.esearchresult?.idlist ?? [];
  const totalCount = parseInt(data.esearchresult?.count ?? '0', 10);

  if (idList.length === 0) {
    return { found: false, sourceId: null, sourceUrl: null, evidenceRaw: null, confidenceScore: 0.3, confidenceFlags: ['No dbSNP variants found'] };
  }

  const rsId = `rs${idList[0]}`;
  return {
    found: true,
    sourceId: rsId,
    sourceUrl: `https://www.ncbi.nlm.nih.gov/snp/${rsId}`,
    evidenceRaw: { topRsId: rsId, totalResults: totalCount } as Record<string, unknown>,
    confidenceScore: 0.65,
    confidenceFlags: [`${totalCount} matching variants`, `Top result: ${rsId}`]
  };
}

/**
 * dbSNP adapter.
 * Covers 1B+ genetic variants with population frequency data, clinical significance,
 * and functional annotations. Supports rsID direct lookup and keyword search.
 * Sprint 38 — Tier 1 public database expansion.
 */
const dbsnpAdapter: VerticalAdapter = {
  domainKey: 'dbsnp',
  displayName: 'dbSNP',
  description: 'NCBI dbSNP — 1 billion+ genetic variants with population frequency, clinical significance, and functional annotations',
  claimExtractorPrompt: 'Extract rsIDs (e.g. rs1234567), variant notation (e.g. BRCA1 c.5266dupC), or gene variant descriptions from the claim text.',
  discoverySearchTerms: ['SNP', 'variant', 'mutation', 'polymorphism', 'allele frequency', 'rsID', 'genetic variant', 'pathogenic variant'],

  async lookupEvidence(claim: { claimText: string; extractedValue: string | null }): Promise<EvidenceResult> {
    const query = claim.extractedValue || claim.claimText;
    const rsIdMatch = query.match(/\brs(\d+)\b/i);

    try {
      return rsIdMatch ? await lookupByRsId(rsIdMatch[1]) : await lookupByKeyword(query);
    } catch (error: unknown) {
      log.error(`Error looking up dbSNP for '${query}':`, errData(error));
      return { found: false, sourceId: null, sourceUrl: null, evidenceRaw: null, confidenceScore: 0.2, confidenceFlags: [`Error: ${(error as Error).message}`] };
    }
  }
};

registerVertical(dbsnpAdapter);
