/**
 * verticalAdapters/sportsNutritionRct.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Sports Nutrition RCT vertical adapter.
 *
 * This is a meta-vertical: it focuses specifically on high-quality RCT
 * and systematic review evidence across ALL sports nutrition interventions.
 *
 * Unlike the other verticals (which focus on a compound category), this
 * adapter verifies claims by checking:
 *  1. Whether the claim is backed by a registered clinical trial (ClinicalTrials.gov)
 *  2. Whether the claim appears in a PubMed systematic review or meta-analysis
 *  3. The GRADE evidence quality (inferred from study design language)
 *
 * This adapter is the "quality gatekeeper" — it assigns lower confidence to
 * claims that lack RCT support even if they sound plausible.
 */
import { registerVertical, type VerticalAdapter, type EvidenceResult } from "./types";
import { searchSystematicReviews as searchEuropePmc, interpretSystematicReviewEvidence } from "../europePmcAdapter";

// ─── ClinicalTrials.gov lookup ────────────────────────────────────────────────

interface ClinicalTrial {
  nctId: string;
  title: string;
  status: string;
  phase: string;
  enrollmentCount?: number;
}

async function searchClinicalTrials(query: string): Promise<{ trials: ClinicalTrial[]; total: number }> {
  try {
    const encoded = encodeURIComponent(query);
    const res = await fetch(
      `https://clinicaltrials.gov/api/v2/studies?query.term=${encoded}&filter.overallStatus=COMPLETED&pageSize=5&format=json`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (!res.ok) return { trials: [], total: 0 };
    const data = await res.json() as {
      studies?: Array<{
        protocolSection?: {
          identificationModule?: { nctId?: string; briefTitle?: string };
          statusModule?: { overallStatus?: string };
          designModule?: { phases?: string[]; enrollmentInfo?: { count?: number } };
        };
      }>;
      totalCount?: number;
    };
    const trials = (data.studies ?? []).map((s) => ({
      nctId: s.protocolSection?.identificationModule?.nctId ?? "",
      title: s.protocolSection?.identificationModule?.briefTitle ?? "",
      status: s.protocolSection?.statusModule?.overallStatus ?? "",
      phase: (s.protocolSection?.designModule?.phases ?? []).join(", "),
      enrollmentCount: s.protocolSection?.designModule?.enrollmentInfo?.count,
    }));
    return { trials, total: data.totalCount ?? 0 };
  } catch {
    return { trials: [], total: 0 };
  }
}

// searchSystematicReviews is now provided by europePmcAdapter (higher quality, full-text)

// ─── GRADE evidence inference ─────────────────────────────────────────────────

function inferGradeEvidence(claimText: string): { grade: string; multiplier: number } {
  const lower = claimText.toLowerCase();
  if (lower.includes("meta-analysis") || lower.includes("systematic review") || lower.includes("cochrane")) {
    return { grade: "HIGH", multiplier: 1.15 };
  }
  if (lower.includes("randomized") || lower.includes("rct") || lower.includes("double-blind")) {
    return { grade: "MODERATE-HIGH", multiplier: 1.08 };
  }
  if (lower.includes("clinical trial") || lower.includes("crossover")) {
    return { grade: "MODERATE", multiplier: 1.0 };
  }
  if (lower.includes("observational") || lower.includes("cohort") || lower.includes("cross-sectional")) {
    return { grade: "LOW", multiplier: 0.80 };
  }
  if (lower.includes("case study") || lower.includes("anecdotal") || lower.includes("expert opinion")) {
    return { grade: "VERY LOW", multiplier: 0.60 };
  }
  return { grade: "UNSPECIFIED", multiplier: 0.90 };
}

const sportsNutritionRctAdapter: VerticalAdapter = {
  domainKey: "sports_nutrition_rct",
  displayName: "Sports Nutrition RCTs",
  description:
    "Meta-vertical that verifies sports nutrition claims specifically against high-quality " +
    "RCT and systematic review evidence. Checks ClinicalTrials.gov for registered trials " +
    "and PubMed for systematic reviews. Applies GRADE evidence quality grading to all claims. " +
    "Acts as a quality gatekeeper across all sports nutrition interventions.",

  claimExtractorPrompt: `
You are a sports nutrition evidence quality assessor. Extract every verifiable claim and assess its evidence quality.
Focus on:
- Study design language: RCT, crossover, double-blind, placebo-controlled, systematic review, meta-analysis
- Sample size claims: number of participants (n=), statistical power, effect size (Cohen's d, Hedges' g)
- Statistical claims: p-values, confidence intervals, effect sizes, NNT (number needed to treat)
- Outcome measures: primary endpoint, secondary endpoints, follow-up duration
- Population characteristics: trained vs untrained, age, sex, sport type
- Intervention details: dose, duration, timing, control condition
- Conflict of interest: industry funding, author affiliations
For each claim, extract: the intervention, the outcome, the study design, the sample size, and any statistical values.
`,

  discoverySearchTerms: [
    "sports nutrition supplement systematic review meta-analysis",
    "protein timing muscle synthesis RCT double-blind",
    "ergogenic aid performance randomized controlled trial",
    "sports supplement safety clinical trial",
    "nutrition periodisation athlete RCT",
  ],

  async lookupEvidence(claim): Promise<EvidenceResult> {
    const { grade, multiplier } = inferGradeEvidence(claim.claimText);

    // Extract key terms for search
    const searchQuery = claim.claimText
      .replace(/[^a-zA-Z0-9\s]/g, " ")
      .split(" ")
      .filter((w) => w.length > 3)
      .slice(0, 6)
      .join(" ");

    const [trialResult, europePmcResult] = await Promise.all([
      searchClinicalTrials(searchQuery),
      searchEuropePmc(`${searchQuery} sports nutrition`),
    ]);

    const flags: string[] = [];
    flags.push(`GRADE evidence level: ${grade}`);

    let baseScore = 0.40;

    // Clinical trial registration
    if (trialResult.total >= 5) {
      baseScore = Math.max(baseScore, 0.75);
      flags.push(`${trialResult.total} completed trials on ClinicalTrials.gov`);
    } else if (trialResult.total >= 1) {
      baseScore = Math.max(baseScore, 0.60);
      flags.push(`${trialResult.total} completed trial on ClinicalTrials.gov`);
      if (trialResult.trials[0]?.enrollmentCount) {
        flags.push(`Largest trial n=${trialResult.trials[0].enrollmentCount}`);
      }
    }

    // Europe PMC systematic review evidence (higher quality than PubMed abstract search)
    const srEvidence = interpretSystematicReviewEvidence(europePmcResult, baseScore);
    baseScore = srEvidence.confidenceScore;
    flags.push(...srEvidence.flags);

    // Apply GRADE multiplier
    const finalScore = Math.min(baseScore * multiplier, 0.95);

    const primarySource = europePmcResult.topPmids[0]
      ? { id: `PMID:${europePmcResult.topPmids[0]}`, url: `https://pubmed.ncbi.nlm.nih.gov/${europePmcResult.topPmids[0]}/` }
      : trialResult.trials[0]
      ? { id: `NCT:${trialResult.trials[0].nctId}`, url: `https://clinicaltrials.gov/study/${trialResult.trials[0].nctId}` }
      : null;

    return {
      found: europePmcResult.found || trialResult.total > 0,
      sourceId: primarySource?.id ?? null,
      sourceUrl: primarySource?.url ?? europePmcResult.sourceUrl ?? null,
      evidenceRaw: {
        gradeLevel: grade,
        systematicReviewCount: europePmcResult.systematicReviewCount,
        metaAnalysisCount: europePmcResult.metaAnalysisCount,
        topPmids: europePmcResult.topPmids,
        clinicalTrialCount: trialResult.total,
        topTrials: trialResult.trials.slice(0, 3).map((t) => ({
          nctId: t.nctId,
          title: t.title,
          enrollmentCount: t.enrollmentCount,
        })),
      },
      confidenceScore: finalScore,
      confidenceFlags: flags,
    };
  },
};

registerVertical(sportsNutritionRctAdapter);
