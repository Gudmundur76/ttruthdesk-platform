/**
 * domainClassifier.ts — Sprint 26
 *
 * Domain Classification: AtomicClaim → Source Adapter(s)
 *
 * Maps a decomposed SPO triple to the correct primary source adapter(s)
 * from the 29 approved sources in sourceRegistry.ts.
 *
 * Design principles:
 *   - Heuristic-first: keyword/regex matching (<1ms) for common domains
 *   - Multi-source: a claim may route to multiple sources
 *   - Ranked: sources are returned in priority order (highest confidence first)
 *   - Fallback: unknown domain defaults to pubmed + semantic_scholar
 *   - Never throws: always returns at least one source
 *
 * Domain rules are defined in domainRules.ts (15 rules + fallback).
 */
import { logger } from "./logger";
import type { AtomicClaim } from "./questionDecomposer";
import { DOMAIN_RULES, FALLBACK_ROUTES } from "./domainRules";
export type { SourceRoute } from "./domainRules";

const log = logger("domainClassifier");

// ─── Types ────────────────────────────────────────────────────────────────────

export type SourceId =
  | "pubmed"
  | "europe_pmc"
  | "rcsb_pdb"
  | "uniprot"
  | "clinicaltrials_gov"
  | "clinvar"
  | "cochrane"
  | "biorxiv"
  | "openfda"
  | "openfda_labels"
  | "pubchem"
  | "chembl"
  | "arxiv"
  | "openalex"
  | "semantic_scholar"
  | "crossref"
  | "opencitations"
  | "edgar_sec"
  | "eur_lex"
  | "court_listener"
  | "ietf_rfc"
  | "nist"
  | "efsa_openfoodtox"
  | "world_bank"
  | "eurostat"
  | "oecd"
  | "owid"
  | "who"
  | "ipcc"
  | "wikidata"
  | "noaa"
  | "eea"
  | "nasa_earthdata"
  | "epa"
  | "usda_fooddata"
  | "codex"
  | "fred"
  | "imf"
  | "bis_statistics"
  | "us_code"
  | "alphafold"
  | "nist_chemistry"
  | "campbell"
  | "apa_psycarticles"
  | "ssrn"
  | "iea"
  | "irena"
  | "usgs";

export type DomainLabel =
  | "hiv_protease"
  | "structural_biology"
  | "protein_biochemistry"
  | "clinical_trial"
  | "pharmacology"
  | "genomics_genetics"
  | "food_safety"
  | "biomedical_general"
  | "preprint"
  | "academic_literature"
  | "financial_regulatory"
  | "legal"
  | "internet_standards"
  | "cybersecurity_standards"
  | "economics_macro"
  | "public_health"
  | "climate"
  | "chemistry"
  | "openfda_adverse"
  | "nice"
  | "who_iris"
  | "embase"
  | "energy"
  | "earth_science"
  | "unknown";

export interface ClassificationResult {
  /** The original claim that was classified */
  claim: AtomicClaim;
  /** Ordered list of source routes (highest confidence first) */
  routes: import("./domainRules").SourceRoute[];
  /** Detected domain label */
  domain: DomainLabel;
  /** Classification duration in milliseconds */
  durationMs: number;
}

// ─── Classifier ───────────────────────────────────────────────────────────────

/**
 * Classify a single AtomicClaim and return the ordered list of source routes.
 *
 * Evaluates domain rules in order — first match wins.
 * Falls back to pubmed + semantic_scholar + openalex if no rule matches.
 *
 * @param claim - The atomic claim to classify
 * @returns ClassificationResult with ordered source routes
 */
export function classifyClaim(claim: AtomicClaim): ClassificationResult {
  const start = Date.now();
  const text = claim.text.toLowerCase();

  for (const rule of DOMAIN_RULES) {
    const matched = rule.patterns.some(re => re.test(text));
    if (matched) {
      const result: ClassificationResult = {
        claim,
        routes: rule.routes.map(r => ({ ...r })),
        domain: rule.domain,
        durationMs: Date.now() - start,
      };
      log.debug("claim classified", {
        domain: rule.domain,
        sources: result.routes.map(r => r.sourceId),
      });
      return result;
    }
  }

  log.debug("claim domain unknown — using fallback routes", {
    text: claim.text.slice(0, 80),
  });
  return {
    claim,
    routes: [...FALLBACK_ROUTES],
    domain: "unknown",
    durationMs: Date.now() - start,
  };
}

/**
 * Classify multiple claims and return results in the same order as input.
 *
 * @param claims - Array of atomic claims to classify
 * @returns Array of ClassificationResult in the same order as input
 */
export function classifyClaims(claims: AtomicClaim[]): ClassificationResult[] {
  return claims.map(claim => classifyClaim(claim));
}

/**
 * Get the primary (highest-confidence) source for a classification result.
 *
 * @param result - ClassificationResult from classifyClaim
 * @returns The top-ranked SourceRoute
 */
export function getPrimaryRoute(
  result: ClassificationResult
): import("./domainRules").SourceRoute {
  return result.routes[0];
}

/**
 * Get all unique source IDs across a set of classification results.
 * Used to pre-warm connections or build a source coverage report.
 *
 * @param results - Array of ClassificationResult
 * @returns Deduplicated array of SourceId
 */
export function getAllSourceIds(results: ClassificationResult[]): SourceId[] {
  const seen = new Set<SourceId>();
  for (const r of results) {
    for (const route of r.routes) {
      seen.add(route.sourceId as SourceId);
    }
  }
  return Array.from(seen);
}
