/**
 * claimQueueWriter.ts
 *
 * Persists generated claims to the generated_claims table and queues
 * passed claims into coord_queue with source="graph_inference".
 *
 * Authority boundary: this module has NO write access to the knowledge graph.
 * It only writes to: generated_claims, coord_queue.
 */

import { getDb } from "../db";
import { generatedClaims, coordQueue } from "../../drizzle/schema";
import { eq } from "drizzle-orm";
import type { GeneratedClaimCandidate } from "./graphQuestionGenerator";
import type { GateResult } from "./verifiabilityGate";

export interface WriteResult {
  generatedClaimId: number;
  coordQueueId?: number;
  status: "queued" | "rejected" | "deferred" | "duplicate";
}

/**
 * Persist a single generated claim and optionally queue it.
 * Deduplication: if an identical claimText already exists in generated_claims
 * with status pending/queued/processing, skip it.
 */
export async function persistGeneratedClaim(
  candidate: GeneratedClaimCandidate,
  gateResult: GateResult,
  vertical = "structural_biology"
): Promise<WriteResult | null> {
  const db = await getDb();
  if (!db) return null;

  // Deduplication check
  const existing = await db
    .select({ id: generatedClaims.id, status: generatedClaims.status })
    .from(generatedClaims)
    .where(eq(generatedClaims.claimText, candidate.claimText))
    .limit(1);

  if (existing.length > 0 && ["pending", "queued", "processing"].includes(existing[0].status)) {
    return { generatedClaimId: existing[0].id, status: "duplicate" };
  }

  const statusMap: Record<string, "pending" | "rejected" | "deferred"> = {
    pass:   "pending",
    reject: "rejected",
    defer:  "deferred",
  };

  const [inserted] = await db
    .insert(generatedClaims)
    .values({
      claimText:           candidate.claimText,
      claimType:           candidate.claimType,
      inferenceType:       candidate.inferenceType,
      requiredSources:     candidate.requiredSources,
      sourceQuery:         candidate.sourceQuery,
      parentVerifications: candidate.parentVerifications,
      entityId:            candidate.entityId,
      reasoning:           candidate.reasoning,
      passedGate:          gateResult.verdict === "pass",
      rejectionReason:     gateResult.rejectionReason ?? null,
      status:              statusMap[gateResult.verdict] ?? "pending",
      priority:            gateResult.priority,
    })
    .$returningId();

  if (!inserted?.id) return null;
  const generatedClaimId = inserted.id;

  if (gateResult.verdict !== "pass") {
    return { generatedClaimId, status: statusMap[gateResult.verdict] as "rejected" | "deferred" };
  }

  // Queue the claim for evidence pursuit
  const claimSummary = `[Graph-Inferred] ${candidate.claimText.slice(0, 200)}`;
  const [queueInserted] = await db
    .insert(coordQueue)
    .values({
      vertical,
      title:    claimSummary,
      priority: gateResult.priority,
      status:   "pending",
      source:   "graph_inference",
    })
    .$returningId();

  const coordQueueId = queueInserted?.id;

  if (coordQueueId) {
    await db
      .update(generatedClaims)
      .set({ status: "queued", coordQueueId })
      .where(eq(generatedClaims.id, generatedClaimId));
  }

  return { generatedClaimId, coordQueueId, status: "queued" };
}

/**
 * Batch-persist a list of (candidate, gateResult) pairs.
 * Returns a summary of what was queued, rejected, deferred, or skipped as duplicates.
 */
export async function persistBatch(
  pairs: Array<{ candidate: GeneratedClaimCandidate; gateResult: GateResult }>,
  vertical = "structural_biology"
): Promise<{
  queued: number;
  rejected: number;
  deferred: number;
  duplicates: number;
  errors: number;
}> {
  const summary = { queued: 0, rejected: 0, deferred: 0, duplicates: 0, errors: 0 };

  for (const { candidate, gateResult } of pairs) {
    try {
      const result = await persistGeneratedClaim(candidate, gateResult, vertical);
      if (!result) { summary.errors++; continue; }
      if (result.status === "queued")    summary.queued++;
      else if (result.status === "rejected") summary.rejected++;
      else if (result.status === "deferred") summary.deferred++;
      else if (result.status === "duplicate") summary.duplicates++;
    } catch {
      summary.errors++;
    }
  }

  return summary;
}
