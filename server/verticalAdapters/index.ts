/**
 * verticalAdapters/index.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Public entry point for the vertical adapter system.
 * Re-exports types and registry from types.ts, then imports adapter
 * implementations so they self-register on module load.
 */

export {
  registerVertical,
  getVertical,
  listVerticals,
  registry,
  type EvidenceResult,
  type VerticalAdapter,
} from "./types";

// Import adapters after registry is initialised — they call registerVertical()
// on module load. Order matters: structural_biology first (reference impl).

// ── Domain-specific vertical adapters (biomedical) ───────────────────────────
import "./structuralBiology";
import "./salmonBiotech";
import "./proteinSupplement";
import "./creatineErgogenics";
import "./gutMicrobiome";
import "./collagenPeptides";
import "./plantBasedProtein";
import "./sportsNutritionRct";
import "./uniprotVertical";
import "./clinicalTrialsVertical";

// ── Domain-agnostic adapters (approved 2026-06-13) ───────────────────────────
// These make the engine verifiable across ALL academic disciplines.
import "./crossRef"; // 130M+ DOIs — universal citation registry
import "./openAlex"; // 250M+ works — comprehensive scholarly index
import "./semanticScholar"; // 200M+ papers — semantic search + citation graph
// ── Science & medicine adapters ─────────────────────────────────────────────
import "./who"; // WHO GHO — global health indicators
import "./cochrane"; // Cochrane Library — systematic reviews (gold standard)
import "./biorxiv"; // bioRxiv/medRxiv — preprints
import "./europe_pmc"; // Europe PMC — open access life sciences
import "./clinvar"; // ClinVar — genetic variants
import "./chembl"; // ChEMBL — drug/compound bioactivity
import "./pubchem"; // PubChem — chemical compounds
import "./openfda_labels"; // OpenFDA drug labels
// ── Law & regulation adapters ────────────────────────────────────────────────
import "./edgar_sec"; // SEC EDGAR — financial filings
import "./eur_lex"; // EUR-Lex — EU law and regulations
import "./court_listener"; // CourtListener — US case law
import "./ietf_rfc"; // IETF RFC — internet standards
// ── Government & data adapters ───────────────────────────────────────────────
import "./world_bank"; // World Bank Open Data — development indicators
import "./owid"; // Our World in Data — long-run global trends
import "./oecd"; // OECD iLibrary — economic statistics
import "./eurostat"; // Eurostat — EU official statistics
import "./ipcc"; // IPCC Assessment Reports — climate science
import "./noaa"; // NOAA — climate observations, sea level, temperature records (Sprint 21)
import "./fred"; // FRED — Federal Reserve economic data, 250K+ series (Sprint 21)
import "./imf"; // IMF DataMapper — GDP, inflation, fiscal data for 190+ countries (Sprint 22)
// ── Standards & technical adapters ───────────────────────────────────────────
import "./arxiv"; // arXiv — preprints across CS, physics, maths
import "./wikidata"; // Wikidata — structured knowledge graph
import "./nist"; // NIST — measurement standards
import "./opencitations"; // OpenCitations — open citation graph + bibliographic metadata
import "./crossrefRetraction"; // Crossref + Scite — DOI retraction detection (Sprint 21)
import "./openfda_adverse"; // Sprint 30 — OpenFDA adverse events
import "./nice"; // Sprint 30 — NICE UK clinical guidelines
import "./who_iris"; // Sprint 30 — WHO IRIS repository
import "./embase"; // Sprint 30 — EMBASE biomedical literature
import "./nasa_earthdata"; // Sprint 31 — NASA Earthdata satellite observations
import "./eea"; // Sprint 31 — European Environment Agency
import "./epa"; // Sprint 31 — US EPA environmental science
import "./usda_fooddata"; // Sprint 32 — USDA FoodData Central nutrition
import "./codex"; // Sprint 32 — CODEX Alimentarius food safety standards
import "./bis_statistics"; // Sprint 33 — BIS macroprudential and financial stability statistics
import "./us_code"; // Sprint 33 — US Code (OLRC) federal statutory law
import "./alphafold"; // Sprint 34 — AlphaFold protein structure predictions (EMBL-EBI)
import "./nist_chemistry"; // Sprint 34 — NIST Chemistry WebBook thermochemical/physical data
import "./campbell"; // Sprint 35 — Campbell Collaboration systematic reviews
import "./apa_psycarticles"; // Sprint 35 — APA PsycArticles psychology journals
import "./ssrn"; // Sprint 35 — SSRN social science working papers
import "./iea"; // Sprint 37 — IEA Energy Statistics
import "./irena"; // Sprint 37 — IRENA Renewable Energy Statistics
import "./usgs"; // Sprint 37 — USGS Earth Sciences (earthquakes, minerals)
import "./unknown"; // no-op fallback for unresolved adapter names (sprint-1 fix)
// ── Sprint 30: Biomedical depth ──────────────────────────────────────────────
import "./openfda_adverse"; // OpenFDA adverse events — FAERS drug safety reports
import "./nice";            // NICE Evidence — UK clinical guidelines and appraisals
import "./who_iris";        // WHO IRIS — WHO technical reports and guidelines
import "./embase";          // EMBASE — European biomedical literature (via Europe PMC)
import "./molecularDiscovery"; // ASI-Evolve — dual quantum provenance (WuKong + Jiuzhang 4.0)
import "./omim";              // OMIM — gene-disease associations for Mendelian disorders (Sprint 38)
import "./hivProtease";       // HIV Protease — PDB co-crystals, ChEMBL, PubMed HIV PI literature (Sprint 39)
import "./genericSource"; // URL/DOI fallback — must be last (lowest priority)
