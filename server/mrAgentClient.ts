/**
 * mrAgentClient.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * HTTP client for the evolva-mragent Strands memory server.
 *
 * Exports (original contract — do NOT change signatures):
 *   fetchPriorContext()     — reconstruct context from episodic memory
 *   querySimilarVerdicts()  — query top-K similar episodes
 *   ingestVerifiedClaim()   — store a new verified claim episode
 *   getMemoryStats()        — fetch memory server statistics
 *   MemoryEpisode           — episode type used by contradiction check
 *
 * Sprint 38 additions (new exports for verifyClaimRoute.ts):
 *   queryMRAgent()          — high-level pre-check: returns cached verdict on hit
 *   ingestMRAgent()         — fire-and-forget post-ingest after new verdict
 *   MRAgentResult           — union type for queryMRAgent return value
 *
 * All functions are safe no-ops when ENV.mrAgentEnabled is false.
 * All errors are silently swallowed — MRAgent is an optional acceleration
 * layer, not a hard dependency.
 */

import { ENV } from "./_core/env";
import { logger } from "./logger";

const log = logger("mrAgentClient");

// ─── Timeouts ─────────────────────────────────────────────────────────────────
const TIMEOUT_QUERY = 3000;    // 3 s — must not slow down verification
const TIMEOUT_INGEST = 5000;   // 5 s — fire-and-forget, but give it a chance
const TIMEOUT_STATS  = 4000;   // 4 s

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MemoryEpisode {
  episode_id: string;
  text: string;
  origin?: string;
  score: number;
  citation?: string;
}

export interface IngestParams {
  // Fields used by trainingExporter.ts
  episodeId?: string;
  text?: string;
  origin?: string;
  tags?: string[];
  citation?: string;
  // Fields used by verifyClaimRoute.ts (Sprint 38 additions)
  claimText?: string;
  verdict?: string;
  confidenceScore?: number;
  rationale?: string;
  evidenceUrl?: string | null;
  pmids?: string[];
  claimId?: number | null;
  domain?: string;
}

export interface MemoryStats {
  total_episodes: number;
  [key: string]: unknown;
}

// Sprint 38 — high-level cache result types
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function baseUrl(): string {
  return ENV.mrAgentUrl ?? "http://localhost:8002";
}

async function safeFetch(
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<Response | null> {
  try {
    const res = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(timeoutMs),
    });
    return res;
  } catch {
    return null;
  }
}

// ─── Original API (preserved exactly) ────────────────────────────────────────

/**
 * Reconstruct prior context for a claim from episodic memory.
 * Returns a context string if relevant episodes exist, null otherwise.
 * Used by analysisPipeline.ts for pre-flight context injection.
 */
export async function fetchPriorContext(claim: string): Promise<string | null> {
  if (!ENV.mrAgentEnabled) return null;

  const res = await safeFetch(
    `${baseUrl()}/v1/memory/reconstruct`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: claim }),
    },
    TIMEOUT_QUERY
  );

  if (!res || !res.ok) return null;

  try {
    const data = await res.json() as {
      answer?: string;
      episodes_used?: number;
      error?: string;
    };
    if (data.error || !data.episodes_used || data.episodes_used === 0) return null;
    return data.answer ?? null;
  } catch {
    return null;
  }
}

/**
 * Query MRAgent for top-K episodes semantically similar to the claim.
 * Returns an empty array on any error.
 * Used by claimSimilarityEngine.ts and mrAgentContradictionCheck.ts.
 */
export async function querySimilarVerdicts(
  claim: string,
  topK = 5
): Promise<MemoryEpisode[]> {
  if (!ENV.mrAgentEnabled) return [];

  const res = await safeFetch(
    `${baseUrl()}/v1/memory/query`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ claim, top_k: topK }),
    },
    TIMEOUT_QUERY
  );

  if (!res || !res.ok) return [];

  try {
    const data = await res.json() as { episodes?: MemoryEpisode[] };
    return data.episodes ?? [];
  } catch {
    return [];
  }
}

/**
 * Ingest a verified claim into MRAgent episodic memory.
 * Requires a citation — the MRAgent server blocks ingestion without one.
 * Used by trainingExporter.ts and verifyClaimRoute.ts.
 *
 * Returns { success: true, episode_id: string } on success, or null on failure.
 * Supports two call shapes:
 *   1. trainingExporter.ts style: { episodeId, text, origin, tags, citation }
 *   2. verifyClaimRoute.ts style: { claimText, verdict, confidenceScore, rationale, evidenceUrl, pmids }
 */
export async function ingestVerifiedClaim(
  params: IngestParams
): Promise<{ success: boolean; episode_id?: string } | null> {
  if (!ENV.mrAgentEnabled) return null;

  // Resolve text — support both call shapes
  const episodeText =
    params.text ??
    JSON.stringify({
      claimText: params.claimText,
      verdict: params.verdict,
      confidenceScore: params.confidenceScore,
      rationale: params.rationale,
      evidenceUrl: params.evidenceUrl,
      claimId: params.claimId ?? null,
    });

  // Resolve citation — support both call shapes
  const citation =
    params.citation ??
    (params.pmids && params.pmids.length > 0
      ? params.pmids.map(p => `PMID:${p}`).join(", ")
      : (params.evidenceUrl ?? "citation.is internal verification"));

  const body: Record<string, unknown> = {
    text: episodeText,
    citation,
    domain: params.domain ?? "citation",
  };
  if (params.episodeId) body.episode_id = params.episodeId;
  if (params.origin) body.origin = params.origin;
  if (params.tags) body.tags = params.tags;
  if (params.confidenceScore !== undefined) body.confidence = params.confidenceScore;

  const res = await safeFetch(
    `${baseUrl()}/v1/memory/ingest`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    TIMEOUT_INGEST
  );

  if (!res || !res.ok) {
    log.warn("[MRAgent] ingestVerifiedClaim failed", { status: res?.status });
    return null;
  }

  try {
    const data = await res.json() as { success?: boolean; episode_id?: string };
    return { success: data.success ?? true, episode_id: data.episode_id };
  } catch {
    return { success: true };
  }
}

/**
 * Fetch memory server statistics.
 * Returns null on any error.
 */
export async function getMemoryStats(): Promise<MemoryStats | null> {
  if (!ENV.mrAgentEnabled) return null;

  const res = await safeFetch(
    `${baseUrl()}/v1/memory/stats`,
    { method: "GET" },
    TIMEOUT_STATS
  );

  if (!res || !res.ok) return null;

  try {
    return await res.json() as MemoryStats;
  } catch {
    return null;
  }
}

// ─── Sprint 38 additions ──────────────────────────────────────────────────────

// Minimum cosine similarity for a cache hit in the verifyClaimRoute pre-check
const CACHE_HIT_THRESHOLD = 0.88;

/**
 * High-level pre-check for verifyClaimRoute.ts (Sprint 38).
 * Queries episodic memory and returns a cached verdict if a high-confidence
 * match exists (cosine similarity ≥ 0.88), avoiding a PubMed round-trip.
 * Returns a miss if MRAgent is disabled, memory is empty, or no episode
 * scores above the threshold.
 */
export async function queryMRAgent(claim: string): Promise<MRAgentResult> {
  if (!ENV.mrAgentEnabled) return { hit: false };

  const episodes = await querySimilarVerdicts(claim, 5);
  if (episodes.length === 0) return { hit: false };

  const top = episodes[0];
  if (!top || top.score < CACHE_HIT_THRESHOLD) return { hit: false };

  let stored: {
    claimText?: string;
    verdict?: string;
    confidenceScore?: number;
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
    confidence: stored.confidenceScore ?? 0.9,
    rationale:
      stored.rationale ??
      `Recalled from verified memory (similarity ${top.score.toFixed(3)}).`,
    evidenceUrl: stored.evidenceUrl ?? null,
    source: "mragent_cache",
  };
}

/**
 * Fire-and-forget post-ingest for verifyClaimRoute.ts (Sprint 38).
 * Stores a new verdict in MRAgent episodic memory after verification.
 * DO NOT await this function — it must never block the HTTP response.
 */
export function ingestMRAgent(
  claimText: string,
  verdict: string,
  confidenceScore: number,
  rationale: string,
  evidenceUrl: string | null,
  pmids: string[]
): void {
  // Delegate to ingestVerifiedClaim — fire-and-forget
  ingestVerifiedClaim({
    claimText,
    verdict,
    confidenceScore,
    rationale,
    evidenceUrl,
    pmids,
    domain: "citation",
  }).catch(() => {
    // Silently ignore — ingest failure must never affect the response
  });
}
