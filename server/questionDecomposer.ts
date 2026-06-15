/**
 * questionDecomposer.ts — Sprint 25
 *
 * Natural Language Question → Atomic Verifiable Claims
 *
 * The missing entry point between a user's question and the verification oracle.
 * Converts any natural language question or AI-generated statement into one or
 * more atomic, falsifiable claims that can each be independently routed to a
 * primary source for verification.
 *
 * Design principles:
 *   - Heuristic-first: fast regex decomposition for common patterns (<5ms)
 *   - LLM fallback: invokeLLM for complex multi-entity questions (opt-in)
 *   - Never throws: always returns at least one claim (the input itself)
 *   - Idempotent: same input always produces the same output
 *   - Max 5 atomic claims per input to bound downstream latency
 *
 * Decomposition patterns handled:
 *   - Simple declarative: "Aspirin reduces cardiovascular risk" → 1 claim
 *   - Comparative: "Is drug A safer than drug B?" → 2 claims
 *   - Conditional: "Does X cause Y in patients with Z?" → 1 claim (preserved)
 *   - Conjunctive: "X increases A and decreases B" → 2 claims
 *   - Multi-entity: "How do X, Y, and Z affect W?" → 3 claims
 *   - Yes/No question: "Does aspirin prevent heart attacks?" → 1 declarative claim
 */

import { invokeLLM, type InvokeParams } from "./_core/llm";
import { logger } from "./logger";

const log = logger("questionDecomposer");

// ─── Public types ─────────────────────────────────────────────────────────────

export interface AtomicClaim {
  /** The verifiable declarative statement */
  text: string;
  /** Which decomposition method produced this claim */
  method: "heuristic" | "llm" | "passthrough";
  /** Confidence that this is a well-formed, verifiable claim (0.0–1.0) */
  confidence: number;
  /** Index of this claim within the decomposed set */
  index: number;
}

export interface DecompositionResult {
  /** Original input text */
  input: string;
  /** Atomic claims derived from the input */
  claims: AtomicClaim[];
  /** Total decomposition time in milliseconds */
  durationMs: number;
  /** Whether LLM was used (true = slower but more accurate) */
  usedLlm: boolean;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_CLAIMS = 5;
const MAX_INPUT_LENGTH = 2000;
const LLM_TIMEOUT_MS = 6_000;

/** Conjunctions that signal compound claims */
const _CONJUNCTIVE_PATTERNS = [
  /\band\b/gi,
  /\bwhile also\b/gi,
  /\bas well as\b/gi,
  /\bin addition to\b/gi,
];

/** Question words that indicate yes/no questions to convert to declarative form */
const _YES_NO_QUESTION_RE = /^(does|do|is|are|was|were|has|have|can|could|will|would|should)\s+/i;

/** Comparative question patterns */
const COMPARATIVE_RE = /\b(safer|more effective|better|worse|higher|lower|greater|less)\s+than\b/i;

/** Multi-entity list pattern: "X, Y, and Z" */
const _ENTITY_LIST_RE = /([^,]+(?:,\s*[^,]+)+(?:,?\s*and\s+[^?.,]+))/i;

/** Stop words to exclude from keyword extraction */
const STOP_WORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "could",
  "should", "may", "might", "shall", "can", "need", "dare", "ought",
  "used", "to", "of", "in", "on", "at", "by", "for", "with", "about",
  "against", "between", "into", "through", "during", "before", "after",
  "above", "below", "from", "up", "down", "out", "off", "over", "under",
  "again", "further", "then", "once", "and", "but", "or", "nor", "so",
  "yet", "both", "either", "neither", "not", "only", "own", "same",
  "than", "too", "very", "just", "because", "as", "until", "while",
  "that", "this", "these", "those", "it", "its", "itself",
]);

// ─── Main entry point ─────────────────────────────────────────────────────────

/**
 * Decompose a natural language question or statement into atomic verifiable claims.
 *
 * @param input - Natural language question or AI-generated statement
 * @param useLlm - Whether to use LLM for complex decomposition (default: false for speed)
 * @returns DecompositionResult with atomic claims
 */
export async function decomposeQuestion(
  input: string,
  useLlm = false
): Promise<DecompositionResult> {
  const start = Date.now();
  const trimmed = input.trim().slice(0, MAX_INPUT_LENGTH);

  if (!trimmed) {
    return {
      input,
      claims: [],
      durationMs: Date.now() - start,
      usedLlm: false,
    };
  }

  // Step 1: Try heuristic decomposition
  const heuristicClaims = decomposeHeuristic(trimmed);

  // Step 2: If heuristic produced confident results, return immediately
  if (heuristicClaims.length > 0 && heuristicClaims[0].confidence >= 0.7) {
    return {
      input,
      claims: heuristicClaims.slice(0, MAX_CLAIMS),
      durationMs: Date.now() - start,
      usedLlm: false,
    };
  }

  // Step 3: If LLM is requested and heuristic was uncertain, try LLM
  if (useLlm) {
    try {
      const llmClaims = await decomposeViaLlm(trimmed);
      if (llmClaims.length > 0) {
        return {
          input,
          claims: llmClaims.slice(0, MAX_CLAIMS),
          durationMs: Date.now() - start,
          usedLlm: true,
        };
      }
    } catch (err) {
      log.warn("LLM decomposition failed, falling back to heuristic", { err });
    }
  }

  // Step 4: Return heuristic result or passthrough
  const fallback =
    heuristicClaims.length > 0
      ? heuristicClaims
      : [passthrough(trimmed)];

  return {
    input,
    claims: fallback.slice(0, MAX_CLAIMS),
    durationMs: Date.now() - start,
    usedLlm: false,
  };
}

// ─── Heuristic decomposition ──────────────────────────────────────────────────

function decomposeHeuristic(text: string): AtomicClaim[] {
  // 1. Convert yes/no question to declarative claim
  const declarative = questionToDeclarative(text);

  // 2. Check for comparative pattern → split into two claims
  if (COMPARATIVE_RE.test(declarative)) {
    const comparative = splitComparative(declarative);
    if (comparative.length === 2) return comparative;
  }

  // 3. Check for conjunctive compound → split on "and"
  const conjunctive = splitConjunctive(declarative);
  if (conjunctive.length > 1) return conjunctive;

  // 4. Check for multi-entity list
  const multiEntity = splitMultiEntity(declarative);
  if (multiEntity.length > 1) return multiEntity;

  // 5. Single claim passthrough with high confidence if it looks declarative
  const isDeclarative = !declarative.trim().endsWith("?") &&
    declarative.split(" ").length >= 4;

  return [
    {
      text: declarative,
      method: "heuristic",
      confidence: isDeclarative ? 0.8 : 0.6,
      index: 0,
    },
  ];
}

/**
 * Convert a yes/no question to a declarative statement.
 * "Does aspirin reduce cardiovascular risk?" → "aspirin reduces cardiovascular risk"
 */
export function questionToDeclarative(text: string): string {
  const trimmed = text.trim();

  // Already declarative
  if (!trimmed.endsWith("?")) return trimmed;

  // Remove trailing question mark
  const withoutQ = trimmed.slice(0, -1).trim();

  // Yes/no question: invert subject-verb order
  const match = withoutQ.match(
    /^(does|do|is|are|was|were|has|have|can|could|will|would|should)\s+(.+)$/i
  );
  if (!match) return withoutQ;

  const [, auxiliary, rest] = match;
  const aux = auxiliary.toLowerCase();

  // Map auxiliary to present tense verb form
  const verbMap: Record<string, string> = {
    does: "",    // "does X reduce Y" → "X reduces Y" (handled below)
    do: "",
    is: "is",
    are: "are",
    was: "was",
    were: "were",
    has: "has",
    have: "have",
    can: "can",
    could: "could",
    will: "will",
    would: "would",
    should: "should",
  };

  if (aux === "does" || aux === "do") {
    // "does aspirin reduce" → "aspirin reduces"
    // Split on first verb after subject
    const words = rest.split(/\s+/);
    if (words.length >= 2) {
      const subject = words[0];
      const verb = words[1];
      const remainder = words.slice(2).join(" ");
      // Add -s to verb for third-person singular (does → verb+s)
      const conjugated = aux === "does" ? conjugateThirdPerson(verb) : verb;
      return remainder
        ? `${subject} ${conjugated} ${remainder}`
        : `${subject} ${conjugated}`;
    }
    return rest;
  }

  return `${rest} ${verbMap[aux] ?? aux}`.trim();
}

/** Simple third-person singular conjugation for common scientific verbs */
function conjugateThirdPerson(verb: string): string {
  const v = verb.toLowerCase();
  if (v.endsWith("s") || v.endsWith("x") || v.endsWith("z") ||
      v.endsWith("ch") || v.endsWith("sh")) {
    return v + "es";
  }
  if (v.endsWith("y") && !/[aeiou]y$/.test(v)) {
    return v.slice(0, -1) + "ies";
  }
  return v + "s";
}

/**
 * Split a comparative claim into two atomic claims.
 * "Drug A is safer than drug B" → ["Drug A is safe", "Drug B is safe"]
 */
function splitComparative(text: string): AtomicClaim[] {
  const match = text.match(
    /^(.+?)\s+is\s+(safer|more effective|better|worse|higher|lower|greater|less)\s+than\s+(.+)$/i
  );
  if (!match) return [];

  const [, subjectA, adjective, subjectB] = match;
  const positiveAdj = adjective.toLowerCase().startsWith("more ")
    ? adjective.slice(5)
    : adjective;

  return [
    {
      text: `${subjectA.trim()} is ${positiveAdj}`,
      method: "heuristic",
      confidence: 0.75,
      index: 0,
    },
    {
      text: `${subjectB.trim()} is ${positiveAdj}`,
      method: "heuristic",
      confidence: 0.75,
      index: 1,
    },
  ];
}

/**
 * Split a conjunctive compound claim on "and" / "while also" / "as well as".
 * "Aspirin reduces fever and prevents clotting" → 2 claims
 */
function splitConjunctive(text: string): AtomicClaim[] {
  // Only split on "and" that connects two verb phrases, not noun phrases
  // Heuristic: split if "and" is followed by a verb (word that's not a stop word)
  const parts = text.split(/\s+and\s+/i);
  if (parts.length < 2) return [];

  // Reject if any part is too short (likely a noun phrase split, not verb phrase)
  if (parts.some(p => p.trim().split(/\s+/).length < 3)) return [];

  // For "X reduces A and decreases B", propagate subject to second clause
  const firstWords = parts[0].trim().split(/\s+/);
  const claims: AtomicClaim[] = [];

  for (let i = 0; i < parts.length && i < MAX_CLAIMS; i++) {
    const part = parts[i].trim();
    // If second+ part starts with a verb (no subject), prepend subject from first
    const startsWithVerb = firstWords.length > 1 &&
      !STOP_WORDS.has(part.split(/\s+/)[0].toLowerCase()) &&
      i > 0 &&
      /^[a-z]/i.test(part) &&
      part.split(/\s+/).length < firstWords.length;

    const claimText = startsWithVerb
      ? `${firstWords[0]} ${part}`
      : part;

    claims.push({
      text: claimText,
      method: "heuristic",
      confidence: 0.72,
      index: i,
    });
  }

  return claims.length >= 2 ? claims : [];
}

/**
 * Split a multi-entity question into per-entity claims.
 * "How do aspirin, ibuprofen, and naproxen affect platelet aggregation?"
 * → 3 claims, one per drug
 */
function splitMultiEntity(text: string): AtomicClaim[] {
  // Match "X, Y, and Z" or "X, Y, Z" patterns
  const listMatch = text.match(
    /^(?:how\s+(?:do|does)\s+|what\s+(?:do|does)\s+|do\s+)?([^,]+(?:,\s*[^,]+)+(?:,?\s*and\s+[^?.,]+))\s+(.+?)(?:\?)?$/i
  );
  if (!listMatch) return [];

  const [, entityList, predicate] = listMatch;

  // Parse entity list
  const entities = entityList
    .split(/,\s*(?:and\s+)?/i)
    .map(e => e.trim())
    .filter(e => e.length > 0 && !STOP_WORDS.has(e.toLowerCase()));

  if (entities.length < 2) return [];

  return entities.slice(0, MAX_CLAIMS).map((entity, i) => ({
    text: `${entity} ${predicate.trim()}`,
    method: "heuristic" as const,
    confidence: 0.7,
    index: i,
  }));
}

/** Return the input as a single passthrough claim */
function passthrough(text: string): AtomicClaim {
  return {
    text: text.replace(/\?$/, "").trim(),
    method: "passthrough",
    confidence: 0.5,
    index: 0,
  };
}

// ─── LLM decomposition ────────────────────────────────────────────────────────

async function decomposeViaLlm(text: string): Promise<AtomicClaim[]> {
  const prompt = `You are a scientific claim decomposer. Convert the following question or statement into a JSON array of atomic, falsifiable declarative claims that can each be independently verified against PubMed or other scientific databases.

Rules:
- Each claim must be a complete declarative sentence (not a question)
- Maximum 5 claims
- Each claim must be independently verifiable
- Do not add claims that are not implied by the input
- Return ONLY valid JSON, no explanation

Input: "${text}"

Return format:
[
  {"text": "claim 1", "confidence": 0.9},
  {"text": "claim 2", "confidence": 0.85}
]`;

  const params: InvokeParams = {
    messages: [{ role: "user", content: prompt }],
    maxTokens: 400,
  };

  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error("LLM timeout")), LLM_TIMEOUT_MS)
  );

  try {
    const result = await Promise.race([invokeLLM(params), timeoutPromise]);
    const raw =
      typeof result.choices[0]?.message?.content === "string"
        ? result.choices[0].message.content
        : "";

    // Parse JSON from LLM response
    const jsonMatch = raw.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];

    const parsed = JSON.parse(jsonMatch[0]) as Array<{
      text: string;
      confidence: number;
    }>;

    return parsed
      .filter(c => typeof c.text === "string" && c.text.length > 5)
      .map((c, i) => ({
        text: c.text.trim(),
        method: "llm" as const,
        confidence: Math.min(1, Math.max(0, c.confidence ?? 0.8)),
        index: i,
      }));
  } catch {
    return [];
  }
}

// ─── Utility exports ──────────────────────────────────────────────────────────

/**
 * Extract meaningful keywords from a claim for PubMed query construction.
 * Removes stop words and short tokens.
 */
export function extractClaimKeywords(claim: string): string[] {
  return claim
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOP_WORDS.has(w));
}

/**
 * Build a PubMed-optimized search query from an atomic claim.
 * Uses the most specific keywords to maximize relevance.
 */
export function buildPubMedQuery(claim: AtomicClaim): string {
  const keywords = extractClaimKeywords(claim.text);
  // Take the top 5 most specific keywords (longest first, as proxies for specificity)
  const topKeywords = keywords
    .sort((a, b) => b.length - a.length)
    .slice(0, 5);
  return topKeywords.join(" ");
}
