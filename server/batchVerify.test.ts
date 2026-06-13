/**
 * batchVerify.test.ts — Phase 119
 *
 * Ralph Wiggum RED → GREEN tests for:
 *   - batchVerify() core logic
 *   - buildBatchResult() response shaping
 *   - claimTextHash() deduplication
 *   - validateBatchInput() input guards
 *   - BATCH_TOOLS_MANIFEST descriptor
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  claimTextHash,
  validateBatchInput,
  buildBatchResult,
  BATCH_TOOLS_MANIFEST,
  type BatchClaimInput,
  type BatchClaimResult,
} from "./batchVerify";

// ─── claimTextHash ────────────────────────────────────────────────────────────
describe("claimTextHash", () => {
  it("returns a 16-char hex string for any non-empty input", () => {
    const h = claimTextHash("Aspirin reduces fever");
    expect(h).toMatch(/^[0-9a-f]{16}$/);
  });

  it("is deterministic — same input → same hash", () => {
    const a = claimTextHash("COVID-19 vaccines are safe");
    const b = claimTextHash("COVID-19 vaccines are safe");
    expect(a).toBe(b);
  });

  it("is case-insensitive — normalises before hashing", () => {
    const a = claimTextHash("Aspirin Reduces Fever");
    const b = claimTextHash("aspirin reduces fever");
    expect(a).toBe(b);
  });

  it("trims whitespace before hashing", () => {
    const a = claimTextHash("  Aspirin reduces fever  ");
    const b = claimTextHash("Aspirin reduces fever");
    expect(a).toBe(b);
  });

  it("produces different hashes for different claims", () => {
    const a = claimTextHash("Aspirin reduces fever");
    const b = claimTextHash("Ibuprofen reduces fever");
    expect(a).not.toBe(b);
  });
});

// ─── validateBatchInput ───────────────────────────────────────────────────────
describe("validateBatchInput", () => {
  it("accepts a valid array of 1–20 claim strings", () => {
    const result = validateBatchInput(["Aspirin reduces fever"]);
    expect(result.valid).toBe(true);
    expect(result.normalised).toHaveLength(1);
  });

  it("accepts an array of 20 claims (max)", () => {
    const claims = Array.from({ length: 20 }, (_, i) => `Claim number ${i + 1}`);
    const result = validateBatchInput(claims);
    expect(result.valid).toBe(true);
    expect(result.normalised).toHaveLength(20);
  });

  it("rejects an empty array", () => {
    const result = validateBatchInput([]);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/at least 1/i);
  });

  it("rejects an array with more than 20 claims", () => {
    const claims = Array.from({ length: 21 }, (_, i) => `Claim ${i}`);
    const result = validateBatchInput(claims);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/at most 20/i);
  });

  it("rejects non-array input", () => {
    const result = validateBatchInput("not an array" as unknown as string[]);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/array/i);
  });

  it("rejects an array containing a non-string element", () => {
    const result = validateBatchInput(["valid claim", 42 as unknown as string]);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/string/i);
  });

  it("rejects an array containing an empty string", () => {
    const result = validateBatchInput(["valid claim", ""]);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/empty/i);
  });

  it("rejects a claim longer than 1000 characters", () => {
    const longClaim = "x".repeat(1001);
    const result = validateBatchInput([longClaim]);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/1000/);
  });

  it("deduplicates claims by normalised text (case-insensitive trim)", () => {
    const result = validateBatchInput([
      "Aspirin reduces fever",
      "  aspirin reduces fever  ",
    ]);
    expect(result.valid).toBe(true);
    expect(result.normalised).toHaveLength(1);
    expect(result.duplicatesRemoved).toBe(1);
  });
});

// ─── buildBatchResult ─────────────────────────────────────────────────────────
describe("buildBatchResult", () => {
  const makeResult = (overrides: Partial<BatchClaimResult> = {}): BatchClaimResult => ({
    claimHash: "abc123def456abcd",
    claimText: "Aspirin reduces fever",
    verdict: "supported",
    confidence: 0.82,
    summary: "Strong evidence from 3 sources",
    evidence: [],
    processedAt: "2026-01-01T00:00:00.000Z",
    error: null,
    ...overrides,
  });

  it("returns a valid batch result object with all required fields", () => {
    const results: BatchClaimResult[] = [makeResult()];
    const output = buildBatchResult(results, 100);
    expect(output.total).toBe(1);
    expect(output.succeeded).toBe(1);
    expect(output.failed).toBe(0);
    expect(output.durationMs).toBeGreaterThanOrEqual(0);
    expect(output.results).toHaveLength(1);
  });

  it("counts failed results correctly", () => {
    const results: BatchClaimResult[] = [
      makeResult(),
      makeResult({ verdict: null, confidence: null, error: "Timeout", claimText: "Claim 2", claimHash: "aaaa1111bbbb2222" }),
    ];
    const output = buildBatchResult(results, 200);
    expect(output.total).toBe(2);
    expect(output.succeeded).toBe(1);
    expect(output.failed).toBe(1);
  });

  it("includes durationMs from the provided start time", () => {
    const startMs = Date.now() - 500;
    const output = buildBatchResult([makeResult()], startMs);
    expect(output.durationMs).toBeGreaterThanOrEqual(500);
  });

  it("preserves claimHash in each result", () => {
    const results = [makeResult({ claimHash: "deadbeef12345678" })];
    const output = buildBatchResult(results, Date.now());
    expect(output.results[0].claimHash).toBe("deadbeef12345678");
  });
});

// ─── BATCH_TOOLS_MANIFEST ─────────────────────────────────────────────────────
describe("BATCH_TOOLS_MANIFEST", () => {
  it("exports exactly one tool descriptor", () => {
    expect(BATCH_TOOLS_MANIFEST).toHaveLength(1);
  });

  it("tool name is verify_claims_batch", () => {
    expect(BATCH_TOOLS_MANIFEST[0].name).toBe("verify_claims_batch");
  });

  it("inputSchema requires a claims array", () => {
    const schema = BATCH_TOOLS_MANIFEST[0].inputSchema as Record<string, unknown>;
    const props = schema["properties"] as Record<string, unknown>;
    expect(props).toHaveProperty("claims");
    const required = schema["required"] as string[];
    expect(required).toContain("claims");
  });

  it("inputSchema has optional confidence_threshold field", () => {
    const schema = BATCH_TOOLS_MANIFEST[0].inputSchema as Record<string, unknown>;
    const props = schema["properties"] as Record<string, unknown>;
    expect(props).toHaveProperty("confidence_threshold");
  });
});
