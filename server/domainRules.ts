/** domainRules.ts — Sprint 26: 15 domain signal rules + fallback for domainClassifier. */
import type { DomainLabel, SourceId } from "./domainClassifier";

export interface SourceRoute {
  sourceId: SourceId;
  confidence: number;
  reason: string;
}

export interface DomainRule {
  domain: DomainLabel;
  patterns: RegExp[];
  routes: SourceRoute[];
}

export const DOMAIN_RULES: DomainRule[] = [
  // ── Structural Biology ────────────────────────────────────────────────────
  {
    domain: "structural_biology",
    patterns: [
      /\b(protein\s+structure|crystal\s+structure|x-ray\s+crystallography|cryo-?em|nmr\s+structure|pdb\s+(id|entry|code)|resolution\s+\d+\s*[åa]|binding\s+site|active\s+site|ligand\s+binding)\b/i,
    ],
    routes: [
      {
        sourceId: "rcsb_pdb",
        confidence: 0.95,
        reason: "Structural biology claim — RCSB PDB is the primary source",
      },
      {
        sourceId: "uniprot",
        confidence: 0.7,
        reason: "Protein function context from UniProt",
      },
      {
        sourceId: "alphafold" as SourceId,
        confidence: 0.88,
        reason: "AlphaFold predicted protein structure from EMBL-EBI",
      },
      {
        sourceId: "pubmed",
        confidence: 0.6,
        reason: "Supporting literature from PubMed",
      },
    ],
  },
  // ── Protein Biochemistry ──────────────────────────────────────────────────
  {
    domain: "protein_biochemistry",
    patterns: [
      /\b(protein|enzyme|receptor|antibody|kinase|protease|transcription\s+factor|amino\s+acid|peptide|polypeptide|uniprot|gene\s+expression|mrna|rna\s+binding)\b/i,
    ],
    routes: [
      {
        sourceId: "uniprot",
        confidence: 0.88,
        reason: "Protein/gene claim — UniProt is the canonical source",
      },
      {
        sourceId: "pubmed",
        confidence: 0.8,
        reason: "Biomedical literature from PubMed",
      },
      {
        sourceId: "europe_pmc",
        confidence: 0.7,
        reason: "Open access literature from Europe PMC",
      },
    ],
  },
  // ── Clinical Trials ───────────────────────────────────────────────────────
  {
    domain: "clinical_trial",
    patterns: [
      /\b(clinical\s+trial|randomized\s+controlled|rct|phase\s+(i{1,3}|[1-4])\s+trial|placebo.controlled|double.blind|nct\d{8}|enrollment|primary\s+endpoint|secondary\s+endpoint|efficacy|safety\s+profile)\b/i,
    ],
    routes: [
      {
        sourceId: "clinicaltrials_gov",
        confidence: 0.95,
        reason:
          "Clinical trial claim — ClinicalTrials.gov is the primary registry",
      },
      {
        sourceId: "cochrane",
        confidence: 0.8,
        reason: "Systematic review evidence from Cochrane",
      },
      {
        sourceId: "pubmed",
        confidence: 0.75,
        reason: "Trial results literature from PubMed",
      },
    ],
  },
  // ── Pharmacology / Drug Safety ────────────────────────────────────────────
  {
    domain: "pharmacology",
    patterns: [
      /\b(drug|medication|pharmaceutical|adverse\s+(event|effect|reaction)|side\s+effect|contraindication|dosage|indication|fda\s+approved|drug\s+interaction|pharmacokinetic|bioavailability|half.life)\b/i,
    ],
    routes: [
      {
        sourceId: "openfda",
        confidence: 0.92,
        reason:
          "Drug safety/adverse event claim — OpenFDA is the primary source",
      },
      {
        sourceId: "openfda_labels",
        confidence: 0.88,
        reason: "Drug labelling and indications from OpenFDA Labels",
      },
      {
        sourceId: "pubmed",
        confidence: 0.75,
        reason: "Pharmacology literature from PubMed",
      },
      {
        sourceId: "chembl",
        confidence: 0.7,
        reason: "Drug compound data from ChEMBL",
      },
    ],
  },
  // ── Genomics / Genetics ───────────────────────────────────────────────────
  {
    domain: "genomics_genetics",
    patterns: [
      /\b(gene|mutation|variant|snp|allele|genotype|phenotype|chromosome|dna|rna|genome|exome|sequencing|clinvar|pathogenic|benign|vus|variant\s+of\s+uncertain\s+significance)\b/i,
    ],
    routes: [
      {
        sourceId: "clinvar",
        confidence: 0.92,
        reason: "Genetic variant claim — ClinVar is the primary source",
      },
      {
        sourceId: "pubmed",
        confidence: 0.78,
        reason: "Genomics literature from PubMed",
      },
      {
        sourceId: "uniprot",
        confidence: 0.65,
        reason: "Gene-protein mapping from UniProt",
      },
    ],
  },
  // ── Food Safety / Nutrition ───────────────────────────────────────────────
  {
    domain: "food_safety",
    patterns: [
      /\b(food\s+safety|acceptable\s+daily\s+intake|adi|tolerable\s+daily\s+intake|tdi|noael|food\s+additive|pesticide\s+residue|contaminant|efsa|dietary\s+supplement|nutrition|nutrient)\b/i,
    ],
    routes: [
      {
        sourceId: "efsa_openfoodtox",
        confidence: 0.92,
        reason:
          "Food safety/toxicology claim — EFSA OpenFoodTox is the primary source",
      },
      {
        sourceId: "who",
        confidence: 0.75,
        reason: "WHO dietary guidelines and public health data",
      },
      {
        sourceId: "pubmed",
        confidence: 0.65,
        reason: "Nutrition literature from PubMed",
      },
      {
        sourceId: "usda_fooddata" as SourceId,
        confidence: 0.88,
        reason: "USDA FoodData Central — authoritative nutrient composition database",
      },
      {
        sourceId: "codex" as SourceId,
        confidence: 0.85,
        reason: "CODEX Alimentarius — international food safety standards",
      },
    ],
  },
  // ── Chemistry / Compounds ─────────────────────────────────────────────────
  {
    domain: "chemistry",
    patterns: [
      /\b(molecule|compound|chemical|molecular\s+(weight|formula)|iupac|cas\s+number|chembl|pubchem|cid\s*\d+|synthesis|reaction|solubility|melting\s+point|boiling\s+point)\b/i,
    ],
    routes: [
      {
        sourceId: "pubchem",
        confidence: 0.92,
        reason: "Chemical compound claim — PubChem is the primary source",
      },
      {
        sourceId: "chembl",
        confidence: 0.85,
        reason: "Bioactive compound data from ChEMBL",
      },
      {
        sourceId: "nist_chemistry" as SourceId,
        confidence: 0.88,
        reason: "NIST Chemistry WebBook — authoritative thermochemical and physical property data",
      },
      {
        sourceId: "pubmed",
        confidence: 0.6,
        reason: "Chemistry literature from PubMed",
      },
    ],
  },
  // ── Preprint / Early Research ─────────────────────────────────────────────
  {
    domain: "preprint",
    patterns: [
      /\b(preprint|biorxiv|medrxiv|arxiv|not\s+peer.reviewed|posted\s+to|submitted\s+to)\b/i,
    ],
    routes: [
      {
        sourceId: "biorxiv",
        confidence: 0.88,
        reason: "Preprint claim — bioRxiv/medRxiv is the primary source",
      },
      {
        sourceId: "arxiv",
        confidence: 0.8,
        reason: "arXiv for physics/CS/math preprints",
      },
      {
        sourceId: "crossref",
        confidence: 0.6,
        reason: "DOI resolution and citation data from CrossRef",
      },
    ],
  },
  // ── Financial / SEC Regulatory ────────────────────────────────────────────
  {
    domain: "financial_regulatory",
    patterns: [
      /\b(sec\s+filing|10-k|10-q|8-k|annual\s+report|earnings|revenue|profit|loss|balance\s+sheet|financial\s+statement|edgar|ipo|stock|share|dividend|market\s+cap)\b/i,
    ],
    routes: [
      {
        sourceId: "edgar_sec",
        confidence: 0.95,
        reason: "Financial/SEC regulatory claim — EDGAR is the primary source",
      },
      {
        sourceId: "world_bank",
        confidence: 0.55,
        reason: "Macroeconomic context from World Bank",
      },
      {
        sourceId: "bis_statistics" as SourceId,
        confidence: 0.82,
        reason: "BIS macroprudential and financial stability statistics",
      },
    ],
  },
  // ── Legal / Court ─────────────────────────────────────────────────────────
  {
    domain: "legal",
    patterns: [
      /\b(court\s+(ruling|decision|case)|lawsuit|litigation|statute|regulation|eu\s+directive|gdpr|celex|eur.lex|legal\s+precedent|judgment|verdict|appeal)\b/i,
    ],
    routes: [
      {
        sourceId: "court_listener",
        confidence: 0.9,
        reason: "Legal case claim — CourtListener is the primary source",
      },
      {
        sourceId: "eur_lex",
        confidence: 0.85,
        reason: "EU regulatory claim — EUR-Lex is the primary source",
      },
      {
        sourceId: "us_code" as SourceId,
        confidence: 0.87,
        reason: "US federal statutory law from OLRC US Code",
      },
    ],
  },
  // ── Internet / Technical Standards ───────────────────────────────────────
  {
    domain: "internet_standards",
    patterns: [
      /\b(rfc\s*\d+|internet\s+standard|ietf|protocol\s+specification|http|tcp|dns|tls|ssl|oauth|openid)\b/i,
    ],
    routes: [
      {
        sourceId: "ietf_rfc",
        confidence: 0.95,
        reason: "Internet standard claim — IETF RFC is the primary source",
      },
    ],
  },
  // ── Cybersecurity / NIST Standards ───────────────────────────────────────
  {
    domain: "cybersecurity_standards",
    patterns: [
      /\b(nist|cvss|cve|vulnerability|cybersecurity\s+framework|sp\s+800|fips|cryptographic|encryption\s+standard)\b/i,
    ],
    routes: [
      {
        sourceId: "nist",
        confidence: 0.95,
        reason: "Cybersecurity/standards claim — NIST is the primary source",
      },
    ],
  },
  // ── Macroeconomics / Development ─────────────────────────────────────────
  {
    domain: "economics_macro",
    patterns: [
      /\b(gdp|gross\s+domestic\s+product|inflation|unemployment|poverty\s+rate|gini|hdi|human\s+development|world\s+bank|oecd|eurostat|imf|economic\s+growth|trade\s+balance)\b/i,
    ],
    routes: [
      {
        sourceId: "world_bank",
        confidence: 0.9,
        reason: "Macroeconomic claim — World Bank is the primary source",
      },
      {
        sourceId: "oecd",
        confidence: 0.85,
        reason: "OECD economic statistics",
      },
      {
        sourceId: "eurostat",
        confidence: 0.8,
        reason: "EU economic statistics from Eurostat",
      },
      {
        sourceId: "owid",
        confidence: 0.75,
        reason: "Our World in Data for long-run economic trends",
      },
      {
        sourceId: "bis_statistics" as SourceId,
        confidence: 0.80,
        reason: "BIS statistics for banking and financial stability data",
      },
    ],
  },
  // ── Public Health / WHO ───────────────────────────────────────────────────
  {
    domain: "public_health",
    patterns: [
      /\b(mortality|morbidity|incidence|prevalence|epidemic|pandemic|vaccination|immunization|disease\s+burden|who|world\s+health\s+organization|global\s+health)\b/i,
    ],
    routes: [
      {
        sourceId: "who",
        confidence: 0.92,
        reason: "Public health claim — WHO is the primary source",
      },
      {
        sourceId: "owid",
        confidence: 0.8,
        reason: "Our World in Data for health metrics",
      },
      {
        sourceId: "pubmed",
        confidence: 0.7,
        reason: "Public health literature from PubMed",
      },
    ],
  },
  // ── Climate / Environment ─────────────────────────────────────────────────
  {
    domain: "climate",
    patterns: [
      /\b(climate\s+change|global\s+warming|greenhouse\s+gas|co2\s+emissions|carbon\s+dioxide|sea\s+level|arctic\s+ice|ipcc|temperature\s+anomaly|carbon\s+budget|net\s+zero)\b/i,
    ],
    routes: [
      {
        sourceId: "ipcc",
        confidence: 0.95,
        reason: "Climate claim — IPCC is the primary source",
      },
      {
        sourceId: "owid",
        confidence: 0.75,
        reason: "Our World in Data for climate metrics",
      },
    ],
  },
  {
    domain: "environmental_science" as DomainLabel,
    patterns: [/climate change/i, /global warming/i, /greenhouse gas/i, /CO2 emissions/i, /sea level/i, /arctic ice/i, /air quality/i, /particulate matter/i, /PM2\.5/i, /ozone/i, /biodiversity/i, /deforestation/i, /carbon/i, /temperature anomaly/i],
    routes: [
      { sourceId: "nasa_earthdata" as SourceId, confidence: 0.90, reason: "NASA satellite climate observations" },
      { sourceId: "noaa" as SourceId, confidence: 0.90, reason: "NOAA atmospheric and ocean data" },
      { sourceId: "ipcc" as SourceId, confidence: 0.92, reason: "IPCC climate assessment reports" },
      { sourceId: "eea" as SourceId, confidence: 0.86, reason: "European Environment Agency indicators" },
      { sourceId: "epa" as SourceId, confidence: 0.84, reason: "US EPA environmental science" },
      { sourceId: "owid" as SourceId, confidence: 0.82, reason: "Our World in Data climate statistics" },
    ],
  },
];

export const FALLBACK_ROUTES: SourceRoute[] = [
  {
    sourceId: "pubmed",
    confidence: 0.55,
    reason: "Default biomedical fallback",
  },
  {
    sourceId: "semantic_scholar",
    confidence: 0.5,
    reason: "Cross-domain academic literature fallback",
  },
  {
    sourceId: "openalex",
    confidence: 0.45,
    reason: "Open access literature fallback",
  },
];
