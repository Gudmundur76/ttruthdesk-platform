/**
 * questionRouter.ts — Phase 110
 *
 * Question-to-Claim Interface + Demand-Triggered Loop
 *
 * Exposes a single tRPC procedure:
 *   questions.answerQuestion — converts a natural language question to a
 *   verifiable claim, runs it through the full analysis pipeline, and
 *   returns a structured answer with verdict + confidence + primary source
 *   citations.
 *
 * Demand-triggered loop:
 *   If confidence < 0.6 OR verdict === "insufficient_evidence", a
 *   "coverage_gap" event is emitted to the autonomous loop event bus so the
 *   frontier engine pursues the gap.
 *
 * Design principles:
 *   - Non-fatal: LLM failures return a graceful error response
 *   - Idempotent: identical questions can be re-submitted safely
 *   - Transparent: loopTriggered flag is always returned to the caller
 */

import { z } from "zod";
import { publicProcedure, router } from "./_core/trpc";
import { invokeLLM } from "./_core/llm";
import { insertQuestion, getQuestion, getClaimWithDocument } from "./db";
import { searchClaims } from "./searchEngine";
import { logger, errData } from "./logger";
import { classifyClaim } from "./domainClassifier";
import type { ClassificationResult } from "./domainClassifier";
import { questionToDeclarative } from "./questionDecomposer";
const log = logger("questionRouter");

// ─── Constants ────────────────────────────────────────────────────────────────

/** Confidence threshold below which the autonomous loop is triggered. */
export const LOOP_TRIGGER_CONFIDENCE = 0.6;

/** Verdict value that always triggers the loop regardless of confidence. */
export const LOOP_TRIGGER_VERDICT = "insufficient_evidence";

/** Maximum question length (characters). */
const MAX_QUESTION_LENGTH = 1000;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AnswerQuestionResult {
  questionId: number | null;
  questionText: string;
  derivedClaim: string;
  verdict: string;
  confidence: number;
  rationale: string;
  sources: SourceCitation[];
  loopTriggered: boolean;
  processedAt: string;
  /** Domain classification for the derived claim — Sprint 26 */
  domainClassification?: ClassificationResult;
}

export interface SourceCitation {
  pmid?: string;
  doi?: string;
  title?: string;
  url?: string;
}

// ─── LLM prompt ───────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a scientific claim verifier for a protein biology knowledge base.

Given a natural language question, you must:
1. Convert it into a single, precise, verifiable scientific claim (a declarative statement that can be true or false).
2. Assess the claim against your knowledge of protein biology, structural biology, and related fields.
3. Return a structured JSON response.

Rules:
- derivedClaim: a concise, verifiable declarative statement derived from the question
- verdict: one of "supported", "partially_supported", "insufficient_evidence", "contradicted", "ambiguous"
- confidence: float 0.0–1.0 (your confidence in the verdict given available evidence)
- rationale: 1–3 sentences explaining the verdict
- sources: array of up to 3 relevant citations (pmid, doi, title, url — include what you know)

IMPORTANT: Never return "out_of_scope". If you cannot assess the claim, return verdict="insufficient_evidence" with confidence=0.1.`;

// ─── Core logic ───────────────────────────────────────────────────────────────

/**
 * Convert a natural language question to a verifiable claim and assess it.
 * Returns a structured answer with verdict, confidence, and source citations.
 */
export async function processQuestion(
  questionText: string
): Promise<Omit<AnswerQuestionResult, "questionId">> {
  const processedAt = new Date().toISOString();

  let derivedClaim = questionText;
  let verdict = "insufficient_evidence";
  let confidence = 0.1;
  let rationale = "Unable to process the question at this time.";
  let sources: SourceCitation[] = [];

  try {
    // ── SIA Integration (Sprint 45) ──
    // Before hallucinating an answer via LLM, check the verified claims DB.
    // This grounds the Q&A in the actual citation graph.
    const declarative = questionToDeclarative(questionText);
    const searchResults = await searchClaims(declarative, { limit: 3 });
    
    // Filter for verified claims with high confidence
    const bestMatch = searchResults.find(r => 
      r.verdict && 
      r.verdict !== "insufficient_evidence" && 
      r.verdict !== "ambiguous" &&
      r.confidenceScore !== null && 
      r.confidenceScore >= 0.7
    );

    if (bestMatch) {
      log.info(`[QuestionRouter] Found verified DB match for: "${questionText}" -> Claim #${bestMatch.id}`);
      
      // Get full document provenance
      const fullClaim = await getClaimWithDocument(bestMatch.id);
      
      derivedClaim = bestMatch.claimText;
      verdict = bestMatch.verdict ?? "supported";
      confidence = bestMatch.confidenceScore ?? 0.8;
      rationale = fullClaim?.claim.verdictRationale ?? `Verified by ${fullClaim?.claim.verdictMethod || 'the citation graph'}.`;
      
      if (fullClaim?.document) {
        sources.push({
          title: fullClaim.document.title ?? "Source Document",
          url: fullClaim.document.storageUrl ?? undefined,
        });
      }
      
      // Add PDB/DOI evidence if available
      if (fullClaim?.claim.pdbEvidenceUrl) {
        sources.push({
          title: "Primary Evidence (PDB/DOI)",
          url: fullClaim.claim.pdbEvidenceUrl,
        });
      }
      
      // Skip the LLM call entirely since we have a verified answer
      const domainClassification = classifyClaim({
        text: derivedClaim,
        method: "passthrough",
        confidence,
        index: 0,
      });
      
      return {
        questionText,
        derivedClaim,
        verdict,
        confidence,
        rationale,
        sources,
        loopTriggered: false, // DB hits don't trigger the loop
        processedAt,
        domainClassification,
      };
    }
    
    // No DB match found — fall back to the LLM (which will likely trigger the loop)
    log.info(`[QuestionRouter] No DB match found, falling back to LLM for: "${questionText}"`);

    const response = await invokeLLM({
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: `Question: ${questionText.trim()}`,
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "question_answer",
          strict: true,
          schema: {
            type: "object",
            properties: {
              derivedClaim: {
                type: "string",
                description: "A concise, verifiable declarative statement",
              },
              verdict: {
                type: "string",
                enum: [
                  "supported",
                  "partially_supported",
                  "insufficient_evidence",
                  "contradicted",
                  "ambiguous",
                ],
              },
              confidence: {
                type: "number",
                description: "Confidence score 0.0–1.0",
              },
              rationale: {
                type: "string",
                description: "1–3 sentences explaining the verdict",
              },
              sources: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    pmid: { type: "string" },
                    doi: { type: "string" },
                    title: { type: "string" },
                    url: { type: "string" },
                  },
                  required: [],
                  additionalProperties: false,
                },
              },
            },
            required: [
              "derivedClaim",
              "verdict",
              "confidence",
              "rationale",
              "sources",
            ],
            additionalProperties: false,
          },
        },
      },
    });

    const content = response?.choices?.[0]?.message?.content;
    if (content) {
      const parsed = JSON.parse(
        typeof content === "string" ? content : JSON.stringify(content)
      ) as {
        derivedClaim?: string;
        verdict?: string;
        confidence?: number;
        rationale?: string;
        sources?: SourceCitation[];
      };

      derivedClaim = parsed.derivedClaim ?? questionText;
      verdict = parsed.verdict ?? "insufficient_evidence";
      confidence =
        typeof parsed.confidence === "number"
          ? Math.max(0, Math.min(1, parsed.confidence))
          : 0.1;
      rationale = parsed.rationale ?? rationale;
      sources = Array.isArray(parsed.sources) ? parsed.sources : [];
    }
  } catch (err) {
    log.error("[QuestionRouter] LLM call failed:", errData(err));
    // Return graceful degradation — loop will be triggered by low confidence
    confidence = 0.1;
    verdict = "insufficient_evidence";
  }

  // Determine if the autonomous loop should be triggered
  const loopTriggered =
    confidence < LOOP_TRIGGER_CONFIDENCE || verdict === LOOP_TRIGGER_VERDICT;

  // Classify the derived claim to the correct source adapter(s) — Sprint 26
  const declarative = questionToDeclarative(derivedClaim);
  const syntheticClaim = {
    text: declarative,
    method: "passthrough" as const,
    confidence,
    index: 0,
  };
  const domainClassification = classifyClaim(syntheticClaim);
  log.debug("domain classified", {
    domain: domainClassification.domain,
    primary: domainClassification.routes[0]?.sourceId,
  });

  return {
    questionText,
    derivedClaim,
    verdict,
    confidence,
    rationale,
    sources,
    loopTriggered,
    processedAt,
    domainClassification,
  };
}

/**
 * Emit a coverage_gap event to the autonomous loop event bus.
 * Fire-and-forget — failure is logged but not propagated.
 */
async function emitCoverageGap(
  questionText: string,
  derivedClaim: string,
  verdict: string,
  confidence: number
): Promise<void> {
  try {
    const { publishEvent } = await import("./autonomousLoop/eventBus");
    await publishEvent("coverage_gap", {
      questionText,
      derivedClaim,
      verdict,
      confidence,
      detectedAt: Math.floor(Date.now() / 1000),
    });
  } catch (err) {
    log.warn(
      "[QuestionRouter] coverage_gap event publish failed:",
      errData(err)
    );
  }
}

// ─── tRPC router ──────────────────────────────────────────────────────────────

export const questionRouter = router({
  /**
   * answerQuestion — converts a natural language question to a verifiable
   * claim, runs it through the analysis pipeline, and returns a structured
   * answer.
   *
   * Public procedure: no authentication required.
   */
  answerQuestion: publicProcedure
    .input(
      z.object({
        question: z
          .string()
          .min(3, "Question must be at least 3 characters")
          .max(
            MAX_QUESTION_LENGTH,
            `Question must be at most ${MAX_QUESTION_LENGTH} characters`
          )
          .trim(),
      })
    )
    .mutation(async ({ input }) => {
      const result = await processQuestion(input.question);

      // Persist to questions table (fire-and-forget on failure)
      let questionId: number | null = null;
      try {
        const askedAt = Math.floor(Date.now() / 1000);
        questionId = await insertQuestion({
          questionText: result.questionText,
          derivedClaim: result.derivedClaim,
          verdict: result.verdict,
          confidence: result.confidence,
          sources: result.sources,
          loopTriggered: result.loopTriggered,
          askedAt,
        });
      } catch (err) {
        log.error("[QuestionRouter] insertQuestion failed:", errData(err));
      }

      // Emit coverage_gap event if loop should be triggered
      if (result.loopTriggered) {
        void emitCoverageGap(
          result.questionText,
          result.derivedClaim,
          result.verdict,
          result.confidence
        );
      }

      return {
        questionId,
        questionText: result.questionText,
        derivedClaim: result.derivedClaim,
        verdict: result.verdict,
        confidence: result.confidence,
        rationale: result.rationale,
        sources: result.sources,
        loopTriggered: result.loopTriggered,
        processedAt: result.processedAt,
      };
    }),

  /**
   * getQuestion — retrieve a previously answered question by ID.
   * Public procedure: no authentication required.
   */
  getQuestion: publicProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input }) => {
      const q = await getQuestion(input.id);
      if (!q) return null;
      return {
        id: q.id,
        questionText: q.questionText,
        derivedClaim: q.derivedClaim,
        verdict: q.verdict,
        confidence: q.confidence,
        sources: (q.sources as SourceCitation[]) ?? [],
        loopTriggered: q.loopTriggered,
        askedAt: q.askedAt,
      };
    }),
});
