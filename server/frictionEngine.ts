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
 *   2. Maps all hidden assumptions with type, risk level, confidence, and falsification test
 *   3. Classifies constraints as hard vs. soft vs. preference, with severity
 *   4. Selects the single highest-leverage friction question (if needed)
 *   5. Generates an optimized reframed prompt for the downstream pipeline
 *   6. Adds validation criteria for the audit
 *   7. Applies the Friction Decision Policy to route: execute | ask_user | reject | reframe
 *
 * Exports:
 *   runPreflightScan(text, options?) → FrictionEngineResult
 *   runOutputAudit(prompt, answer)   → OutputAuditResult
 *   sanitizeInput(input)             → { ok, sanitized } | { ok: false, reason }
 *   redactPii(text)                  → string
 */

import { invokeMultiLLM } from "./_core/multiLLM";
import { findClaimsByTextSimilarity, type ClaimSignal } from "./graphTraversal";
import { logger, errData } from "./logger";
const log = logger("frictionEngine");

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

export type ConstraintSeverity =
  | "blocking"
  | "critical"
  | "high"
  | "medium"
  | "low";

export type RecommendedAction =
  | "execute" // Intent clear, assumptions low-risk → proceed silently
  | "ask_user" // One high-risk assumption → ask single friction question, block until answered
  | "reject" // Contradictory goals or unfalsifiable document → refuse with reason
  | "reframe"; // Better prompt available → show optimized_prompt, let user confirm

export interface FrictionAssumption {
  statement: string; // "This assumes that…"
  type: AssumptionType;
  risk: AssumptionRisk;
  /** Confidence that this assumption is actually present (0–1). FR-L0-12 */
  confidence: number;
  test: string; // How to verify or falsify this assumption
}

export interface FrictionConstraint {
  constraint: string;
  classification: ConstraintClassification;
  /** Severity of violating this constraint. FR-L0-22 */
  severity: ConstraintSeverity;
  evidence: string; // What evidence supports classifying it this way
}

// ─── Jaccard Similarity + Dedup (T008) ──────────────────────────────────────

/**
 * Compute Jaccard similarity between two strings (token-level).
 * Returns a value in [0, 1] where 1 = identical token sets.
 */
export function jaccardSimilarity(a: string, b: string): number {
  const tokenize = (s: string) =>
    new Set(s.toLowerCase().split(/\W+/).filter(Boolean));
  const setA = tokenize(a);
  const setB = tokenize(b);
  if (setA.size === 0 && setB.size === 0) return 1;
  const aArr = Array.from(setA);
  const bArr = Array.from(setB);
  const intersection = new Set(aArr.filter(t => setB.has(t)));
  const union = new Set([...aArr, ...bArr]);
  return intersection.size / union.size;
}

/**
 * Remove near-duplicate assumptions (Jaccard > 0.85).
 * When two assumptions are near-duplicates, keep the earlier one (first-wins).
 */
export function deduplicateAssumptions(
  assumptions: FrictionAssumption[]
): FrictionAssumption[] {
  const kept: FrictionAssumption[] = [];
  for (const candidate of assumptions) {
    const isDuplicate = kept.some(
      existing =>
        jaccardSimilarity(candidate.statement, existing.statement) > 0.85
    );
    if (!isDuplicate) kept.push(candidate);
  }
  return kept;
}

/** The full FrictionEngine structured JSON schema from Section 13 of the paper */
export interface FrictionEngineResult {
  // ── Core schema fields ──────────────────────────────────────────────────────
  raw_prompt: string;
  surface_request: string;
  inferred_intent: string;
  assumptions: FrictionAssumption[];
  constraints: FrictionConstraint[];
  friction_question: string; // Single highest-leverage why-question (empty if not needed)
  optimized_prompt: string; // Reframed execution-ready prompt
  validation_criteria: string[]; // What a good answer must satisfy
  remaining_uncertainty: string; // What cannot be resolved before submission
  recommended_action: RecommendedAction;
  /** Human-readable reasons for the recommended_action decision. FR-L0-31 */
  decision_reasons: string[];
  /** Optional follow-up questions the engine wants to ask the user. */
  additional_questions?: string[];
  /** Wall-clock ms from start to end of the scan. Alias of durationMs. */
  scanDurationMs: number;
  /** Which LLM provider handled this scan (e.g. "openrouter:gpt-4o-mini"). */
  modelUsed: string;
  /** Number of semantically similar claims found in the knowledge graph. */
  similarClaimCount: number;
  /** Number of claims that matched a database-verifiable category. */
  databaseMatches: number;

  // ── Truth Desk claim-level detail ───────────────────────────────────────────
  claims: PreflightClaim[];
  totalClaims: number;
  databaseVerifiable: number;
  assumptionSmuggled: number;
  likelyContradicted: number;
  outOfScope: number;
  opinionOrNarrative: number;

  // ── Graph-backed prior signals ──────────────────────────────────────────────
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
export type AuditDimension =
  | "deep_intent"
  | "unverified_assumptions"
  | "fact_vs_guess"
  | "validation_criteria";
export type AuditScore = "pass" | "fail" | "partial";

export interface OutputAuditResult {
  verdict: AuditVerdict;
  /** PRD-L0 §6.1 dimension scores */
  dimensionScores: Record<AuditDimension, AuditScore>;
  /** Whether the answer is usable without revision */
  isUsable: boolean;
  /** Confidence in the verdict (0–1) */
  confidence: number;
  satisfiesDeepIntent: boolean;
  reliesOnUnverifiedAssumptions: boolean;
  distinguishesFactsFromGuesses: boolean;
  addressesValidationCriteria: boolean;
  reason: string;
  rejection_reason?: string;
  caveat?: string;
  suggestedRevision: string | null;
}

// ─── Options ─────────────────────────────────────────────────────────────────

export interface PreflightScanOptions {
  /**
   * Override the LLM decision policy with a forced action. FR-L0-32.
   * When set, the engine still runs the full scan but returns this action.
   */
  forceAction?: RecommendedAction;
  /** Skip the knowledge graph lookup (faster, less context). FR-L0-52. */
  skipGraphLookup?: boolean;
  /** Maximum number of assumptions to return (default: unlimited). */
  maxAssumptions?: number;
  /** Maximum number of constraints to return (default: unlimited). */
  maxConstraints?: number;
}

// ─── Input Sanitization (NFR-L0-30) ──────────────────────────────────────────

/** Known jailbreak/injection patterns that should be rejected. */
const INJECTION_PATTERNS: RegExp[] = [
  /ignore\s+(all\s+)?previous\s+instructions/i,
  /forget\s+(all\s+)?previous\s+instructions/i,
  /you\s+are\s+now\s+(a|an|the)\s+/i,
  /pretend\s+(you\s+are|to\s+be)/i,
  /act\s+as\s+(a|an|the)\s+/i,
  /disregard\s+(all\s+)?previous/i,
  /system\s*:\s*you\s+are/i,
  /<\s*script[^>]*>/i,
  /\bexec\s*\(/i,
  /\beval\s*\(/i,
  /\bdrop\s+table/i,
  /\bdelete\s+from/i,
  /\bunion\s+select/i,
  /\binsert\s+into/i,
  /\bupdate\s+\w+\s+set/i,
];

/** PII redaction patterns for NFR-L0-31 */
const PII_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  {
    pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
    replacement: "[EMAIL_REDACTED]",
  },
  {
    pattern: /\b(?:\+?1[-.]?)?\(?\d{3}\)?[-.]?\d{3}[-.]?\d{4}\b/g,
    replacement: "[PHONE_REDACTED]",
  },
  {
    pattern:
      /\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13}|3(?:0[0-5]|[68][0-9])[0-9]{11}|6(?:011|5[0-9]{2})[0-9]{12}|(?:2131|1800|35\d{3})\d{11})\b/g,
    replacement: "[CARD_REDACTED]",
  },
];

/**
 * Sanitize user input before sending to LLM (NFR-L0-30).
 * Returns { ok: true, sanitized } or { ok: false, reason } on rejection.
 */
export function sanitizeInput(
  input: string
): { ok: true; sanitized: string } | { ok: false; reason: string } {
  if (!input || input.trim().length < 10) {
    return { ok: false, reason: "input_too_short" };
  }
  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(input)) {
      return { ok: false, reason: "prompt_injection_detected" };
    }
  }
  return { ok: true, sanitized: input };
}

/**
 * Redact PII from text before storage (NFR-L0-31).
 */
export function redactPii(text: string): string {
  let result = text;
  for (const { pattern, replacement } of PII_PATTERNS) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

// ─── Rule-Based Fallback Classifier (Section 9.3) ────────────────────────────
// When all LLM providers fail, use local heuristics. Must complete in <200ms.

const POLICY_VIOLATION_KEYWORDS = [
  "bomb",
  "weapon",
  "kill",
  "murder",
  "hack",
  "exploit",
  "malware",
  "phishing",
  "ransomware",
  "darkweb",
  "illegal",
];

/**
 * Local heuristic classifier used when all LLM providers fail.
 * Returns a conservative recommended_action in <200ms.
 */
export function ruleBasedFallback(input: string): {
  recommended_action: RecommendedAction;
  decision_reasons: string[];
} {
  const trimmed = input.trim();
  // Rule 1: Too short → reject
  if (trimmed.length < 10) {
    return {
      recommended_action: "reject",
      decision_reasons: ["input_too_short"],
    };
  }
  // Rule 2: Policy violation keywords → reject
  const lower = trimmed.toLowerCase();
  for (const kw of POLICY_VIOLATION_KEYWORDS) {
    if (lower.includes(kw)) {
      return {
        recommended_action: "reject",
        decision_reasons: [`policy_violation_keyword:${kw}`],
      };
    }
  }
  // Rule 3: Question marks → ask_user (likely needs clarification)
  if (trimmed.includes("?")) {
    return {
      recommended_action: "ask_user",
      decision_reasons: ["input_contains_question"],
    };
  }
  // Rule 4: Imperative statements with clear objects → execute
  if (/^(audit|verify|check|analyze|review|validate)\b/i.test(trimmed)) {
    return {
      recommended_action: "execute",
      decision_reasons: ["imperative_with_clear_object"],
    };
  }
  // Rule 5: All other inputs → ask_user (conservative)
  return {
    recommended_action: "ask_user",
    decision_reasons: ["rule_based_fallback_conservative"],
  };
}

// ─── System Prompts ───────────────────────────────────────────────────────────

const FRICTION_ENGINE_SYSTEM_PROMPT = `You are FrictionEngine, a self-prompting prompt optimization layer applied to scientific document submission.

Your role is NOT to answer the user's request immediately. Your role is to transform it.

The user is submitting a scientific document for claim verification against authoritative databases (PDB, UniProt, PubMed, OpenFDA, etc.).

For this document, you must:

1. IDENTIFY the surface request: what the user literally wants (audit this document).
2. INFER the deeper intent: what they are actually trying to achieve (validate specific claims, find contradictions, build credibility, etc.).
3. MAP all hidden assumptions in the document with type, risk level, confidence (0-1), and how to test each one.
4. CLASSIFY constraints as hard (cannot be changed), soft (preferred), assumption (treated as fact but unverified), preference (stylistic), or unknown. For each constraint, also classify severity as critical|high|medium|low.
5. SELECT the single highest-leverage friction question — only if answering it would materially change how the audit is run. If the intent is clear and assumptions are low-risk, leave friction_question empty.
6. GENERATE an optimized reframed prompt for the downstream audit pipeline.
7. ADD validation criteria: what a good audit result must satisfy.
8. APPLY the Friction Decision Policy:
   - "execute": intent is clear, all assumptions are low-risk → proceed
   - "ask_user": intent is clear but ONE assumption is high-risk → ask the friction_question, block until answered
   - "reject": document contains contradictory goals, no verifiable claims, or is entirely unfalsifiable
   - "reframe": a significantly better framing exists → show optimized_prompt for user confirmation
9. PROVIDE decision_reasons: a list of 1-3 human-readable strings explaining why you chose the recommended_action.

10. CLASSIFY every factual claim in the document into:
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
      "confidence": 0.85,
      "test": "string — how to verify or falsify this assumption"
    }
  ],
  "constraints": [
    {
      "constraint": "string",
      "classification": "hard|soft|assumption|preference|unknown",
      "severity": "critical|high|medium|low",
      "evidence": "string"
    }
  ],
  "friction_question": "string (empty string if not needed)",
  "optimized_prompt": "string — the reframed execution-ready prompt for the audit pipeline",
  "validation_criteria": ["string"],
  "remaining_uncertainty": "string",
  "recommended_action": "execute|ask_user|reject|reframe",
  "decision_reasons": ["string — why this action was chosen"],
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

// eslint-disable-next-line complexity -- TODO(phase-131): extract helpers to reduce complexity
export async function runPreflightScan(
  text: string,
  options: PreflightScanOptions = {}
): Promise<FrictionEngineResult> {
  const start = Date.now();
  let modelUsed = "unknown";

  // NFR-L0-30: Sanitize input before sending to LLM
  const sanitized = sanitizeInput(text);
  if (!sanitized.ok) {
    return buildRejectedResult(text, sanitized.reason, Date.now() - start);
  }

  // Truncate to avoid token limits — preflight is a fast scan
  const truncated =
    sanitized.sanitized.length > 8000
      ? sanitized.sanitized.substring(0, 8000) +
        "\n[Document truncated for preflight scan]"
      : sanitized.sanitized;

  const raw_prompt = `Audit this scientific document for verifiable claims:\n\n${truncated}`;

  let parsed: Partial<FrictionEngineResult & { decision_reasons?: string[] }> =
    {};
  let usedRuleBasedFallback = false;

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
                      confidence: { type: "number" },
                      test: { type: "string" },
                    },
                    required: [
                      "statement",
                      "type",
                      "risk",
                      "confidence",
                      "test",
                    ],
                  },
                },
                constraints: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      constraint: { type: "string" },
                      classification: { type: "string" },
                      severity: { type: "string" },
                      evidence: { type: "string" },
                    },
                    required: [
                      "constraint",
                      "classification",
                      "severity",
                      "evidence",
                    ],
                  },
                },
                friction_question: { type: "string" },
                optimized_prompt: { type: "string" },
                validation_criteria: {
                  type: "array",
                  items: { type: "string" },
                },
                remaining_uncertainty: { type: "string" },
                recommended_action: { type: "string" },
                decision_reasons: { type: "array", items: { type: "string" } },
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
                "decision_reasons",
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

    modelUsed = (response as { _provider?: string })._provider ?? "unknown";
    const content = response.choices?.[0]?.message?.content as
      | string
      | undefined;
    if (content) {
      parsed = JSON.parse(content) as Partial<
        FrictionEngineResult & {
          decision_reasons?: string[];
          additional_questions?: string[];
        }
      >;
    }
  } catch (err) {
    log.error("[FrictionEngine] Preflight scan LLM error:", errData(err));
    // Section 9.3: Rule-based fallback when all LLM providers fail
    usedRuleBasedFallback = true;
    const fallback = ruleBasedFallback(text);
    parsed = {
      recommended_action: fallback.recommended_action,
      decision_reasons: [
        ...fallback.decision_reasons,
        "rule_based_fallback_used",
      ],
    };
  }

  // ─── Normalise and tally ──────────────────────────────────────────────────
  const claims = (parsed.claims ?? []) as PreflightClaim[];
  const assumptions = (parsed.assumptions ?? []) as FrictionAssumption[];
  const constraints = (parsed.constraints ?? []) as FrictionConstraint[];

  // Normalise assumption confidence to [0,1]
  for (const a of assumptions) {
    if (typeof a.confidence !== "number" || isNaN(a.confidence))
      a.confidence = 0.5;
    a.confidence = Math.max(0, Math.min(1, a.confidence));
  }

  // Normalise constraint severity (default to "medium" if missing)
  for (const c of constraints) {
    if (
      !["blocking", "critical", "high", "medium", "low"].includes(c.severity)
    ) {
      c.severity = "medium";
    }
  }

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
  let recommended_action = (parsed.recommended_action ??
    "execute") as RecommendedAction;
  const decision_reasons: string[] = [...(parsed.decision_reasons ?? [])];

  // T054: Only count high-risk assumptions with confidence >= 0.6 in the action decision.
  // Low-confidence assumptions (< 0.6) are not reliable enough to force ask_user.
  const highRiskCount = assumptions.filter(
    a => a.risk === "high" && a.confidence >= 0.6
  ).length;

  if (
    counts.database_verifiable === 0 &&
    counts.assumption_smuggled === 0 &&
    counts.likely_contradicted === 0
  ) {
    // No verifiable content → reject
    if (recommended_action !== "reject") {
      recommended_action = "reject";
      decision_reasons.push("no_verifiable_claims_detected");
    }
  } else if (constraints.some(c => c.severity === "blocking")) {
    // T009: Any blocking-severity constraint forces ask_user (or keeps reject)
    if (recommended_action !== "reject") {
      recommended_action = "ask_user";
      decision_reasons.push("blocking_constraint_present");
    }
  } else if (highRiskCount >= 2) {
    // Multiple high-risk assumptions → ask_user
    if (recommended_action === "execute") {
      recommended_action = "ask_user";
      decision_reasons.push(`${highRiskCount}_high_risk_assumptions_detected`);
    }
  } else if (highRiskCount === 1 && !parsed.friction_question) {
    // One high-risk assumption but no friction question generated → ask_user
    if (recommended_action === "execute") {
      recommended_action = "ask_user";
      decision_reasons.push("high_risk_assumption_requires_clarification");
    }
  }

  // FR-L0-32: forceAction override — runs full scan but returns forced action
  if (options.forceAction) {
    decision_reasons.push(`force_action_override:${options.forceAction}`);
    recommended_action = options.forceAction;
  }

  if (usedRuleBasedFallback) {
    decision_reasons.push("llm_unavailable_rule_based_fallback");
  }

  // ── Stage 7.5: Query knowledge graph for prior composite signals ─────────────
  // T017: Wrap in try/catch — on failure set similarClaimCount to 0
  let priorGraphSignals: ClaimSignal[] = [];
  let similarClaimCount = 0;
  if (!options.skipGraphLookup) {
    try {
      const anchorClaim = claims.find(
        c => c.category === "database_verifiable"
      );
      if (anchorClaim) {
        priorGraphSignals = await findClaimsByTextSimilarity(anchorClaim.text, {
          limit: 5,
          minScore: 0.75,
        });
        similarClaimCount = priorGraphSignals.length;
      }
    } catch {
      // FR-L0-52: graph degradation — return empty signals
      priorGraphSignals = [];
      similarClaimCount = 0;
    }
  }

  // Apply maxAssumptions / maxConstraints caps if requested
  const finalAssumptions = options.maxAssumptions
    ? assumptions.slice(0, options.maxAssumptions)
    : assumptions;
  const finalConstraints = options.maxConstraints
    ? constraints.slice(0, options.maxConstraints)
    : constraints;

  const scanDurationMs = Date.now() - start;
  return {
    raw_prompt,
    surface_request:
      parsed.surface_request ?? "Audit this scientific document.",
    inferred_intent:
      parsed.inferred_intent ??
      "Verify factual claims against authoritative databases.",
    assumptions: finalAssumptions,
    constraints: finalConstraints,
    friction_question: parsed.friction_question ?? "",
    optimized_prompt: parsed.optimized_prompt ?? raw_prompt,
    validation_criteria: parsed.validation_criteria ?? [
      "All verifiable claims must be checked against at least one authoritative database.",
      "Contradicted claims must include the specific conflicting database record.",
      "Smuggled assumptions must be flagged with the missing evidence.",
    ],
    remaining_uncertainty: parsed.remaining_uncertainty ?? "",
    recommended_action,
    decision_reasons,
    additional_questions: (parsed as { additional_questions?: string[] })
      .additional_questions,
    scanDurationMs,
    modelUsed,
    similarClaimCount,
    databaseMatches: counts.database_verifiable,
    claims,
    totalClaims: claims.length,
    databaseVerifiable: counts.database_verifiable,
    assumptionSmuggled: counts.assumption_smuggled,
    likelyContradicted: counts.likely_contradicted,
    outOfScope: counts.out_of_scope,
    opinionOrNarrative: counts.opinion_or_narrative,
    priorGraphSignals,
    durationMs: scanDurationMs,
  };
}

// ─── Core: runOutputAudit ─────────────────────────────────────────────────────

/**
 * Runs the FrictionEngine Output Critic (Section 10.5 of the paper).
 * Audits a downstream LLM answer against the optimized prompt.
 * Returns a verdict: pass | revise | ask_user | reject
 */
// eslint-disable-next-line complexity -- TODO(phase-131): extract helpers to reduce complexity
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

    const content = response.choices?.[0]?.message?.content as
      | string
      | undefined;
    if (content) {
      const raw = JSON.parse(content) as Record<string, unknown>;
      const verdict = (raw.verdict as AuditVerdict) ?? "pass";
      const satisfiesDeepIntent = Boolean(raw.satisfiesDeepIntent ?? true);
      const reliesOnUnverifiedAssumptions = Boolean(
        raw.reliesOnUnverifiedAssumptions ?? false
      );
      const distinguishesFactsFromGuesses = Boolean(
        raw.distinguishesFactsFromGuesses ?? true
      );
      const addressesValidationCriteria = Boolean(
        raw.addressesValidationCriteria ?? true
      );
      const isUsable = verdict === "pass" || verdict === "revise";
      const dimensionScores: Record<AuditDimension, AuditScore> = {
        deep_intent: satisfiesDeepIntent ? "pass" : "fail",
        unverified_assumptions: reliesOnUnverifiedAssumptions ? "fail" : "pass",
        fact_vs_guess: distinguishesFactsFromGuesses ? "pass" : "fail",
        validation_criteria: addressesValidationCriteria ? "pass" : "fail",
      };
      const result: OutputAuditResult = {
        verdict,
        dimensionScores,
        isUsable,
        confidence: isUsable ? 0.85 : 0.6,
        satisfiesDeepIntent,
        reliesOnUnverifiedAssumptions,
        distinguishesFactsFromGuesses,
        addressesValidationCriteria,
        reason: (raw.reason as string) ?? "",
        rejection_reason:
          verdict === "reject"
            ? ((raw.reason as string) ?? undefined)
            : undefined,
        caveat: (raw.suggestedRevision as string | undefined) ?? undefined,
        suggestedRevision: (raw.suggestedRevision as string | null) ?? null,
      };
      return result;
    }
  } catch (err) {
    log.error("[FrictionEngine] Output audit LLM error:", errData(err));
  }

  // Fallback: pass through on error — never block on audit failure
  return {
    verdict: "pass",
    dimensionScores: {
      deep_intent: "pass",
      unverified_assumptions: "pass",
      fact_vs_guess: "pass",
      validation_criteria: "pass",
    },
    isUsable: true,
    confidence: 0.5,
    satisfiesDeepIntent: true,
    reliesOnUnverifiedAssumptions: false,
    distinguishesFactsFromGuesses: true,
    addressesValidationCriteria: true,
    reason: "Output audit unavailable — passing through.",
    suggestedRevision: null,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildFallbackResult(
  raw_prompt: string,
  durationMs: number
): FrictionEngineResult {
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
    decision_reasons: ["fallback_result"],
    scanDurationMs: durationMs,
    modelUsed: "fallback",
    similarClaimCount: 0,
    databaseMatches: 0,
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

function buildRejectedResult(
  raw_prompt: string,
  reason: string,
  durationMs: number
): FrictionEngineResult {
  return {
    raw_prompt,
    surface_request: "Input rejected before processing.",
    inferred_intent: "N/A",
    assumptions: [],
    constraints: [],
    friction_question: "",
    optimized_prompt: raw_prompt,
    validation_criteria: [],
    remaining_uncertainty: reason,
    recommended_action: "reject",
    decision_reasons: [reason],
    scanDurationMs: durationMs,
    modelUsed: "none",
    similarClaimCount: 0,
    databaseMatches: 0,
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

// Re-export buildFallbackResult for tests that need it
export { buildFallbackResult };
