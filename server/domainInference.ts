/**
 * domainInference.ts — Sprint 40
 *
 * Lightweight rule-based domain inference for raw document text.
 *
 * Uses the same DOMAIN_RULES patterns as the claim classifier, but operates on
 * the full document text (title + abstract) rather than individual claims.
 * This allows the discovery loop to set `verticalDomain` on a document BEFORE
 * the analysis pipeline runs, so `extractClaims()` uses the correct prompt.
 *
 * Scoring algorithm:
 *   - Count the number of DOMAIN_RULES patterns that match the text (absolute hits)
 *   - Normalise by sqrt(pattern_count) rather than pattern_count to avoid penalising
 *     domains with many fine-grained patterns (e.g. energy has 23 patterns)
 *   - Domains with only 1 broad catch-all regex (e.g. protein_biochemistry) are
 *     demoted by a specificity penalty if a more specific domain also matches
 *   - Minimum 1 absolute hit required; no normalised threshold
 *   - Tie-break: prefer the domain that appears later in DOMAIN_RULES (more specific)
 */

import { DOMAIN_RULES } from "./domainRules";

/** Domains that use a single broad catch-all regex — penalised when specific domains match */
const BROAD_DOMAINS = new Set([
  "protein_biochemistry",
  "biomedical_general",
  "preprint",
  "academic_literature",
  "financial_regulatory",  // 'loss', 'revenue', 'stock' appear in many non-financial texts
  "economics",             // overlaps heavily with economics_macro
  "unknown",
]);

/**
 * Infer the most likely domain label for a document from its raw text.
 *
 * @param text - Raw document text (title + abstract, or full body)
 * @returns A DomainLabel string (e.g. "clinical_trial", "energy", "earth_science")
 */
export function inferDomainFromText(text: string): string {
  if (!text || text.trim().length === 0) return "biomedical_general";

  const lower = text.toLowerCase();

  interface DomainScore {
    domain: string;
    hits: number;
    score: number;
    isBroad: boolean;
    ruleIndex: number;
  }

  const scores: DomainScore[] = [];

  for (let i = 0; i < DOMAIN_RULES.length; i++) {
    const rule = DOMAIN_RULES[i];
    const hits = rule.patterns.filter(re => re.test(lower)).length;
    if (hits === 0) continue;

    // Normalise by sqrt(pattern_count) to balance single-regex vs multi-pattern domains
    const score = hits / Math.sqrt(rule.patterns.length);

    scores.push({
      domain: rule.domain as string,
      hits,
      score,
      isBroad: BROAD_DOMAINS.has(rule.domain as string),
      ruleIndex: i,
    });
  }

  if (scores.length === 0) return "biomedical_general";

  // Sort: highest score first; tie-break by ruleIndex descending (later = more specific)
  scores.sort((a, b) => {
    if (Math.abs(a.score - b.score) > 0.001) return b.score - a.score;
    return b.ruleIndex - a.ruleIndex;
  });

  const best = scores[0];

  // If the best match is a broad domain AND a specific domain also matched with
  // at least 1 hit, prefer the specific domain
  if (best.isBroad) {
    const specificMatch = scores.find(s => !s.isBroad);
    if (specificMatch) return specificMatch.domain;
  }

  return best.domain;
}
