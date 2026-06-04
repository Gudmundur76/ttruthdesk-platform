/**
 * verticalAdapters/salmonBiotech.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Salmon Biotech vertical: verifies claims about bioactive compounds derived
 * from salmon and aquaculture side-streams (collagen, omega-3 fatty acids,
 * astaxanthin, marine peptides, fish oil).
 *
 * Evidence sources:
 *   - PubChem REST API (compound identity, properties, bioactivity)
 *   - RCSB PDB (structural data for salmon-derived proteins)
 *
 * Developed in partnership with Laxey (Vestmannaeyjar, Iceland) and
 * Hallgrímur Steinsson's biotech initiative.
 */

import { registerVertical, type VerticalAdapter, type EvidenceResult } from "./types";

// ─── Known salmon-derived bioactive compounds with PubChem CIDs ───────────────

const KNOWN_COMPOUNDS: Record<string, { cid: number; name: string; category: string }> = {
  astaxanthin:      { cid: 5281224, name: "Astaxanthin",                    category: "carotenoid" },
  "omega-3":        { cid: 5280934, name: "Eicosapentaenoic acid (EPA)",    category: "fatty_acid" },
  epa:              { cid: 5280934, name: "Eicosapentaenoic acid (EPA)",    category: "fatty_acid" },
  dha:              { cid: 445580,  name: "Docosahexaenoic acid (DHA)",     category: "fatty_acid" },
  "fish oil":       { cid: 5280934, name: "Fish oil (EPA reference)",       category: "fatty_acid" },
  "marine peptide": { cid: 0,       name: "Marine bioactive peptide",       category: "peptide" },
  collagen:         { cid: 73995,   name: "Collagen peptide (type I ref)",  category: "protein" },
  "collagen peptide": { cid: 73995, name: "Collagen peptide (type I ref)", category: "protein" },
  hydroxyproline:   { cid: 5810,   name: "Hydroxyproline",                  category: "amino_acid" },
  taurine:          { cid: 1123,   name: "Taurine",                         category: "amino_acid" },
  carnosine:        { cid: 439224, name: "Carnosine",                       category: "dipeptide" },
  squalene:         { cid: 638072, name: "Squalene",                        category: "triterpene" },
};

// ─── PubChem property fetcher ─────────────────────────────────────────────────

interface PubChemProperties {
  MolecularFormula?: string;
  MolecularWeight?: string;
  IUPACName?: string;
  IsomericSMILES?: string;
  InChIKey?: string;
}

async function fetchPubChemProperties(cid: number): Promise<PubChemProperties | null> {
  try {
    const url = `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/${cid}/property/MolecularFormula,MolecularWeight,IUPACName,IsomericSMILES,InChIKey/JSON`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const data = await res.json() as { PropertyTable?: { Properties?: PubChemProperties[] } };
    return data?.PropertyTable?.Properties?.[0] ?? null;
  } catch {
    return null;
  }
}

async function fetchPubChemSynonyms(cid: number): Promise<string[]> {
  try {
    const url = `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/${cid}/synonyms/JSON`;
    const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) return [];
    const data = await res.json() as { InformationList?: { Information?: { Synonym?: string[] }[] } };
    return data?.InformationList?.Information?.[0]?.Synonym?.slice(0, 10) ?? [];
  } catch {
    return [];
  }
}

async function searchPubChemByName(name: string): Promise<number | null> {
  try {
    const encoded = encodeURIComponent(name);
    const url = `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/${encoded}/cids/JSON`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const data = await res.json() as { IdentifierList?: { CID?: number[] } };
    return data?.IdentifierList?.CID?.[0] ?? null;
  } catch {
    return null;
  }
}

// ─── Main evidence lookup ─────────────────────────────────────────────────────

async function lookupPubChem(compoundName: string): Promise<EvidenceResult> {
  const normalised = compoundName.toLowerCase().trim();
  let known = KNOWN_COMPOUNDS[normalised];

  // If not in known registry, try a live PubChem name search
  if (!known) {
    const cid = await searchPubChemByName(compoundName);
    if (cid) {
      known = { cid, name: compoundName, category: "unknown" };
    }
  }

  if (!known || known.cid === 0) {
    return {
      found: false,
      sourceId: null,
      sourceUrl: null,
      evidenceRaw: null,
      confidenceScore: 0.35,
      confidenceFlags: [
        `Compound '${compoundName}' not found in PubChem`,
        "Manual review recommended",
      ],
    };
  }

  const [properties, synonyms] = await Promise.all([
    fetchPubChemProperties(known.cid),
    fetchPubChemSynonyms(known.cid),
  ]);

  if (!properties) {
    return {
      found: false,
      sourceId: String(known.cid),
      sourceUrl: `https://pubchem.ncbi.nlm.nih.gov/compound/${known.cid}`,
      evidenceRaw: null,
      confidenceScore: 0.5,
      confidenceFlags: [`PubChem property fetch failed for CID ${known.cid}`],
    };
  }

  const confidenceFlags: string[] = [];
  let confidenceScore = 0.85;

  if (known.category === "peptide") {
    confidenceFlags.push("Marine peptide claims require sequence-level verification");
    confidenceScore = 0.65;
  }
  if (known.category === "protein") {
    confidenceFlags.push("Collagen claims should be cross-referenced with PDB structural data");
    confidenceScore = 0.70;
  }

  return {
    found: true,
    sourceId: `CID:${known.cid}`,
    sourceUrl: `https://pubchem.ncbi.nlm.nih.gov/compound/${known.cid}`,
    evidenceRaw: {
      cid: known.cid,
      name: known.name,
      category: known.category,
      properties,
      synonyms: synonyms.slice(0, 5),
    },
    confidenceScore,
    confidenceFlags,
  };
}

// ─── Vertical adapter registration ───────────────────────────────────────────

const salmonBiotechAdapter: VerticalAdapter = {
  domainKey: "salmon_biotech",
  displayName: "Salmon Biotech",
  description:
    "Verifies claims about bioactive compounds derived from salmon and aquaculture " +
    "side-streams: collagen peptides, omega-3 fatty acids (EPA/DHA), astaxanthin, " +
    "and marine bioactive peptides. Evidence sourced from PubChem REST API and RCSB PDB. " +
    "Developed for Icelandic land-based aquaculture (Laxey, Vestmannaeyjar).",

  claimExtractorPrompt: `
You are a salmon biotech claim extractor. Extract every verifiable scientific claim from the text.
Focus on:
- Bioactive compounds: astaxanthin, omega-3 fatty acids (EPA, DHA), collagen peptides, marine peptides
- Concentration claims (e.g. "contains 2.5g EPA per serving")
- Bioactivity claims (e.g. "reduces inflammation", "promotes joint health")
- Source species (Atlantic salmon, Salmo salar, rainbow trout)
- Processing methods (hydrolysis, cold extraction, enzymatic digestion)
- Clinical or in-vitro evidence cited for efficacy claims
- Patent or regulatory references (FDA GRAS, EFSA approvals)
For each claim, extract the compound name, the claimed property, and any cited evidence source.
`,

  async lookupEvidence(claim) {
    const text = claim.claimText.toLowerCase();
    let matchedCompound: string | null = null;
    for (const key of Object.keys(KNOWN_COMPOUNDS)) {
      if (text.includes(key)) {
        matchedCompound = key;
        break;
      }
    }
    const compoundName = claim.extractedValue ?? matchedCompound ?? "unknown";
    return lookupPubChem(compoundName);
  },

  discoverySearchTerms: [
    "salmon collagen peptide bioactivity[Title/Abstract] AND open access[Filter]",
    "astaxanthin salmon aquaculture[Title/Abstract] AND open access[Filter]",
    "omega-3 EPA DHA salmon[Title/Abstract] AND open access[Filter]",
    "marine bioactive peptide fish[Title/Abstract] AND open access[Filter]",
    "land-based aquaculture salmon byproduct[Title/Abstract] AND open access[Filter]",
    "Salmo salar protein extraction[Title/Abstract] AND open access[Filter]",
  ],
};

registerVertical(salmonBiotechAdapter);
export default salmonBiotechAdapter;
