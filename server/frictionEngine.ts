/**
 * frictionEngine.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * FrictionEngine — Self-Prompting Prompt Optimization Layer
 *
 * Implements the full 7-stage self-prompting loop from the FrictionEngine paper
 * (Manus AI, June 2026):
 *
 *   Raw Prompt → Intent Extraction → Assumption Detection → Why Interrogation
 *   → Constraint Classification → Prompt Reframe → Execution Prompt
 *   → Output Review → Final Response
 *
 * Applied to Truth Desk as a pre-submission interrogation layer. Before a user
 * submits a document for full audit, this service:
 *
 *   1. Infers the submitter's deeper intent (not just "audit this doc")
 *   2. Maps all hidden assumptions with type, risk level, and falsification test
 *   3. Classifies constraints as hard vs. soft vs. preference
 *   4. Selects the single highest-leverage friction question (if needed)
 *   5. Generates an optimized reframed prompt for the downstream pipeline
 *   6. Adds validation criteria for the audit
 *   7. Applies the Friction Decision Policy to route: execute | ask_user | reject | reframe
 *
 * Exports:
 *   runPreflightScan(text)  → FrictionEngineResult
 *   runOutputAudit(prompt, answer) → OutputAuditResult
 */

import { invokeMultiLLM } from "./_core/multiLLM";
import { findClaimsByTextSimilarity, type ClaimSignal } from "./graphTraversal";

// ─── Types — Full Paper JSON Schema ──────────────────────────────────────────

export type AssumptionType =
  | "factual"
  | "strategic"
  | "emotional"
  | "market"
  | "technical"
  | "scientific"
  | "operational";

export type AssumptionRisk = "low" | "medium" | "high";

export type ConstraintClassification =
  | "hard"
  | "soft"
  | "assumption"
  | "preference"
  | "unknown";

export type RecommendedAction =
  | "execute"       // Intent clear, assumptions low-risk → proceed silently
  | "ask_user"      // One high-risk assumption → ask single friction question, block until answered
  | "reject"        // Contradictory goals or unfalsifiable document → refuse with reason
  | "reframe";      // Better prompt available → show optimized_prompt, let user confirm

export interface FrictionAssumption {
  statement: string;          // "This assumes that…"
  type: AssumptionType;
  risk: AssumptionRisk;
  test: string;               // How to verify or falsify this assumption
}

export interface FrictionConstraint {
  constraint: string;
  classification: ConstraintClassification;
  evidence: string;           // What evidence supports classifying it this way
}

/** The full FrictionEngine structured JSON schema from Section 13 of the paper */
export interface FrictionEngineResult {
  // ── Core schema fields ──────────────────────────────────────────────────────
  raw_prompt: string;
  surface_request: string;
  inferred_intent: string;
  assumptions: FrictionAssumption[];
  constraints: FrictionConstraint[];
  friction_question: string;        // Single highest-leverage why-question (empty if not needed)
  optimized_prompt: string;         // Reframed execution-ready prompt
  validation_criteria: string[];    // What a good answer must satisfy
  remaining_uncertainty: string;    // What cannot be resolved before submission
  recommended_action: RecommendedAction;

  // ── Truth Desk claim-level detail ───────────────────────────────────────────
  claims: PreflightClaim[];
  totalClaims: number;
  databaseVerifiable: number;
  assumptionSmuggled: number;
  likelyContradicted: number;
  outOfScope: number;
  opinionOrNarrative: number;

  // ── Meta ────────────────────────────────────────────────────────────────────
  // ── Graph-backed prior signals ──────────────────────────────────────────────────────
  // Top-5 semantically similar claims already in the knowledge graph,
  // with their composite truth signals. Empty array if graph has no matches.
  priorGraphSignals: ClaimSignal[];

  durationMs: number;
}

export type ClaimCategory =
  | "database_verifiable"
  | "assumption_smuggled"
  | "likely_contradicted"
  | "out_of_scope"
  | "opinion_or_narrative";

export interface PreflightClaim {
  text: string;
  category: ClaimCategory;
  assumptionExposed: string | null;
  falsificationTest: string | null;
}

// ─── Output Audit Types ───────────────────────────────────────────────────────

export type AuditVerdict = "pass" | "revise" | "ask_user" | "reject";

export interface OutputAuditResult {
  verdict: AuditVerdict;
  satisfiesDeepIntent: boolean;
  reliesOnUnverifiedAssumptions: boolean;
  distinguishesFactsFromGuesses: boolean;
  addressesValidationCriteria: boolean;
  reason: string;
  suggestedRevision: string | null;
}

// ─── System Prompts ───────────────────────────────────────────────────────────

const FRICTION_ENGINE_SYSTEM_PROMPT = `You are FrictionEngine, a self-prompting prompt optimization layer applied to scientific document submission.

Your role is NOT to answer the user's request immediately. Your role is to transform it.

The user is submitting a scientific document for claim verification against authoritative databases (PDB, UniProt, PubMed, OpenFDA, etc.).

For this document, you must:

1. IDENTIFY the surface request: what the user literally wants (audit this document).
2. INFER the deeper intent: what they are actually trying to achieve (validate specific claims, find contradictions, build credibility, etc.).
3. MAP all hidden assumptions in the document with type, risk level, and how to test each one.
4. CLASSIFY constraints as hard (cannot be changed), soft (preferred), assumption (treated as fact but unverified), preference (stylistic), or unknown.
5. SELECT the single highest-leverage friction question — only if answering it would materially change how the audit is run. If the intent is clear and assumptions are low-risk, leave friction_question empty.
6. GENERATE an optimized reframed prompt for the downstream audit pipeline.
7. ADD validation criteria: what a good audit result must satisfy.
8. APPLY the Friction Decision Policy:
   - "execute": intent is clear, all assumptions are low-risk → proceed
   - "ask_user": intent is clear but ONE assumption is high-risk → ask the friction_question, block until answered
   - "reject": document contains contradictory goals, no verifiable claims, or is entirely unfalsifiable
   - "reframe": a significantly better framing exists → show optimized_prompt for user confirmation

9. CLASSIFY every factual claim in the document into:
   - "database_verifiable": can be checked against PDB, UniProt, PubMed, OpenFDA, etc.
   - "assumption_smuggled": assumes a conclusion not supported by the methods
   - "likely_contradicted": likely contradicts known database records
   - "out_of_scope": cannot be verified with available databases
   - "opinion_or_narrative": not a factual claim

Return a JSON object with this EXACT schema:
{
  "surface_request": "string",
  "inferred_intent": "string",
  "assumptions": [
    {
      "statement": "This assumes that...",
      "type": "factual|strategic|emotional|market|technical|scientific|operational",
      "risk": "low|medium|high",
      "test": "string — how to verify or falsify this assumption"
    }
  ],
  "constraints": [
    {
      "constraint": "string",
      "classification": "hard|soft|assumption|preference|unknown",
      "evidence": "string"
    }
  ],
  "friction_question": "string (empty string if not needed)",
  "optimized_prompt": "string — the reframed execution-ready prompt for the audit pipeline",
  "validation_criteria": ["string"],
  "remaining_uncertainty": "string",
  "recommended_action": "execute|ask_user|reject|reframe",
  "claims": [
    {
      "text": "exact claim text",
      "category": "database_verifiable|assumption_smuggled|likely_contradicted|out_of_scope|opinion_or_narrative",
      "assumptionExposed": "string or null",
      "falsificationTest": "string or null"
    }
  ]
}

Never create friction for its own sake. Use friction to increase truth, clarity, and value.
Only ask the friction_question if the answer would materially change the audit.
Return at most 30 claims.`;

const OUTPUT_AUDIT_SYSTEM_PROMPT = `You are the FrictionEngine Output Critic. Your job is to audit an AI-generated answer against the original optimized prompt.

Check:
1. Does the answer satisfy the deeper intent (not just the surface request)?
2. Does it rely on unverified assumptions?
3. Does it distinguish facts from guesses?
4. Does it address the validation criteria?
5. Does it answer the wrong version of the question?

Return a JSON object:
{
  "satisfiesDeepIntent": true|false,
  "reliesOnUnverifiedAssumptions": true|false,
  "distinguishesFactsFromGuesses": true|false,
  "addressesValidationCriteria": true|false,
  "verdict": "pass|revise|ask_user|reject",
  "reason": "string — why this verdict",
  "suggestedRevision": "string or null — if revise, what to change in the prompt"
}`;

// ─── Core: runPreflightScan ───────────────────────────────────────────────────

export async function runPreflightScan(text: string): Promise<FrictionEngineResult> {
  const start = Date.now();

  // Truncate to avoid token limits — preflight is a fast scan
  const truncated =
    text.length > 8000
      ? text.substring(0, 8000) + "\n[Document truncated for preflight scan]"
      : text;

  const raw_prompt = `Audit this scientific document for verifiable claims:\n\n${truncated}`;

  let parsed: Partial<FrictionEngineResult> = {};

  try {
    const response = await invokeMultiLLM(
      {
        messages: [
          { role: "system", content: FRICTION_ENGINE_SYSTEM_PROMPT },
          { role: "user", content: raw_prompt },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "friction_engine_result",
            strict: false,
            schema: {
              type: "object",
              properties: {
                surface_request: { type: "string" },
                inferred_intent: { type: "string" },
                assumptions: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      statement: { type: "string" },
                      type: { type: "string" },
                      risk: { type: "string" },
                      test: { type: "string" },
                    },
                    required: ["statement", "type", "risk", "test"],
                  },
                },
                constraints: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      constraint: { type: "string" },
                      classification: { type: "string" },
                      evidence: { type: "string" },
                    },
                    required: ["constraint", "classification", "evidence"],
                  },
                },
                friction_question: { type: "string" },
                optimized_prompt: { type: "string" },
                validation_criteria: { type: "array", items: { type: "string" } },
                remaining_uncertainty: { type: "string" },
                recommended_action: { type: "string" },
                claims: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      text: { type: "string" },
                      category: { type: "string" },
                      assumptionExposed: { type: "string" },
                      falsificationTest: { type: "string" },
                    },
                    required: ["text", "category"],
                  },
                },
              },
              required: [
                "surface_request",
                "inferred_intent",
                "assumptions",
                "constraints",
                "friction_question",
                "optimized_prompt",
                "validation_criteria",
                "remaining_uncertainty",
                "recommended_action",
                "claims",
              ],
            },
          },
        },
        temperature: 0.1,
        max_tokens: 3000,
      },
      "draft"
    );

    const content = response.choices?.[0]?.message?.content as string | undefined;
    if (content) {
      parsed = JSON.parse(content) as Partial<FrictionEngineResult>;
    }
  } catch (err) {
    console.error("[FrictionEngine] Preflight scan LLM error:", err);
    // Return a safe fallback — never block submission on FrictionEngine failure
    return buildFallbackResult(raw_prompt, Date.now() - start);
  }

  // ─── Normalise and tally ──────────────────────────────────────────────────
  const claims = (parsed.claims ?? []) as PreflightClaim[];
  const assumptions = (parsed.assumptions ?? []) as FrictionAssumption[];
  const constraints = (parsed.constraints ?? []) as FrictionConstraint[];

  const counts = {
    database_verifiable: 0,
    assumption_smuggled: 0,
    likely_contradicted: 0,
    out_of_scope: 0,
    opinion_or_narrative: 0,
  };
  for (const c of claims) {
    if (c.category in counts) counts[c.category as keyof typeof counts]++;
  }

  // ─── Apply Friction Decision Policy ──────────────────────────────────────
  // Override the LLM's recommended_action with deterministic rules where clear
  let recommended_action = (parsed.recommended_action ?? "execute") as RecommendedAction;
  const highRiskCount = assumptions.filter((a) => a.risk === "high").length;

  if (counts.database_verifiable === 0 && counts.assumption_smuggled === 0 && counts.likely_contradicted === 0) {
    // No verifiable content → reject
    recommended_action = "reject";
  } else if (highRiskCount >= 2) {
    // Multiple high-risk assumptions → ask_user (pick the most important friction_question)
    recommended_action = "ask_user";
  } else if (highRiskCount === 1 && !parsed.friction_question) {
    // One high-risk assumption but no friction question generated → ask_user
    recommended_action = "ask_user";
  }

  // ── Stage 7.5: Query knowledge graph for prior composite signals ─────────────
  // Non-fatal: if graph is empty or DB unavailable, priorGraphSignals is []
  const priorGraphSignals: ClaimSignal[] = await (async () => {
    try {
      const anchorClaim = claims.find(c => c.category === "database_verifiable");
      if (!anchorClaim) return [];
      return await findClaimsByTextSimilarity(anchorClaim.text, {
        limit: 5,
        minScore: 0.75,
      });
    } catch {
      return [];
    }
  })();

  return {
    raw_prompt,
    surface_request: parsed.surface_request ?? "Audit this scientific document.",
    inferred_intent: parsed.inferred_intent ?? "Verify factual claims against authoritative databases.",
    assumptions,
    constraints,
    friction_question: parsed.friction_question ?? "",
    optimized_prompt: parsed.optimized_prompt ?? raw_prompt,
    validation_criteria: parsed.validation_criteria ?? [
      "All verifiable claims must be checked against at least one authoritative database.",
      "Contradicted claims must include the specific conflicting database record.",
      "Smuggled assumptions must be flagged with the missing evidence.",
    ],
    remaining_uncertainty: parsed.remaining_uncertainty ?? "",
    recommended_action,
    claims,
    totalClaims: claims.length,
    databaseVerifiable: counts.database_verifiable,
    assumptionSmuggled: counts.assumption_smuggled,
    likelyContradicted: counts.likely_contradicted,
    outOfScope: counts.out_of_scope,
    opinionOrNarrative: counts.opinion_or_narrative,
    priorGraphSignals,
    durationMs: Date.now() - start,
  };
}

// ─── Core: runOutputAudit ─────────────────────────────────────────────────────

/**
 * Runs the FrictionEngine Output Critic (Section 10.5 of the paper).
 * Audits a downstream LLM answer against the optimized prompt.
 * Returns a verdict: pass | revise | ask_user | reject
 */
export async function runOutputAudit(
  optimizedPrompt: string,
  modelAnswer: string,
  validationCriteria: string[] = []
): Promise<OutputAuditResult> {
  const criteriaText =
    validationCriteria.length > 0
      ? `\n\nValidation criteria:\n${validationCriteria.map((c, i) => `${i + 1}. ${c}`).join("\n")}`
      : "";

  try {
    const response = await invokeMultiLLM(
      {
        messages: [
          { role: "system", content: OUTPUT_AUDIT_SYSTEM_PROMPT },
          {
            role: "user",
            content: `Optimized prompt:\n${optimizedPrompt}${criteriaText}\n\nModel answer:\n${modelAnswer}`,
          },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "output_audit_result",
            strict: false,
            schema: {
              type: "object",
              properties: {
                satisfiesDeepIntent: { type: "boolean" },
                reliesOnUnverifiedAssumptions: { type: "boolean" },
                distinguishesFactsFromGuesses: { type: "boolean" },
                addressesValidationCriteria: { type: "boolean" },
                verdict: { type: "string" },
                reason: { type: "string" },
                suggestedRevision: { type: "string" },
              },
              required: [
                "satisfiesDeepIntent",
                "reliesOnUnverifiedAssumptions",
                "distinguishesFactsFromGuesses",
                "addressesValidationCriteria",
                "verdict",
                "reason",
              ],
            },
          },
        },
        temperature: 0.1,
        max_tokens: 512,
      },
      "draft"
    );

    const content = response.choices?.[0]?.message?.content as string | undefined;
    if (content) {
      const parsed = JSON.parse(content) as OutputAuditResult;
      return parsed;
    }
  } catch (err) {
    console.error("[FrictionEngine] Output audit LLM error:", err);
  }

  // Fallback: pass through on error — never block on audit failure
  return {
    verdict: "pass",
    satisfiesDeepIntent: true,
    reliesOnUnverifiedAssumptions: false,
    distinguishesFactsFromGuesses: true,
    addressesValidationCriteria: true,
    reason: "Output audit unavailable — passing through.",
    suggestedRevision: null,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildFallbackResult(raw_prompt: string, durationMs: number): FrictionEngineResult {
  return {
    raw_prompt,
    surface_request: "Audit this scientific document.",
    inferred_intent: "Verify factual claims against authoritative databases.",
    assumptions: [],
    constraints: [],
    friction_question: "",
    optimized_prompt: raw_prompt,
    validation_criteria: [
      "All verifiable claims must be checked against at least one authoritative database.",
      "Contradicted claims must include the specific conflicting database record.",
    ],
    remaining_uncertainty: "Preflight scan unavailable.",
    recommended_action: "execute",
    claims: [],
    totalClaims: 0,
    databaseVerifiable: 0,
    assumptionSmuggled: 0,
    likelyContradicted: 0,
    outOfScope: 0,
    opinionOrNarrative: 0,
    priorGraphSignals: [],
    durationMs,
  };
}
