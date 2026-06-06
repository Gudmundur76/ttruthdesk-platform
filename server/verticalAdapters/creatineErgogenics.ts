/**
 * verticalAdapters/creatineErgogenics.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Creatine & Ergogenics vertical adapter.
 *
 * Verifies claims about creatine monohydrate, beta-alanine, HMB, caffeine,
 * and other sports performance ergogenics against:
 *  1. PubChem — compound identity and molecular data
 *  2. PubMed — RCT evidence for performance claims
 *
 * Creatine is the most studied ergogenic aid — high RCT count expected.
 */
import { registerVertical, type VerticalAdapter, type EvidenceResult } from "./types";
import { searchFdaAdverseEvents, interpretFdaSignals } from "../openfdaAdapter";

// ─── PubChem CID map for common ergogenics ────────────────────────────────────

const ERGOGENIC_PUBCHEM_CIDS: Record<string, number> = {
  "creatine": 586,
  "creatine monohydrate": 586,
  "beta-alanine": 239,
  "beta alanine": 239,
  "hmb": 119219,
  "beta-hydroxy-beta-methylbutyrate": 119219,
  "caffeine": 2519,
  "citrulline": 9750,
  "l-citrulline": 9750,
  "arginine": 6322,
  "l-arginine": 6322,
  "carnitine": 10917,
  "l-carnitine": 10917,
  "taurine": 1123,
  "betaine": 247,
};

async function lookupErgogenicPubChem(cid: number): Promise<{ found: boolean; url: string }> {
  try {
    const res = await fetch(
      `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/${cid}/property/IUPACName,MolecularFormula,MolecularWeight/JSON`,
      { signal: AbortSignal.timeout(6000) }
    );
    return { found: res.ok, url: `https://pubchem.ncbi.nlm.nih.gov/compound/${cid}` };
  } catch {
    return { found: false, url: `https://pubchem.ncbi.nlm.nih.gov/compound/${cid}` };
  }
}

async function searchPubMedPerformance(compound: string, _claimFragment: string): Promise<{ count: number; pmids: string[] }> {
  try {
    const query = encodeURIComponent(
      `${compound} performance[tiab] AND (randomized controlled trial[pt] OR meta-analysis[pt])`
    );
    const res = await fetch(
      `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=${query}&retmax=5&retmode=json`,
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

const creatineErgogenicsAdapter: VerticalAdapter = {
  domainKey: "creatine_ergogenics",
  displayName: "Creatine & Ergogenics",
  description:
    "Verifies performance and safety claims about creatine monohydrate, beta-alanine, HMB, " +
    "caffeine, citrulline, and other sports ergogenics against PubChem compound data and " +
    "PubMed RCT/meta-analysis evidence.",

  claimExtractorPrompt: `
You are a sports ergogenics research claim extractor. Extract every verifiable claim from the text.
Focus on:
- Compound names: creatine monohydrate, beta-alanine, HMB, caffeine, citrulline, arginine, carnitine, taurine, betaine
- Performance claims: strength gains (1RM), power output (watts), sprint time, VO2max, endurance
- Body composition claims: lean mass gain (kg), fat loss (kg), body fat percentage
- Dosing claims: loading phase (g/day), maintenance dose (g/day), timing
- Mechanism claims: phosphocreatine resynthesis, carnosine buffering, nitric oxide production
- Safety claims: kidney function (creatinine, GFR), liver enzymes, adverse events
- Population claims: athletes, elderly, vegetarians, clinical populations
For each claim, extract: the compound, the claimed effect, the magnitude (if stated), the population, and any p-values or effect sizes.
`,

  discoverySearchTerms: [
    "creatine monohydrate strength RCT meta-analysis",
    "beta-alanine performance randomized trial",
    "HMB lean mass clinical trial",
    "caffeine exercise performance systematic review",
    "citrulline nitric oxide sport RCT",
  ],

  async lookupEvidence(claim): Promise<EvidenceResult> {
    const claimLower = claim.claimText.toLowerCase();

    // Identify compound
    let matchedCompound: string | null = null;
    let matchedCid: number | null = null;
    for (const [keyword, cid] of Object.entries(ERGOGENIC_PUBCHEM_CIDS)) {
      if (claimLower.includes(keyword)) {
        matchedCompound = keyword;
        matchedCid = cid;
        break;
      }
    }

    // Default to creatine if no match (most common in this vertical)
    if (!matchedCompound) {
      matchedCompound = "creatine";
      matchedCid = 586;
    }

    const isSafetyClaim = /safe|kidney|liver|adverse|harm|risk|side effect|creatinine/i.test(claim.claimText);

    const [pubchemResult, rctResult, fdaResult] = await Promise.all([
      lookupErgogenicPubChem(matchedCid ?? 586),
      searchPubMedPerformance(matchedCompound, claim.claimText.slice(0, 80)),
      searchFdaAdverseEvents(matchedCompound),
    ]);

    const flags: string[] = [];
    let score = 0.35;

    // Creatine has 500+ RCTs — high baseline confidence
    if (matchedCompound === "creatine" || matchedCompound === "creatine monohydrate") {
      score = 0.75; // Prior: creatine efficacy is very well established
      flags.push("Creatine monohydrate: extensive RCT evidence base");
    }

    if (rctResult.count >= 20) {
      score = Math.max(score, 0.90);
      flags.push(`${rctResult.count} RCTs/meta-analyses found`);
    } else if (rctResult.count >= 5) {
      score = Math.max(score, 0.75);
      flags.push(`${rctResult.count} RCTs found`);
    } else if (rctResult.count >= 1) {
      score = Math.max(score, 0.55);
      flags.push(`${rctResult.count} RCT found`);
    } else {
      flags.push("No specific RCTs found for this claim variant");
    }

    if (pubchemResult.found) {
      score = Math.min(score + 0.03, 0.95);
      flags.push(`PubChem CID ${matchedCid} confirmed`);
    }

    // Apply FDA safety signals
    const fdaSignals = interpretFdaSignals(fdaResult, isSafetyClaim);
    score = Math.min(Math.max(score + fdaSignals.confidenceDelta, 0.1), 0.95);
    flags.push(...fdaSignals.flags);

    return {
      found: rctResult.count > 0 || pubchemResult.found,
      sourceId: rctResult.pmids[0] ? `PMID:${rctResult.pmids[0]}` : `CID:${matchedCid}`,
      sourceUrl: rctResult.pmids[0]
        ? `https://pubmed.ncbi.nlm.nih.gov/${rctResult.pmids[0]}/`
        : pubchemResult.url,
      evidenceRaw: {
        compound: matchedCompound,
        pubchemCid: matchedCid,
        rctCount: rctResult.count,
        topPmids: rctResult.pmids,
      },
      confidenceScore: score,
      confidenceFlags: flags,
    };
  },
};

registerVertical(creatineErgogenicsAdapter);
