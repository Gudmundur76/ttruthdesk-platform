/**
 * verticalAdapters/gutMicrobiome.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Gut Microbiome & Protein vertical adapter.
 *
 * Verifies claims about how dietary protein affects the gut microbiome,
 * and claims about probiotics/prebiotics that interact with protein metabolism.
 *
 * Evidence sources:
 *  1. PubMed — RCTs and observational studies on microbiome + protein
 *  2. NCBI Taxonomy — species validation for probiotic strain claims
 */
import { registerVertical, type VerticalAdapter, type EvidenceResult } from "./types";

// ─── NCBI Taxonomy lookup for probiotic strains ───────────────────────────────

async function validateMicrobialStrain(strainName: string): Promise<{ found: boolean; taxId?: number }> {
  try {
    const encoded = encodeURIComponent(strainName);
    const searchRes = await fetch(
      `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=taxonomy&term=${encoded}&retmax=1&retmode=json`,
      { signal: AbortSignal.timeout(6000) }
    );
    if (!searchRes.ok) return { found: false };
    const data = await searchRes.json() as { esearchresult?: { idlist?: string[]; count?: string } };
    const ids = data.esearchresult?.idlist ?? [];
    if (ids.length === 0) return { found: false };
    return { found: true, taxId: parseInt(ids[0], 10) };
  } catch {
    return { found: false };
  }
}

async function searchMicrobiomeRCTs(query: string): Promise<{ count: number; pmids: string[] }> {
  try {
    const encoded = encodeURIComponent(
      `${query} AND (gut microbiota[mesh] OR gut microbiome[tiab] OR intestinal microbiota[mesh]) AND (randomized controlled trial[pt] OR clinical trial[pt])`
    );
    const res = await fetch(
      `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=${encoded}&retmax=5&retmode=json`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (!res.ok) return { count: 0, pmids: [] };
    const data = await res.json() as { esearchresult?: { idlist?: string[]; count?: string } };
    return {
      count: parseInt(data.esearchresult?.count ?? "0", 10),
      pmids: data.esearchresult?.idlist ?? [],
    };
  } catch {
    return { count: 0, pmids: [] };
  }
}

// ─── Known probiotic genera ───────────────────────────────────────────────────

const PROBIOTIC_GENERA = [
  "lactobacillus", "bifidobacterium", "saccharomyces", "streptococcus thermophilus",
  "enterococcus", "bacillus coagulans", "akkermansia", "faecalibacterium",
  "roseburia", "prevotella", "bacteroides",
];

const gutMicrobiomeAdapter: VerticalAdapter = {
  domainKey: "gut_microbiome",
  displayName: "Gut Microbiome & Protein",
  description:
    "Verifies claims about the interaction between dietary protein and the gut microbiome, " +
    "including probiotic/prebiotic effects on protein metabolism, gut barrier function, " +
    "and microbiome diversity. Uses PubMed RCT evidence and NCBI Taxonomy strain validation.",

  claimExtractorPrompt: `
You are a gut microbiome and nutrition research claim extractor. Extract every verifiable claim from the text.
Focus on:
- Probiotic strains: Lactobacillus, Bifidobacterium, Saccharomyces, Akkermansia, Faecalibacterium
- Prebiotic substrates: inulin, FOS, GOS, resistant starch, pectin
- Protein-microbiome interactions: protein fermentation, SCFA production, branched-chain fatty acids
- Gut barrier claims: tight junction proteins, intestinal permeability, leaky gut
- Diversity metrics: alpha diversity (Shannon index), beta diversity, species richness
- Clinical outcomes: IBS symptoms, IBD, bloating, transit time, stool consistency (Bristol scale)
- Protein type effects: animal vs plant protein on microbiome composition
For each claim, extract: the intervention (probiotic/prebiotic/protein type), the outcome measure, the population, and any specific values.
`,

  discoverySearchTerms: [
    "dietary protein gut microbiome randomized trial",
    "whey protein gut microbiota clinical study",
    "probiotic protein metabolism RCT",
    "plant protein microbiome diversity trial",
    "protein fermentation gut bacteria study",
  ],

  async lookupEvidence(claim): Promise<EvidenceResult> {
    const claimLower = claim.claimText.toLowerCase();

    // Check for probiotic strain mention
    const mentionedGenus = PROBIOTIC_GENERA.find((g) => claimLower.includes(g));

    // Build search query
    const searchTerm = mentionedGenus
      ? `${mentionedGenus} protein`
      : claim.claimText.slice(0, 80);

    const [strainResult, rctResult] = await Promise.all([
      mentionedGenus ? validateMicrobialStrain(mentionedGenus) : Promise.resolve({ found: false, taxId: undefined }),
      searchMicrobiomeRCTs(searchTerm),
    ]);

    const flags: string[] = [];
    let score = 0.30;

    if (rctResult.count >= 5) {
      score = 0.75;
      flags.push(`${rctResult.count} microbiome RCTs found`);
    } else if (rctResult.count >= 2) {
      score = 0.58;
      flags.push(`${rctResult.count} microbiome RCTs found`);
    } else if (rctResult.count >= 1) {
      score = 0.45;
      flags.push("1 microbiome RCT found");
    } else {
      flags.push("No microbiome RCTs found for this specific claim");
    }

    if (strainResult.found && strainResult.taxId) {
      score = Math.min(score + 0.05, 0.90);
      flags.push(`NCBI Taxonomy ID ${strainResult.taxId} confirmed for ${mentionedGenus}`);
    }

    // Microbiome research is inherently more variable — cap confidence
    score = Math.min(score, 0.82);

    return {
      found: rctResult.count > 0 || strainResult.found,
      sourceId: rctResult.pmids[0] ? `PMID:${rctResult.pmids[0]}` : null,
      sourceUrl: rctResult.pmids[0]
        ? `https://pubmed.ncbi.nlm.nih.gov/${rctResult.pmids[0]}/`
        : mentionedGenus
        ? `https://www.ncbi.nlm.nih.gov/taxonomy/?term=${encodeURIComponent(mentionedGenus)}`
        : null,
      evidenceRaw: {
        mentionedGenus: mentionedGenus ?? null,
        ncbiTaxId: strainResult.taxId ?? null,
        rctCount: rctResult.count,
        topPmids: rctResult.pmids,
      },
      confidenceScore: score,
      confidenceFlags: flags,
    };
  },
};

registerVertical(gutMicrobiomeAdapter);
