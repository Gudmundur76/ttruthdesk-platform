/**
 * temporalVersioning.ts
 *
 * Phase 118 — Temporal Claim Versioning
 *
 * Provides:
 *   - isClaimStale()        — detects claims older than a configurable threshold
 *   - buildTemporalWindow() — derives validFrom/validUntil from evidence publication years
 *   - filterByDate()        — filters claims to those valid at a given query date
 *   - verdictAtDate()       — returns a claim's verdict annotated with temporal validity
 *   - TOOLS_MANIFEST        — MCP tool descriptor for verify_claim_at_date
 *
 * Design notes:
 *   - No DB writes here — this module is pure logic, testable without a DB.
 *   - The DB schema migration (adding validFrom/validUntil to claims table) is
 *     applied separately via drizzle-kit generate + webdev_execute_sql.
 *   - The MCP tool handler in mcpServer.ts calls verdictAtDate() after fetching
 *     the claim from the DB.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type VerdictLabel =
  | "Supported"
  | "Contradicted"
  | "Partially Supported"
  | "Ambiguous"
  | "Insufficient Evidence"
  | "Out of Scope"
  | "Needs Expert Review";

export interface TemporalWindow {
  validFrom: Date;
  validUntil: Date | null;
}

export interface TemporalClaim {
  id: number;
  verdict: VerdictLabel;
  validFrom: Date;
  validUntil: Date | null;
  claimText: string;
}

export interface VerdictAtDateResult {
  claimId: number;
  verdict: VerdictLabel;
  claimText: string;
  temporallyValid: boolean;
  validFrom: Date;
  validUntil: Date | null;
  staleSince?: Date;
  reason?: string;
}

// ─── isClaimStale ─────────────────────────────────────────────────────────────

/**
 * Returns true if the claim was last verified more than `staleDays` ago.
 * Default threshold: 365 days.
 */
export function isClaimStale(
  lastVerifiedAt: Date,
  staleDays = 365
): boolean {
  const ageMs = Date.now() - lastVerifiedAt.getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  return ageDays > staleDays;
}

// ─── buildTemporalWindow ──────────────────────────────────────────────────────

/**
 * Derives a validity window from a list of evidence publication years.
 *
 * - validFrom: January 1st of the earliest evidence year (or current year if empty)
 * - validUntil: January 1st of the retraction year if provided, otherwise null
 */
export function buildTemporalWindow(
  evidenceYears: number[],
  retractionYear?: number
): TemporalWindow {
  const earliestYear =
    evidenceYears.length > 0
      ? Math.min(...evidenceYears)
      : new Date().getFullYear();

  return {
    validFrom: new Date(earliestYear, 0, 1),
    validUntil:
      retractionYear != null ? new Date(retractionYear, 0, 1) : null,
  };
}

// ─── filterByDate ─────────────────────────────────────────────────────────────

/**
 * Filters a list of claims to those valid at the given queryDate.
 * If queryDate is null, all claims are returned (no temporal filter).
 */
export function filterByDate<T extends { validFrom: Date; validUntil: Date | null }>(
  claims: T[],
  queryDate: Date | null
): T[] {
  if (queryDate === null) return claims;

  return claims.filter(claim => {
    if (queryDate < claim.validFrom) return false;
    if (claim.validUntil !== null && queryDate > claim.validUntil) return false;
    return true;
  });
}

// ─── verdictAtDate ────────────────────────────────────────────────────────────

/**
 * Returns a claim's verdict annotated with temporal validity metadata.
 *
 * - temporallyValid: true if queryDate falls within [validFrom, validUntil]
 * - staleSince: set to validUntil when the claim has expired
 * - reason: human-readable explanation when temporallyValid is false
 */
export function verdictAtDate(
  claim: TemporalClaim,
  queryDate: Date
): VerdictAtDateResult {
  const base: VerdictAtDateResult = {
    claimId: claim.id,
    verdict: claim.verdict,
    claimText: claim.claimText,
    temporallyValid: true,
    validFrom: claim.validFrom,
    validUntil: claim.validUntil,
  };

  if (queryDate < claim.validFrom) {
    return {
      ...base,
      temporallyValid: false,
      reason: `Query date ${queryDate.toISOString().slice(0, 10)} is before this claim's validity window (starts ${claim.validFrom.toISOString().slice(0, 10)}).`,
    };
  }

  if (claim.validUntil !== null && queryDate > claim.validUntil) {
    return {
      ...base,
      temporallyValid: false,
      staleSince: claim.validUntil,
      reason: `This claim expired on ${claim.validUntil.toISOString().slice(0, 10)}. It may have been superseded by newer evidence.`,
    };
  }

  return base;
}

// ─── MCP Tool Manifest ────────────────────────────────────────────────────────

export const TOOLS_MANIFEST = [
  {
    name: "verify_claim_at_date",
    description:
      "Verify a scientific claim as it was understood at a specific date. " +
      "Returns the verdict that was valid on that date, whether the claim has since " +
      "been superseded, and the temporal validity window of the evidence.",
    inputSchema: {
      type: "object",
      properties: {
        claim: {
          type: "string",
          description: "The scientific claim to verify.",
        },
        query_date: {
          type: "string",
          description:
            "ISO 8601 date string (YYYY-MM-DD) to verify the claim as of. " +
            "Use 'latest' to get the most current verdict.",
        },
        vertical: {
          type: "string",
          description: "Optional domain hint (e.g. 'structural_biology', 'salmon_biotech').",
        },
      },
      required: ["claim", "query_date"],
      additionalProperties: false,
    },
  },
] as const;
