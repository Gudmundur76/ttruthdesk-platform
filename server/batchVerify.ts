/**
 * batchVerify.ts — Phase 119
 *
 * Batch claim verification utilities.
 *
 * Provides:
 *   - claimTextHash()      — deterministic 16-char hex ID for deduplication
 *   - validateBatchInput() — input guards (1–20 claims, dedup, length)
 *   - buildBatchResult()   — response shaper
 *   - BATCH_TOOLS_MANIFEST — MCP tool descriptor for verify_claims_batch
 *   - batchVerifyClaims()  — orchestrates parallel per-claim verification
 *
 * Design:
 *   - Concurrency capped at 5 parallel calls (avoids overwhelming PubMed)
 *   - Each claim is independently error-isolated (one failure ≠ whole batch fails)
 *   - claimTextHash normalises to lowercase+trim before hashing → dedup is
 *     case-insensitive and whitespace-insensitive
 */

import { createHash } from "crypto";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BatchClaimInput {
  claim: string;
  domain?: string;
}

export interface BatchEvidenceItem {
  pmid: string;
  title?: string;
  excerpt?: string;
  citationUrl?: string;
  year?: number;
}

export interface BatchClaimResult {
  claimHash: string;
  claimText: string;
  verdict: string | null;
  confidence: number | null;
  summary: string | null;
  evidence: BatchEvidenceItem[];
  processedAt: string;
  error: string | null;
}

export interface BatchOutput {
  total: number;
  succeeded: number;
  failed: number;
  durationMs: number;
  results: BatchClaimResult[];
}

interface ValidationResult {
  valid: boolean;
  normalised: string[];
  duplicatesRemoved: number;
  error?: string;
}

// ─── claimTextHash ────────────────────────────────────────────────────────────

/**
 * Returns a deterministic 16-char hex hash of a claim string.
 * Normalises to lowercase and trims whitespace before hashing.
 */
export function claimTextHash(claim: string): string {
  const normalised = claim.trim().toLowerCase();
  return createHash("sha256").update(normalised, "utf8").digest("hex").slice(0, 16);
}

// ─── validateBatchInput ───────────────────────────────────────────────────────

/**
 * Validates and normalises a batch of claim strings.
 * - Must be an array of 1–20 non-empty strings, each ≤ 1000 chars
 * - Deduplicates by normalised text (case-insensitive, trimmed)
 */
export function validateBatchInput(claims: string[]): ValidationResult {
  if (!Array.isArray(claims)) {
    return { valid: false, normalised: [], duplicatesRemoved: 0, error: "claims must be an array" };
  }
  if (claims.length === 0) {
    return { valid: false, normalised: [], duplicatesRemoved: 0, error: "claims must contain at least 1 item" };
  }
  if (claims.length > 20) {
    return { valid: false, normalised: [], duplicatesRemoved: 0, error: "claims must contain at most 20 items" };
  }

  // Validate each element
  for (let i = 0; i < claims.length; i++) {
    const c = claims[i];
    if (typeof c !== "string") {
      return { valid: false, normalised: [], duplicatesRemoved: 0, error: `claims[${i}] must be a string` };
    }
    if (c.trim().length === 0) {
      return { valid: false, normalised: [], duplicatesRemoved: 0, error: `claims[${i}] must not be empty` };
    }
    if (c.length > 1000) {
      return { valid: false, normalised: [], duplicatesRemoved: 0, error: `claims[${i}] must be at most 1000 characters` };
    }
  }

  // Deduplicate by normalised key
  const seen = new Map<string, string>();
  claims.forEach(c => {
    const key = c.trim().toLowerCase();
    if (!seen.has(key)) {
      seen.set(key, c.trim());
    }
  });

  const normalised = Array.from(seen.values());
  const duplicatesRemoved = claims.length - normalised.length;

  return { valid: true, normalised, duplicatesRemoved };
}

// ─── buildBatchResult ─────────────────────────────────────────────────────────

/**
 * Shapes an array of per-claim results into the final batch response object.
 */
export function buildBatchResult(results: BatchClaimResult[], startMs: number): BatchOutput {
  const succeeded = results.filter(r => r.error === null).length;
  const failed = results.length - succeeded;
  return {
    total: results.length,
    succeeded,
    failed,
    durationMs: Date.now() - startMs,
    results,
  };
}

// ─── batchVerifyClaims ────────────────────────────────────────────────────────

const BATCH_CONCURRENCY = 5;

/**
 * Orchestrates parallel per-claim verification against the internal
 * /api/public/verify-claim endpoint. Concurrency is capped at BATCH_CONCURRENCY.
 * Each claim is independently error-isolated.
 */
export async function batchVerifyClaims(
  claims: string[],
  options: { confidenceThreshold?: number; domain?: string; port?: number } = {}
): Promise<BatchClaimResult[]> {
  const port = options.port ?? (process.env["PORT"] ? Number(process.env["PORT"]) : 3000);
  const host = `http://localhost:${port}`;
  const results: BatchClaimResult[] = [];

  // Process in chunks of BATCH_CONCURRENCY
  for (let i = 0; i < claims.length; i += BATCH_CONCURRENCY) {
    const chunk = claims.slice(i, i + BATCH_CONCURRENCY);
    const chunkResults = await Promise.all(
      chunk.map(claim => verifySingleClaim(claim, host, options))
    );
    results.push(...chunkResults);
  }

  return results;
}

async function verifySingleClaim(
  claim: string,
  host: string,
  options: { confidenceThreshold?: number; domain?: string }
): Promise<BatchClaimResult> {
  const hash = claimTextHash(claim);
  const now = new Date().toISOString();

  try {
    const body: Record<string, unknown> = { claim };
    if (options.domain) body["domain"] = options.domain;

    const resp = await fetch(`${host}/api/public/verify-claim`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-MCP-Internal": "1",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });

    if (!resp.ok) {
      const errBody = await resp.json().catch(() => ({})) as Record<string, unknown>;
      return {
        claimHash: hash,
        claimText: claim,
        verdict: null,
        confidence: null,
        summary: null,
        evidence: [],
        processedAt: now,
        error: (errBody["error"] as string) ?? `HTTP ${resp.status}`,
      };
    }

    const data = await resp.json() as Record<string, unknown>;
    if (!data["ok"]) {
      return {
        claimHash: hash,
        claimText: claim,
        verdict: null,
        confidence: null,
        summary: null,
        evidence: [],
        processedAt: now,
        error: (data["error"] as string) ?? "Verification failed",
      };
    }

    const rawDensity = typeof data["signalDensity"] === "number" ? (data["signalDensity"] as number) : 5;
    const confidence = Math.min(1, Math.max(0, rawDensity / 10));
    const threshold = options.confidenceThreshold ?? 0;

    if (confidence < threshold) {
      return {
        claimHash: hash,
        claimText: claim,
        verdict: "below_threshold",
        confidence,
        summary: `Confidence ${confidence.toFixed(2)} is below threshold ${threshold.toFixed(2)}`,
        evidence: [],
        processedAt: now,
        error: null,
      };
    }

    const pubmedResults = (data["pubmedResults"] as Array<Record<string, unknown>>) ?? [];

    return {
      claimHash: hash,
      claimText: claim,
      verdict: (data["verdict"] as string) ?? "inconclusive",
      confidence,
      summary: (data["rationale"] as string) ?? null,
      evidence: pubmedResults.map(p => ({
        pmid: String(p["pmid"] ?? ""),
        title: p["title"] as string | undefined,
        excerpt: p["abstractSnippet"] as string | undefined,
        citationUrl: (p["url"] ?? p["citationUrl"]) as string | undefined,
        year: p["year"] as number | undefined,
      })),
      processedAt: now,
      error: null,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      claimHash: hash,
      claimText: claim,
      verdict: null,
      confidence: null,
      summary: null,
      evidence: [],
      processedAt: now,
      error: message,
    };
  }
}

// ─── MCP Tool Manifest ────────────────────────────────────────────────────────

export const BATCH_TOOLS_MANIFEST = [
  {
    name: "verify_claims_batch",
    description:
      "Submit up to 20 claims in a single request and receive structured verdicts for each. " +
      "Claims are verified in parallel (concurrency capped at 5). Duplicate claims (case-insensitive) " +
      "are automatically deduplicated. Each result includes a claimHash for stable referencing. " +
      "Failed claims are isolated — one error does not abort the batch.",
    inputSchema: {
      type: "object",
      properties: {
        claims: {
          type: "array",
          items: { type: "string", maxLength: 1000 },
          minItems: 1,
          maxItems: 20,
          description: "Array of claim strings to verify. 1–20 items. Duplicates are removed.",
        },
        confidence_threshold: {
          type: "number",
          minimum: 0,
          maximum: 1,
          description: "Optional minimum confidence [0,1]. Claims below this threshold return verdict='below_threshold'.",
        },
        domain: {
          type: "string",
          description: "Optional domain hint (e.g. 'biology', 'medicine') applied to all claims in the batch.",
        },
      },
      required: ["claims"],
      additionalProperties: false,
    },
  },
] as const;
