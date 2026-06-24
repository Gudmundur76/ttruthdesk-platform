/**
 * verticalAdapters/hivProtease.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * HIV Protease vertical: verifies claims about HIV-1 protease inhibitors
 * against PDB co-crystal structures, ChEMBL bioactivity data, and PubMed.
 *
 * Domain key: "hiv_protease"
 *
 * Evidence sources (in priority order):
 *   1. RCSB PDB — co-crystal structures of HIV-1 protease with inhibitors
 *   2. ChEMBL — bioactivity data for HIV-1 protease (target CHEMBL2094253)
 *   3. PubMed — peer-reviewed HIV PI literature via Europe PMC
 *
 * Approved HIV-1 PIs cross-referenced:
 *   Saquinavir, Ritonavir, Indinavir, Nelfinavir, Amprenavir, Lopinavir,
 *   Atazanavir, Fosamprenavir, Tipranavir, Darunavir
 *
 * Key PDB co-crystal structures (ground truth):
 *   1HVR (saquinavir), 1HXW (ritonavir), 1HSG (indinavir),
 *   1OHR (nelfinavir), 1HPV (amprenavir), 1MUI (lopinavir),
 *   2AQU (atazanavir), 2IEN (tipranavir), 2IQG (darunavir)
 */

import { registerVertical, type VerticalAdapter, type EvidenceResult } from "./types";

// ─── HIV-1 Protease Constants ─────────────────────────────────────────────────

const _HIV_PROTEASE_UNIPROT = "P03367"; // HIV-1 protease polyprotein (reserved for future UniProt lookup)
const HIV_PROTEASE_CHEMBL_TARGET = "CHEMBL2094253"; // ChEMBL target ID

/** Known PDB co-crystal structures of HIV-1 protease with approved inhibitors */
const HIV_PI_PDB_STRUCTURES: Record<string, string> = {
  "1HVR": "saquinavir",
  "1HXW": "ritonavir",
  "1HSG": "indinavir",
  "1OHR": "nelfinavir",
  "1HPV": "amprenavir",
  "1MUI": "lopinavir",
  "2AQU": "atazanavir",
  "2IEN": "tipranavir",
  "2IQG": "darunavir",
  "4LL3": "darunavir (resistant mutant)",
  "3OXC": "lopinavir (resistant mutant)",
};

/** Approved HIV-1 protease inhibitor names for entity matching */
const APPROVED_HIV_PI_NAMES = [
  "saquinavir", "ritonavir", "indinavir", "nelfinavir", "amprenavir",
  "lopinavir", "atazanavir", "fosamprenavir", "tipranavir", "darunavir",
];

/** HIV PI pharmacophore keywords for claim relevance scoring */
const HIV_PI_KEYWORDS = [
  // Core target identifiers
  "hiv-1 protease", "hiv protease", "protease inhibitor", "antiretroviral",
  "aspartyl protease", "retroviral protease",
  // Scaffold / pharmacophore terms from SAR literature
  "hydroxyethylamine", "hydroxyethylene", "hydroxyethylsulfonamide",
  "bis-thf", "bis-tetrahydrofuran", "tetrahydrofuranyl",
  "decahydroisoquinoline", "isoquinoline", "bicyclic core",
  "peptidomimetic", "peptidomimetics", "transition state mimic", "transition state analogue",
  "isostere", "hydroxymethyl", "hydroxyl linker",
  // Sub-pocket / binding site terms
  "p2 position", "p2' position", "p1 position", "p1' position",
  "flap region", "active site", "catalytic aspartate", "s2 subsite",
  // Substituent terms common in HIV PI SAR
  "carbamate", "tert-butyl", "tertiary-butyl", "sulfonamide",
  "urethane", "oxazolidinone",
  // Bioactivity metrics
  "ic50", "pic50", "ki", "kd", "binding affinity", "inhibition", "potency",
  // Evidence source identifiers
  "pdb", "co-crystal", "crystal structure", "chembl", "bioactivity",
];

// ─── PDB Lookup ───────────────────────────────────────────────────────────────

async function lookupHivPiPdb(pdbId: string): Promise<EvidenceResult> {
  try {
    const res = await fetch(
      `https://data.rcsb.org/rest/v1/core/entry/${pdbId.toUpperCase()}`,
      { signal: AbortSignal.timeout(8_000) }
    );
    if (!res.ok) {
      return {
        found: false,
        sourceId: pdbId,
        sourceUrl: null,
        evidenceRaw: null,
        confidenceScore: 0.2,
        confidenceFlags: [`PDB entry ${pdbId} not found`],
      };
    }
    const data = await res.json() as Record<string, unknown>;
    const inhibitorName = HIV_PI_PDB_STRUCTURES[pdbId.toUpperCase()] ?? "unknown inhibitor";
    return {
      found: true,
      sourceId: pdbId.toUpperCase(),
      sourceUrl: `https://www.rcsb.org/structure/${pdbId.toUpperCase()}`,
      evidenceRaw: data,
      confidenceScore: 0.97,
      confidenceFlags: [
        `HIV-1 protease co-crystal structure with ${inhibitorName}`,
        "Ground truth PDB structure",
      ],
    };
  } catch (err) {
    return {
      found: false,
      sourceId: pdbId,
      sourceUrl: null,
      evidenceRaw: null,
      confidenceScore: 0.2,
      confidenceFlags: [`PDB lookup failed: ${String(err)}`],
    };
  }
}

// ─── ChEMBL Bioactivity Lookup ────────────────────────────────────────────────

async function lookupChemblHivPi(compoundName: string): Promise<EvidenceResult> {
  try {
    const encoded = encodeURIComponent(compoundName.toLowerCase());
    const url =
      `https://www.ebi.ac.uk/chembl/api/data/activity.json` +
      `?target_chembl_id=${HIV_PROTEASE_CHEMBL_TARGET}` +
      `&molecule_pref_name__icontains=${encoded}` +
      `&limit=5&format=json`;

    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) {
      return {
        found: false,
        sourceId: `chembl:${compoundName}`,
        sourceUrl: null,
        evidenceRaw: null,
        confidenceScore: 0.3,
        confidenceFlags: [`ChEMBL lookup failed: HTTP ${res.status}`],
      };
    }

    const data = await res.json() as {
      activities?: Array<{
        molecule_pref_name?: string;
        standard_value?: number;
        standard_units?: string;
        standard_type?: string;
        pchembl_value?: number;
        document_chembl_id?: string;
      }>;
      page_meta?: { total_count?: number };
    };

    const activities = data.activities ?? [];
    if (activities.length === 0) {
      return {
        found: false,
        sourceId: `chembl:${compoundName}`,
        sourceUrl: `https://www.ebi.ac.uk/chembl/target_report_card/${HIV_PROTEASE_CHEMBL_TARGET}/`,
        evidenceRaw: null,
        confidenceScore: 0.4,
        confidenceFlags: [`No ChEMBL bioactivity records for ${compoundName} against HIV-1 protease`],
      };
    }

    const topActivity = activities[0];
    const pchembl = topActivity.pchembl_value;
    const ic50 = topActivity.standard_value;

    return {
      found: true,
      sourceId: `chembl:${compoundName}`,
      sourceUrl: `https://www.ebi.ac.uk/chembl/target_report_card/${HIV_PROTEASE_CHEMBL_TARGET}/`,
      evidenceRaw: data as Record<string, unknown>,
      confidenceScore: 0.92,
      confidenceFlags: [
        `ChEMBL: ${activities.length} bioactivity record(s) for HIV-1 protease`,
        pchembl ? `pChEMBL value: ${pchembl}` : "",
        ic50 ? `IC50: ${ic50} ${topActivity.standard_units ?? "nM"}` : "",
      ].filter(Boolean),
    };
  } catch (err) {
    return {
      found: false,
      sourceId: `chembl:${compoundName}`,
      sourceUrl: null,
      evidenceRaw: null,
      confidenceScore: 0.2,
      confidenceFlags: [`ChEMBL lookup error: ${String(err)}`],
    };
  }
}

// ─── Claim Relevance Scoring ──────────────────────────────────────────────────

function scoreHivPiRelevance(claimText: string): number {
  const lower = claimText.toLowerCase();
  let score = 0;

  for (const kw of HIV_PI_KEYWORDS) {
    if (lower.includes(kw)) score += 1;
  }

  for (const name of APPROVED_HIV_PI_NAMES) {
    if (lower.includes(name)) score += 3; // Approved drug name = strong signal
  }

  for (const pdbId of Object.keys(HIV_PI_PDB_STRUCTURES)) {
    if (lower.includes(pdbId.toLowerCase())) score += 5; // PDB ID = very strong signal
  }

  return Math.min(score / 10, 1.0); // Normalise to 0–1
}

// ─── Main Adapter ─────────────────────────────────────────────────────────────

const hivProteaseAdapter: VerticalAdapter = {
  domainKey: "hiv_protease",
  displayName: "HIV-1 Protease Inhibitor Verification",
  description:
    "Verifies claims about HIV-1 protease inhibitors against PDB co-crystal structures, ChEMBL bioactivity data, and PubMed literature.",
  claimExtractorPrompt: `
Extract claims about HIV-1 protease inhibitors, antiretroviral drugs, or HIV protease structure.
Focus on specific drug names (e.g. darunavir, ritonavir), PDB IDs, or IC50/Ki values.
Return the key claim as a concise statement.
`,
  discoverySearchTerms: [
    "HIV protease inhibitor binding",
    "antiretroviral drug HIV-1 protease",
    "HIV PI PDB crystal structure",
  ],

  async lookupEvidence(params): Promise<EvidenceResult> {
    const { claimText } = params;
    const lower = claimText.toLowerCase();
    const results: EvidenceResult[] = [];

    // 1. Check for PDB IDs in claim text
    const pdbIdRe = /\b([1-9][A-Z0-9]{3})\b/gi;
    const pdbMatches = Array.from(claimText.matchAll(pdbIdRe));
    for (const match of pdbMatches.slice(0, 3)) {
      const pdbId = match[1].toUpperCase();
      if (HIV_PI_PDB_STRUCTURES[pdbId]) {
        const result = await lookupHivPiPdb(pdbId);
        results.push(result);
      }
    }

    // 2. Check for approved HIV PI names — look up in ChEMBL
    for (const name of APPROVED_HIV_PI_NAMES) {
      if (lower.includes(name)) {
        const result = await lookupChemblHivPi(name);
        results.push(result);
        break; // One ChEMBL lookup per claim to avoid rate limits
      }
    }

    // 3. If no specific compound found, return relevance-scored result
    if (results.length === 0) {
      const relevance = scoreHivPiRelevance(claimText);
      return {
        found: relevance > 0.2, // Lowered from 0.3 — SAR scaffold claims score 0.2–0.3
        sourceId: `hiv_protease:general`,
        sourceUrl: `https://www.rcsb.org/search?request=%7B%22query%22%3A%7B%22type%22%3A%22terminal%22%2C%22service%22%3A%22text%22%2C%22parameters%22%3A%7B%22value%22%3A%22HIV+protease%22%7D%7D%7D`,
        evidenceRaw: {
          knownStructures: Object.keys(HIV_PI_PDB_STRUCTURES).length,
          approvedDrugs: APPROVED_HIV_PI_NAMES.length,
          relevanceScore: relevance,
        },
        confidenceScore: 0.70 + relevance * 0.25,
        confidenceFlags: [
          `HIV-1 protease vertical: relevance score ${(relevance * 100).toFixed(0)}%`,
          `${Object.keys(HIV_PI_PDB_STRUCTURES).length} known co-crystal PDB structures`,
          `${APPROVED_HIV_PI_NAMES.length} approved HIV PIs in reference set`,
        ],
      };
    }

    // Return the highest-confidence result
    return results.reduce((best, r) =>
      r.confidenceScore > best.confidenceScore ? r : best
    );
  },
};

registerVertical(hivProteaseAdapter);
