/**
 * qualityPassFeedbackCollector.ts — SIA Feedback Collector
 *
 * Runs after each quality-pass job to:
 *   1. Collect outcome metrics (upgrade rate, verdict distribution, etc.)
 *   2. Store a quality_pass_feedback row
 *   3. Run the SIA Feedback-Agent for the claim_extractor component
 *   4. If the Feedback-Agent proposes a revision AND risk is low/medium,
 *      activate the new prompt for the next generation
 *
 * This is the "H" (harness) half of SIA-W+H applied to the live pipeline.
 * Weight updates are not implemented (API-based LLMs, not locally fine-tuned).
 *
 * Safety constraints:
 *   - Only activates low/medium risk proposals automatically
 *   - High-risk proposals are stored as pending_review in sia_improvement_proposals
 *   - The previous prompt is always preserved in the DB (never deleted)
 *   - The upgrade rate must be below 0.75 to trigger a revision (healthy pipeline = no change)
 */

import { getDb } from "../db";
import {
  qualityPassFeedback,
  siaImprovementProposals,
  claims,
} from "../../drizzle/schema";
import { eq } from "drizzle-orm";
import {
  getActivePrompt,
  runFeedbackAgent,
  activatePrompt,
  seedPromptIfMissing,
} from "./promptHarnessManager";
import type { QualityPassResult } from "../qualityPassJob";
import { logger, errData } from "../logger";
const log = logger("sia/qualityPassFeedbackCollector");


// ─── Types ────────────────────────────────────────────────────────────────────

export interface FeedbackCollectorResult {
  feedbackRowId: number | null;
  harnessGeneration: number;
  upgradeRate: number;
  feedbackTriggered: boolean;
  proposalGenerated: boolean;
  proposalActivated: boolean;
  newGeneration: number | null;
  reasoning: string;
}

// ─── Core function ────────────────────────────────────────────────────────────

/**
 * Collect quality-pass outcomes and run the SIA feedback loop.
 * Called at the end of qualityPassJobHandler.
 *
 * @param result - The QualityPassResult from the quality-pass job
 * @param processedDocIds - Array of document IDs that were processed in this run
 */
export async function collectQualityPassFeedback(
  result: QualityPassResult,
  processedDocIds: number[]
): Promise<FeedbackCollectorResult> {
  const db = await getDb();
  if (!db) {
    return {
      feedbackRowId: null,
      harnessGeneration: 1,
      upgradeRate: 0,
      feedbackTriggered: false,
      proposalGenerated: false,
      proposalActivated: false,
      newGeneration: null,
      reasoning: "Database unavailable",
    };
  }

  // 1. Ensure seed prompts exist for all components
  await Promise.allSettled([
    seedPromptIfMissing("claim_extractor"),
    seedPromptIfMissing("verdict_rationale"),
    seedPromptIfMissing("passage_extractor"),
    seedPromptIfMissing("misrep_classifier"),
  ]);

  // 2. Get the current active harness generation
  const currentHarness = await getActivePrompt("claim_extractor");
  const harnessGeneration = currentHarness.generation;

  // 3. Compute verdict distribution for the processed documents
  const verdictCounts = {
    verdictSupported: 0,
    verdictContested: 0,
    verdictInsufficient: 0,
    verdictContradicted: 0,
  };
  let totalClaims = 0;

  if (processedDocIds.length > 0) {
    try {
      // Count verdicts for all claims in the processed documents
      for (const docId of processedDocIds) {
        const docClaims = await db
          .select({ verdict: claims.verdict })
          .from(claims)
          .where(eq(claims.documentId, docId));

        totalClaims += docClaims.length;
        for (const c of docClaims) {
          const v = (c.verdict ?? "").toLowerCase();
          if (v.includes("support")) verdictCounts.verdictSupported++;
          else if (
            v.includes("contest") ||
            v.includes("partial") ||
            v.includes("ambiguous")
          )
            verdictCounts.verdictContested++;
          else if (v.includes("insufficient") || v.includes("beyond"))
            verdictCounts.verdictInsufficient++;
          else if (v.includes("contradict") || v.includes("refut"))
            verdictCounts.verdictContradicted++;
        }
      }
    } catch (err) {
      log.warn(
        "[FeedbackCollector] Error counting verdicts (non-fatal):",
        errData(err)
      );
    }
  }

  // 4. Compute derived metrics
  const total = result.processed + result.failed;
  const upgradeRate = total > 0 ? result.processed / total : 0;
  const failRate = total > 0 ? result.failed / total : 0;
  const avgClaimsPerDoc =
    result.processed > 0 ? totalClaims / result.processed : 0;

  // 5. Store the feedback row
  let feedbackRowId: number | null = null;
  try {
    const insertResult = await db.insert(qualityPassFeedback).values({
      runDate: new Date().toISOString().slice(0, 10),
      batchSize: result.processed + result.skipped + result.failed,
      processed: result.processed,
      skipped: result.skipped,
      failed: result.failed,
      ...verdictCounts,
      upgradeRate,
      avgClaimsPerDoc,
      harnessGeneration,
      createdAt: Date.now(),
    });
    feedbackRowId = (insertResult as { insertId?: number }).insertId ?? null;
  } catch (err) {
    log.error("[FeedbackCollector] Error storing feedback row:", errData(err));
  }

  // 6. Decide whether to run the Feedback-Agent
  // Only trigger if the pipeline processed at least 3 documents AND upgrade rate < 0.75
  const shouldTriggerFeedback = result.processed >= 3 && upgradeRate < 0.75;

  if (!shouldTriggerFeedback) {
    const reason =
      result.processed < 3
        ? `Too few documents processed (${result.processed} < 3)`
        : `Upgrade rate healthy (${(upgradeRate * 100).toFixed(1)}% ≥ 75%)`;
    log.info(`[FeedbackCollector] Skipping Feedback-Agent: ${reason}`);
    return {
      feedbackRowId,
      harnessGeneration,
      upgradeRate,
      feedbackTriggered: false,
      proposalGenerated: false,
      proposalActivated: false,
      newGeneration: null,
      reasoning: reason,
    };
  }

  // 7. Run the Feedback-Agent for claim_extractor (primary component)
  log.info(
    `[FeedbackCollector] Running Feedback-Agent (upgradeRate=${(upgradeRate * 100).toFixed(1)}%, gen=${harnessGeneration})`
  );

  const proposal = await runFeedbackAgent("claim_extractor", currentHarness, {
    upgradeRate,
    failRate,
    avgClaimsPerDoc,
    ...verdictCounts,
    processed: result.processed,
  });

  if (!proposal) {
    return {
      feedbackRowId,
      harnessGeneration,
      upgradeRate,
      feedbackTriggered: true,
      proposalGenerated: false,
      proposalActivated: false,
      newGeneration: null,
      reasoning: "Feedback-Agent found no improvement needed",
    };
  }

  // 8. Store the proposal in sia_improvement_proposals
  let proposalId: number | null = null;
  try {
    const propResult = await db.insert(siaImprovementProposals).values({
      runId: `quality-pass-${new Date().toISOString().slice(0, 10)}`,
      generation: harnessGeneration + 1,
      combinedScore: upgradeRate,
      scoreDelta: proposal.expectedUpgradeRateDelta,
      proposal: JSON.stringify({
        component: proposal.component,
        revisedPromptText: proposal.revisedPromptText,
        reasoning: proposal.reasoning,
        expectedUpgradeRateDelta: proposal.expectedUpgradeRateDelta,
        risk: proposal.risk,
      }),
      status: proposal.risk === "high" ? "pending_review" : "approved",
      createdAt: Date.now(),
    });
    proposalId = (propResult as { insertId?: number }).insertId ?? null;
  } catch (err) {
    log.error("[FeedbackCollector] Error storing proposal:", errData(err));
  }

  // 9. Auto-activate low/medium risk proposals
  const shouldActivate = proposal.risk !== "high";
  let newGeneration: number | null = null;

  if (shouldActivate) {
    try {
      newGeneration = harnessGeneration + 1;
      await activatePrompt(
        "claim_extractor",
        newGeneration,
        proposal.revisedPromptText,
        {
          upgradeRate,
          failRate,
          avgClaimsPerDoc,
          improvementProposalId: proposalId ?? undefined,
        }
      );

      // Update the feedback row with the proposal reference
      if (feedbackRowId) {
        await db
          .update(qualityPassFeedback)
          .set({
            feedbackProposalId: proposalId,
            feedbackReasoning: proposal.reasoning,
          })
          .where(eq(qualityPassFeedback.id, feedbackRowId));
      }

      log.info(
        `[FeedbackCollector] Activated generation ${newGeneration} for claim_extractor (risk=${proposal.risk})`
      );
    } catch (err) {
      log.error("[FeedbackCollector] Error activating new prompt:", errData(err));
      newGeneration = null;
    }
  } else {
    log.info(
      `[FeedbackCollector] High-risk proposal stored for human review (proposalId=${proposalId})`
    );
  }

  return {
    feedbackRowId,
    harnessGeneration,
    upgradeRate,
    feedbackTriggered: true,
    proposalGenerated: true,
    proposalActivated: shouldActivate && newGeneration !== null,
    newGeneration,
    reasoning: proposal.reasoning,
  };
}
