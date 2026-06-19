/**
 * hypothesisGenerator.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Frontier Engine — Layer 4: Hypothesis Generation
 *
 * Looks at patterns in verified truth and generates new, testable claims.
 * These are NOT stored as facts. They are submitted to coord_queue for
 * the discovery agent to find papers, which then go through the full
 * Truth Desk pipeline (Friction → Truth → Verdict).
 *
 * Two pattern types are implemented:
 *   1. Homology pattern: If A, B, C all bind X (Supported), and D is
 *      homologous to A, B, C → hypothesis: D binds X
 *   2. Contradiction pattern: If 3+ papers disagree on a measurement,
 *      generate a hypothesis about the confounding variable
 *
 * The Frontier Engine NEVER writes to graph_entities, graphRelations,
 * claims, or verdicts. Hypotheses go to coord_queue only.
 *
 * FR-L3-19: LLM circuit breaker — if 3 consecutive LLM calls fail,
 * Stage 4 is skipped until the cooldown expires.
 */

import { getDb } from "../db";
import { frontierLog, coordQueue } from "../../drizzle/schema";
import { sql } from "drizzle-orm";
import {} from "../_core/multiLLM";
import { frontierCircuitBreaker } from "./circuitBreaker";
import { logger } from "../logger";

const log = logger("frontier/hypothesisGenerator");

// ─── DB helper ────────────────────────────────────────────────────────────────
async function getDbOrThrow() {
  const d = await getDb();
  if (!d) throw new Error("[FrontierEngine] Database not available");
  return d;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface GeneratedHypothesis {
  claimText: string;
  rationale: string;
  patternType: "homology" | "contradiction" | "gap_closure";
  entityIds: number[];
  confidence: "low" | "medium"; // Never "high" — hypotheses are not facts
  searchTerms: string[];
}

export interface HypothesisGenerationResult {
  hypothesesGenerated: number;
  queueItemsCreated: number;
  hypotheses: GeneratedHypothesis[];
  /** True if Stage 4 was skipped because the circuit breaker is open */
  skippedByCircuitBreaker: boolean;
}

// ─── Pattern 1: Homology Binding Hypothesis ───────────────────────────────────

/**
 * Finds cases where:
 *   - Multiple proteins (A, B, C) all have Supported "binds" claims to ligand X
 *   - Another protein D is homologous to A, B, C (has "homologous_to" edges)
 *   - D has no existing binding claim for X
 *
 * Generates: "Protein D likely binds Ligand X based on homology with A, B, C"
 */
async function detectHomologyHypotheses(): Promise<GeneratedHypothesis[]> {
  const db = await getDbOrThrow();
  const hypotheses: GeneratedHypothesis[] = [];

  try {
    // Find ligands that multiple proteins bind (Supported)
    const result = await db.execute(sql`
      SELECT 
        gr.targetEntityId as ligandId,
        te.name as ligandName,
        COUNT(DISTINCT gr.sourceEntityId) as bindingProteinCount,
        GROUP_CONCAT(DISTINCT gr.sourceEntityId ORDER BY gr.sourceEntityId SEPARATOR ',') as bindingProteinIds,
        GROUP_CONCAT(DISTINCT se.name ORDER BY se.name SEPARATOR ', ') as bindingProteinNames
      FROM graph_relations gr
      JOIN graph_entities te ON te.id = gr.targetEntityId
      JOIN graph_entities se ON se.id = gr.sourceEntityId
      WHERE gr.relationType IN ('binds', 'interacts_with')
        AND gr.confidence >= 0.7
      GROUP BY gr.targetEntityId, te.name
      HAVING bindingProteinCount >= 2
      ORDER BY bindingProteinCount DESC
      LIMIT 10
    `);

    const ligandRows = result[0] as unknown as Array<{
      ligandId: number;
      ligandName: string;
      bindingProteinCount: number;
      bindingProteinIds: string;
      bindingProteinNames: string;
    }>;

    for (const ligand of ligandRows) {
      const bindingIds = ligand.bindingProteinIds.split(",").map(Number);

      // Find proteins homologous to the binding proteins that don't yet bind this ligand
      const homologResult = await db.execute(sql`
        SELECT DISTINCT
          gr2.targetEntityId as homologId,
          he.name as homologName
        FROM graph_relations gr2
        JOIN graph_entities he ON he.id = gr2.targetEntityId
        WHERE gr2.relationType = 'homologous_to'
          AND gr2.sourceEntityId IN (${sql.raw(bindingIds.join(","))})
          AND gr2.targetEntityId NOT IN (${sql.raw(bindingIds.join(","))})
          AND gr2.targetEntityId NOT IN (
            SELECT sourceEntityId FROM graph_relations
            WHERE targetEntityId = ${ligand.ligandId}
              AND relationType IN ('binds', 'interacts_with')
          )
        LIMIT 5
      `);

      const homologs = homologResult[0] as unknown as Array<{
        homologId: number;
        homologName: string;
      }>;

      for (const homolog of homologs) {
        hypotheses.push({
          claimText: `${homolog.homologName} likely binds ${ligand.ligandName} based on structural homology with ${ligand.bindingProteinNames}.`,
          rationale: `${ligand.bindingProteinCount} proteins homologous to ${homolog.homologName} (${ligand.bindingProteinNames}) all have Supported binding claims for ${ligand.ligandName}. Homology pattern suggests ${homolog.homologName} shares this binding capability. This is a mechanically-generated hypothesis — not a verified fact.`,
          patternType: "homology",
          entityIds: [homolog.homologId, ligand.ligandId, ...bindingIds],
          confidence: "medium",
          searchTerms: [
            homolog.homologName,
            ligand.ligandName,
            "binding assay",
            "structural homology",
            "interaction study",
          ],
        });
      }
    }
  } catch (err) {
    // Non-fatal — record failure for circuit breaker
    frontierCircuitBreaker.recordFailure();
    log.warn("[HypothesisGenerator] Homology detection failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return hypotheses;
}

// ─── Pattern 2: Contradiction Resolution Hypothesis ──────────────────────────

/**
 * Finds entity pairs with multiple contradicting claims and generates a
 * hypothesis about the confounding variable (e.g., experimental conditions).
 */
async function detectContradictionHypotheses(): Promise<GeneratedHypothesis[]> {
  const db = await getDbOrThrow();
  const hypotheses: GeneratedHypothesis[] = [];

  try {
    const result = await db.execute(sql`
      SELECT 
        gr.sourceEntityId,
        gr.targetEntityId,
        COUNT(*) as contradictionCount,
        se.name as sourceName,
        te.name as targetName
      FROM graph_relations gr
      JOIN graph_entities se ON se.id = gr.sourceEntityId
      JOIN graph_entities te ON te.id = gr.targetEntityId
      WHERE gr.relationType = 'contradicts'
      GROUP BY gr.sourceEntityId, gr.targetEntityId, se.name, te.name
      HAVING contradictionCount >= 3
      ORDER BY contradictionCount DESC
      LIMIT 5
    `);

    const rows = result[0] as unknown as Array<{
      sourceEntityId: number;
      targetEntityId: number;
      contradictionCount: number;
      sourceName: string;
      targetName: string;
    }>;

    for (const row of rows) {
      hypotheses.push({
        claimText: `The ${row.contradictionCount} contradicting claims about the relationship between ${row.sourceName} and ${row.targetName} may be explained by batch-dependent experimental conditions (temperature, buffer composition, or expression system).`,
        rationale: `${row.contradictionCount} papers in the knowledge graph produce contradicting claims about ${row.sourceName} and ${row.targetName}. Contradiction pattern analysis suggests experimental variability as a confounding variable. This hypothesis targets the resolution of gap — not a verified fact.`,
        patternType: "contradiction",
        entityIds: [row.sourceEntityId, row.targetEntityId],
        confidence: "low",
        searchTerms: [
          row.sourceName,
          row.targetName,
          "experimental conditions",
          "reproducibility",
          "batch effects",
          "systematic review",
        ],
      });
    }
  } catch (err) {
    // Non-fatal — record failure for circuit breaker
    frontierCircuitBreaker.recordFailure();
    log.warn("[HypothesisGenerator] Contradiction detection failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return hypotheses;
}

// ─── Core: queueHypothesis ────────────────────────────────────────────────────

/**
 * Submits a hypothesis to coord_queue for the discovery agent.
 * The hypothesis will be processed through the full Truth Desk pipeline.
 * The Frontier Engine NEVER writes the hypothesis as a claim directly.
 */
async function queueHypothesis(
  hypothesis: GeneratedHypothesis,
  gapId?: number
): Promise<number | null> {
  const db = await getDbOrThrow();

  try {
    const [inserted] = await db.insert(coordQueue).values({
      vertical: "protein",
      priority: 40,
      status: "pending",
      source: "frontier_hypothesis",
      title: `[Frontier Hypothesis] ${hypothesis.claimText.slice(0, 200)}`,
      result: {
        hypothesis: hypothesis.claimText,
        rationale: hypothesis.rationale,
        patternType: hypothesis.patternType,
        searchTerms: hypothesis.searchTerms,
        entityIds: hypothesis.entityIds,
        confidence: hypothesis.confidence,
        gapId,
        // IMPORTANT: This is a hypothesis, not a verified claim.
        // The discovery agent must find papers; the pipeline must verify.
        requiresVerification: true,
      } as unknown as null,
    });

    const queueItemId = (inserted as unknown as { insertId: number }).insertId;

    await db.insert(frontierLog).values({
      actionType: "hypothesis_queued",
      gapId,
      queueItemId,
      reasoning: {
        patternType: hypothesis.patternType,
        claimText: hypothesis.claimText.slice(0, 300),
        confidence: hypothesis.confidence,
        searchTerms: hypothesis.searchTerms,
      },
      outcome: `Hypothesis queued as coord_queue item #${queueItemId} for verification`,
    });

    // Record success for circuit breaker
    frontierCircuitBreaker.recordSuccess();
    return queueItemId;
  } catch (_err) {
    // Record failure for circuit breaker
    const tripped = frontierCircuitBreaker.recordFailure();
    if (tripped) {
      log.warn("[HypothesisGenerator] Circuit breaker tripped — Stage 4 will be skipped next cycle", {
        consecutiveFailures: frontierCircuitBreaker.consecutiveFailures,
      });
    }
    return null;
  }
}

// ─── Public: runHypothesisGenerator ──────────────────────────────────────────

/**
 * Runs all hypothesis patterns and queues results for verification.
 * Called by the Frontier Engine orchestrator.
 *
 * FR-L3-19: If the circuit breaker is open, skips Stage 4 entirely and
 * returns a result with skippedByCircuitBreaker=true.
 */
export async function runHypothesisGenerator(
  maxHypotheses = 5
): Promise<HypothesisGenerationResult> {
  // FR-L3-19: Check circuit breaker before running Stage 4
  if (frontierCircuitBreaker.shouldSkip()) {
    const state = frontierCircuitBreaker.getState();
    log.warn("[HypothesisGenerator] Circuit breaker open — skipping Stage 4", {
      consecutiveFailures: state.consecutiveFailures,
      openedAt: state.openedAt,
      cooldownMs: state.cooldownMs,
    });
    return {
      hypothesesGenerated: 0,
      queueItemsCreated: 0,
      hypotheses: [],
      skippedByCircuitBreaker: true,
    };
  }

  const [homologyHypotheses, contradictionHypotheses] = await Promise.all([
    detectHomologyHypotheses(),
    detectContradictionHypotheses(),
  ]);

  // Apply maxHypotheses cap
  const allHypotheses = [...homologyHypotheses, ...contradictionHypotheses].slice(0, maxHypotheses);
  let queueItemsCreated = 0;

  for (const hypothesis of allHypotheses) {
    const queueItemId = await queueHypothesis(hypothesis);
    if (queueItemId !== null) queueItemsCreated++;
  }

  return {
    hypothesesGenerated: allHypotheses.length,
    queueItemsCreated,
    hypotheses: allHypotheses,
    skippedByCircuitBreaker: false,
  };
}

/**
 * Records the outcome of a Frontier hypothesis after Truth Desk verifies it.
 * Called by analysisPipeline when a coord_queue item with source="frontier_hypothesis"
 * completes with a Supported or Contradicted verdict.
 */
export async function recordHypothesisOutcome(
  queueItemId: number,
  verdict: "Supported" | "Contradicted" | "Insufficient Evidence",
  claimId?: number
): Promise<void> {
  const db = await getDbOrThrow();

  const actionType =
    verdict === "Supported"
      ? "hypothesis_verified"
      : verdict === "Contradicted"
        ? "hypothesis_refuted"
        : "gap_detected"; // Re-open gap if still insufficient

  await db.insert(frontierLog).values({
    actionType,
    queueItemId,
    reasoning: {
      verdict,
      claimId,
      note:
        verdict === "Supported"
          ? "Frontier hypothesis confirmed by Truth Desk pipeline"
          : verdict === "Contradicted"
            ? "Frontier hypothesis refuted — false path eliminated, model learns"
            : "Hypothesis still unverifiable — gap remains open",
    },
    outcome: `Hypothesis outcome: ${verdict}`,
  });
}
