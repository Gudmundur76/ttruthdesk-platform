/**
 * groundTruthLoader.ts — Ground Truth Dataset Loader
 *
 * Loads verified claim examples from three sources:
 *   1. Manual calibration set (500 claims from adapterCalibration.ts Phase 142)
 *   2. Synthetic gold standard (PDB/PubMed/Cochrane unambiguous claims)
 *   3. Contradiction pairs (200 pairs of known-contradicting claims)
 *
 * PRD_SKILLOPT_AGENT2MODEL §1.3 — Ground Truth Dataset.
 *
 * The loader reads from a JSONL file at groundTruthPath. Each line is a JSON
 * object conforming to GroundTruthExample. The file is produced by:
 *   pnpm corpus:export --output training/ground_truth.jsonl
 */

import { readFileSync, existsSync } from "fs";
import { logger } from "../logger";

const log = logger("skillopt/groundTruthLoader");

// ─── Types ─────────────────────────────────────────────────────────────────────

export type GroundTruthSource =
  | "manual_calibration"
  | "synthetic_gold"
  | "contradiction_pair";

export interface GroundTruthExample {
  /** Unique identifier for this example */
  id: string;
  /** The raw input text from which the claim was extracted */
  inputText: string;
  /** The verified claim text */
  claimText: string;
  /** Human-verified expected verdict */
  expectedVerdict: string;
  /** Expected confidence range [min, max] */
  expectedConfidenceRange: [number, number];
  /** Source of this ground truth example */
  source: GroundTruthSource;
  /** Domain (structural_biology, clinical, etc.) */
  domain: string;
  /** For contradiction pairs: the ID of the paired contradicting claim */
  contradictionPairId?: string;
  /** Whether this example has been human-reviewed */
  humanReviewed: boolean;
  /** Optional notes from the reviewer */
  notes?: string;
}

export interface GroundTruthDataset {
  examples: GroundTruthExample[];
  stats: {
    total: number;
    bySource: Record<GroundTruthSource, number>;
    byDomain: Record<string, number>;
    byVerdict: Record<string, number>;
    humanReviewedCount: number;
  };
}

// ─── Loader ────────────────────────────────────────────────────────────────────

/**
 * Load ground truth examples from a JSONL file.
 * Each line must be a valid JSON object conforming to GroundTruthExample.
 *
 * @param filePath - Absolute or relative path to the .jsonl file
 * @param options - Optional filters
 */
export function loadGroundTruth(
  filePath: string,
  options?: {
    /** Only include examples from these sources */
    sources?: GroundTruthSource[];
    /** Only include examples from these domains */
    domains?: string[];
    /** Only include human-reviewed examples */
    humanReviewedOnly?: boolean;
    /** Maximum number of examples to load */
    limit?: number;
  }
): GroundTruthDataset {
  if (!existsSync(filePath)) {
    log.warn(
      `[GroundTruthLoader] File not found: ${filePath} — returning empty dataset`
    );
    return buildDataset([]);
  }

  const raw = readFileSync(filePath, "utf-8");
  const lines = raw
    .split("\n")
    .map(l => l.trim())
    .filter(l => l.length > 0 && !l.startsWith("//"));

  let examples: GroundTruthExample[] = [];

  for (let i = 0; i < lines.length; i++) {
    try {
      const parsed = JSON.parse(lines[i]) as GroundTruthExample;
      examples.push(parsed);
    } catch (err) {
      log.warn(
        `[GroundTruthLoader] Skipping malformed line ${i + 1}: ${String(err)}`
      );
    }
  }

  // Apply filters
  if (options?.sources && options.sources.length > 0) {
    examples = examples.filter(e => options.sources!.includes(e.source));
  }
  if (options?.domains && options.domains.length > 0) {
    examples = examples.filter(e => options.domains!.includes(e.domain));
  }
  if (options?.humanReviewedOnly) {
    examples = examples.filter(e => e.humanReviewed);
  }
  if (options?.limit && options.limit > 0) {
    examples = examples.slice(0, options.limit);
  }

  log.info(
    `[GroundTruthLoader] Loaded ${examples.length} examples from ${filePath}`
  );

  return buildDataset(examples);
}

/**
 * Build a GroundTruthDataset with computed stats from an array of examples.
 */
function buildDataset(examples: GroundTruthExample[]): GroundTruthDataset {
  const bySource: Record<GroundTruthSource, number> = {
    manual_calibration: 0,
    synthetic_gold: 0,
    contradiction_pair: 0,
  };
  const byDomain: Record<string, number> = {};
  const byVerdict: Record<string, number> = {};
  let humanReviewedCount = 0;

  for (const ex of examples) {
    bySource[ex.source] = (bySource[ex.source] ?? 0) + 1;
    byDomain[ex.domain] = (byDomain[ex.domain] ?? 0) + 1;
    byVerdict[ex.expectedVerdict] = (byVerdict[ex.expectedVerdict] ?? 0) + 1;
    if (ex.humanReviewed) humanReviewedCount++;
  }

  return {
    examples,
    stats: {
      total: examples.length,
      bySource,
      byDomain,
      byVerdict,
      humanReviewedCount,
    },
  };
}

/**
 * Validate that a ground truth dataset meets minimum quality requirements.
 * Returns a list of validation warnings (empty = valid).
 */
export function validateDataset(dataset: GroundTruthDataset): string[] {
  const warnings: string[] = [];

  if (dataset.stats.total < 100) {
    warnings.push(
      `Dataset too small: ${dataset.stats.total} examples (minimum 100 recommended)`
    );
  }

  if (dataset.stats.humanReviewedCount < dataset.stats.total * 0.1) {
    warnings.push(
      `Low human review rate: only ${dataset.stats.humanReviewedCount}/${dataset.stats.total} examples are human-reviewed`
    );
  }

  const verdicts = Object.keys(dataset.stats.byVerdict);
  if (verdicts.length < 3) {
    warnings.push(
      `Low verdict diversity: only ${verdicts.length} distinct verdict types (minimum 3 recommended)`
    );
  }

  return warnings;
}
