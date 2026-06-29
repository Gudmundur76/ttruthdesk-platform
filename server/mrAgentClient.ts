/**
 * mrAgentClient.ts
 *
 * Thin HTTP client for the evolva-mragent Strands memory server.
 * All calls are non-blocking: failures are logged and silently ignored
 * so that a downed memory server never interrupts claim verification.
 *
 * Endpoints used:
 *   POST /reconstruct   → pre-flight context injection
 *   POST /query         → contradiction detection (similarity search)
 *   POST /ingest        → autopilot training export
 *   GET  /stats         → corpus size check
 */

import { logger, errData } from "./logger";
import { ENV } from "./_core/env";

const log = logger("mrAgentClient");

// ── Types ─────────────────────────────────────────────────────────────────────

export interface MemoryEpisode {
  episode_id: string;
  text: string;
  origin: string;
  score: number;
  citation?: string;
}

export interface ReconstructResult {
  answer: string;
  episodes_used: number;
  error?: string;
}

export interface QueryResult {
  episodes: MemoryEpisode[];
  total_in_memory: number;
  error?: string;
}

export interface IngestResult {
  success: boolean;
  episode_id: string;
  has_embedding: boolean;
  error?: string;
}

export interface MemoryStats {
  episode_count: number;
  key_node_count: number;
  link_count: number;
  error?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function post<T>(
  path: string,
  body: Record<string, unknown>,
  timeoutMs = 5000
): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${ENV.mrAgentUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      log.warn(`[MRAgent] ${path} returned HTTP ${res.status}`, {
        status: res.status,
      });
      return null;
    }
    return (await res.json()) as T;
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      log.warn(`[MRAgent] ${path} timed out after ${timeoutMs}ms`, {
        timeoutMs,
      });
    } else {
      log.warn(`[MRAgent] ${path} failed`, errData(err));
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function get<T>(path: string, timeoutMs = 5000): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${ENV.mrAgentUrl}${path}`, {
      signal: controller.signal,
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Fetch prior verification context for a claim text.
 * Returns a short natural-language summary of what the system has previously
 * found about similar claims, or null if the memory server is unavailable.
 *
 * Used for pre-flight context injection in analysisPipeline.ts.
 */
export async function fetchPriorContext(
  claimText: string
): Promise<string | null> {
  if (!ENV.mrAgentEnabled) return null;
  const result = await post<ReconstructResult>("/reconstruct", {
    claim: claimText,
    top_k: 5,
  });
  if (!result || result.error || result.episodes_used === 0) return null;
  return result.answer;
}

/**
 * Query similar past verdicts for contradiction detection.
 * Returns the top-k most similar stored episodes, or null on failure.
 */
export async function querySimilarVerdicts(
  claimText: string,
  topK = 5
): Promise<MemoryEpisode[] | null> {
  if (!ENV.mrAgentEnabled) return null;
  const result = await post<QueryResult>("/query", {
    claim: claimText,
    top_k: topK,
  });
  if (!result || result.error) return null;
  return result.episodes;
}

/**
 * Ingest a verified claim into the memory agent.
 * Used by the autopilot training export after high-confidence verdicts.
 */
export async function ingestVerifiedClaim(params: {
  episodeId: string;
  text: string;
  origin: string;
  tags: string[];
  citation: string;
}): Promise<IngestResult | null> {
  if (!ENV.mrAgentEnabled) return null;
  return post<IngestResult>("/ingest", {
    episode_id: params.episodeId,
    text: params.text,
    origin: params.origin,
    tags: params.tags,
    citation: params.citation,
  });
}

/**
 * Get current memory stats (episode count etc.).
 */
export async function getMemoryStats(): Promise<MemoryStats | null> {
  if (!ENV.mrAgentEnabled) return null;
  return get<MemoryStats>("/stats");
}
