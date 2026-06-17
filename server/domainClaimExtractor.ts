/**
 * domainClaimExtractor.ts — Sprint 40
 *
 * Per-domain claim extraction configurations.
 *
 * Each domain has:
 *   - systemPrompt: what the LLM is asked to do
 *   - userPrefix:   how to frame the document for extraction
 *   - claimTypes:   the valid claim type strings for this domain
 *   - schemaFields: additional structured fields beyond claimText/claimType/extractedValue
 *
 * Design principles:
 *   - Narrow beats broad: each prompt asks for ONLY the claim types relevant to the domain
 *   - Conservative: only extract specific, verifiable claims — never vague assertions
 *   - Consistent: every domain returns at minimum { claimText, claimType, extractedValue }
 *   - Extensible: add a new domain config here; no schema migration required (varchar)
 */

export interface DomainClaimConfig {
  systemPrompt: string;
  userPrefix: string;
  claimTypes: readonly string[];
  /** Additional JSON schema properties beyond the three base fields */
  extraSchemaProperties: Record<string, unknown>;
  /** Additional required fields beyond the three base fields */
  extraRequired: string[];
}

// ─── Structural Biology ───────────────────────────────────────────────────────
const STRUCTURAL_BIOLOGY: DomainClaimConfig = {
  systemPrompt: `You are a structural biology claim extractor. Extract verifiable molecular claims from biotech documents.
Claim types:
  pdb_id — explicit PDB accession codes (4-char alphanumeric, e.g. "1HHO")
  protein_name — named proteins, enzymes, receptors, antibodies
  experimental_method — X-ray crystallography, cryo-EM, NMR, SAXS, etc.
  resolution — structural resolution values in Angstroms (Å)
  organism — source organisms (e.g. Homo sapiens, E. coli)
  ligand — small molecules, cofactors, inhibitors bound to a protein
  general_molecular — other verifiable molecular biology claims
Be conservative — only extract specific, verifiable claims. Return [] if none found.`,
  userPrefix: "Extract all verifiable structural biology claims from this document:",
  claimTypes: ["pdb_id", "protein_name", "experimental_method", "resolution", "organism", "ligand", "general_molecular"],
  extraSchemaProperties: {
    pdbId: { type: ["string", "null"] },
    proteinName: { type: ["string", "null"] },
    experimentalMethod: { type: ["string", "null"] },
    resolution: { type: ["number", "null"] },
    organism: { type: ["string", "null"] },
    ligand: { type: ["string", "null"] },
  },
  extraRequired: ["pdbId", "proteinName", "experimentalMethod", "resolution", "organism", "ligand"],
};

// ─── Clinical Trials ─────────────────────────────────────────────────────────
const CLINICAL_TRIAL: DomainClaimConfig = {
  systemPrompt: `You are a clinical trial claim extractor. Extract verifiable claims from clinical research documents.
Claim types:
  trial_id — ClinicalTrials.gov NCT number or EudraCT number
  intervention — drug name, device, procedure, or behavioural intervention
  primary_endpoint — primary outcome measure and its result
  secondary_endpoint — secondary outcome measure and its result
  population — patient population, inclusion/exclusion criteria
  adverse_event — reported adverse events, safety signals
  efficacy_result — quantified efficacy result (e.g. hazard ratio, p-value, response rate)
  general_clinical — other verifiable clinical claims
Be conservative — only extract specific, verifiable claims with numeric values where possible. Return [] if none found.`,
  userPrefix: "Extract all verifiable clinical trial claims from this document:",
  claimTypes: ["trial_id", "intervention", "primary_endpoint", "secondary_endpoint", "population", "adverse_event", "efficacy_result", "general_clinical"],
  extraSchemaProperties: {
    trialId: { type: ["string", "null"] },
    intervention: { type: ["string", "null"] },
    endpoint: { type: ["string", "null"] },
    populationSize: { type: ["number", "null"] },
    pValue: { type: ["number", "null"] },
  },
  extraRequired: ["trialId", "intervention", "endpoint", "populationSize", "pValue"],
};

// ─── Genomics / Genetics ──────────────────────────────────────────────────────
const GENOMICS_GENETICS: DomainClaimConfig = {
  systemPrompt: `You are a genomics and genetics claim extractor. Extract verifiable claims from genomics documents.
Claim types:
  gene_id — HGNC gene symbol or Ensembl/NCBI gene ID
  variant — specific genetic variant (SNP rsID, HGVS notation, ClinVar ID)
  pathway — named biological pathway (KEGG, Reactome)
  expression_level — quantified gene expression result
  association — statistical genetic association (GWAS hit, odds ratio)
  sequence_feature — genomic feature (promoter, enhancer, splice site)
  general_genomics — other verifiable genomics claims
Return [] if none found.`,
  userPrefix: "Extract all verifiable genomics and genetics claims from this document:",
  claimTypes: ["gene_id", "variant", "pathway", "expression_level", "association", "sequence_feature", "general_genomics"],
  extraSchemaProperties: {
    geneSymbol: { type: ["string", "null"] },
    variantId: { type: ["string", "null"] },
    pathwayId: { type: ["string", "null"] },
    oddsRatio: { type: ["number", "null"] },
    pValue: { type: ["number", "null"] },
  },
  extraRequired: ["geneSymbol", "variantId", "pathwayId", "oddsRatio", "pValue"],
};

// ─── Pharmacology ─────────────────────────────────────────────────────────────
const PHARMACOLOGY: DomainClaimConfig = {
  systemPrompt: `You are a pharmacology claim extractor. Extract verifiable claims from pharmacology and drug documents.
Claim types:
  drug_name — INN or brand name of a drug
  mechanism — mechanism of action (receptor target, enzyme inhibition, etc.)
  ic50 — IC50, EC50, Ki, or Kd value with units
  indication — approved or investigated therapeutic indication
  adverse_effect — known or reported adverse drug effect
  dosage — dosage regimen, route of administration
  interaction — drug-drug or drug-food interaction
  general_pharmacology — other verifiable pharmacology claims
Return [] if none found.`,
  userPrefix: "Extract all verifiable pharmacology claims from this document:",
  claimTypes: ["drug_name", "mechanism", "ic50", "indication", "adverse_effect", "dosage", "interaction", "general_pharmacology"],
  extraSchemaProperties: {
    drugName: { type: ["string", "null"] },
    target: { type: ["string", "null"] },
    ic50Value: { type: ["number", "null"] },
    ic50Units: { type: ["string", "null"] },
  },
  extraRequired: ["drugName", "target", "ic50Value", "ic50Units"],
};

// ─── Food Safety / Nutrition ──────────────────────────────────────────────────
const FOOD_SAFETY: DomainClaimConfig = {
  systemPrompt: `You are a food safety and nutrition claim extractor. Extract verifiable claims from food science documents.
Claim types:
  nutrient — specific nutrient and its quantity (e.g. "100g contains 5g protein")
  contaminant — food contaminant, pesticide residue, or mycotoxin with level
  additive — food additive, E-number, or preservative
  health_claim — substantiated health claim with evidence level
  adi — acceptable daily intake or tolerable upper intake level
  allergen — food allergen identification
  general_food — other verifiable food safety claims
Return [] if none found.`,
  userPrefix: "Extract all verifiable food safety and nutrition claims from this document:",
  claimTypes: ["nutrient", "contaminant", "additive", "health_claim", "adi", "allergen", "general_food"],
  extraSchemaProperties: {
    substance: { type: ["string", "null"] },
    quantity: { type: ["number", "null"] },
    unit: { type: ["string", "null"] },
    foodMatrix: { type: ["string", "null"] },
  },
  extraRequired: ["substance", "quantity", "unit", "foodMatrix"],
};

// ─── Economics / Macroeconomics ───────────────────────────────────────────────
const ECONOMICS_MACRO: DomainClaimConfig = {
  systemPrompt: `You are an economics claim extractor. Extract verifiable quantitative claims from economics documents.
Claim types:
  gdp — GDP or GDP growth rate claim with country and year
  inflation — inflation rate claim with country, year, and index
  unemployment — unemployment rate claim with country and year
  trade — trade balance, export, or import value
  interest_rate — central bank rate or bond yield
  fiscal — government deficit, debt, or spending figure
  index — economic index value (e.g. Gini coefficient, HDI)
  general_economics — other verifiable macroeconomic claims
Return [] if none found.`,
  userPrefix: "Extract all verifiable macroeconomic claims from this document:",
  claimTypes: ["gdp", "inflation", "unemployment", "trade", "interest_rate", "fiscal", "index", "general_economics"],
  extraSchemaProperties: {
    country: { type: ["string", "null"] },
    year: { type: ["number", "null"] },
    value: { type: ["number", "null"] },
    unit: { type: ["string", "null"] },
    source: { type: ["string", "null"] },
  },
  extraRequired: ["country", "year", "value", "unit", "source"],
};

// ─── Legal ────────────────────────────────────────────────────────────────────
const LEGAL: DomainClaimConfig = {
  systemPrompt: `You are a legal claim extractor. Extract verifiable claims from legal documents.
Claim types:
  statute — reference to a specific statute, act, or regulation with citation
  case_law — reference to a court case with citation (case name, court, year)
  ruling — specific legal ruling or holding
  definition — legal definition from a statute or authoritative source
  obligation — legal obligation or prohibition imposed by law
  penalty — specific penalty, fine, or sanction
  general_legal — other verifiable legal claims
Return [] if none found.`,
  userPrefix: "Extract all verifiable legal claims from this document:",
  claimTypes: ["statute", "case_law", "ruling", "definition", "obligation", "penalty", "general_legal"],
  extraSchemaProperties: {
    citation: { type: ["string", "null"] },
    jurisdiction: { type: ["string", "null"] },
    year: { type: ["number", "null"] },
  },
  extraRequired: ["citation", "jurisdiction", "year"],
};

// ─── Climate ──────────────────────────────────────────────────────────────────
const CLIMATE: DomainClaimConfig = {
  systemPrompt: `You are a climate science claim extractor. Extract verifiable quantitative claims from climate documents.
Claim types:
  temperature — global or regional temperature anomaly or trend
  co2 — atmospheric CO2 concentration or emissions figure
  sea_level — sea level rise measurement or projection
  extreme_event — frequency or intensity of extreme weather events
  forcing — radiative forcing value
  scenario — IPCC scenario or RCP/SSP pathway reference
  general_climate — other verifiable climate claims
Return [] if none found.`,
  userPrefix: "Extract all verifiable climate science claims from this document:",
  claimTypes: ["temperature", "co2", "sea_level", "extreme_event", "forcing", "scenario", "general_climate"],
  extraSchemaProperties: {
    value: { type: ["number", "null"] },
    unit: { type: ["string", "null"] },
    period: { type: ["string", "null"] },
    region: { type: ["string", "null"] },
    confidence: { type: ["string", "null"] },
  },
  extraRequired: ["value", "unit", "period", "region", "confidence"],
};

// ─── Public Health ────────────────────────────────────────────────────────────
const PUBLIC_HEALTH: DomainClaimConfig = {
  systemPrompt: `You are a public health claim extractor. Extract verifiable claims from public health and epidemiology documents.
Claim types:
  incidence — disease incidence or prevalence rate
  mortality — mortality or case fatality rate
  risk_factor — quantified risk factor association (RR, OR, HR)
  vaccine — vaccine efficacy or coverage figure
  intervention — public health intervention outcome
  burden — disease burden estimate (DALYs, QALYs)
  general_public_health — other verifiable public health claims
Return [] if none found.`,
  userPrefix: "Extract all verifiable public health claims from this document:",
  claimTypes: ["incidence", "mortality", "risk_factor", "vaccine", "intervention", "burden", "general_public_health"],
  extraSchemaProperties: {
    disease: { type: ["string", "null"] },
    population: { type: ["string", "null"] },
    value: { type: ["number", "null"] },
    unit: { type: ["string", "null"] },
    year: { type: ["number", "null"] },
  },
  extraRequired: ["disease", "population", "value", "unit", "year"],
};

// ─── Chemistry ────────────────────────────────────────────────────────────────
const CHEMISTRY: DomainClaimConfig = {
  systemPrompt: `You are a chemistry claim extractor. Extract verifiable claims from chemistry documents.
Claim types:
  compound — named chemical compound with CAS number or InChI
  property — physical or chemical property (melting point, boiling point, solubility)
  reaction — named chemical reaction with conditions and yield
  spectral — spectroscopic data (NMR, IR, MS)
  synthesis — synthesis route or procedure
  toxicity — toxicity value (LD50, LC50, NOAEL)
  general_chemistry — other verifiable chemistry claims
Return [] if none found.`,
  userPrefix: "Extract all verifiable chemistry claims from this document:",
  claimTypes: ["compound", "property", "reaction", "spectral", "synthesis", "toxicity", "general_chemistry"],
  extraSchemaProperties: {
    compoundName: { type: ["string", "null"] },
    casNumber: { type: ["string", "null"] },
    value: { type: ["number", "null"] },
    unit: { type: ["string", "null"] },
  },
  extraRequired: ["compoundName", "casNumber", "value", "unit"],
};

// ─── Energy ───────────────────────────────────────────────────────────────────
const ENERGY: DomainClaimConfig = {
  systemPrompt: `You are an energy statistics claim extractor. Extract verifiable quantitative claims from energy documents.
Claim types:
  production — energy production figure (TWh, EJ, Mtoe) by source and country/year
  consumption — energy consumption figure by sector, country, and year
  capacity — installed capacity figure (GW) by technology and country/year
  co2_intensity — CO2 intensity of electricity or energy (gCO2/kWh)
  share — renewable or low-carbon share of energy mix (%)
  investment — energy investment figure (USD) by technology and year
  general_energy — other verifiable energy claims
Return [] if none found.`,
  userPrefix: "Extract all verifiable energy statistics claims from this document:",
  claimTypes: ["production", "consumption", "capacity", "co2_intensity", "share", "investment", "general_energy"],
  extraSchemaProperties: {
    country: { type: ["string", "null"] },
    year: { type: ["number", "null"] },
    value: { type: ["number", "null"] },
    unit: { type: ["string", "null"] },
    energySource: { type: ["string", "null"] },
  },
  extraRequired: ["country", "year", "value", "unit", "energySource"],
};

// ─── Earth Science ────────────────────────────────────────────────────────────
const EARTH_SCIENCE: DomainClaimConfig = {
  systemPrompt: `You are an earth science claim extractor. Extract verifiable quantitative claims from earth science documents.
Claim types:
  earthquake — seismic event with magnitude, location, and date
  mineral — mineral resource estimate with quantity and location
  geology — geological formation, age, or stratigraphy claim
  hydrology — water resource or hydrological measurement
  hazard — natural hazard assessment or risk figure
  remote_sensing — satellite or remote sensing measurement
  general_earth_science — other verifiable earth science claims
Return [] if none found.`,
  userPrefix: "Extract all verifiable earth science claims from this document:",
  claimTypes: ["earthquake", "mineral", "geology", "hydrology", "hazard", "remote_sensing", "general_earth_science"],
  extraSchemaProperties: {
    location: { type: ["string", "null"] },
    magnitude: { type: ["number", "null"] },
    date: { type: ["string", "null"] },
    value: { type: ["number", "null"] },
    unit: { type: ["string", "null"] },
  },
  extraRequired: ["location", "magnitude", "date", "value", "unit"],
};

// ─── Social Science ───────────────────────────────────────────────────────────
const SOCIAL_SCIENCE: DomainClaimConfig = {
  systemPrompt: `You are a social science claim extractor. Extract verifiable quantitative claims from social science documents.
Claim types:
  survey_result — survey finding with sample size and percentage
  correlation — statistical correlation or regression coefficient
  experiment — experimental result from a controlled study
  meta_analysis — meta-analytic effect size (Cohen's d, r, OR)
  demographic — demographic statistic (population, age distribution)
  inequality — inequality measure (Gini, income ratio)
  general_social_science — other verifiable social science claims
Return [] if none found.`,
  userPrefix: "Extract all verifiable social science claims from this document:",
  claimTypes: ["survey_result", "correlation", "experiment", "meta_analysis", "demographic", "inequality", "general_social_science"],
  extraSchemaProperties: {
    sampleSize: { type: ["number", "null"] },
    effectSize: { type: ["number", "null"] },
    pValue: { type: ["number", "null"] },
    population: { type: ["string", "null"] },
    year: { type: ["number", "null"] },
  },
  extraRequired: ["sampleSize", "effectSize", "pValue", "population", "year"],
};

// ─── Biomedical General ───────────────────────────────────────────────────────
const BIOMEDICAL_GENERAL: DomainClaimConfig = {
  systemPrompt: `You are a biomedical claim extractor. Extract verifiable claims from biomedical research documents.
Claim types:
  biomarker — biomarker identification with sensitivity/specificity
  mechanism — biological mechanism or pathway claim
  animal_model — animal model result with species and outcome
  cell_line — cell line experiment result
  assay — assay result with method and value
  meta_analysis — systematic review or meta-analytic finding
  general_biomedical — other verifiable biomedical claims
Return [] if none found.`,
  userPrefix: "Extract all verifiable biomedical claims from this document:",
  claimTypes: ["biomarker", "mechanism", "animal_model", "cell_line", "assay", "meta_analysis", "general_biomedical"],
  extraSchemaProperties: {
    biomarker: { type: ["string", "null"] },
    species: { type: ["string", "null"] },
    value: { type: ["number", "null"] },
    unit: { type: ["string", "null"] },
    pValue: { type: ["number", "null"] },
  },
  extraRequired: ["biomarker", "species", "value", "unit", "pValue"],
};

// ─── Protein Biochemistry ─────────────────────────────────────────────────────
const PROTEIN_BIOCHEMISTRY: DomainClaimConfig = {
  systemPrompt: `You are a protein biochemistry claim extractor. Extract verifiable claims from protein science documents.
Claim types:
  protein_function — protein function or activity claim
  post_translational — post-translational modification (phosphorylation, glycosylation, etc.)
  interaction — protein-protein or protein-ligand interaction
  localization — subcellular localization
  abundance — protein expression level or abundance
  sequence — amino acid sequence feature or mutation
  general_protein — other verifiable protein biochemistry claims
Return [] if none found.`,
  userPrefix: "Extract all verifiable protein biochemistry claims from this document:",
  claimTypes: ["protein_function", "post_translational", "interaction", "localization", "abundance", "sequence", "general_protein"],
  extraSchemaProperties: {
    proteinName: { type: ["string", "null"] },
    uniprotId: { type: ["string", "null"] },
    organism: { type: ["string", "null"] },
    value: { type: ["number", "null"] },
    unit: { type: ["string", "null"] },
  },
  extraRequired: ["proteinName", "uniprotId", "organism", "value", "unit"],
};

// ─── Financial / Regulatory ───────────────────────────────────────────────────
const FINANCIAL_REGULATORY: DomainClaimConfig = {
  systemPrompt: `You are a financial regulatory claim extractor. Extract verifiable claims from financial regulatory documents.
Claim types:
  filing — SEC filing reference (form type, CIK, date)
  revenue — revenue or earnings figure with period
  ratio — financial ratio (P/E, debt-to-equity, ROE)
  regulation — regulatory requirement or threshold
  enforcement — enforcement action or penalty
  disclosure — material disclosure or risk factor
  general_financial — other verifiable financial claims
Return [] if none found.`,
  userPrefix: "Extract all verifiable financial regulatory claims from this document:",
  claimTypes: ["filing", "revenue", "ratio", "regulation", "enforcement", "disclosure", "general_financial"],
  extraSchemaProperties: {
    entity: { type: ["string", "null"] },
    value: { type: ["number", "null"] },
    currency: { type: ["string", "null"] },
    period: { type: ["string", "null"] },
    citation: { type: ["string", "null"] },
  },
  extraRequired: ["entity", "value", "currency", "period", "citation"],
};

// ─── Internet Standards ───────────────────────────────────────────────────────
const INTERNET_STANDARDS: DomainClaimConfig = {
  systemPrompt: `You are an internet standards claim extractor. Extract verifiable claims from IETF and standards documents.
Claim types:
  rfc — RFC number and title reference
  protocol — protocol specification or requirement (MUST, SHOULD, MAY)
  algorithm — cryptographic algorithm specification
  port — registered port number assignment
  mime_type — MIME type registration
  general_standards — other verifiable standards claims
Return [] if none found.`,
  userPrefix: "Extract all verifiable internet standards claims from this document:",
  claimTypes: ["rfc", "protocol", "algorithm", "port", "mime_type", "general_standards"],
  extraSchemaProperties: {
    rfcNumber: { type: ["string", "null"] },
    requirement: { type: ["string", "null"] },
    value: { type: ["string", "null"] },
  },
  extraRequired: ["rfcNumber", "requirement", "value"],
};

// ─── Cybersecurity Standards ──────────────────────────────────────────────────
const CYBERSECURITY_STANDARDS: DomainClaimConfig = {
  systemPrompt: `You are a cybersecurity standards claim extractor. Extract verifiable claims from cybersecurity and NIST documents.
Claim types:
  cve — CVE identifier with CVSS score
  control — NIST control or CIS benchmark requirement
  algorithm — cryptographic algorithm recommendation or deprecation
  compliance — compliance requirement or certification
  vulnerability — specific vulnerability with affected versions
  general_security — other verifiable cybersecurity claims
Return [] if none found.`,
  userPrefix: "Extract all verifiable cybersecurity claims from this document:",
  claimTypes: ["cve", "control", "algorithm", "compliance", "vulnerability", "general_security"],
  extraSchemaProperties: {
    cveId: { type: ["string", "null"] },
    cvssScore: { type: ["number", "null"] },
    affectedProduct: { type: ["string", "null"] },
    controlId: { type: ["string", "null"] },
  },
  extraRequired: ["cveId", "cvssScore", "affectedProduct", "controlId"],
};

// ─── Preprint ─────────────────────────────────────────────────────────────────
const PREPRINT: DomainClaimConfig = {
  // Preprints can be from any domain — use biomedical general as the default
  ...BIOMEDICAL_GENERAL,
  userPrefix: "Extract all verifiable claims from this preprint:",
};

// ─── Academic Literature (general) ───────────────────────────────────────────
const ACADEMIC_LITERATURE: DomainClaimConfig = {
  ...BIOMEDICAL_GENERAL,
  userPrefix: "Extract all verifiable claims from this academic paper:",
};

// ─── Domain → Config map ──────────────────────────────────────────────────────
export const DOMAIN_EXTRACTOR_CONFIGS: Record<string, DomainClaimConfig> = {
  structural_biology: STRUCTURAL_BIOLOGY,
  protein_biochemistry: PROTEIN_BIOCHEMISTRY,
  clinical_trial: CLINICAL_TRIAL,
  pharmacology: PHARMACOLOGY,
  genomics_genetics: GENOMICS_GENETICS,
  food_safety: FOOD_SAFETY,
  biomedical_general: BIOMEDICAL_GENERAL,
  preprint: PREPRINT,
  academic_literature: ACADEMIC_LITERATURE,
  financial_regulatory: FINANCIAL_REGULATORY,
  legal: LEGAL,
  internet_standards: INTERNET_STANDARDS,
  cybersecurity_standards: CYBERSECURITY_STANDARDS,
  economics_macro: ECONOMICS_MACRO,
  public_health: PUBLIC_HEALTH,
  climate: CLIMATE,
  chemistry: CHEMISTRY,
  openfda_adverse: PHARMACOLOGY,   // reuse pharmacology config
  nice: CLINICAL_TRIAL,            // reuse clinical trial config
  who_iris: PUBLIC_HEALTH,         // reuse public health config
  embase: BIOMEDICAL_GENERAL,      // reuse biomedical general config
  energy: ENERGY,
  earth_science: EARTH_SCIENCE,
  social_science: SOCIAL_SCIENCE,
  psychology: SOCIAL_SCIENCE,          // reuse social science config
  environmental_science: CLIMATE,      // reuse climate config
  // Fallback for unknown/unmapped domains
  unknown: BIOMEDICAL_GENERAL,
};

/**
 * Returns the extraction config for a given domain label.
 * Falls back to BIOMEDICAL_GENERAL for any unmapped domain.
 */
export function getDomainExtractorConfig(domain: string): DomainClaimConfig {
  return DOMAIN_EXTRACTOR_CONFIGS[domain] ?? BIOMEDICAL_GENERAL;
}
