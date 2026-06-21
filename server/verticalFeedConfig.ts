/**
 * verticalFeedConfig.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Shared MeSH term configuration for the PMC Open Access feed connector.
 *
 * Imported by pmcFeedJob.ts (nightly feed) and any future tooling that needs
 * to know which PubMed queries map to which vertical domain.
 *
 * Adding a new vertical:
 *   1. Add a new entry to VERTICAL_FEED_CONFIGS with a unique domainKey.
 *   2. Ensure a matching VerticalAdapter is registered in
 *      server/verticalAdapters/index.ts.
 *   3. The nightly pmc-feed job will automatically pick it up on next run.
 *
 * PMC Open Access filter: use `free full text[sb]` in PubMed queries.
 * The string "pmc open access[filter]" is NOT a valid PubMed filter and
 * returns 0 results. The correct subset builder tag is `free full text[sb]`.
 */

export interface VerticalFeedConfig {
  /** Matches the domainKey used in VerticalAdapter and the documents table. */
  domainKey: string;
  displayName: string;
  /**
   * PubMed query strings. Each query is run independently via ESearch.
   * All queries MUST include `free full text[sb]` to restrict to
   * legally reusable Open Access papers available in PMC.
   */
  meshQueries: string[];
  /** Maximum PMIDs to retrieve per query per run. Keep ≤ 100 to stay within
   *  NCBI rate limits for unauthenticated access. */
  maxResultsPerQuery: number;
}

export const VERTICAL_FEED_CONFIGS: VerticalFeedConfig[] = [
  {
    domainKey: "structural_biology",
    displayName: "Structural Biology",
    meshQueries: [
      // Core structural biology MeSH terms (free full text[sb] = PMC Open Access)
      '"Protein Structure, Tertiary"[MeSH Terms] AND free full text[sb]',
      '"Crystallography, X-Ray"[MeSH Terms] AND free full text[sb]',
      '"Cryoelectron Microscopy"[MeSH Terms] AND free full text[sb]',
      '"Protein Conformation"[MeSH Terms] AND "Binding Sites"[MeSH Terms] AND free full text[sb]',
      // PDB-linked papers
      '"Protein Data Bank"[All Fields] AND free full text[sb]',
    ],
    maxResultsPerQuery: 50,
  },
  {
    domainKey: "salmon_biotech",
    displayName: "Salmon Biotech",
    meshQueries: [
      // Salmon and aquaculture (free full text[sb] = PMC Open Access)
      '"Salmo salar"[MeSH Terms] AND free full text[sb]',
      '"Aquaculture"[MeSH Terms] AND "Salmonidae"[MeSH Terms] AND free full text[sb]',
      // Marine bioactives
      '"Fatty Acids, Omega-3"[MeSH Terms] AND "Fishes"[MeSH Terms] AND free full text[sb]',
      '"Astaxanthin"[MeSH Terms] AND free full text[sb]',
      '"Marine Proteins"[All Fields] AND free full text[sb]',
      // Salmon health and genetics
      '"Genome"[MeSH Terms] AND "Salmo salar"[MeSH Terms] AND free full text[sb]',
      // Salmon-specific biomarkers
      '"Carotenoids"[MeSH Terms] AND "Salmonidae"[MeSH Terms] AND free full text[sb]',
    ],
    maxResultsPerQuery: 40,
  },
  // ── 6 new coordination-layer verticals ──────────────────────────────────────
  {
    domainKey: "protein_supplement",
    displayName: "Protein Supplements",
    meshQueries: [
      '"Dietary Supplements"[MeSH Terms] AND "Proteins"[MeSH Terms] AND free full text[sb]',
      '"Whey Proteins"[MeSH Terms] AND free full text[sb]',
      '"Plant Proteins, Dietary"[MeSH Terms] AND free full text[sb]',
      '"Amino Acids, Essential"[MeSH Terms] AND "Athletic Performance"[MeSH Terms] AND free full text[sb]',
      '"Muscle Proteins"[MeSH Terms] AND "Resistance Training"[MeSH Terms] AND free full text[sb]',
    ],
    maxResultsPerQuery: 50,
  },
  {
    domainKey: "creatine_ergogenics",
    displayName: "Creatine & Ergogenics",
    meshQueries: [
      '"Creatine"[MeSH Terms] AND free full text[sb]',
      '"Performance-Enhancing Substances"[MeSH Terms] AND free full text[sb]',
      '"Beta-Alanine"[All Fields] AND free full text[sb]',
      '"Caffeine"[MeSH Terms] AND "Athletic Performance"[MeSH Terms] AND free full text[sb]',
      '"Nitric Oxide"[MeSH Terms] AND "Exercise"[MeSH Terms] AND free full text[sb]',
    ],
    maxResultsPerQuery: 50,
  },
  {
    domainKey: "gut_microbiome",
    displayName: "Gut Microbiome & Protein",
    meshQueries: [
      '"Gastrointestinal Microbiome"[MeSH Terms] AND "Dietary Proteins"[MeSH Terms] AND free full text[sb]',
      '"Probiotics"[MeSH Terms] AND "Protein Digestion"[All Fields] AND free full text[sb]',
      '"Short-Chain Fatty Acids"[MeSH Terms] AND "Dietary Fiber"[MeSH Terms] AND free full text[sb]',
      '"Intestinal Absorption"[MeSH Terms] AND "Amino Acids"[MeSH Terms] AND free full text[sb]',
    ],
    maxResultsPerQuery: 40,
  },
  {
    domainKey: "collagen_peptides",
    displayName: "Collagen & Peptides",
    meshQueries: [
      '"Collagen"[MeSH Terms] AND "Dietary Supplements"[MeSH Terms] AND free full text[sb]',
      '"Collagen Peptides"[All Fields] AND free full text[sb]',
      '"Gelatin"[MeSH Terms] AND "Wound Healing"[MeSH Terms] AND free full text[sb]',
      '"Skin Aging"[MeSH Terms] AND "Collagen"[MeSH Terms] AND free full text[sb]',
      '"Joint Diseases"[MeSH Terms] AND "Collagen"[MeSH Terms] AND free full text[sb]',
    ],
    maxResultsPerQuery: 40,
  },
  {
    domainKey: "plant_based_protein",
    displayName: "Plant-Based Protein",
    meshQueries: [
      '"Pea Proteins"[All Fields] AND free full text[sb]',
      '"Soy Proteins"[MeSH Terms] AND free full text[sb]',
      '"Legumes"[MeSH Terms] AND "Protein"[MeSH Terms] AND free full text[sb]',
      '"Hemp"[All Fields] AND "Protein"[MeSH Terms] AND free full text[sb]',
      '"Spirulina"[MeSH Terms] AND free full text[sb]',
      '"Mycoprotein"[All Fields] AND free full text[sb]',
    ],
    maxResultsPerQuery: 50,
  },
  {
    domainKey: "sports_nutrition_rct",
    displayName: "Sports Nutrition RCTs",
    meshQueries: [
      '"Randomized Controlled Trial"[pt] AND "Sports Nutritional Sciences"[MeSH Terms] AND free full text[sb]',
      '"Randomized Controlled Trial"[pt] AND "Muscle Strength"[MeSH Terms] AND "Dietary Supplements"[MeSH Terms] AND free full text[sb]',
      '"Randomized Controlled Trial"[pt] AND "Body Composition"[MeSH Terms] AND "Protein"[MeSH Terms] AND free full text[sb]',
      '"Randomized Controlled Trial"[pt] AND "Recovery"[All Fields] AND "Exercise"[MeSH Terms] AND free full text[sb]',
    ],
    maxResultsPerQuery: 60,
  },
  // ── HIV Protease vertical (novus.is integration, 2026-06-21) ─────────────────
  {
    domainKey: "hiv_protease",
    displayName: "HIV-1 Protease Inhibitors",
    meshQueries: [
      // Core HIV protease inhibitor literature
      '"HIV Protease Inhibitors"[MeSH Terms] AND free full text[sb]',
      '"HIV Protease"[MeSH Terms] AND "Drug Resistance, Viral"[MeSH Terms] AND free full text[sb]',
      // Structural biology of HIV PI
      '"HIV Protease"[MeSH Terms] AND "Crystallography, X-Ray"[MeSH Terms] AND free full text[sb]',
      '"Darunavir"[Supplementary Concept] AND free full text[sb]',
      '"Lopinavir"[MeSH Terms] AND free full text[sb]',
      // Antiretroviral therapy
      '"Anti-Retroviral Agents"[MeSH Terms] AND "HIV-1"[MeSH Terms] AND free full text[sb]',
      // Computational drug discovery for HIV PI
      '"HIV Protease"[MeSH Terms] AND "Drug Design"[MeSH Terms] AND free full text[sb]',
      '"Molecular Docking Simulation"[MeSH Terms] AND "HIV Protease Inhibitors"[MeSH Terms] AND free full text[sb]',
    ],
    maxResultsPerQuery: 50,
  },
];

/** Look up a feed config by vertical domain key. Returns undefined if not found. */
export function getVerticalFeedConfig(domainKey: string): VerticalFeedConfig | undefined {
  return VERTICAL_FEED_CONFIGS.find((c) => c.domainKey === domainKey);
}
