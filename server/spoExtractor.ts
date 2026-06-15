/**
 * spoExtractor.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Normalizes a natural-language claim into a Subject–Predicate–Object (SPO)
 * triple. This is the #1 ask from Perplexity's product spec (Doc 1 + Doc 3):
 *
 *   "Normalize the claim into subject–predicate–object."
 *
 * The SPO triple is returned in the verify_claim response so AI agents can
 * ground their answers with structured, machine-readable claim assertions.
 *
 * Implementation:
 *   - Uses the Manus-proxied LLM (gpt-5-mini) for semantic extraction.
 *   - Falls back to a regex heuristic if the LLM call fails or times out.
 *   - Never throws — always returns a best-effort SPO triple.
 *
 * Example:
 *   Input:  "Lysozyme is an antimicrobial enzyme found in human tears"
 *   Output: { subject: "Lysozyme", predicate: "is an antimicrobial enzyme found in", object: "human tears" }
 *
 *   Input:  "Has salmon aquaculture reduced Neoparamoeba perurans parasite loads since 2018?"
 *   Output: { subject: "salmon aquaculture", predicate: "reduces", object: "Neoparamoeba perurans parasite loads" }
 */

export interface SpoTriple {
  subject: string;
  predicate: string;
  object: string;
  /** confidence in the extraction quality: 0.0–1.0 */
  confidence: number;
  /** "llm" | "heuristic" — which method produced this triple */
  method: "llm" | "heuristic";
}

const LLM_TIMEOUT_MS = 8_000;

/**
 * Extract an SPO triple from a claim string.
 * Always returns a result — never throws.
 */
export async function extractSpoTriple(claimText: string): Promise<SpoTriple> {
  try {
    const result = await extractSpoViaLlm(claimText);
    if (result) return result;
  } catch {
    // fall through to heuristic
  }
  return extractSpoHeuristic(claimText);
}

// ─── LLM extraction ───────────────────────────────────────────────────────────

async function extractSpoViaLlm(claimText: string): Promise<SpoTriple | null> {
  const apiBase =
    process.env["OPENAI_API_BASE"] ??
    process.env["BUILT_IN_FORGE_API_URL"] ??
    "https://api.openai.com/v1";
  const apiKey =
    process.env["OPENAI_API_KEY"] ??
    process.env["BUILT_IN_FORGE_API_KEY"] ??
    "";
  if (!apiKey) return null;

  const prompt = `Extract the Subject–Predicate–Object triple from this claim.
Return ONLY valid JSON with keys: subject, predicate, object.
No explanation. No markdown. Just JSON.

Claim: "${claimText.replace(/"/g, "'")}"

Rules:
- subject: the entity or concept the claim is about (noun phrase)
- predicate: the relationship or action (verb phrase, normalized to present tense)
- object: what the subject relates to or acts upon (noun phrase)
- For questions, extract the implicit assertion (e.g. "Has X done Y?" → subject=X, predicate=does, object=Y)
- Keep each part concise (max 10 words)

JSON:`;

  const resp = await fetch(`${apiBase}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-5-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0,
      max_tokens: 120,
    }),
    signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
  });

  if (!resp.ok) return null;
  const data = (await resp.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const raw = data.choices?.[0]?.message?.content?.trim() ?? "";
  // Strip markdown code fences if present
  const cleaned = raw
    .replace(/^```json?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  const parsed = JSON.parse(cleaned) as {
    subject?: string;
    predicate?: string;
    object?: string;
  };
  if (!parsed.subject || !parsed.predicate || !parsed.object) return null;
  return {
    subject: String(parsed.subject).trim(),
    predicate: String(parsed.predicate).trim(),
    object: String(parsed.object).trim(),
    confidence: 0.92,
    method: "llm",
  };
}

// ─── Heuristic fallback ───────────────────────────────────────────────────────

/**
 * Simple regex-based SPO extraction for when the LLM is unavailable.
 * Handles the most common claim patterns:
 *   "X is Y"          → subject=X, predicate=is, object=Y
 *   "X reduces Y"     → subject=X, predicate=reduces, object=Y
 *   "X has been shown to Y" → subject=X, predicate=has been shown to, object=Y
 */
function extractSpoHeuristic(claimText: string): SpoTriple {
  // Normalize question to assertion
  const text = claimText
    .replace(/^(has|have|does|do|is|are|was|were|can|could|will|would)\s+/i, "")
    .replace(/\?$/, "")
    .trim();

  // Common verb patterns (order matters — more specific first)
  const verbPatterns = [
    /^(.+?)\s+(has been shown to|have been shown to)\s+(.+)$/i,
    /^(.+?)\s+(is associated with|are associated with)\s+(.+)$/i,
    /^(.+?)\s+(is involved in|are involved in)\s+(.+)$/i,
    /^(.+?)\s+(is required for|are required for)\s+(.+)$/i,
    /^(.+?)\s+(is expressed in|are expressed in)\s+(.+)$/i,
    /^(.+?)\s+(is found in|are found in)\s+(.+)$/i,
    /^(.+?)\s+(is an?|are an?)\s+(.+)$/i,
    /^(.+?)\s+(reduces?|increases?|inhibits?|activates?|promotes?|suppresses?)\s+(.+)$/i,
    /^(.+?)\s+(causes?|leads? to|results? in)\s+(.+)$/i,
    /^(.+?)\s+(binds?|interacts? with|associates? with)\s+(.+)$/i,
    /^(.+?)\s+(encodes?|expresses?|produces?|synthesizes?)\s+(.+)$/i,
    /^(.+?)\s+(is|are|was|were)\s+(.+)$/i,
    /^(.+?)\s+(has|have|had)\s+(.+)$/i,
  ];

  for (const pattern of verbPatterns) {
    const m = text.match(pattern);
    if (m && m[1] && m[2] && m[3]) {
      return {
        subject: m[1].trim(),
        predicate: m[2].trim(),
        object: m[3].trim(),
        confidence: 0.55,
        method: "heuristic",
      };
    }
  }

  // Last resort: split on first verb-like word
  const words = text.split(/\s+/);
  if (words.length >= 3) {
    const mid = Math.floor(words.length / 2);
    return {
      subject: words.slice(0, mid - 1).join(" ") || words[0],
      predicate: words[mid - 1] ?? "relates to",
      object: words.slice(mid).join(" ") || words[words.length - 1],
      confidence: 0.3,
      method: "heuristic",
    };
  }

  return {
    subject: text,
    predicate: "relates to",
    object: "unknown",
    confidence: 0.1,
    method: "heuristic",
  };
}
