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
];

/** Look up a feed config by vertical domain key. Returns undefined if not found. */
export function getVerticalFeedConfig(domainKey: string): VerticalFeedConfig | undefined {
  return VERTICAL_FEED_CONFIGS.find((c) => c.domainKey === domainKey);
}
