/**
 * circuitBreaker.ts — LLM Circuit Breaker for the Frontier Engine
 *
 * Protects the hypothesis generation stage from cascading LLM failures.
 * When 3 consecutive LLM failures occur, the circuit opens and Stage 4
 * is skipped until the cooldown period (5 minutes) expires.
 *
 * FR-L3-19, Section 9.3
 */

export interface CircuitBreakerState {
  /** Number of consecutive failures since last success. Reset to 0 on success. */
  consecutiveFailures: number;
  /** True when consecutiveFailures >= FAILURE_THRESHOLD */
  isOpen: boolean;
  /** Timestamp when the circuit was tripped, or null if not open */
  openedAt: Date | null;
  /** Cooldown duration in milliseconds (default 5 minutes) */
  cooldownMs: number;
  /** Failure threshold before circuit opens */
  threshold: number;
}

const FAILURE_THRESHOLD = 3;
const DEFAULT_COOLDOWN_MS = 300_000; // 5 minutes

export class FrontierCircuitBreaker {
  consecutiveFailures = 0;
  isOpen = false;
  openedAt: Date | null = null;
  readonly cooldownMs: number;
  readonly threshold: number;

  constructor(cooldownMs = DEFAULT_COOLDOWN_MS, threshold = FAILURE_THRESHOLD) {
    this.cooldownMs = cooldownMs;
    this.threshold = threshold;
  }

  /**
   * Call on every successful LLM invocation.
   * Resets the failure counter and closes the circuit.
   */
  recordSuccess(): void {
    this.consecutiveFailures = 0;
    this.isOpen = false;
    this.openedAt = null;
  }

  /**
   * Call on every LLM failure (timeout, unparseable JSON, network error).
   * Opens the circuit when consecutiveFailures reaches FAILURE_THRESHOLD.
   * Returns true if this failure caused the circuit to open.
   */
  recordFailure(): boolean {
    this.consecutiveFailures++;
    if (!this.isOpen && this.consecutiveFailures >= this.threshold) {
      this.isOpen = true;
      this.openedAt = new Date();
      return true; // circuit just opened
    }
    return false;
  }

  /**
   * Returns true if Stage 4 (hypothesis generation) should be skipped.
   *
   * The circuit is open when:
   *   - isOpen is true AND
   *   - the cooldown has not yet expired
   *
   * When the cooldown expires, the circuit is automatically reset.
   */
  shouldSkip(): boolean {
    if (!this.isOpen) return false;

    const now = Date.now();
    const openedAt = this.openedAt?.getTime() ?? now;

    if (now - openedAt > this.cooldownMs) {
      // Cooldown expired — reset the circuit
      this.isOpen = false;
      this.consecutiveFailures = 0;
      this.openedAt = null;
      return false;
    }

    return true;
  }

  /**
   * Manually reset the circuit breaker (admin override).
   * Closes the circuit and resets the failure counter.
   */
  reset(): void {
    this.consecutiveFailures = 0;
    this.isOpen = false;
    this.openedAt = null;
  }

  /** Returns a snapshot of the current circuit state */
  getState(): CircuitBreakerState {
    return {
      consecutiveFailures: this.consecutiveFailures,
      isOpen: this.isOpen,
      openedAt: this.openedAt,
      cooldownMs: this.cooldownMs,
      threshold: this.threshold,
    };
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

/** Module-level singleton shared by the frontier engine */
export const frontierCircuitBreaker = new FrontierCircuitBreaker();
