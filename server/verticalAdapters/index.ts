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
import "./unknown"; // no-op fallback for unresolved adapter names (sprint-1 fix)
import "./genericSource"; // URL/DOI fallback — must be last (lowest priority)
