/**
 * sourceRegistry.ts — Source Whitelist
 * ─────────────────────────────────────────────────────────────────────────────
 * Defines the authoritative list of approved data sources for Truth Desk.
 *
 * Each source entry specifies:
 *   - schema: the fields this source can verify
 *   - healthCheckFn: async function returning { healthy, latencyMs, error }
 *   - failureMode: "hard_stop" (block all verdicts) | "degrade" (return Insufficient Evidence)
 *   - approved: boolean — only approved sources are used in production
 *   - approvedAt: ISO date string when the source was whitelisted
 *
 * Rule: A source MUST be approved before it can be used in the pipeline.
 * Adding a source here is not sufficient — set approved: true explicitly.
 */

import { checkUniProtHealth } from "./verticalAdapters/uniprotVertical";
import { checkClinicalTrialsHealth } from "./clinicalTrialsAdapter";

// ─── Types ─────────────────────────────────────────────────────────────────────

export type FailureMode = "hard_stop" | "degrade";

export interface SourceHealthResult {
  healthy: boolean;
  latencyMs: number;
  error: string | null;
  checkedAt: string; // ISO timestamp
}

export interface SourceDefinition {
  /** Unique identifier for this source */
  id: string;
  /** Human-readable name */
  displayName: string;
  /** Short description of what this source verifies */
  description: string;
  /** Base URL for the source API */
  apiBaseUrl: string;
  /** Fields/claim types this source can verify */
  schema: string[];
  /** What happens when this source is unreachable */
  failureMode: FailureMode;
  /** Whether this source is approved for production use */
  approved: boolean;
  /** ISO date when the source was approved (null if pending) */
  approvedAt: string | null;
  /** Run a live health check against this source */
  healthCheckFn: () => Promise<{ healthy: boolean; latencyMs: number; error: string | null }>;
}

// ─── Source definitions ────────────────────────────────────────────────────────

export const SOURCE_WHITELIST: SourceDefinition[] = [
  {
    id: "rcsb_pdb",
    displayName: "RCSB Protein Data Bank (PDB)",
    description:
      "Verifies molecular structure claims: resolution, experimental method, " +
      "organism, ligands, and PDB ID existence. The reference source for structural biology.",
    apiBaseUrl: "https://data.rcsb.org/rest/v1",
    schema: ["pdb_id", "resolution", "experimental_method", "organism", "ligand", "protein_name"],
    failureMode: "degrade",
    approved: true,
    approvedAt: "2024-01-01",
    healthCheckFn: async () => {
      const start = Date.now();
      try {
        const res = await fetch(
          "https://data.rcsb.org/rest/v1/core/entry/1LYZ",
          { signal: AbortSignal.timeout(8_000) }
        );
        const latencyMs = Date.now() - start;
        if (!res.ok) return { healthy: false, latencyMs, error: `HTTP ${res.status}` };
        const data = await res.json() as Record<string, unknown>;
        const ok = !!(data?.entry_id ?? data?.rcsb_id);
        return { healthy: ok, latencyMs, error: ok ? null : "Unexpected response shape" };
      } catch (err) {
        return { healthy: false, latencyMs: Date.now() - start, error: String(err) };
      }
    },
  },

  {
    id: "pubmed",
    displayName: "PubMed E-utilities (NCBI)",
    description:
      "Verifies publication existence, author affiliations, and abstract content " +
      "for biomedical literature claims.",
    apiBaseUrl: "https://eutils.ncbi.nlm.nih.gov/entrez/eutils",
    schema: ["pmid", "doi", "publication_title", "author", "journal", "year"],
    failureMode: "degrade",
    approved: true,
    approvedAt: "2024-01-01",
    healthCheckFn: async () => {
      const start = Date.now();
      try {
        const res = await fetch(
          "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=11748933&retmode=json",
          { signal: AbortSignal.timeout(8_000) }
        );
        const latencyMs = Date.now() - start;
        if (!res.ok) return { healthy: false, latencyMs, error: `HTTP ${res.status}` };
        const data = await res.json() as Record<string, unknown>;
        const ok = !!(data?.result);
        return { healthy: ok, latencyMs, error: ok ? null : "Unexpected response shape" };
      } catch (err) {
        return { healthy: false, latencyMs: Date.now() - start, error: String(err) };
      }
    },
  },

  {
    id: "uniprot",
    displayName: "UniProt Knowledge Base (UniProtKB)",
    description:
      "Verifies protein identity claims: protein names, gene names, organism associations, " +
      "and functional annotations. Prioritises Swiss-Prot reviewed entries.",
    apiBaseUrl: "https://rest.uniprot.org/uniprotkb",
    schema: ["protein_name", "gene_name", "organism", "function", "uniprot_accession"],
    failureMode: "degrade",
    approved: true,
    approvedAt: "2025-06-07",
    healthCheckFn: checkUniProtHealth,
  },

  {
    id: "clinicaltrials_gov",
    displayName: "ClinicalTrials.gov (REST API v2)",
    description:
      "Verifies clinical trial claims: trial registration (NCT IDs), trial status, " +
      "interventions, phases, and enrollment counts.",
    apiBaseUrl: "https://clinicaltrials.gov/api/v2",
    schema: ["trial_id", "trial_status", "intervention", "trial_phase", "enrollment"],
    failureMode: "degrade",
    approved: true,
    approvedAt: "2025-06-07",
    healthCheckFn: checkClinicalTrialsHealth,
  },

  // ── OpenFDA (approved 2026-06-13) ───────────────────────────────────────────────

  {
    id: "openfda",
    displayName: "OpenFDA (FDA Adverse Events & Drug Labels)",
    description:
      "Verifies adverse event claims and drug label information for pharmaceutical claims. " +
      "Covers FDA drug events, drug labels, and device adverse events.",
    apiBaseUrl: "https://api.fda.gov",
    schema: ["adverse_event", "drug_label", "drug_name", "indication"],
    failureMode: "degrade",
    approved: true,
    approvedAt: "2026-06-13",
    healthCheckFn: async () => {
      const start = Date.now();
      try {
        const res = await fetch(
          "https://api.fda.gov/drug/event.json?limit=1",
          { signal: AbortSignal.timeout(8_000) }
        );
        const latencyMs = Date.now() - start;
        return { healthy: res.ok, latencyMs, error: res.ok ? null : `HTTP ${res.status}` };
      } catch (err) {
        return { healthy: false, latencyMs: Date.now() - start, error: String(err) };
      }
    },
  },

  {
    id: "efsa_openfoodtox",
    displayName: "EFSA OpenFoodTox (Toxicological Data)",
    description:
      "Will verify toxicological claims and safety thresholds for food and feed substances. " +
      "Opens food safety verification vertical.",
    apiBaseUrl: "https://data.efsa.europa.eu/api",
    schema: ["substance_name", "tdi", "adi", "noael", "hazard_characterisation"],
    failureMode: "degrade",
    approved: true,
    approvedAt: "2026-06-13",
    healthCheckFn: async () => {
      const start = Date.now();
      try {
        const res = await fetch(
          "https://data.efsa.europa.eu/api/catalogue/substance?page=0&size=1",
          { signal: AbortSignal.timeout(8_000) }
        );
        const latencyMs = Date.now() - start;
        return { healthy: res.ok, latencyMs, error: res.ok ? null : `HTTP ${res.status}` };
      } catch (err) {
        return { healthy: false, latencyMs: Date.now() - start, error: String(err) };
      }
    },
  },

  // ── CrossRef (approved 2026-06-13) ───────────────────────────────────────────────

  {
    id: "crossref",
    displayName: "CrossRef (130M+ DOIs, All Disciplines)",
    description:
      "Domain-agnostic DOI and citation verification across all academic disciplines. " +
      "The universal citation registry — any citable claim can be verified.",
    apiBaseUrl: "https://api.crossref.org",
    schema: ["doi", "title", "journal", "year", "citations", "abstract"],
    failureMode: "degrade",
    approved: true,
    approvedAt: "2026-06-13",
    healthCheckFn: async () => {
      const start = Date.now();
      try {
        const res = await fetch(
          "https://api.crossref.org/works/10.1038/nature12373",
          {
            headers: { "User-Agent": "citation-engine/1.0 (citation-engine@citation.is)" },
            signal: AbortSignal.timeout(8_000),
          }
        );
        const latencyMs = Date.now() - start;
        return { healthy: res.ok, latencyMs, error: res.ok ? null : `HTTP ${res.status}` };
      } catch (err) {
        return { healthy: false, latencyMs: Date.now() - start, error: String(err) };
      }
    },
  },

  // ── OpenAlex (approved 2026-06-13) ───────────────────────────────────────────────

  {
    id: "openalex",
    displayName: "OpenAlex (250M+ Scholarly Works)",
    description:
      "Comprehensive open scholarly index covering all academic disciplines. " +
      "Provides citation graph, concept classification, and open access availability.",
    apiBaseUrl: "https://api.openalex.org",
    schema: ["id", "doi", "title", "abstract", "year", "citations", "concepts"],
    failureMode: "degrade",
    approved: true,
    approvedAt: "2026-06-13",
    healthCheckFn: async () => {
      const start = Date.now();
      try {
        const res = await fetch(
          "https://api.openalex.org/works/doi:10.1038/nature12373?mailto=citation-engine@citation.is",
          { signal: AbortSignal.timeout(8_000) }
        );
        const latencyMs = Date.now() - start;
        return { healthy: res.ok, latencyMs, error: res.ok ? null : `HTTP ${res.status}` };
      } catch (err) {
        return { healthy: false, latencyMs: Date.now() - start, error: String(err) };
      }
    },
  },

  // ── Semantic Scholar (approved 2026-06-13) ────────────────────────────────────────

  {
    id: "semantic_scholar",
    displayName: "Semantic Scholar (200M+ Papers, AI-Powered)",
    description:
      "Semantic search across 200M+ papers with citation graph and influential citation signals. " +
      "Strong for AI, computer science, biomedical, and interdisciplinary claims.",
    apiBaseUrl: "https://api.semanticscholar.org/graph/v1",
    schema: ["paperId", "doi", "title", "abstract", "year", "citationCount", "influentialCitationCount"],
    failureMode: "degrade",
    approved: true,
    approvedAt: "2026-06-13",
    healthCheckFn: async () => {
      const start = Date.now();
      try {
        const res = await fetch(
          "https://api.semanticscholar.org/graph/v1/paper/DOI:10.1038/nature12373?fields=paperId,title",
          { signal: AbortSignal.timeout(8_000) }
        );
        const latencyMs = Date.now() - start;
        return { healthy: res.ok, latencyMs, error: res.ok ? null : `HTTP ${res.status}` };
      } catch (err) {
        return { healthy: false, latencyMs: Date.now() - start, error: String(err) };
      }
    },
  },
  // ── Science & medicine (approved 2026-06-13) ─────────────────────────────────
  {
    id: "who",
    displayName: "WHO Global Health Observatory",
    description: "World Health Organization official health indicators and statistics.",
    apiBaseUrl: "https://ghoapi.azureedge.net/api",
    schema: ["IndicatorCode", "SpatialDim", "TimeDim", "NumericValue"],
    failureMode: "degrade",
    approved: true,
    approvedAt: "2026-06-13",
    healthCheckFn: async () => {
      const start = Date.now();
      try {
        const res = await fetch("https://ghoapi.azureedge.net/api/Indicator?$top=1", { signal: AbortSignal.timeout(8_000) });
        return { healthy: res.ok, latencyMs: Date.now() - start, error: res.ok ? null : `HTTP ${res.status}` };
      } catch (err) { return { healthy: false, latencyMs: Date.now() - start, error: String(err) }; }
    },
  },
  {
    id: "cochrane",
    displayName: "Cochrane Library",
    description: "Systematic reviews and meta-analyses — gold standard for clinical evidence.",
    apiBaseUrl: "https://www.cochranelibrary.com",
    schema: ["doi", "title", "abstract", "reviewGroup"],
    failureMode: "degrade",
    approved: true,
    approvedAt: "2026-06-13",
    healthCheckFn: async () => {
      const start = Date.now();
      try {
        const res = await fetch("https://www.cochranelibrary.com/cdsr/doi/10.1002/14651858.CD000980.pub4/full", { signal: AbortSignal.timeout(8_000) });
        return { healthy: res.ok || res.status === 403, latencyMs: Date.now() - start, error: null };
      } catch (err) { return { healthy: false, latencyMs: Date.now() - start, error: String(err) }; }
    },
  },
  {
    id: "biorxiv",
    displayName: "bioRxiv / medRxiv",
    description: "Preprint server for biology and medicine.",
    apiBaseUrl: "https://api.biorxiv.org",
    schema: ["doi", "title", "abstract", "date", "category"],
    failureMode: "degrade",
    approved: true,
    approvedAt: "2026-06-13",
    healthCheckFn: async () => {
      const start = Date.now();
      try {
        const res = await fetch("https://api.biorxiv.org/details/biorxiv/10.1101/2020.01.22.914440/na/json", { signal: AbortSignal.timeout(8_000) });
        return { healthy: res.ok, latencyMs: Date.now() - start, error: res.ok ? null : `HTTP ${res.status}` };
      } catch (err) { return { healthy: false, latencyMs: Date.now() - start, error: String(err) }; }
    },
  },
  {
    id: "europe_pmc",
    displayName: "Europe PMC",
    description: "Open access life sciences literature from EBI.",
    apiBaseUrl: "https://www.ebi.ac.uk/europepmc/webservices/rest",
    schema: ["pmid", "pmcid", "doi", "title", "abstractText"],
    failureMode: "degrade",
    approved: true,
    approvedAt: "2026-06-13",
    healthCheckFn: async () => {
      const start = Date.now();
      try {
        const res = await fetch("https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=aspirin&format=json&pageSize=1", { signal: AbortSignal.timeout(8_000) });
        return { healthy: res.ok, latencyMs: Date.now() - start, error: res.ok ? null : `HTTP ${res.status}` };
      } catch (err) { return { healthy: false, latencyMs: Date.now() - start, error: String(err) }; }
    },
  },
  {
    id: "clinvar",
    displayName: "ClinVar",
    description: "NCBI database of genetic variants and clinical significance.",
    apiBaseUrl: "https://eutils.ncbi.nlm.nih.gov/entrez/eutils",
    schema: ["variation_id", "clinical_significance", "gene", "condition"],
    failureMode: "degrade",
    approved: true,
    approvedAt: "2026-06-13",
    healthCheckFn: async () => {
      const start = Date.now();
      try {
        const res = await fetch("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=clinvar&term=BRCA1&retmode=json&retmax=1", { signal: AbortSignal.timeout(8_000) });
        return { healthy: res.ok, latencyMs: Date.now() - start, error: res.ok ? null : `HTTP ${res.status}` };
      } catch (err) { return { healthy: false, latencyMs: Date.now() - start, error: String(err) }; }
    },
  },
  {
    id: "chembl",
    displayName: "ChEMBL",
    description: "EMBL-EBI bioactivity database for drug compounds.",
    apiBaseUrl: "https://www.ebi.ac.uk/chembl/api/data",
    schema: ["molecule_chembl_id", "pref_name", "max_phase", "molecule_type"],
    failureMode: "degrade",
    approved: true,
    approvedAt: "2026-06-13",
    healthCheckFn: async () => {
      const start = Date.now();
      try {
        const res = await fetch("https://www.ebi.ac.uk/chembl/api/data/molecule?format=json&limit=1", { signal: AbortSignal.timeout(8_000) });
        return { healthy: res.ok, latencyMs: Date.now() - start, error: res.ok ? null : `HTTP ${res.status}` };
      } catch (err) { return { healthy: false, latencyMs: Date.now() - start, error: String(err) }; }
    },
  },
  {
    id: "pubchem",
    displayName: "PubChem",
    description: "NCBI chemical compound database with bioactivity data.",
    apiBaseUrl: "https://pubchem.ncbi.nlm.nih.gov/rest/pug",
    schema: ["CID", "IUPACName", "MolecularFormula", "MolecularWeight"],
    failureMode: "degrade",
    approved: true,
    approvedAt: "2026-06-13",
    healthCheckFn: async () => {
      const start = Date.now();
      try {
        const res = await fetch("https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/aspirin/JSON", { signal: AbortSignal.timeout(8_000) });
        return { healthy: res.ok, latencyMs: Date.now() - start, error: res.ok ? null : `HTTP ${res.status}` };
      } catch (err) { return { healthy: false, latencyMs: Date.now() - start, error: String(err) }; }
    },
  },
  {
    id: "openfda_labels",
    displayName: "OpenFDA Drug Labels",
    description: "FDA-approved drug label information.",
    apiBaseUrl: "https://api.fda.gov/drug/label.json",
    schema: ["openfda.brand_name", "indications_and_usage", "contraindications", "dosage_and_administration"],
    failureMode: "degrade",
    approved: true,
    approvedAt: "2026-06-13",
    healthCheckFn: async () => {
      const start = Date.now();
      try {
        const res = await fetch("https://api.fda.gov/drug/label.json?search=aspirin&limit=1", { signal: AbortSignal.timeout(8_000) });
        return { healthy: res.ok, latencyMs: Date.now() - start, error: res.ok ? null : `HTTP ${res.status}` };
      } catch (err) { return { healthy: false, latencyMs: Date.now() - start, error: String(err) }; }
    },
  },
  // ── Law & regulation (approved 2026-06-13) ───────────────────────────────────────
  {
    id: "edgar_sec",
    displayName: "SEC EDGAR",
    description: "US Securities and Exchange Commission financial filings.",
    apiBaseUrl: "https://efts.sec.gov/LATEST",
    schema: ["entityName", "filingDate", "formType", "fileNum"],
    failureMode: "degrade",
    approved: true,
    approvedAt: "2026-06-13",
    healthCheckFn: async () => {
      const start = Date.now();
      try {
        const res = await fetch("https://efts.sec.gov/LATEST/search-index?q=apple&forms=10-K", { signal: AbortSignal.timeout(8_000) });
        return { healthy: res.ok, latencyMs: Date.now() - start, error: res.ok ? null : `HTTP ${res.status}` };
      } catch (err) { return { healthy: false, latencyMs: Date.now() - start, error: String(err) }; }
    },
  },
  {
    id: "eur_lex",
    displayName: "EUR-Lex",
    description: "Official EU law — regulations, directives, treaties.",
    apiBaseUrl: "https://eur-lex.europa.eu",
    schema: ["celex", "title", "date", "type"],
    failureMode: "degrade",
    approved: true,
    approvedAt: "2026-06-13",
    healthCheckFn: async () => {
      const start = Date.now();
      try {
        const res = await fetch("https://eur-lex.europa.eu/search.html?type=quick&lang=en&text=GDPR", { signal: AbortSignal.timeout(8_000) });
        return { healthy: res.ok, latencyMs: Date.now() - start, error: res.ok ? null : `HTTP ${res.status}` };
      } catch (err) { return { healthy: false, latencyMs: Date.now() - start, error: String(err) }; }
    },
  },
  {
    id: "court_listener",
    displayName: "CourtListener",
    description: "US federal and state court opinions and case law.",
    apiBaseUrl: "https://www.courtlistener.com/api/rest/v4",
    schema: ["caseName", "dateFiled", "court", "citation"],
    failureMode: "degrade",
    approved: true,
    approvedAt: "2026-06-13",
    healthCheckFn: async () => {
      const start = Date.now();
      try {
        const res = await fetch("https://www.courtlistener.com/api/rest/v4/search/?q=roe+wade&type=o&format=json&page_size=1", { signal: AbortSignal.timeout(8_000) });
        return { healthy: res.ok, latencyMs: Date.now() - start, error: res.ok ? null : `HTTP ${res.status}` };
      } catch (err) { return { healthy: false, latencyMs: Date.now() - start, error: String(err) }; }
    },
  },
  {
    id: "ietf_rfc",
    displayName: "IETF RFC Editor",
    description: "Internet standards and technical specifications.",
    apiBaseUrl: "https://www.rfc-editor.org",
    schema: ["rfc", "title", "status", "date"],
    failureMode: "degrade",
    approved: true,
    approvedAt: "2026-06-13",
    healthCheckFn: async () => {
      const start = Date.now();
      try {
        const res = await fetch("https://www.rfc-editor.org/rfc/rfc9110.txt", { signal: AbortSignal.timeout(8_000) });
        return { healthy: res.ok, latencyMs: Date.now() - start, error: res.ok ? null : `HTTP ${res.status}` };
      } catch (err) { return { healthy: false, latencyMs: Date.now() - start, error: String(err) }; }
    },
  },
  // ── Government & data (approved 2026-06-13) ───────────────────────────────────────
  {
    id: "world_bank",
    displayName: "World Bank Open Data",
    description: "World Bank development indicators and economic statistics.",
    apiBaseUrl: "https://api.worldbank.org/v2",
    schema: ["indicator", "country", "date", "value"],
    failureMode: "degrade",
    approved: true,
    approvedAt: "2026-06-13",
    healthCheckFn: async () => {
      const start = Date.now();
      try {
        const res = await fetch("https://api.worldbank.org/v2/country/US/indicator/NY.GDP.MKTP.CD?format=json&mrv=1", { signal: AbortSignal.timeout(8_000) });
        return { healthy: res.ok, latencyMs: Date.now() - start, error: res.ok ? null : `HTTP ${res.status}` };
      } catch (err) { return { healthy: false, latencyMs: Date.now() - start, error: String(err) }; }
    },
  },
  {
    id: "owid",
    displayName: "Our World in Data",
    description: "Long-run global data on health, economics, and development.",
    apiBaseUrl: "https://ourworldindata.org",
    schema: ["entity", "year", "value", "variable"],
    failureMode: "degrade",
    approved: true,
    approvedAt: "2026-06-13",
    healthCheckFn: async () => {
      const start = Date.now();
      try {
        const res = await fetch("https://ourworldindata.org/grapher/life-expectancy.csv", { signal: AbortSignal.timeout(8_000) });
        return { healthy: res.ok, latencyMs: Date.now() - start, error: res.ok ? null : `HTTP ${res.status}` };
      } catch (err) { return { healthy: false, latencyMs: Date.now() - start, error: String(err) }; }
    },
  },
  {
    id: "oecd",
    displayName: "OECD iLibrary",
    description: "OECD economic, social, and environmental statistics.",
    apiBaseUrl: "https://stats.oecd.org/SDMX-JSON/data",
    schema: ["dataset", "country", "indicator", "value", "year"],
    failureMode: "degrade",
    approved: true,
    approvedAt: "2026-06-13",
    healthCheckFn: async () => {
      const start = Date.now();
      try {
        const res = await fetch("https://stats.oecd.org/SDMX-JSON/data/QNA/USA.B1_GE.VOBARSA.Q/all?format=jsonvnd.oecd.data+json&lastNObservations=1", { signal: AbortSignal.timeout(10_000) });
        return { healthy: res.ok, latencyMs: Date.now() - start, error: res.ok ? null : `HTTP ${res.status}` };
      } catch (err) { return { healthy: false, latencyMs: Date.now() - start, error: String(err) }; }
    },
  },
  {
    id: "eurostat",
    displayName: "Eurostat",
    description: "Official EU statistical office — economic, social, and demographic data.",
    apiBaseUrl: "https://ec.europa.eu/eurostat/api/dissemination",
    schema: ["dataset", "geo", "time", "value"],
    failureMode: "degrade",
    approved: true,
    approvedAt: "2026-06-13",
    healthCheckFn: async () => {
      const start = Date.now();
      try {
        const res = await fetch("https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/nama_10_gdp?format=JSON&geo=EU27_2020&na_item=B1GQ&unit=CP_MEUR&time=2023", { signal: AbortSignal.timeout(10_000) });
        return { healthy: res.ok, latencyMs: Date.now() - start, error: res.ok ? null : `HTTP ${res.status}` };
      } catch (err) { return { healthy: false, latencyMs: Date.now() - start, error: String(err) }; }
    },
  },
  {
    id: "ipcc",
    displayName: "IPCC Assessment Reports",
    description: "IPCC climate science assessment reports — highest scientific consensus.",
    apiBaseUrl: "https://api.crossref.org/works",
    schema: ["doi", "title", "year", "report"],
    failureMode: "degrade",
    approved: true,
    approvedAt: "2026-06-13",
    healthCheckFn: async () => {
      const start = Date.now();
      try {
        const res = await fetch("https://api.crossref.org/works/10.1017/9781009157896", { signal: AbortSignal.timeout(8_000) });
        return { healthy: res.ok, latencyMs: Date.now() - start, error: res.ok ? null : `HTTP ${res.status}` };
      } catch (err) { return { healthy: false, latencyMs: Date.now() - start, error: String(err) }; }
    },
  },
  // ── Standards & technical (approved 2026-06-13) ────────────────────────────────────
  {
    id: "arxiv",
    displayName: "arXiv",
    description: "Open access preprints in physics, maths, CS, biology, and economics.",
    apiBaseUrl: "https://export.arxiv.org/api",
    schema: ["arxivId", "title", "summary", "authors", "published"],
    failureMode: "degrade",
    approved: true,
    approvedAt: "2026-06-13",
    healthCheckFn: async () => {
      const start = Date.now();
      try {
        const res = await fetch("https://export.arxiv.org/api/query?search_query=all:electron&max_results=1", { signal: AbortSignal.timeout(8_000) });
        return { healthy: res.ok, latencyMs: Date.now() - start, error: res.ok ? null : `HTTP ${res.status}` };
      } catch (err) { return { healthy: false, latencyMs: Date.now() - start, error: String(err) }; }
    },
  },
  {
    id: "wikidata",
    displayName: "Wikidata",
    description: "Structured knowledge graph — facts, entities, and relationships.",
    apiBaseUrl: "https://www.wikidata.org/w/api.php",
    schema: ["qid", "label", "description", "claims"],
    failureMode: "degrade",
    approved: true,
    approvedAt: "2026-06-13",
    healthCheckFn: async () => {
      const start = Date.now();
      try {
        const res = await fetch("https://www.wikidata.org/w/api.php?action=wbsearchentities&search=aspirin&language=en&format=json&limit=1", { signal: AbortSignal.timeout(8_000) });
        return { healthy: res.ok, latencyMs: Date.now() - start, error: res.ok ? null : `HTTP ${res.status}` };
      } catch (err) { return { healthy: false, latencyMs: Date.now() - start, error: String(err) }; }
    },
  },
  {
    id: "nist",
    displayName: "NIST",
    description: "US National Institute of Standards and Technology — measurement standards.",
    apiBaseUrl: "https://data.nist.gov/rmm",
    schema: ["title", "description", "keyword", "modified"],
    failureMode: "degrade",
    approved: true,
    approvedAt: "2026-06-13",
    healthCheckFn: async () => {
      const start = Date.now();
      try {
        const res = await fetch("https://data.nist.gov/rmm/records?q=cybersecurity&size=1", { signal: AbortSignal.timeout(8_000) });
        return { healthy: res.ok, latencyMs: Date.now() - start, error: res.ok ? null : `HTTP ${res.status}` };
      } catch (err) { return { healthy: false, latencyMs: Date.now() - start, error: String(err) }; }
    },
  },
];

// ─── Registry helpers ──────────────────────────────────────────────────────────

export function getApprovedSources(): SourceDefinition[] {
  return SOURCE_WHITELIST.filter((s) => s.approved);
}

export function getPendingSources(): SourceDefinition[] {
  return SOURCE_WHITELIST.filter((s) => !s.approved);
}

export function getSourceById(id: string): SourceDefinition | undefined {
  return SOURCE_WHITELIST.find((s) => s.id === id);
}

/**
 * Approve a pending source for production use.
 * Mutates the in-memory whitelist. Changes persist for the lifetime of the process.
 */
export function approveSource(sourceId: string): boolean {
  const source = SOURCE_WHITELIST.find((s) => s.id === sourceId);
  if (!source) return false;
  source.approved = true;
  source.approvedAt = new Date().toISOString();
  return true;
}

/**
 * Reject (un-approve) a source, removing it from production use.
 */
export function rejectSource(sourceId: string): boolean {
  const source = SOURCE_WHITELIST.find((s) => s.id === sourceId);
  if (!source) return false;
  source.approved = false;
  source.approvedAt = null;
  return true;
}

export async function runHealthCheck(sourceId: string): Promise<SourceHealthResult | null> {
  const source = getSourceById(sourceId);
  if (!source) return null;
  const result = await source.healthCheckFn();
  return { ...result, checkedAt: new Date().toISOString() };
}

export async function runAllHealthChecks(): Promise<Record<string, SourceHealthResult>> {
  const results: Record<string, SourceHealthResult> = {};
  await Promise.allSettled(
    SOURCE_WHITELIST.map(async (source) => {
      try {
        const result = await source.healthCheckFn();
        results[source.id] = { ...result, checkedAt: new Date().toISOString() };
      } catch (err) {
        results[source.id] = {
          healthy: false,
          latencyMs: 0,
          error: String(err),
          checkedAt: new Date().toISOString(),
        };
      }
    })
  );
  return results;
}
