/**
 * topologyHypothesisGenerator.ts — Dream Cycle 3: Topology Hypothesis Generation
 *
 * Uses the patterns detected in Cycle 2 to generate new hypotheses that can
 * be queued for evidence pursuit. Unlike the Inverse Prompt Engine (which
 * generates hypotheses from individual claims), the Dream State generates
 * hypotheses from graph-level topology — specifically:
 *
 *   1. For each homology_bridge pattern: generate a hypothesis that protein A
 *      is homologous to protein B, queued as a graph_inference generated_claim.
 *   2. For each evidence_desert pattern: generate a hypothesis that the entity
 *      may have been mis-classified, queued as a contradiction_chase claim.
 *   3. For each contradiction_cluster: generate a hypothesis that a new
 *      authoritative source could resolve the cluster.
 *
 * All hypotheses pass through the existing verifiabilityGate before queuing.
 */

import { getDb } from "../db";
import { graphEntities } from "../../drizzle/schema";
import { eq } from "drizzle-orm";
import type { DetectedPattern } from "./latentPatternDetector";
import { runVerifiabilityGate } from "../inversePrompt/verifiabilityGate";
import { persistGeneratedClaim } from "../inversePrompt/claimQueueWriter";

export interface HypothesisGenerationResult {
  hypothesesQueued: number;
  hypothesesRejected: number;
  hypothesesDeferred: number;
}

/**
 * Generate hypotheses from detected patterns and queue them for evidence pursuit.
 */
  // eslint-disable-next-line complexity -- TODO(phase-131): extract helpers to reduce complexity
export async function generateTopologyHypotheses(
  patterns: DetectedPattern[]
): Promise<HypothesisGenerationResult> {
  const result: HypothesisGenerationResult = {
    hypothesesQueued: 0,
    hypothesesRejected: 0,
    hypothesesDeferred: 0,
  };

  const db = await getDb();
  if (!db || patterns.length === 0) return result;

  for (const pattern of patterns) {
    try {
      if (pattern.type === "homology_bridge" && pattern.entityIds.length >= 2) {
        // Generate homology hypothesis for the first pair
        const [idA, idB] = pattern.entityIds;
        const [entityA] = await db
          .select({ canonicalName: graphEntities.canonicalName })
          .from(graphEntities)
          .where(eq(graphEntities.id, idA))
          .limit(1);
        const [entityB] = await db
          .select({ canonicalName: graphEntities.canonicalName })
          .from(graphEntities)
          .where(eq(graphEntities.id, idB))
          .limit(1);

        if (entityA && entityB) {
          const candidate = {
            claimText: `${entityA.canonicalName} is structurally homologous to ${entityB.canonicalName} based on shared experimental methods.`,
            claimType: "general_molecular",
            inferenceType: "homology_projection" as const,
            requiredSources: ["rcsb_pdb", "uniprot"],
            sourceQuery: `${entityA.canonicalName} ${entityB.canonicalName} homology structure`,
            parentVerifications: [] as number[],
            entityId: idA,
            reasoning: `Dream State detected ${pattern.evidence}. Both entities share ≥ 2 experimental methods but lack a homologous_to edge.`,
          };
          const gateResult = runVerifiabilityGate(candidate);
          const writeResult = await persistGeneratedClaim(
            candidate,
            gateResult,
            "structural_biology"
          );
          if (writeResult) {
            if (writeResult.status === "queued" || writeResult.status === "duplicate") result.hypothesesQueued++;
            else if (writeResult.status === "rejected") result.hypothesesRejected++;
            else if (writeResult.status === "deferred") result.hypothesesDeferred++;
          }
        }
      } else if (pattern.type === "contradiction_cluster" && pattern.entityIds.length > 0) {
        // Generate a contradiction-chase hypothesis for the most contradicted entity
        const [entityId] = pattern.entityIds;
        const [entity] = await db
          .select({ canonicalName: graphEntities.canonicalName })
          .from(graphEntities)
          .where(eq(graphEntities.id, entityId))
          .limit(1);

        if (entity) {
          const candidate = {
            claimText: `The contradictions surrounding ${entity.canonicalName} may be resolvable by consulting a primary crystallographic database source.`,
            claimType: "general_molecular",
            inferenceType: "contradiction_chase" as const,
            requiredSources: ["rcsb_pdb"],
            sourceQuery: `${entity.canonicalName} structure contradiction resolution`,
            parentVerifications: [] as number[],
            entityId,
            reasoning: `Dream State detected ${pattern.evidence}. High contradiction degree suggests a canonical source check could resolve ambiguity.`,
          };
          const gateResult = runVerifiabilityGate(candidate);
          const writeResult = await persistGeneratedClaim(
            candidate,
            gateResult,
            "structural_biology"
          );
          if (writeResult) {
            if (writeResult.status === "queued" || writeResult.status === "duplicate") result.hypothesesQueued++;
            else if (writeResult.status === "rejected") result.hypothesesRejected++;
            else if (writeResult.status === "deferred") result.hypothesesDeferred++;
          }
        }
      }
    } catch {
      // Non-fatal — continue with remaining patterns
    }
  }

  return result;
}
