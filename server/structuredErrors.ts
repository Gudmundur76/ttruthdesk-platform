/**
 * structuredErrors.ts — Phase 129
 *
 * Canonical error code constants and a makeError() helper for structured
 * 4xx/5xx responses across all public and internal API endpoints.
 *
 * Usage:
 *   res.status(404).json(makeError(ERR_CLAIM_NOT_FOUND, "Claim abc not found"));
 *   res.status(429).json(makeError(ERR_RATE_LIMITED, "Too many requests", { retryAfter: 60 }));
 */

// ─── Error code constants ─────────────────────────────────────────────────────

/** 404 — The requested claim does not exist */
export const ERR_CLAIM_NOT_FOUND = "ERR_CLAIM_NOT_FOUND" as const;

/** 429 — Request rate limit exceeded */
export const ERR_RATE_LIMITED = "ERR_RATE_LIMITED" as const;

/** 503 — Database is unavailable */
export const ERR_DB_UNAVAILABLE = "ERR_DB_UNAVAILABLE" as const;

/** 400 — Request payload failed validation */
export const ERR_INVALID_INPUT = "ERR_INVALID_INPUT" as const;

/** 503 — Ingestion pipeline has stalled (no new papers in threshold window) */
export const ERR_INGESTION_STALLED = "ERR_INGESTION_STALLED" as const;

/** 409 — A claim's verdict has flipped since the last consumer notification */
export const ERR_VERDICT_FLIP = "ERR_VERDICT_FLIP" as const;

/** 404 — The requested source version does not exist */
export const ERR_SOURCE_NOT_FOUND = "ERR_SOURCE_NOT_FOUND" as const;

/** 401 — Missing or invalid API key */
export const ERR_UNAUTHORIZED = "ERR_UNAUTHORIZED" as const;

/** 403 — API key exists but lacks permission for this operation */
export const ERR_FORBIDDEN = "ERR_FORBIDDEN" as const;

/** 500 — Unexpected internal server error */
export const ERR_INTERNAL = "ERR_INTERNAL" as const;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface StructuredError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Build a structured error response body.
 *
 * @param code    One of the ERR_* constants
 * @param message Human-readable description of the error
 * @param details Optional machine-readable key/value details (e.g. retryAfter, field)
 */
export function makeError(
  code: string,
  message: string,
  details?: Record<string, unknown>
): StructuredError {
  const err: StructuredError = { code, message };
  if (details !== undefined) {
    err.details = details;
  }
  return err;
}
