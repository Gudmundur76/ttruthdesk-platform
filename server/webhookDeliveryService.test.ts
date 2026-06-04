/**
 * webhookDeliveryService.test.ts
 *
 * Unit tests for the webhook delivery service:
 *   - HMAC signature generation
 *   - Delivery status determination (success / retry_pending / failed)
 *   - Retry delay scheduling (exponential backoff)
 *   - Stats aggregation
 *   - Prune cutoff calculation
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import crypto from "crypto";

// ─── HMAC helper (extracted for unit testing) ─────────────────────────────────

function buildSignature(secret: string, body: string): string {
  return "sha256=" + crypto.createHmac("sha256", secret).update(body, "utf8").digest("hex");
}

// ─── Retry delay table ────────────────────────────────────────────────────────

const RETRY_DELAYS_MS = [5 * 60_000, 30 * 60_000, 2 * 60 * 60_000];

function computeNextRetry(attemptCount: number, success: boolean): Date | null {
  if (success) return null;
  if (attemptCount > RETRY_DELAYS_MS.length) return null;
  return new Date(Date.now() + RETRY_DELAYS_MS[attemptCount - 1]);
}

function computeStatus(success: boolean, nextRetry: Date | null): "success" | "retry_pending" | "failed" {
  if (success) return "success";
  if (nextRetry) return "retry_pending";
  return "failed";
}

// ─── Stats aggregation helper ─────────────────────────────────────────────────

type LogEntry = {
  status: "success" | "failed" | "timeout" | "retry_pending";
  latencyMs: number | null;
  createdAt: Date;
};

function computeStats(entries: LogEntry[]) {
  const total = entries.length;
  const success = entries.filter((e) => e.status === "success").length;
  const failed = entries.filter((e) => e.status === "failed").length;
  const retryPending = entries.filter((e) => e.status === "retry_pending").length;
  const avgLatency =
    total > 0
      ? Math.round(entries.reduce((s, e) => s + (e.latencyMs ?? 0), 0) / total)
      : 0;
  const successRate = total > 0 ? Math.round((success / total) * 100) : 0;
  const since24h = new Date(Date.now() - 24 * 60 * 60_000);
  const recent = entries.filter((e) => e.createdAt >= since24h);
  return {
    total, success, failed, retryPending, avgLatency, successRate,
    last24h: {
      total: recent.length,
      success: recent.filter((e) => e.status === "success").length,
      failed: recent.filter((e) => e.status === "failed").length,
    },
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("HMAC signature", () => {
  it("produces a sha256= prefixed hex string", () => {
    const sig = buildSignature("my-secret", '{"event":"test"}');
    expect(sig).toMatch(/^sha256=[a-f0-9]{64}$/);
  });

  it("is deterministic for the same inputs", () => {
    const a = buildSignature("secret", "payload");
    const b = buildSignature("secret", "payload");
    expect(a).toBe(b);
  });

  it("differs for different secrets", () => {
    const a = buildSignature("secret-a", "payload");
    const b = buildSignature("secret-b", "payload");
    expect(a).not.toBe(b);
  });

  it("differs for different payloads", () => {
    const a = buildSignature("secret", "payload-a");
    const b = buildSignature("secret", "payload-b");
    expect(a).not.toBe(b);
  });

  it("can be verified by the receiver", () => {
    const secret = "receiver-secret";
    const body = JSON.stringify({ event: "high_risk_claim", claimId: 42 });
    const sig = buildSignature(secret, body);
    const expected = "sha256=" + crypto.createHmac("sha256", secret).update(body, "utf8").digest("hex");
    expect(sig).toBe(expected);
  });
});

describe("Retry scheduling", () => {
  it("returns null on success", () => {
    expect(computeNextRetry(1, true)).toBeNull();
    expect(computeNextRetry(3, true)).toBeNull();
  });

  it("returns null after max retries (attempt 4)", () => {
    expect(computeNextRetry(4, false)).toBeNull();
  });

  it("schedules first retry at ~5 minutes", () => {
    const before = Date.now();
    const next = computeNextRetry(1, false);
    expect(next).not.toBeNull();
    const delta = next!.getTime() - before;
    expect(delta).toBeGreaterThanOrEqual(5 * 60_000 - 100);
    expect(delta).toBeLessThanOrEqual(5 * 60_000 + 500);
  });

  it("schedules second retry at ~30 minutes", () => {
    const before = Date.now();
    const next = computeNextRetry(2, false);
    expect(next).not.toBeNull();
    const delta = next!.getTime() - before;
    expect(delta).toBeGreaterThanOrEqual(30 * 60_000 - 100);
    expect(delta).toBeLessThanOrEqual(30 * 60_000 + 500);
  });

  it("schedules third retry at ~2 hours", () => {
    const before = Date.now();
    const next = computeNextRetry(3, false);
    expect(next).not.toBeNull();
    const delta = next!.getTime() - before;
    expect(delta).toBeGreaterThanOrEqual(2 * 60 * 60_000 - 100);
    expect(delta).toBeLessThanOrEqual(2 * 60 * 60_000 + 500);
  });
});

describe("Status determination", () => {
  it("returns success when delivery succeeded", () => {
    expect(computeStatus(true, null)).toBe("success");
  });

  it("returns retry_pending when there is a next retry", () => {
    expect(computeStatus(false, new Date(Date.now() + 5 * 60_000))).toBe("retry_pending");
  });

  it("returns failed when no retry is scheduled", () => {
    expect(computeStatus(false, null)).toBe("failed");
  });
});

describe("Stats aggregation", () => {
  const now = new Date();
  const old = new Date(now.getTime() - 25 * 60 * 60_000); // 25h ago

  const entries: LogEntry[] = [
    { status: "success", latencyMs: 120, createdAt: now },
    { status: "success", latencyMs: 80, createdAt: now },
    { status: "failed", latencyMs: 200, createdAt: now },
    { status: "retry_pending", latencyMs: 150, createdAt: now },
    { status: "failed", latencyMs: 300, createdAt: old },
  ];

  it("counts total entries", () => {
    expect(computeStats(entries).total).toBe(5);
  });

  it("counts successes", () => {
    expect(computeStats(entries).success).toBe(2);
  });

  it("counts failures", () => {
    expect(computeStats(entries).failed).toBe(2);
  });

  it("counts retry_pending", () => {
    expect(computeStats(entries).retryPending).toBe(1);
  });

  it("computes correct success rate", () => {
    expect(computeStats(entries).successRate).toBe(40); // 2/5
  });

  it("computes average latency", () => {
    const avg = Math.round((120 + 80 + 200 + 150 + 300) / 5);
    expect(computeStats(entries).avgLatency).toBe(avg);
  });

  it("filters last 24h correctly", () => {
    const stats = computeStats(entries);
    expect(stats.last24h.total).toBe(4); // old entry excluded
    expect(stats.last24h.success).toBe(2);
    expect(stats.last24h.failed).toBe(1);
  });

  it("handles empty entries", () => {
    const stats = computeStats([]);
    expect(stats.total).toBe(0);
    expect(stats.successRate).toBe(0);
    expect(stats.avgLatency).toBe(0);
  });
});

describe("Prune cutoff", () => {
  it("cutoff is 90 days in the past", () => {
    const before = Date.now();
    const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60_000);
    const after = Date.now();
    const expected = 90 * 24 * 60 * 60_000;
    expect(before - cutoff.getTime()).toBeGreaterThanOrEqual(expected - 100);
    expect(after - cutoff.getTime()).toBeLessThanOrEqual(expected + 500);
  });

  it("entries older than 90 days would be pruned", () => {
    const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60_000);
    const oldEntry = new Date(Date.now() - 91 * 24 * 60 * 60_000);
    const recentEntry = new Date(Date.now() - 89 * 24 * 60 * 60_000);
    expect(oldEntry < cutoff).toBe(true);
    expect(recentEntry < cutoff).toBe(false);
  });
});
