/**
 * discoveryAgent.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Multi-source autonomous discovery agent.
 * Queries three independent sources in parallel and returns a deduplicated
 * list of candidate papers for the audit pipeline.
 *
 * Sources:
 *   1. PubMed  — broad structural biology / molecular evidence search
 *   2. bioRxiv — preprints in biochemistry & molecular biology
 *   3. PDB     — papers linked to recent PDB structure depositions
 *
 * Each result is normalised into a DiscoveryCandidate so downstream code
 * doesn't need to know which source it came from.
 */

export type IngestSource = "pubmed" | "biorxiv" | "pdb_linked";

export interface DiscoveryCandidate {
  pmid: string;           // stable unique key (PMID or synthetic pdb:<id>)
  doi: string | null;
  title: string;
  authors: string | null;
  journal: string | null;
  pubYear: string | null;
  abstractText: string | null;
  ingestSource: IngestSource;
  searchQuery: string;
}

// ─── PubMed search ────────────────────────────────────────────────────────────

const PUBMED_SEARCH_TERMS = [
  // Structural biology core
  "crystal structure protein[Title/Abstract] AND open access[Filter]",
  "cryo-EM structure[Title/Abstract] AND open access[Filter]",
  "X-ray crystallography protein[Title/Abstract] AND open access[Filter]",
  // Molecular evidence in biotech context
  "protein binding affinity structure[Title/Abstract] AND open access[Filter]",
  "antibody structure PDB[Title/Abstract] AND open access[Filter]",
  // deCODE Genetics and Icelandic research (priority seeding)
  "deCODE genetics[Affiliation] AND open access[Filter]",
  "Stefansson K[Author] AND protein[Title/Abstract]",
  // HIV-1 protease inhibitor SAR literature (Sprint 40 — hiv_protease vertical)
  "HIV-1 Protease Inhibitors[MeSH] AND structure-activity[Title/Abstract] AND open access[Filter]",
  "HIV Protease Inhibitors[MeSH] AND darunavir[Title/Abstract]",
  "Anti-HIV Agents[MeSH] AND protease inhibitor[Title/Abstract] AND open access[Filter]",
  "decahydroisoquinoline HIV protease[Title/Abstract]",
  "hydroxyethylamine isostere HIV-1 protease[Title/Abstract]",
];

async function fetchPubMedCandidates(
  query: string,
  maxResults = 10
): Promise<DiscoveryCandidate[]> {
  try {
    // Step 1: search for IDs
    const searchUrl = new URL("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi");
    searchUrl.searchParams.set("db", "pubmed");
    searchUrl.searchParams.set("term", query);
    searchUrl.searchParams.set("retmax", String(maxResults));
    searchUrl.searchParams.set("retmode", "json");
    searchUrl.searchParams.set("sort", "pub+date");

    const searchRes = await fetch(searchUrl.toString(), {
      headers: { "User-Agent": "ProteinTruthDesk/1.0 (contact@proteintruthdeskk.com)" },
    });
    if (!searchRes.ok) return [];
    const searchData = await searchRes.json() as { esearchresult?: { idlist?: string[] } };
    const ids: string[] = searchData.esearchresult?.idlist ?? [];
    if (ids.length === 0) return [];

    // Step 2: fetch summaries
    const summaryUrl = new URL("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi");
    summaryUrl.searchParams.set("db", "pubmed");
    summaryUrl.searchParams.set("id", ids.join(","));
    summaryUrl.searchParams.set("retmode", "json");

    const summaryRes = await fetch(summaryUrl.toString(), {
      headers: { "User-Agent": "ProteinTruthDesk/1.0 (contact@proteintruthdeskk.com)" },
    });
    if (!summaryRes.ok) return [];
    const summaryData = await summaryRes.json() as {
      result?: Record<string, {
        uid?: string;
        title?: string;
        authors?: { name: string }[];
        fulljournalname?: string;
        pubdate?: string;
        elocationid?: string;
        source?: string;
      }>;
    };

    const results: DiscoveryCandidate[] = [];
    for (const pmid of ids) {
      const item = summaryData.result?.[pmid];
      if (!item || !item.title) continue;
      const doi = item.elocationid?.startsWith("doi:") ? item.elocationid.slice(4) : null;
      const pubYear = item.pubdate ? item.pubdate.split(" ")[0] : null;
      const authors = item.authors?.map((a) => a.name).join(", ") ?? null;
      results.push({
        pmid,
        doi,
        title: item.title,
        authors,
        journal: item.fulljournalname ?? item.source ?? null,
        pubYear,
        abstractText: null, // fetched separately when needed
        ingestSource: "pubmed",
        searchQuery: query,
      });
    }
    return results;
  } catch {
    return [];
  }
}

// ─── bioRxiv search ───────────────────────────────────────────────────────────

const BIORXIV_CATEGORIES = ["biochemistry", "biophysics", "molecular-biology"];

async function fetchBioRxivCandidates(
  category: string,
  maxResults = 8
): Promise<DiscoveryCandidate[]> {
  try {
    // bioRxiv REST API: /details/biorxiv/{start}/{end}/{cursor}/{format}
    const today = new Date();
    const thirtyDaysAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
    const fmt = (d: Date) => d.toISOString().slice(0, 10);
    const url = `https://api.biorxiv.org/details/biorxiv/${fmt(thirtyDaysAgo)}/${fmt(today)}/0/json`;

    const res = await fetch(url, {
      headers: { "User-Agent": "ProteinTruthDesk/1.0" },
    });
    if (!res.ok) return [];
    const data = await res.json() as {
      collection?: {
        doi: string;
        title: string;
        authors: string;
        category: string;
        abstract: string;
        date: string;
        server: string;
      }[];
    };

    const items = (data.collection ?? [])
      .filter((item) => item.category?.toLowerCase().includes(category.replace("-", " ")))
      .slice(0, maxResults);

    return items.map((item) => ({
      pmid: `biorxiv:${item.doi.replace(/\//g, "_")}`,
      doi: item.doi,
      title: item.title,
      authors: item.authors,
      journal: `bioRxiv (${item.category})`,
      pubYear: item.date?.slice(0, 4) ?? null,
      abstractText: item.abstract ?? null,
      ingestSource: "biorxiv" as IngestSource,
      searchQuery: `biorxiv:${category}`,
    }));
  } catch {
    return [];
  }
}

// ─── PDB recent depositions ───────────────────────────────────────────────────

async function fetchPdbLinkedCandidates(maxResults = 10): Promise<DiscoveryCandidate[]> {
  try {
    // PDB search API: find recently deposited structures with primary citations
    const query = {
      query: {
        type: "terminal",
        service: "text",
        parameters: {
          attribute: "rcsb_entry_info.resolution_combined",
          operator: "less_or_equal",
          value: 2.5,
        },
      },
      return_type: "entry",
      request_options: {
        paginate: { start: 0, rows: maxResults },
        sort: [{ sort_by: "rcsb_accession_info.deposit_date", direction: "desc" }],
        results_content_type: ["experimental"],
      },
    };

    const res = await fetch("https://search.rcsb.org/rcsbsearch/v2/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(query),
    });
    if (!res.ok) return [];
    const data = await res.json() as { result_set?: { identifier: string }[] };
    const pdbIds = (data.result_set ?? []).map((r) => r.identifier).slice(0, maxResults);

    const candidates: DiscoveryCandidate[] = [];
    for (const pdbId of pdbIds) {
      try {
        const dataRes = await fetch(
          `https://data.rcsb.org/rest/v1/core/entry/${pdbId}`
        );
        if (!dataRes.ok) continue;
        const entry = await dataRes.json() as {
          rcsb_primary_citation?: {
            title?: string;
            pdbx_database_id_pub_med?: string;
            pdbx_database_id_doi?: string;
            journal_abbrev?: string;
            year?: number;
            rcsb_authors?: string[];
          };
        };
        const cit = entry.rcsb_primary_citation;
        if (!cit?.title) continue;
        const pmid = cit.pdbx_database_id_pub_med
          ? String(cit.pdbx_database_id_pub_med)
          : `pdb:${pdbId}`;
        candidates.push({
          pmid,
          doi: cit.pdbx_database_id_doi ?? null,
          title: cit.title,
          authors: cit.rcsb_authors?.join(", ") ?? null,
          journal: cit.journal_abbrev ?? null,
          pubYear: cit.year ? String(cit.year) : null,
          abstractText: null,
          ingestSource: "pdb_linked",
          searchQuery: `pdb:${pdbId}`,
        });
      } catch {
        // skip individual PDB entry errors
      }
    }
    return candidates;
  } catch {
    return [];
  }
}

// ─── Main discovery function ──────────────────────────────────────────────────

export interface DiscoveryResult {
  candidates: DiscoveryCandidate[];
  sourceBreakdown: Record<IngestSource, number>;
  totalFetched: number;
  deduplicatedCount: number;
}

/**
 * Run all three sources in parallel and return a deduplicated list of
 * candidates ordered by source priority (PDB-linked first, then PubMed,
 * then bioRxiv preprints).
 */
export async function runDiscoveryAgent(options?: {
  pubmedMaxPerQuery?: number;
  bioRxivMaxPerCategory?: number;
  pdbMaxResults?: number;
}): Promise<DiscoveryResult> {
  const {
    pubmedMaxPerQuery = 8,
    bioRxivMaxPerCategory = 6,
    pdbMaxResults = 8,
  } = options ?? {};

  // Run all sources in parallel
  const [pubmedResults, bioRxivResults, pdbResults] = await Promise.all([
    Promise.all(
      PUBMED_SEARCH_TERMS.map((q) => fetchPubMedCandidates(q, pubmedMaxPerQuery))
    ).then((arrs) => arrs.flat()),
    Promise.all(
      BIORXIV_CATEGORIES.map((c) => fetchBioRxivCandidates(c, bioRxivMaxPerCategory))
    ).then((arrs) => arrs.flat()),
    fetchPdbLinkedCandidates(pdbMaxResults),
  ]);

  const totalFetched = pubmedResults.length + bioRxivResults.length + pdbResults.length;

  // Deduplicate by pmid (stable key across sources)
  const seen = new Set<string>();
  const deduped: DiscoveryCandidate[] = [];

  // Priority order: PDB-linked (highest evidence density) → PubMed → bioRxiv
  for (const candidate of [...pdbResults, ...pubmedResults, ...bioRxivResults]) {
    if (!seen.has(candidate.pmid)) {
      seen.add(candidate.pmid);
      deduped.push(candidate);
    }
  }

  const sourceBreakdown: Record<IngestSource, number> = {
    pubmed: deduped.filter((c) => c.ingestSource === "pubmed").length,
    biorxiv: deduped.filter((c) => c.ingestSource === "biorxiv").length,
    pdb_linked: deduped.filter((c) => c.ingestSource === "pdb_linked").length,
  };

  return {
    candidates: deduped,
    sourceBreakdown,
    totalFetched,
    deduplicatedCount: deduped.length,
  };
}
