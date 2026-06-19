/**
 * frictionLayer.ts — L0: Friction Gate (Phase 2 Hardened)
 *
 * Evaluates whether an event has a verifiable payload and is worth processing.
 * Phase 2 additions (build2_decision.docx):
 *   - Cache lookup: SHA-256 hash of payload → preflight_cache table (NFR-L0-40)
 *   - Circuit breaker: opens after 5 consecutive failures, resets after 60s (NFR-L0-50)
 *   - Retry: up to 3 retries with exponential backoff 1s/2s/4s on transient errors (NFR-L0-51)
 *   - Event publication: publishes l0_scan_completed / l0_scan_failed to event bus
 *   - Graph degradation: continues with empty priorGraphSignals on DB unavailable
 */

import { createHash } from "crypto";
import type { LoopEvent } from "../eventBus";
import { publishEvent } from "../eventBus";
import type { LoopAction } from "../loopOrchestrator";
import { getDb } from "../../db";
import { preflightCache } from "../../../drizzle/schema";
import { eq } from "drizzle-orm";
import { logger } from "../../logger";
import type { FrictionEngineResult } from "../../frictionEngine";

const log = logger("frictionLayer");

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FrictionLayerResult {
  shouldProcess: boolean;
  reason?: string;
  actions: LoopAction[];
  /** Whether the result was served from cache (NFR-L0-40) */
  fromCache?: boolean;
  /** Whether the circuit breaker is open */
  circuitOpen?: boolean;
}

// ─── Circuit Breaker State ────────────────────────────────────────────────────

interface CircuitBreakerState {
  failures: number;
  lastFailureAt: number | null;
  isOpen: boolean;
}

const CIRCUIT_BREAKER_THRESHOLD = 5;
const CIRCUIT_BREAKER_RESET_MS = 60_000; // 60 seconds

// In-process circuit breaker (resets on server restart — acceptable for L0)
const circuitBreaker: CircuitBreakerState = {
  failures: 0,
  lastFailureAt: null,
  isOpen: false,
};

function isCircuitOpen(): boolean {
  if (!circuitBreaker.isOpen) return false;
  // Auto-reset after CIRCUIT_BREAKER_RESET_MS
  if (
    circuitBreaker.lastFailureAt !== null &&
    Date.now() - circuitBreaker.lastFailureAt > CIRCUIT_BREAKER_RESET_MS
  ) {
    circuitBreaker.isOpen = false;
    circuitBreaker.failures = 0;
    log.info("[FrictionLayer] Circuit breaker reset after timeout");
    return false;
  }
  return true;
}

function recordSuccess(): void {
  circuitBreaker.failures = 0;
  circuitBreaker.isOpen = false;
}

function recordFailure(): void {
  circuitBreaker.failures++;
  circuitBreaker.lastFailureAt = Date.now();
  if (circuitBreaker.failures >= CIRCUIT_BREAKER_THRESHOLD) {
    circuitBreaker.isOpen = true;
    log.warn(
      `[FrictionLayer] Circuit breaker OPENED after ${circuitBreaker.failures} failures`
    );
  }
}

/** Exported for testing only */
export function _resetCircuitBreaker(): void {
  circuitBreaker.failures = 0;
  circuitBreaker.lastFailureAt = null;
  circuitBreaker.isOpen = false;
}

// ─── PII Redaction on FrictionEngineResult (T016) ───────────────────────────

/** Redact PII from all string fields of a FrictionEngineResult. */
export function redactPii(result: FrictionEngineResult): FrictionEngineResult {
  const PII_PATTERNS: RegExp[] = [
    /\b[A-Z][a-z]+ [A-Z][a-z]+\b/g, // Full names
    /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g, // Emails
    /\b(?:\+?1[\s-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g, // Phone numbers
    /\b\d{3}-\d{2}-\d{4}\b/g, // SSNs
    /\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13})\b/g, // Credit cards
  ];
  const redact = (s: string): string =>
    PII_PATTERNS.reduce((acc, re) => acc.replace(re, "[REDACTED]"), s);
  return {
    ...result,
    raw_prompt: redact(result.raw_prompt),
    surface_request: redact(result.surface_request),
    inferred_intent: redact(result.inferred_intent),
    friction_question: redact(result.friction_question),
    remaining_uncertainty: redact(result.remaining_uncertainty),
    optimized_prompt: redact(result.optimized_prompt),
    assumptions: result.assumptions.map(a => ({
      ...a,
      statement: redact(a.statement),
    })),
    constraints: result.constraints.map(c => ({
      ...c,
      constraint: redact(c.constraint),
    })),
    claims: result.claims.map(cl => ({ ...cl, text: redact(cl.text) })),
  };
}

// ─── withRetry helper (T014) ──────────────────────────────────────────────────

/**
 * Retry an async operation with exponential backoff.
 * Default: 3 retries, base delay 1000ms (1s → 2s → 4s).
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  baseDelayMs = 1000
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      const backoffMs = baseDelayMs * Math.pow(2, attempt - 1);
      await new Promise(resolve => setTimeout(resolve, backoffMs));
    }
    try {
      return await fn();
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

// ─── hashInput export (T015) ─────────────────────────────────────────────────

/** SHA-256 hash of a payload object (sorted keys). Exported for testing. */
export function hashInput(payload: Record<string, unknown>): string {
  return hashPayload(payload);
}

/** Exported for testing: check if a cache entry exists for this hash */
export async function checkPreflightCache(
  inputHash: string
): Promise<FrictionLayerResult | null> {
  return getCachedResult(inputHash);
}

/** Exported for testing: store a result in the preflight cache */
export async function storePreflightCache(
  inputHash: string,
  result: FrictionLayerResult
): Promise<void> {
  return setCachedResult(inputHash, result);
}

// ─── Cache Helpers ────────────────────────────────────────────────────────────

function hashPayload(payload: Record<string, unknown>): string {
  const normalized = JSON.stringify(
    Object.fromEntries(
      Object.entries(payload).sort(([a], [b]) => a.localeCompare(b))
    )
  );
  return createHash("sha256").update(normalized).digest("hex");
}

async function getCachedResult(
  inputHash: string
): Promise<FrictionLayerResult | null> {
  try {
    const db = await getDb();
    if (!db) return null;
    const rows = await db
      .select()
      .from(preflightCache)
      .where(eq(preflightCache.inputHash, inputHash));
    const row = rows[0];
    if (!row) return null;
    // Check TTL
    if (row.expiresAt && new Date(row.expiresAt) < new Date()) {
      return null; // expired
    }
    // Update hit count asynchronously (non-fatal)
    db.update(preflightCache)
      .set({ hitCount: (row.hitCount ?? 0) + 1 })
      .where(eq(preflightCache.inputHash, inputHash))
      .catch(() => {
        /* non-fatal */
      });
    return {
      ...(row.result as unknown as FrictionLayerResult),
      fromCache: true,
    };
  } catch {
    return null;
  }
}

async function setCachedResult(
  inputHash: string,
  result: FrictionLayerResult
): Promise<void> {
  try {
    const db = await getDb();
    if (!db) return;
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h TTL
    await db
      .insert(preflightCache)
      .values({
        inputHash,
        result: result as unknown as Record<string, unknown>,
        recommendedAction: "pass",
        hitCount: 1,
        expiresAt,
      })
      .onDuplicateKeyUpdate({
        set: {
          result: result as unknown as Record<string, unknown>,
          hitCount: 1,
          expiresAt,
        },
      });
  } catch {
    // Non-fatal: cache write failure does not block processing
  }
}

// ─── Event Publication ────────────────────────────────────────────────────────

async function publishScanEvent(
  eventType: "l0_scan_completed" | "l0_scan_failed",
  payload: Record<string, unknown>
): Promise<void> {
  try {
    await publishEvent(eventType, payload);
  } catch {
    // Non-fatal: event publication failure does not block processing
  }
}

// ─── Core Gate Logic ──────────────────────────────────────────────────────────

async function evaluatePayload(event: LoopEvent): Promise<FrictionLayerResult> {
  const actions: LoopAction[] = [];

  // Check for empty payload
  if (!event.payload || Object.keys(event.payload).length === 0) {
    return { shouldProcess: false, reason: "empty_payload", actions };
  }

  // Event-specific payload validation
  switch (event.eventType) {
    case "document_submitted": {
      const hasDocId = !!event.payload.documentId;
      const hasClaimText =
        typeof event.payload.claimText === "string" &&
        (event.payload.claimText as string).length > 5;
      if (!hasDocId && !hasClaimText) {
        return { shouldProcess: false, reason: "missing_document_id", actions };
      }
      actions.push({
        type: "friction_check",
        description: hasDocId
          ? `Document ${event.payload.documentId} passed friction gate`
          : `Hostinger claim "${(event.payload.claimText as string).slice(0, 60)}" passed friction gate`,
        priority: 10,
        result: "success",
      });
      break;
    }

    case "verdict_complete": {
      if (!event.payload.claimId || !event.payload.verdict) {
        return {
          shouldProcess: false,
          reason: "missing_claim_id_or_verdict",
          actions,
        };
      }
      actions.push({
        type: "friction_check",
        description: `Verdict for claim ${event.payload.claimId} passed friction gate`,
        priority: 10,
        result: "success",
      });
      break;
    }

    case "contradiction_found": {
      if (!event.payload.claimId) {
        return { shouldProcess: false, reason: "missing_claim_id", actions };
      }
      actions.push({
        type: "friction_check",
        description: `Contradiction for claim ${event.payload.claimId} passed friction gate`,
        priority: 60,
        result: "success",
      });
      break;
    }

    case "scheduled_tick": {
      actions.push({
        type: "friction_check",
        description: "Scheduled tick passed friction gate",
        priority: 5,
        result: "success",
      });
      break;
    }

    default: {
      actions.push({
        type: "friction_check",
        description: `Event ${event.eventType} passed friction gate`,
        priority: 5,
        result: "success",
      });
    }
  }

  return { shouldProcess: true, actions };
}

// ─── Main Entry Point ─────────────────────────────────────────────────────────

const MAX_RETRIES = 3;
const RETRY_BASE_MS = 1000; // 1s → 2s → 4s (T014)

export async function runFrictionGate(
  event: LoopEvent
): Promise<FrictionLayerResult> {
  const startMs = Date.now();

  // Circuit breaker check
  if (isCircuitOpen()) {
    log.warn(
      "[FrictionLayer] Circuit breaker is open — returning conservative result"
    );
    await publishScanEvent("l0_scan_failed", {
      eventType: event.eventType,
      reason: "circuit_breaker_open",
      durationMs: Date.now() - startMs,
    });
    return {
      shouldProcess: false,
      reason: "circuit_breaker_open",
      actions: [],
      circuitOpen: true,
    };
  }

  // Cache lookup
  const inputHash = hashPayload(event.payload);
  const cached = await getCachedResult(inputHash);
  if (cached) {
    log.info(`[FrictionLayer] Cache hit for event ${event.eventType}`);
    return cached;
  }

  // Retry loop (T014: 3 retries, 1s/2s/4s backoff)
  let lastError: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const backoffMs = RETRY_BASE_MS * Math.pow(2, attempt - 1);
      await new Promise(resolve => setTimeout(resolve, backoffMs));
      log.info(
        `[FrictionLayer] Retry attempt ${attempt} for event ${event.eventType}`
      );
    }

    try {
      const result = await evaluatePayload(event);
      recordSuccess();

      // Cache successful results
      if (result.shouldProcess) {
        await setCachedResult(inputHash, result);
      }

      // Publish telemetry event
      await publishScanEvent("l0_scan_completed", {
        eventType: event.eventType,
        shouldProcess: result.shouldProcess,
        reason: result.reason,
        fromCache: false,
        durationMs: Date.now() - startMs,
      });

      return result;
    } catch (err) {
      lastError = err;
      log.warn(`[FrictionLayer] Attempt ${attempt} failed: ${String(err)}`);
    }
  }
  // All retries exhausted
  recordFailure();
  log.error(`[FrictionLayer] All retries exhausted: ${String(lastError)}`);

  await publishScanEvent("l0_scan_failed", {
    eventType: event.eventType,
    reason: "all_retries_exhausted",
    error: String(lastError),
    durationMs: Date.now() - startMs,
  });

  // Graceful degradation: conservative pass-through
  return {
    shouldProcess: false,
    reason: "friction_gate_error",
    actions: [],
  };
}
