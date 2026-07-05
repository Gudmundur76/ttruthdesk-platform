/**
 * mrAgentClient.ts
 * Sprint 38 — MRAgent memory integration for citation.is verification pipeline.
 *
 * Provides two functions:
 *   queryMRAgent  — pre-check: look up a claim in MRAgent memory before hitting PubMed.
 *                   Returns a cached verdict if a high-confidence match (score ≥ 0.88) exists.
 *   ingestMRAgent — post-ingest: store a new verdict in MRAgent memory after verification.
 *                   Fire-and-forget — never blocks the HTTP response.
 *
 * Both functions are safe to call when MRAGENT_URL is not set (returns { hit: false } / void).
 * All errors are swallowed — MRAgent is an optional acceleration layer, not a hard dependency.
 */

const MRAGENT_URL = process.env.MRAGENT_URL ?? null;
const MRAGENT_TIMEOUT_QUERY = 3000;   // 3 s — must not slow down verification
const MRAGENT_TIMEOUT_INGEST = 5000;  // 5 s — fire-and-forget, but give it a chance
const CACHE_HIT_THRESHOLD = 0.88;     // cosine similarity threshold for a cache hit

export interface MRAgentHit {
  hit: true;
  verdict: string;
  confidence: number;
  rationale: string;
  evidenceUrl: string | null;
  source: "mragent_cache";
}

export interface MRAgentMiss {
  hit: false;
}

export type MRAgentResult = MRAgentHit | MRAgentMiss;

/**
 * Query MRAgent memory for a cached verdict on the given claim.
 * Returns a hit with the stored verdict if a sufficiently similar episode exists,
 * or a miss if MRAgent is unavailable, the memory is empty, or no episode scores
 * above the CACHE_HIT_THRESHOLD.
 */
export async function queryMRAgent(claim: string): Promise<MRAgentResult> {
  if (!MRAGENT_URL) return { hit: false };

  try {
    const res = await fetch(`${MRAGENT_URL}/v1/memory/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ claim, top_k: 5 }),
      signal: AbortSignal.timeout(MRAGENT_TIMEOUT_QUERY),
    });

    if (!res.ok) return { hit: false };

    const data = await res.json() as {
      episodes?: Array<{ episode_id: string; text: string; score: number }>;
      total_in_memory?: number;
    };

    const episodes = data.episodes ?? [];
    if (episodes.length === 0) return { hit: false };

    const top = episodes[0];
    if (!top || top.score < CACHE_HIT_THRESHOLD) return { hit: false };

    // The stored episode text is a JSON-encoded verdict record
    let stored: {
      claim?: string;
      verdict?: string;
      confidence?: number;
      rationale?: string;
      evidenceUrl?: string | null;
    };
    try {
      stored = JSON.parse(top.text);
    } catch {
      return { hit: false };
    }

    if (!stored.verdict) return { hit: false };

    return {
      hit: true,
      verdict: stored.verdict,
      confidence: stored.confidence ?? 0.9,
      rationale: stored.rationale ?? `Recalled from verified memory (similarity ${top.score.toFixed(3)}).`,
      evidenceUrl: stored.evidenceUrl ?? null,
      source: "mragent_cache",
    };
  } catch {
    // Network error, timeout, or parse failure — treat as miss
    return { hit: false };
  }
}

/**
 * Ingest a new verified claim into MRAgent memory.
 * Fire-and-forget — do NOT await this function in the request handler.
 * Errors are silently swallowed.
 */
export function ingestMRAgent(
  claim: string,
  verdict: string,
  confidence: number,
  rationale: string,
  evidenceUrl: string | null,
  pmids: string[]
): void {
  if (!MRAGENT_URL) return;

  // Build a citation string from PMIDs or fall back to the evidence URL
  const citation =
    pmids.length > 0
      ? pmids.map((p) => `PMID:${p}`).join(", ")
      : (evidenceUrl ?? "citation.is internal verification");

  const episodeText = JSON.stringify({
    claim,
    verdict,
    confidence,
    rationale,
    evidenceUrl,
  });

  // Fire-and-forget — intentionally not awaited
  fetch(`${MRAGENT_URL}/v1/memory/ingest`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text: episodeText,
      citation,
      domain: "citation",
      confidence,
    }),
    signal: AbortSignal.timeout(MRAGENT_TIMEOUT_INGEST),
  }).catch(() => {
    // Silently ignore — MRAgent ingest failure must never affect the response
  });
}
