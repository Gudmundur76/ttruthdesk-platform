/**
 * verificationEventStore.ts
 *
 * In-memory ring buffer for `verification.completed` events.
 *
 * Emitted after every verdict in verifyClaimRoute.ts.
 * Consumed by /api/telemetry/summary for self-direct polling.
 *
 * Design: no DB migration required — events are ephemeral.
 * Ring buffer capped at MAX_EVENTS to prevent unbounded growth.
 */

const MAX_EVENTS = 500;

export interface VerificationCompletedEvent {
  inputId: string;
  verdict: string;
  adapter: string;
  confidence: number;
  timestamp: string;
}

export interface TelemetrySummary {
  totalVerifications: number;
  supportedCount: number;
  contradictedCount: number;
  ambiguousCount: number;
  insufficientEvidenceCount: number;
  otherCount: number;
  avgConfidence: number;
  lastVerifiedAt: string | null;
  recentEvents: VerificationCompletedEvent[];
}

class VerificationEventStore {
  private events: VerificationCompletedEvent[] = [];

  push(event: VerificationCompletedEvent): void {
    this.events.push(event);
    if (this.events.length > MAX_EVENTS) {
      this.events.shift();
    }
  }

  getSummary(windowMs = 24 * 60 * 60 * 1000): TelemetrySummary {
    const cutoff = new Date(Date.now() - windowMs).toISOString();
    const window = this.events.filter(e => e.timestamp >= cutoff);

    let supportedCount = 0;
    let contradictedCount = 0;
    let ambiguousCount = 0;
    let insufficientEvidenceCount = 0;
    let otherCount = 0;
    let confidenceSum = 0;

    for (const e of window) {
      confidenceSum += e.confidence;
      switch (e.verdict) {
        case "Supported":
        case "Partially Supported":
          supportedCount++;
          break;
        case "Contradicted":
          contradictedCount++;
          break;
        case "Ambiguous":
          ambiguousCount++;
          break;
        case "Insufficient Evidence":
          insufficientEvidenceCount++;
          break;
        default:
          otherCount++;
      }
    }

    const total = window.length;
    return {
      totalVerifications: total,
      supportedCount,
      contradictedCount,
      ambiguousCount,
      insufficientEvidenceCount,
      otherCount,
      avgConfidence: total > 0 ? confidenceSum / total : 0,
      lastVerifiedAt: total > 0 ? window[total - 1].timestamp : null,
      recentEvents: window.slice(-50),
    };
  }

  /** Expose raw events for testing. */
  getAll(): VerificationCompletedEvent[] {
    return [...this.events];
  }

  /** Reset for testing. */
  clear(): void {
    this.events = [];
  }
}

export const verificationEventStore = new VerificationEventStore();
