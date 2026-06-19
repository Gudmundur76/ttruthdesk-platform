/**
 * adapterCalibration.ts
 * Calibration harness for vertical adapters. FR-CAL-01, FR-CAL-02.
 */
import { extractClaims } from "../../claimExtractor";
import type { VerticalAdapter } from "../types";
import type { TestDocument } from "./testDocuments";

export interface ClaimCalibrationResult {
  adapterId: string;
  documentId: string;
  claimsExtracted: number;
  claimsSupported: number;
  claimsRefuted: number;
  claimsUnverifiable: number;
  extractionRateMs: number;
  verificationRateMs: number;
  precisionScore: number;
  recallScore: number;
  f1Score: number;
  errors: string[];
}

export interface AdapterCalibrationSummary {
  adapterId: string;
  results: ClaimCalibrationResult[];
  avgPrecision: number;
  avgRecall: number;
  avgF1: number;
  failureGroup: "G1" | "G2" | "G3" | "G4";
  totalErrors: number;
}

/**
 * Assign a failure group based on calibration scores.
 * G1: Low extraction (precision < 0.3) — prompt needs generation
 * G2: Over-extraction (recall > 0.9 but precision < 0.5) — prompt needs constraint
 * G3: Low verification (supported rate < 0.15) — prompt needs specificity
 * G4: Passing (all metrics acceptable)
 */
export function assignFailureGroup(
  avgPrecision: number,
  avgRecall: number,
  supportedRate: number
): "G1" | "G2" | "G3" | "G4" {
  if (avgPrecision < 0.3) return "G1";
  if (avgRecall > 0.9 && avgPrecision < 0.5) return "G2";
  if (supportedRate < 0.15) return "G3";
  return "G4";
}

/**
 * Calibrate a single adapter against a single test document.
 */
export async function calibrateAdapter(
  adapter: VerticalAdapter,
  doc: TestDocument
): Promise<ClaimCalibrationResult> {
  const errors: string[] = [];
  let claimsExtracted = 0;
  let claimsSupported = 0;
  let claimsRefuted = 0;
  let claimsUnverifiable = 0;
  let extractionRateMs = 0;
  let verificationRateMs = 0;

  try {
    const extractStart = Date.now();
    const extracted = await extractClaims(doc.text, undefined, adapter.domainKey);
    extractionRateMs = Date.now() - extractStart;
    claimsExtracted = extracted.length;

    const verifyStart = Date.now();
    for (const claim of extracted) {
      try {
        const evidence = await adapter.lookupEvidence({ claimText: claim.claimText, extractedValue: claim.extractedValue ?? null });
        if (evidence.found) {
          claimsSupported++;
        } else {
          claimsUnverifiable++;
        }
      } catch (e) {
        claimsRefuted++;
        errors.push(`verify:${claim.claimText.slice(0, 40)}: ${String(e)}`);
      }
    }
    verificationRateMs = Date.now() - verifyStart;
  } catch (e) {
    errors.push(`extract: ${String(e)}`);
  }

  const total = claimsExtracted || 1;
  const precisionScore = claimsSupported / total;
  const recallScore = claimsExtracted > 0 ? Math.min(claimsExtracted / 10, 1) : 0;
  const f1Score =
    precisionScore + recallScore > 0
      ? (2 * precisionScore * recallScore) / (precisionScore + recallScore)
      : 0;

  return {
    adapterId: adapter.domainKey,
    documentId: doc.id,
    claimsExtracted,
    claimsSupported,
    claimsRefuted,
    claimsUnverifiable,
    extractionRateMs,
    verificationRateMs,
    precisionScore,
    recallScore,
    f1Score,
    errors,
  };
}

/**
 * Calibrate a single adapter against all 5 test documents.
 */
export async function calibrateAdapterFull(
  adapter: VerticalAdapter,
  docs: TestDocument[]
): Promise<AdapterCalibrationSummary> {
  const results: ClaimCalibrationResult[] = [];

  for (const doc of docs) {
    const result = await calibrateAdapter(adapter, doc);
    results.push(result);
  }

  const avgPrecision =
    results.reduce((s, r) => s + r.precisionScore, 0) / results.length;
  const avgRecall =
    results.reduce((s, r) => s + r.recallScore, 0) / results.length;
  const avgF1 = results.reduce((s, r) => s + r.f1Score, 0) / results.length;
  const totalSupported = results.reduce((s, r) => s + r.claimsSupported, 0);
  const totalExtracted = results.reduce((s, r) => s + r.claimsExtracted, 0);
  const supportedRate = totalExtracted > 0 ? totalSupported / totalExtracted : 0;
  const failureGroup = assignFailureGroup(avgPrecision, avgRecall, supportedRate);
  const totalErrors = results.reduce((s, r) => s + r.errors.length, 0);

  return {
    adapterId: adapter.domainKey,
    results,
    avgPrecision,
    avgRecall,
    avgF1,
    failureGroup,
    totalErrors,
  };
}
