/**
 * Claim Provenance Service
 *
 * Records every pipeline step that produces or modifies a claim, and provides
 * a full provenance chain query so users can trace exactly how a verdict was
 * reached — from raw text extraction through evidence lookup, quality scoring,
 * and any manual overrides.
 *
 * Design:
 *  - recordStep()  — called by each pipeline stage to append an event
 *  - getChain()    — returns the full ordered chain for a claim
 *  - getDocumentChain() — returns all events for all claims in a document
 *  - summarize()   — produces a human-readable summary of the chain
 */

import { getDb } from "./db";
import { claimProvenanceEvents, InsertClaimProvenanceEvent } from "../drizzle/schema";
import { eq, and, desc, asc } from "drizzle-orm";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ProvenanceStep =
  | "extraction"
  | "evidence_lookup"
  | "quality_scoring"
  | "verdict_override"
  | "agent_ingestion"
  | "similarity_check";

export interface RecordStepOptions {
  claimId: number;
  documentId: number;
  step: ProvenanceStep;
  actor?: string;
  inputSnapshot?: Record<string, unknown>;
  outputSnapshot?: Record<string, unknown>;
  durationMs?: number;
  success?: boolean;
  errorMsg?: string;
}

export interface ProvenanceChainEntry {
  id: number;
  claimId: number;
  documentId: number;
  step: ProvenanceStep;
  actor: string;
  inputSnapshot: Record<string, unknown> | null;
  outputSnapshot: Record<string, unknown> | null;
  durationMs: number | null;
  success: boolean;
  errorMsg: string | null;
  createdAt: Date;
}

export interface ProvenanceSummary {
  claimId: number;
  totalSteps: number;
  successfulSteps: number;
  failedSteps: number;
  firstSeenAt: Date | null;
  lastModifiedAt: Date | null;
  stepsCompleted: ProvenanceStep[];
  stepsMissing: ProvenanceStep[];
  actors: string[];
  /** Human-readable narrative of how the verdict was reached */
  narrative: string;
}

// ─── Core pipeline steps in canonical order ───────────────────────────────────
const PIPELINE_STEPS: ProvenanceStep[] = [
  "extraction",
  "evidence_lookup",
  "quality_scoring",
  "verdict_override",
];

// ─── Record a provenance event ────────────────────────────────────────────────

export async function recordStep(opts: RecordStepOptions): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  const row: InsertClaimProvenanceEvent = {
    claimId: opts.claimId,
    documentId: opts.documentId,
    step: opts.step,
    actor: opts.actor ?? "system",
    inputSnapshot: (opts.inputSnapshot ?? null) as unknown as Record<string, unknown>,
    outputSnapshot: (opts.outputSnapshot ?? null) as unknown as Record<string, unknown>,
    durationMs: opts.durationMs ?? null,
    success: opts.success !== false,
    errorMsg: opts.errorMsg ?? null,
  };

  const [result] = await db.insert(claimProvenanceEvents).values(row);
  return (result as { insertId: number }).insertId;
}

// ─── Retrieve the full provenance chain for a single claim ────────────────────

export async function getChain(claimId: number): Promise<ProvenanceChainEntry[]> {
  const db = await getDb();
  if (!db) return [];

  const rows = await db
    .select()
    .from(claimProvenanceEvents)
    .where(eq(claimProvenanceEvents.claimId, claimId))
    .orderBy(asc(claimProvenanceEvents.createdAt));

  return rows.map(normalizeRow);
}

// ─── Retrieve all provenance events for a document ────────────────────────────

export async function getDocumentChain(
  documentId: number
): Promise<ProvenanceChainEntry[]> {
  const db = await getDb();
  if (!db) return [];

  const rows = await db
    .select()
    .from(claimProvenanceEvents)
    .where(eq(claimProvenanceEvents.documentId, documentId))
    .orderBy(asc(claimProvenanceEvents.createdAt));

  return rows.map(normalizeRow);
}

// ─── Summarize the provenance chain for a claim ───────────────────────────────

export function summarize(chain: ProvenanceChainEntry[]): ProvenanceSummary {
  if (chain.length === 0) {
    return {
      claimId: 0,
      totalSteps: 0,
      successfulSteps: 0,
      failedSteps: 0,
      firstSeenAt: null,
      lastModifiedAt: null,
      stepsCompleted: [],
      stepsMissing: PIPELINE_STEPS,
      actors: [],
      narrative: "No provenance data recorded for this claim.",
    };
  }

  const claimId = chain[0].claimId;
  const successful = chain.filter((e) => e.success);
  const failed = chain.filter((e) => !e.success);
  const stepsCompleted = Array.from(new Set(successful.map((e) => e.step)));
  const stepsMissing = PIPELINE_STEPS.filter((s) => !stepsCompleted.includes(s));
  const actors = Array.from(new Set(chain.map((e) => e.actor)));

  const firstSeenAt = chain[0].createdAt;
  const lastModifiedAt = chain[chain.length - 1].createdAt;

  // Build narrative
  const parts: string[] = [];

  const extractionStep = successful.find((e) => e.step === "extraction");
  if (extractionStep) {
    const out = extractionStep.outputSnapshot as Record<string, unknown> | null;
    const claimType = out?.claimType ?? "unknown type";
    parts.push(`Claim was extracted as type "${claimType}" by ${extractionStep.actor}.`);
  }

  const evidenceStep = successful.find((e) => e.step === "evidence_lookup");
  if (evidenceStep) {
    const out = evidenceStep.outputSnapshot as Record<string, unknown> | null;
    const verdict = out?.verdict ?? "unknown";
    const source = out?.evidenceSource ?? "external database";
    parts.push(`Evidence lookup against ${source} returned verdict "${verdict}".`);
  }

  const scoringStep = successful.find((e) => e.step === "quality_scoring");
  if (scoringStep) {
    const out = scoringStep.outputSnapshot as Record<string, unknown> | null;
    const score = typeof out?.confidenceScore === "number"
      ? `${(out.confidenceScore as number * 100).toFixed(0)}%`
      : "unknown";
    parts.push(`Quality scoring assigned confidence ${score}.`);
  }

  const overrideStep = successful.find((e) => e.step === "verdict_override");
  if (overrideStep) {
    const out = overrideStep.outputSnapshot as Record<string, unknown> | null;
    const reviewer = overrideStep.actor;
    const newVerdict = out?.overriddenVerdict ?? "unknown";
    parts.push(`Verdict was manually overridden to "${newVerdict}" by ${reviewer}.`);
  }

  const agentStep = successful.find((e) => e.step === "agent_ingestion");
  if (agentStep) {
    parts.push(`Claim was ingested via agent task by ${agentStep.actor}.`);
  }

  const simStep = successful.find((e) => e.step === "similarity_check");
  if (simStep) {
    const out = simStep.outputSnapshot as Record<string, unknown> | null;
    const dupeCount = out?.duplicatesFound ?? 0;
    if (dupeCount) {
      parts.push(`Similarity check found ${dupeCount} near-duplicate claim(s).`);
    }
  }

  if (failed.length > 0) {
    parts.push(`${failed.length} step(s) failed: ${failed.map((e) => e.step).join(", ")}.`);
  }

  const narrative = parts.length > 0
    ? parts.join(" ")
    : "Claim was processed through the standard pipeline.";

  return {
    claimId,
    totalSteps: chain.length,
    successfulSteps: successful.length,
    failedSteps: failed.length,
    firstSeenAt,
    lastModifiedAt,
    stepsCompleted,
    stepsMissing,
    actors,
    narrative,
  };
}

// ─── Instrument existing pipeline stages ─────────────────────────────────────
// These wrappers are called by the existing pipeline modules to record events
// without requiring them to import this service directly.

export async function recordExtraction(
  claimId: number,
  documentId: number,
  claimType: string,
  extractedValue: string | null,
  durationMs?: number
): Promise<void> {
  await recordStep({
    claimId,
    documentId,
    step: "extraction",
    actor: "analysis_pipeline",
    inputSnapshot: { documentId },
    outputSnapshot: { claimType, extractedValue },
    durationMs,
    success: true,
  });
}

export async function recordEvidenceLookup(
  claimId: number,
  documentId: number,
  verdict: string,
  evidenceSource: string,
  evidenceUrl: string | null,
  durationMs?: number
): Promise<void> {
  await recordStep({
    claimId,
    documentId,
    step: "evidence_lookup",
    actor: "evidence_lookup_service",
    inputSnapshot: { claimId },
    outputSnapshot: { verdict, evidenceSource, evidenceUrl },
    durationMs,
    success: true,
  });
}

export async function recordQualityScoring(
  claimId: number,
  documentId: number,
  confidenceScore: number,
  flags: string[],
  durationMs?: number
): Promise<void> {
  await recordStep({
    claimId,
    documentId,
    step: "quality_scoring",
    actor: "quality_scorer",
    inputSnapshot: { claimId },
    outputSnapshot: { confidenceScore, flags },
    durationMs,
    success: true,
  });
}

export async function recordVerdictOverride(
  claimId: number,
  documentId: number,
  reviewerName: string,
  originalVerdict: string | null,
  overriddenVerdict: string
): Promise<void> {
  await recordStep({
    claimId,
    documentId,
    step: "verdict_override",
    actor: reviewerName,
    inputSnapshot: { originalVerdict },
    outputSnapshot: { overriddenVerdict },
    success: true,
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normalizeRow(row: typeof claimProvenanceEvents.$inferSelect): ProvenanceChainEntry {
  return {
    id: row.id,
    claimId: row.claimId,
    documentId: row.documentId,
    step: row.step as ProvenanceStep,
    actor: row.actor,
    inputSnapshot: (row.inputSnapshot as Record<string, unknown> | null) ?? null,
    outputSnapshot: (row.outputSnapshot as Record<string, unknown> | null) ?? null,
    durationMs: row.durationMs ?? null,
    success: row.success,
    errorMsg: row.errorMsg ?? null,
    createdAt: row.createdAt,
  };
}
