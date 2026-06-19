/**
 * testDocuments.ts — 5 canonical test documents for adapter calibration.
 * PRD_ADAPTER_CALIBRATION FR-CAL-01.
 */
export interface TestDocument {
  id: "D1" | "D2" | "D3" | "D4" | "D5";
  label: string;
  description: string;
  text: string;
}

export const D1_DENSE_SPECIFIC: TestDocument = {
  id: "D1",
  label: "Dense Specific",
  description: "PubMed-style abstract with multiple PDB IDs, resolution values, and organisms.",
  text: `Crystal structure of human p53 tumor suppressor protein in complex with DNA.
The p53 protein (UniProt P04637) was crystallized at 2.1 angstrom resolution (PDB: 2OCJ).
The tetramerization domain (PDB: 1AIE) was resolved at 1.8 angstroms using X-ray crystallography.
Organism: Homo sapiens. The DNA-binding domain spans residues 94-292.
A second structure of murine p53 (PDB: 3KMD) was solved at 2.6 angstroms.
The R175H mutation abolishes DNA binding in 78% of tested cell lines.
GDP growth in the US reached 2.8% in Q4 2024 per BEA.
Atorvastatin reduces LDL cholesterol by 39% at 10mg dose per FDA label (NDA 020702).
The Richter magnitude 7.8 earthquake struck Turkey on February 6, 2023.
Clinical trial NCT04280705 enrolled 847 patients with stage III non-small cell lung cancer.`.trim(),
};

export const D2_DENSE_VAGUE: TestDocument = {
  id: "D2",
  label: "Dense Vague",
  description: "High-volume text with generalizations and no specific verifiable identifiers.",
  text: `Proteins are important molecules in living organisms. They perform many functions including
catalysis, structural support, and signal transduction. Scientists have studied proteins
for many decades. Recent advances in cryo-EM have improved our understanding of protein
structure. Many diseases are caused by protein misfolding. Drug discovery often targets
protein-protein interactions. The pharmaceutical industry invests heavily in protein research.
Economic conditions affect research funding. Countries with strong economies tend to have
more scientific output. Climate change may affect biodiversity. Earthquakes are natural
disasters that cause significant damage. Medical trials are conducted to test new treatments.`.trim(),
};

export const D3_SPARSE_SPECIFIC: TestDocument = {
  id: "D3",
  label: "Sparse Specific",
  description: "Short text with 2-3 highly specific, verifiable claims.",
  text: `The crystal structure of SARS-CoV-2 main protease (Mpro) was deposited as PDB 6LU7
at 2.16 angstrom resolution. The structure was determined by X-ray crystallography
using Homo sapiens-expressed protein. This structure has been cited over 3,200 times
as of January 2025.`.trim(),
};

export const D4_SPARSE_VAGUE: TestDocument = {
  id: "D4",
  label: "Sparse Vague",
  description: "Short text with vague, unverifiable statements only.",
  text: `Science is important. Researchers work hard to discover new things. Medicine helps people.
The economy affects everyone. Natural events can be dangerous.`.trim(),
};

export const D5_MIXED: TestDocument = {
  id: "D5",
  label: "Mixed",
  description: "Multi-domain text mixing specific verifiable claims with vague statements.",
  text: `The protein lysozyme (PDB: 1LYZ) was one of the first enzyme structures solved,
at 2.0 angstrom resolution in 1965. Lysozyme is found in many organisms.
US inflation reached 3.4% in December 2023 per the Bureau of Labor Statistics (CPI-U).
The economy has been challenging recently. A 6.4 magnitude earthquake struck
southern California on July 4, 2019. Earthquakes are scary.
Clinical trial NCT03041311 demonstrated a 23% reduction in cardiovascular events
with drug X at 12-month follow-up. Many drugs are in development.`.trim(),
};

export const TEST_DOCUMENTS: TestDocument[] = [
  D1_DENSE_SPECIFIC,
  D2_DENSE_VAGUE,
  D3_SPARSE_SPECIFIC,
  D4_SPARSE_VAGUE,
  D5_MIXED,
];
