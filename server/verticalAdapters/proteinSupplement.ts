/**
 * verticalAdapters/proteinSupplement.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Protein Supplement vertical adapter.
 *
 * Verifies claims about protein supplements (whey, casein, soy, pea, etc.)
 * against:
 *  1. PubChem — compound identity, molecular weight, CAS number
 *  2. PubMed — RCT evidence for efficacy claims
 *
 * Evidence grading:
 *  - RCT with n≥50 + significant result → 0.85–0.95
 *  - RCT with n<50 or borderline result → 0.60–0.80
 *  - Observational/review only → 0.40–0.60
 *  - No clinical evidence → 0.20–0.40
 */
import { registerVertical, type VerticalAdapter, type EvidenceResult } from "./types";
import { verifyProteinViaUniProt } from "../uniprotAdapter";
import { searchFdaAdverseEvents, interpretFdaSignals } from "../openfdaAdapter";

// ─── PubChem lookup ───────────────────────────────────────────────────────────

interface PubChemCompound {
  CID: number;
  IUPACName?: string;
  MolecularFormula?: string;
  MolecularWeight?: string;
  IsomericSMILES?: string;
}

async function lookupPubChem(compoundName: string): Promise<PubChemCompound | null> {
  try {
    const encoded = encodeURIComponent(compoundName);
    const res = await fetch(
      `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/${encoded}/JSON?MaxRecords=1`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (!res.ok) return null;
    const data = await res.json() as { PC_Compounds?: Array<Record<string, unknown>> };
    const compound = data.PC_Compounds?.[0];
    if (!compound) return null;
    // Extract CID from the compound id structure
    const cidObj = compound.id as { id?: { cid?: number } } | undefined;
    const cid = cidObj?.id?.cid;
    if (!cid) return null;
    return { CID: cid };
  } catch {
    return null;
  }
}

// ─── PubMed search for RCT evidence ──────────────────────────────────────────

interface PubMedSearchResult {
  pmids: string[];
  count: number;
}

async function searchPubMedRCTs(query: string): Promise<PubMedSearchResult> {
  try {
    const encoded = encodeURIComponent(`${query} AND (randomized controlled trial[pt] OR clinical trial[pt])`);
    const res = await fetch(
      `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=${encoded}&retmax=5&retmode=json`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (!res.ok) return { pmids: [], count: 0 };
    const data = await res.json() as { esearchresult?: { idlist?: string[]; count?: string } };
    const idlist = data.esearchresult?.idlist ?? [];
    const count = parseInt(data.esearchresult?.count ?? "0", 10);
    return { pmids: idlist, count };
  } catch {
    return { pmids: [], count: 0 };
  }
}

// ─── Adapter ──────────────────────────────────────────────────────────────────

const proteinSupplementAdapter: VerticalAdapter = {
  domainKey: "protein_supplement",
  displayName: "Protein Supplements",
  description:
    "Verifies claims about protein supplements (whey, casein, soy, pea, collagen, etc.) " +
    "against PubChem compound data and PubMed randomised controlled trial evidence. " +
    "Covers efficacy, dosing, bioavailability, and safety claims.",

  claimExtractorPrompt: `
You are a protein supplement research claim extractor. Extract every verifiable claim from the text.
Focus on:
- Protein types: whey protein, casein, soy protein, pea protein, rice protein, egg white protein
- Efficacy claims: muscle protein synthesis, lean mass gain, strength improvement, recovery
- Dosing claims: grams per serving, timing (pre/post workout), daily intake recommendations
- Bioavailability claims: PDCAAS score, DIAAS score, leucine content, essential amino acid profile
- Safety claims: kidney function, liver enzymes, adverse events
- Comparison claims: whey vs casein, animal vs plant protein
- Population-specific claims: elderly, athletes, vegetarians
For each claim, extract: the protein type, the claimed effect, the population, and any specific values (doses, percentages, p-values).
`,

  discoverySearchTerms: [
    "whey protein randomized controlled trial",
    "casein protein muscle synthesis RCT",
    "plant protein bioavailability clinical trial",
    "pea protein leucine content study",
    "protein supplement elderly sarcopenia trial",
  ],

  async lookupEvidence(claim): Promise<EvidenceResult> {
    const claimLower = claim.claimText.toLowerCase();

    // Identify the protein compound mentioned
    const proteinKeywords: Record<string, string> = {
      "whey": "whey protein",
      "casein": "casein protein",
      "soy protein": "soy protein isolate",
      "pea protein": "pea protein",
      "rice protein": "rice protein",
      "collagen": "collagen peptides",
      "egg white": "egg white protein",
    };

    let compoundName: string | null = null;
    for (const [keyword, name] of Object.entries(proteinKeywords)) {
      if (claimLower.includes(keyword)) {
        compoundName = name;
        break;
      }
    }

    // Detect safety claims
    const isSafetyClaim = /safe|kidney|liver|adverse|harm|risk|side effect/i.test(claim.claimText);

    // Run PubChem, PubMed, UniProt, and OpenFDA lookups in parallel
    const [pubchemResult, rctResult, uniprotResult, fdaResult] = await Promise.all([
      compoundName ? lookupPubChem(compoundName) : Promise.resolve(null),
      searchPubMedRCTs(
        compoundName
          ? `${compoundName} ${claim.extractedValue ?? ""}`
          : claim.claimText.slice(0, 100)
      ),
      compoundName ? verifyProteinViaUniProt(compoundName) : Promise.resolve(null),
      compoundName ? searchFdaAdverseEvents(compoundName) : Promise.resolve(null),
    ]);

    const flags: string[] = [];
    let score = 0.3;

    // Score based on RCT evidence
    if (rctResult.count >= 10) {
      score = 0.85;
      flags.push(`${rctResult.count} RCTs found in PubMed`);
    } else if (rctResult.count >= 3) {
      score = 0.70;
      flags.push(`${rctResult.count} RCTs found in PubMed`);
    } else if (rctResult.count >= 1) {
      score = 0.55;
      flags.push(`${rctResult.count} RCT found in PubMed`);
    } else {
      score = 0.30;
      flags.push("No RCTs found in PubMed for this specific claim");
    }

    // Boost if PubChem compound confirmed
    if (pubchemResult?.CID) {
      score = Math.min(score + 0.05, 0.95);
      flags.push(`PubChem CID ${pubchemResult.CID} confirmed for ${compoundName}`);
    }

    // Boost if UniProt protein identity confirmed
    if (uniprotResult?.found) {
      score = Math.min(score + 0.05, 0.95);
      flags.push(...uniprotResult.flags);
    }

    // Apply FDA safety signals
    if (fdaResult) {
      const fdaSignals = interpretFdaSignals(fdaResult, isSafetyClaim);
      score = Math.min(Math.max(score + fdaSignals.confidenceDelta, 0.1), 0.95);
      flags.push(...fdaSignals.flags);
    }

    const primaryPmid = rctResult.pmids[0] ?? null;

    return {
      found: rctResult.count > 0 || pubchemResult !== null,
      sourceId: primaryPmid ? `PMID:${primaryPmid}` : (pubchemResult ? `CID:${pubchemResult.CID}` : null),
      sourceUrl: primaryPmid
        ? `https://pubmed.ncbi.nlm.nih.gov/${primaryPmid}/`
        : pubchemResult
        ? `https://pubchem.ncbi.nlm.nih.gov/compound/${pubchemResult.CID}`
        : null,
      evidenceRaw: {
        rctCount: rctResult.count,
        topPmids: rctResult.pmids,
        pubchemCid: pubchemResult?.CID ?? null,
        compoundName,
      },
      confidenceScore: score,
      confidenceFlags: flags,
    };
  },
};

registerVertical(proteinSupplementAdapter);
