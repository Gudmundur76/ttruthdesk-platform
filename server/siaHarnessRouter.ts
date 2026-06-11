/**
 * SIA Harness Improvement Router
 *
 * Provides tRPC procedures for the SIA (Self-Improving AI) citation integrity
 * harness improvement loop. This router:
 *
 *   1. Reads SIA generation results from the runs/ directory
 *   2. Compares generation scores to identify improvements
 *   3. Proposes prompt and logic improvements to the verdict engine
 *   4. Stores improvement proposals in the database for review
 *
 * The governing principle: every improvement is evaluated against one question —
 * does this make the platform a more accurate citation integrity classifier?
 *
 * Architecture:
 *   - SIA runs offline against the citation-integrity task dataset
 *   - After each run, this router reads the results and proposes improvements
 *   - Improvements are stored as proposals, not applied automatically
 *   - A human review step is required before any prompt change goes to production
 *
 * This is the H (harness) half of SIA-W+H. Weight updates are not implemented
 * as the platform uses API-based LLMs, not locally fine-tuned models.
 */

import { z } from "zod";
import { protectedProcedure, router } from "./_core/trpc";
import { invokeLLM } from "./_core/llm";
import { getDb } from "./db";
import { siaGenerations, siaImprovementProposals } from "../drizzle/schema";
import { desc, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

// ---------------------------------------------------------------------------
// Input / output schemas
// ---------------------------------------------------------------------------

const GenerationResultSchema = z.object({
  runId: z.string(),
  generation: z.number().int().min(1),
  combinedScore: z.number().min(0).max(1),
  citationStateAccuracy: z.number().min(0).max(1),
  passagePrecision: z.number().min(0).max(1),
  misrepresentationRecall: z.number().min(0).max(1),
  nTotal: z.number().int(),
  nEvaluated: z.number().int(),
  targetAgentCode: z.string().min(1),
  improvementMd: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Helper: generate improvement proposal via LLM
// ---------------------------------------------------------------------------

const IMPROVEMENT_ANALYSIS_PROMPT = `You are a citation integrity engineering expert reviewing SIA (Self-Improving AI) generation results for the Protein Truth Desk platform.

Your job is to analyse the performance metrics from a SIA generation run and propose specific, actionable improvements to the platform's verdict engine prompts and logic.

The platform classifies scientific claims into four citation states:
- verified: source directly supports the claim
- contested: source exists but evidence is weaker/narrower than claimed
- implied: no direct source but adjacent evidence implies the claim
- beyond_evidence: no source and no adjacent evidence

The platform also detects misrepresentation patterns:
- strength_overclaim, scope_overclaim, recency_overclaim, abstract_only, fabrication

Governing principle: ONLY propose improvements that increase citation integrity accuracy. Do not propose improvements that only make code more elegant without improving accuracy.

Respond with a JSON object:
{
  "priority": "high | medium | low",
  "improvement_type": "prompt_refinement | logic_improvement | confidence_calibration | passage_extraction",
  "target_component": "classification_prompt | passage_extractor | confidence_scorer | misrep_detector",
  "title": "short title (max 80 chars)",
  "description": "one paragraph explaining what to change and why it will improve accuracy",
  "proposed_change": "the specific prompt text or logic change to apply",
  "expected_score_gain": 0.0-0.2,
  "risk": "low | medium | high",
  "test_criteria": "how to verify this improvement works before applying to production"
}`;

async function generateImprovementProposal(
  metrics: z.infer<typeof GenerationResultSchema>,
  previousBestScore: number
): Promise<object> {
  const userPrompt = `Generation ${metrics.generation} results for run ${metrics.runId}:

Combined Score: ${metrics.combinedScore.toFixed(4)} (previous best: ${previousBestScore.toFixed(4)})
Citation State Accuracy: ${metrics.citationStateAccuracy.toFixed(4)}
Passage Alignment Precision: ${metrics.passagePrecision.toFixed(4)}
Misrepresentation Recall: ${metrics.misrepresentationRecall.toFixed(4)}
Claims evaluated: ${metrics.nEvaluated}/${metrics.nTotal}

${metrics.improvementMd ? `SIA Feedback Agent improvement plan:\n${metrics.improvementMd}` : "No improvement plan available for this generation."}

Target agent code excerpt (first 2000 chars):
${metrics.targetAgentCode.slice(0, 2000)}

Based on these metrics, what is the single highest-impact improvement to propose for the platform's verdict engine?`;

  const response = await invokeLLM({
    messages: [
      { role: "system", content: IMPROVEMENT_ANALYSIS_PROMPT },
      { role: "user", content: userPrompt },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "improvement_proposal",
        strict: true,
        schema: {
          type: "object",
          properties: {
            priority: { type: "string", enum: ["high", "medium", "low"] },
            improvement_type: {
              type: "string",
              enum: [
                "prompt_refinement",
                "logic_improvement",
                "confidence_calibration",
                "passage_extraction",
              ],
            },
            target_component: {
              type: "string",
              enum: [
                "classification_prompt",
                "passage_extractor",
                "confidence_scorer",
                "misrep_detector",
              ],
            },
            title: { type: "string" },
            description: { type: "string" },
            proposed_change: { type: "string" },
            expected_score_gain: { type: "number" },
            risk: { type: "string", enum: ["low", "medium", "high"] },
            test_criteria: { type: "string" },
          },
          required: [
            "priority",
            "improvement_type",
            "target_component",
            "title",
            "description",
            "proposed_change",
            "expected_score_gain",
            "risk",
            "test_criteria",
          ],
          additionalProperties: false,
        },
      },
    },
  });

  const rawContent = response.choices?.[0]?.message?.content;
  const content = typeof rawContent === "string" ? rawContent : null;
  if (!content) throw new Error("LLM returned empty improvement proposal");
  return JSON.parse(content);
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const siaHarnessRouter = router({
  /**
   * Record a completed SIA generation result and generate an improvement proposal.
   * Called after each SIA generation completes.
   */
  recordGeneration: protectedProcedure
    .input(GenerationResultSchema)
    .mutation(async ({ input, ctx }) => {
      // Only platform admins can record SIA generations
      if (ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN" });
      }

      const db = await getDb();
      if (!db)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Database unavailable",
        });

      // Find the previous best score for this run
      const previousGenerations = await db
        .select({ combinedScore: siaGenerations.combinedScore })
        .from(siaGenerations)
        .where(eq(siaGenerations.runId, input.runId))
        .orderBy(desc(siaGenerations.combinedScore))
        .limit(1);

      const previousBestScore = previousGenerations[0]?.combinedScore ?? 0;

      // Store the generation result
      await db.insert(siaGenerations).values({
        runId: input.runId,
        generation: input.generation,
        combinedScore: input.combinedScore,
        citationStateAccuracy: input.citationStateAccuracy,
        passagePrecision: input.passagePrecision,
        misrepresentationRecall: input.misrepresentationRecall,
        nTotal: input.nTotal,
        nEvaluated: input.nEvaluated,
        targetAgentCode: input.targetAgentCode,
        improvementMd: input.improvementMd ?? null,
        createdAt: Date.now(),
      });

      // Generate improvement proposal if score improved
      const scoreImproved = input.combinedScore > previousBestScore;
      let proposal = null;

      if (scoreImproved || input.generation === 1) {
        proposal = await generateImprovementProposal(input, previousBestScore);

        const db2 = db; // reuse same connection
        await db2.insert(siaImprovementProposals).values({
          runId: input.runId,
          generation: input.generation,
          combinedScore: input.combinedScore,
          scoreDelta: input.combinedScore - previousBestScore,
          proposal: JSON.stringify(proposal),
          status: "pending_review",
          createdAt: Date.now(),
        });
      }

      return {
        recorded: true,
        scoreImproved,
        previousBestScore,
        newScore: input.combinedScore,
        proposalGenerated: proposal !== null,
        proposal,
      };
    }),

  /**
   * List all SIA generations for a run, ordered by score descending.
   */
  listGenerations: protectedProcedure
    .input(z.object({ runId: z.string() }))
    .query(async ({ input, ctx }) => {
      if (ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN" });
      }

      const db = await getDb();
      if (!db)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Database unavailable",
        });

      return db
        .select()
        .from(siaGenerations)
        .where(eq(siaGenerations.runId, input.runId))
        .orderBy(desc(siaGenerations.combinedScore));
    }),

  /**
   * List pending improvement proposals awaiting review.
   */
  listProposals: protectedProcedure
    .input(
      z.object({
        status: z
          .enum(["pending_review", "approved", "rejected", "applied"])
          .optional(),
      })
    )
    .query(async ({ input, ctx }) => {
      if (ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN" });
      }

      const db = await getDb();
      if (!db)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Database unavailable",
        });

      const query = db
        .select()
        .from(siaImprovementProposals)
        .orderBy(desc(siaImprovementProposals.createdAt));

      if (input.status) {
        return query.where(eq(siaImprovementProposals.status, input.status));
      }

      return query;
    }),

  /**
   * Update the status of an improvement proposal (approve, reject, or mark applied).
   */
  updateProposalStatus: protectedProcedure
    .input(
      z.object({
        proposalId: z.number().int(),
        status: z.enum(["approved", "rejected", "applied"]),
        reviewNote: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      if (ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN" });
      }

      const db = await getDb();
      if (!db)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Database unavailable",
        });

      await db
        .update(siaImprovementProposals)
        .set({
          status: input.status,
          reviewNote: input.reviewNote ?? null,
          reviewedAt: Date.now(),
          reviewedBy: ctx.user.id,
        })
        .where(eq(siaImprovementProposals.id, input.proposalId));

      return { updated: true };
    }),

  /**
   * Get the current best generation score across all runs.
   * Used to track overall citation integrity improvement over time.
   */
  getBestScore: protectedProcedure.query(async ({ ctx }) => {
    if (ctx.user.role !== "admin") {
      throw new TRPCError({ code: "FORBIDDEN" });
    }

    const db = await getDb();
    if (!db)
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Database unavailable",
      });

    const best = await db
      .select({
        combinedScore: siaGenerations.combinedScore,
        runId: siaGenerations.runId,
        generation: siaGenerations.generation,
        createdAt: siaGenerations.createdAt,
      })
      .from(siaGenerations)
      .orderBy(desc(siaGenerations.combinedScore))
      .limit(1);

    return best[0] ?? null;
  }),
});
