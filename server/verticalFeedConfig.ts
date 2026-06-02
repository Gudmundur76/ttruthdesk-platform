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
 */

export interface VerticalFeedConfig {
  /** Matches the domainKey used in VerticalAdapter and the documents table. */
  domainKey: string;
  displayName: string;
  /**
   * PubMed query strings. Each query is run independently via ESearch.
   * All queries MUST include `pmc open access[filter]` to restrict to
   * legally reusable Open Access papers.
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
      // Core structural biology MeSH terms
      '"Protein Structure, Tertiary"[MeSH Terms] AND pmc open access[filter]',
      '"Crystallography, X-Ray"[MeSH Terms] AND pmc open access[filter]',
      '"Cryoelectron Microscopy"[MeSH Terms] AND pmc open access[filter]',
      '"Protein Conformation"[MeSH Terms] AND "Binding Sites"[MeSH Terms] AND pmc open access[filter]',
      // PDB-linked papers
      '"Protein Data Bank"[All Fields] AND pmc open access[filter]',
    ],
    maxResultsPerQuery: 50,
  },
  {
    domainKey: "salmon_biotech",
    displayName: "Salmon Biotech",
    meshQueries: [
      // Salmon and aquaculture
      '"Salmo salar"[MeSH Terms] AND pmc open access[filter]',
      '"Aquaculture"[MeSH Terms] AND "Salmonidae"[MeSH Terms] AND pmc open access[filter]',
      // Marine bioactives
      '"Fatty Acids, Omega-3"[MeSH Terms] AND "Fishes"[MeSH Terms] AND pmc open access[filter]',
      '"Astaxanthin"[MeSH Terms] AND pmc open access[filter]',
      '"Marine Proteins"[All Fields] AND pmc open access[filter]',
      // Salmon health and genetics
      '"Genome"[MeSH Terms] AND "Salmo salar"[MeSH Terms] AND pmc open access[filter]',
      // Salmon-specific biomarkers
      '"Carotenoids"[MeSH Terms] AND "Salmonidae"[MeSH Terms] AND pmc open access[filter]',
    ],
    maxResultsPerQuery: 40,
  },
];

/** Look up a feed config by vertical domain key. Returns undefined if not found. */
export function getVerticalFeedConfig(domainKey: string): VerticalFeedConfig | undefined {
  return VERTICAL_FEED_CONFIGS.find((c) => c.domainKey === domainKey);
}
