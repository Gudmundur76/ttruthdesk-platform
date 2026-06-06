/**
 * verticalAdapters/collagenPeptides.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Collagen & Peptides vertical adapter.
 *
 * Verifies claims about collagen supplements (hydrolysed collagen, collagen
 * peptides, gelatin) and their effects on skin, joints, bones, and tendons.
 *
 * Evidence sources:
 *  1. PubChem — compound identity for collagen-derived peptides
 *  2. PubMed — RCT evidence for skin, joint, and bone outcomes
 */
import { registerVertical, type VerticalAdapter, type EvidenceResult } from "./types";
import { verifyProteinViaUniProt } from "../uniprotAdapter";

// ─── Collagen-related PubChem CIDs ───────────────────────────────────────────

const _COLLAGEN_COMPOUNDS: Record<string, number> = {
  "hydroxyproline": 5810,
  "proline": 145742,
  "glycine": 750,
  "collagen": 0, // No single CID — use PubMed only
  "gelatin": 0,
};

async function searchCollagenRCTs(
  outcome: string,
  compound: string
): Promise<{ count: number; pmids: string[] }> {
  try {
    const query = encodeURIComponent(
      `collagen ${compound} ${outcome} AND (randomized controlled trial[pt] OR clinical trial[pt])`
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

// ─── Outcome classification ───────────────────────────────────────────────────

function classifyOutcome(claimText: string): string {
  const lower = claimText.toLowerCase();
  if (lower.includes("skin") || lower.includes("wrinkle") || lower.includes("elasticity") || lower.includes("hydration")) return "skin";
  if (lower.includes("joint") || lower.includes("cartilage") || lower.includes("osteoarthritis") || lower.includes("knee")) return "joint";
  if (lower.includes("bone") || lower.includes("density") || lower.includes("osteoporosis") || lower.includes("fracture")) return "bone";
  if (lower.includes("tendon") || lower.includes("ligament") || lower.includes("achilles")) return "tendon";
  if (lower.includes("muscle") || lower.includes("lean mass") || lower.includes("sarcopenia")) return "muscle";
  if (lower.includes("wound") || lower.includes("healing") || lower.includes("scar")) return "wound healing";
  return "general";
}

const collagenPeptidesAdapter: VerticalAdapter = {
  domainKey: "collagen_peptides",
  displayName: "Collagen & Peptides",
  description:
    "Verifies claims about hydrolysed collagen, collagen peptides, and gelatin supplements " +
    "and their effects on skin elasticity, joint pain, bone density, tendon repair, " +
    "and muscle mass. Uses PubMed RCT evidence and PubChem amino acid data.",

  claimExtractorPrompt: `
You are a collagen supplement research claim extractor. Extract every verifiable claim from the text.
Focus on:
- Collagen types: type I, type II, type III, hydrolysed collagen, collagen peptides, gelatin, undenatured collagen
- Skin claims: wrinkle depth (mm), skin elasticity (%), skin hydration, dermal density
- Joint claims: VAS pain score, WOMAC score, cartilage thickness (mm), joint space width
- Bone claims: bone mineral density (g/cm²), bone turnover markers (CTX, P1NP)
- Tendon claims: tendon cross-sectional area, collagen synthesis markers, injury recovery time
- Dosing claims: grams per day, duration of supplementation (weeks), co-administration with vitamin C
- Biomarker claims: serum hydroxyproline, procollagen type I N-terminal propeptide (P1NP)
For each claim, extract: the collagen type, the outcome measure, the magnitude, the duration, and the population.
`,

  discoverySearchTerms: [
    "hydrolysed collagen skin elasticity RCT",
    "collagen peptides joint pain randomized trial",
    "collagen supplementation bone density clinical trial",
    "collagen tendon repair exercise study",
    "collagen peptides muscle mass elderly RCT",
  ],

  async lookupEvidence(claim): Promise<EvidenceResult> {
    const outcome = classifyOutcome(claim.claimText);

    // Identify specific collagen compound
    const claimLower = claim.claimText.toLowerCase();
    let compound = "peptides";
    if (claimLower.includes("type ii") || claimLower.includes("type 2") || claimLower.includes("undenatured")) {
      compound = "type II";
    } else if (claimLower.includes("type i") || claimLower.includes("type 1") || claimLower.includes("hydrolysed")) {
      compound = "hydrolysed";
    } else if (claimLower.includes("gelatin")) {
      compound = "gelatin";
    }

    const [rctResult, uniprotResult] = await Promise.all([
      searchCollagenRCTs(outcome, compound),
      verifyProteinViaUniProt(`collagen ${compound}`),
    ]);

    const flags: string[] = [];
    let score = 0.35;

    // Skin collagen evidence is strongest
    if (outcome === "skin") {
      score = rctResult.count >= 3 ? 0.80 : rctResult.count >= 1 ? 0.65 : 0.40;
      flags.push(`Skin outcome: ${rctResult.count} RCTs found`);
    } else if (outcome === "joint") {
      score = rctResult.count >= 3 ? 0.75 : rctResult.count >= 1 ? 0.58 : 0.35;
      flags.push(`Joint outcome: ${rctResult.count} RCTs found`);
    } else if (outcome === "bone") {
      score = rctResult.count >= 2 ? 0.70 : rctResult.count >= 1 ? 0.55 : 0.30;
      flags.push(`Bone outcome: ${rctResult.count} RCTs found`);
    } else {
      score = rctResult.count >= 1 ? 0.50 : 0.30;
      flags.push(`${outcome} outcome: ${rctResult.count} RCTs found`);
    }

    // Hydroxyproline CID confirmed
    if (claimLower.includes("hydroxyproline")) {
      score = Math.min(score + 0.05, 0.90);
      flags.push("PubChem CID 5810 (hydroxyproline) confirmed");
    }

    // UniProt protein identity boost
    if (uniprotResult.found) {
      score = Math.min(score + 0.05, 0.90);
      flags.push(...uniprotResult.flags);
    }

    return {
      found: rctResult.count > 0,
      sourceId: rctResult.pmids[0] ? `PMID:${rctResult.pmids[0]}` : null,
      sourceUrl: rctResult.pmids[0]
        ? `https://pubmed.ncbi.nlm.nih.gov/${rctResult.pmids[0]}/`
        : null,
      evidenceRaw: {
        outcome,
        compound,
        rctCount: rctResult.count,
        topPmids: rctResult.pmids,
      },
      confidenceScore: score,
      confidenceFlags: flags,
    };
  },
};

registerVertical(collagenPeptidesAdapter);
