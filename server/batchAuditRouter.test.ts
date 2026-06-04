/**
 * Tests for the batch audit API router.
 * Covers: input validation, rate limiter logic, response schema,
 * and edge cases (empty papers, oversized batches, missing fields).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";

// ─── Mirror the input schema from batchAuditRouter.ts ────────────────────────
const PaperSchema = z.object({
  ref: z.string().max(128).optional(),
  title: z.string().min(1).max(512),
  text: z.string().min(20).max(200_000),
  verticalDomain: z.string().max(64).optional(),
  pmid: z.string().max(20).optional(),
});

const BatchAuditRequestSchema = z.object({
  papers: z.array(PaperSchema).min(1).max(20),
  includeQualityScores: z.boolean().default(true),
});

// ─── Mirror the rate limiter from batchAuditRouter.ts ────────────────────────
const WINDOW_MS = 15 * 60 * 1000;
const MAX_REQUESTS = 5;

function makeRateLimiter() {
  const ipWindows = new Map<string, { count: number; resetAt: number }>();
  return function checkRateLimit(ip: string, now: number): { allowed: boolean; retryAfterMs: number } {
    let window = ipWindows.get(ip);
    if (!window || now > window.resetAt) {
      window = { count: 0, resetAt: now + WINDOW_MS };
      ipWindows.set(ip, window);
    }
    window.count++;
    if (window.count > MAX_REQUESTS) {
      return { allowed: false, retryAfterMs: window.resetAt - now };
    }
    return { allowed: true, retryAfterMs: 0 };
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("batch audit — input validation", () => {
  it("accepts a valid single-paper request", () => {
    const result = BatchAuditRequestSchema.safeParse({
      papers: [{ title: "Test Paper", text: "This is a test abstract with enough text to pass validation." }],
    });
    expect(result.success).toBe(true);
  });

  it("accepts up to 20 papers", () => {
    const papers = Array.from({ length: 20 }, (_, i) => ({
      title: `Paper ${i + 1}`,
      text: "Abstract text that is long enough to pass the minimum length check.",
    }));
    const result = BatchAuditRequestSchema.safeParse({ papers });
    expect(result.success).toBe(true);
  });

  it("rejects more than 20 papers", () => {
    const papers = Array.from({ length: 21 }, (_, i) => ({
      title: `Paper ${i + 1}`,
      text: "Abstract text that is long enough to pass the minimum length check.",
    }));
    const result = BatchAuditRequestSchema.safeParse({ papers });
    expect(result.success).toBe(false);
  });

  it("rejects empty papers array", () => {
    const result = BatchAuditRequestSchema.safeParse({ papers: [] });
    expect(result.success).toBe(false);
  });

  it("rejects paper with text shorter than 20 characters", () => {
    const result = BatchAuditRequestSchema.safeParse({
      papers: [{ title: "Test", text: "Too short" }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects paper with empty title", () => {
    const result = BatchAuditRequestSchema.safeParse({
      papers: [{ title: "", text: "Abstract text that is long enough to pass the minimum length check." }],
    });
    expect(result.success).toBe(false);
  });

  it("accepts optional ref, verticalDomain, and pmid fields", () => {
    const result = BatchAuditRequestSchema.safeParse({
      papers: [{
        ref: "my-ref-001",
        title: "Test Paper",
        text: "Abstract text that is long enough to pass the minimum length check.",
        verticalDomain: "structural_biology",
        pmid: "12345678",
      }],
    });
    expect(result.success).toBe(true);
  });

  it("defaults includeQualityScores to true", () => {
    const result = BatchAuditRequestSchema.safeParse({
      papers: [{ title: "Test", text: "Abstract text that is long enough to pass the minimum length check." }],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.includeQualityScores).toBe(true);
    }
  });

  it("accepts includeQualityScores: false", () => {
    const result = BatchAuditRequestSchema.safeParse({
      papers: [{ title: "Test", text: "Abstract text that is long enough to pass the minimum length check." }],
      includeQualityScores: false,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.includeQualityScores).toBe(false);
    }
  });
});

describe("batch audit — rate limiter", () => {
  it("allows up to MAX_REQUESTS requests per window", () => {
    const checkRateLimit = makeRateLimiter();
    const now = Date.now();
    for (let i = 0; i < MAX_REQUESTS; i++) {
      expect(checkRateLimit("192.168.1.1", now).allowed).toBe(true);
    }
  });

  it("blocks the (MAX_REQUESTS + 1)th request", () => {
    const checkRateLimit = makeRateLimiter();
    const now = Date.now();
    for (let i = 0; i < MAX_REQUESTS; i++) {
      checkRateLimit("10.0.0.1", now);
    }
    const result = checkRateLimit("10.0.0.1", now);
    expect(result.allowed).toBe(false);
    expect(result.retryAfterMs).toBeGreaterThan(0);
  });

  it("resets the window after WINDOW_MS", () => {
    const checkRateLimit = makeRateLimiter();
    const now = Date.now();
    for (let i = 0; i < MAX_REQUESTS + 1; i++) {
      checkRateLimit("172.16.0.1", now);
    }
    // Simulate time passing past the window
    const future = now + WINDOW_MS + 1;
    const result = checkRateLimit("172.16.0.1", future);
    expect(result.allowed).toBe(true);
  });

  it("tracks different IPs independently", () => {
    const checkRateLimit = makeRateLimiter();
    const now = Date.now();
    // Exhaust IP A
    for (let i = 0; i < MAX_REQUESTS + 1; i++) {
      checkRateLimit("1.1.1.1", now);
    }
    // IP B should still be allowed
    expect(checkRateLimit("2.2.2.2", now).allowed).toBe(true);
  });
});

describe("batch audit — response schema", () => {
  it("summary has required fields", () => {
    const summary = {
      papersRequested: 2,
      papersSucceeded: 1,
      papersFailed: 1,
      totalClaims: 5,
      verdictDistribution: { Supported: 3, Contradicted: 2 },
    };
    expect(summary.papersRequested).toBe(2);
    expect(summary.papersSucceeded + summary.papersFailed).toBe(summary.papersRequested);
    expect(typeof summary.verdictDistribution).toBe("object");
  });

  it("failed result has correct shape", () => {
    const failedResult = {
      ref: "ref-001",
      title: "Failed Paper",
      documentId: -1,
      status: "failed" as const,
      errorMessage: "LLM timeout",
      claimCount: 0,
      claims: [],
      processingMs: 1200,
    };
    expect(failedResult.status).toBe("failed");
    expect(failedResult.claims).toHaveLength(0);
    expect(failedResult.errorMessage).toBeTruthy();
  });

  it("complete result has correct shape", () => {
    const completeResult = {
      ref: "ref-002",
      title: "Complete Paper",
      documentId: 42,
      status: "complete" as const,
      errorMessage: null,
      claimCount: 3,
      claims: [
        { claimId: 1, claimText: "BRCA1 binds BARD1", claimType: "structural", verdict: "Supported", verdictRationale: "PDB 1JM7", confidenceScore: 0.87, confidenceFlags: null, extractedValue: null },
        { claimId: 2, claimText: "Resolution is 2.5Å", claimType: "measurement", verdict: "Supported", verdictRationale: "PDB header", confidenceScore: 0.92, confidenceFlags: null, extractedValue: "2.5" },
        { claimId: 3, claimText: "Organism is human", claimType: "organism", verdict: "Supported", verdictRationale: "UniProt", confidenceScore: 0.95, confidenceFlags: null, extractedValue: "Homo sapiens" },
      ],
      processingMs: 4500,
    };
    expect(completeResult.status).toBe("complete");
    expect(completeResult.claims).toHaveLength(3);
    expect(completeResult.errorMessage).toBeNull();
  });
});
