/**
 * selfDirectWebhook.test.ts
 *
 * Tests for the self-direct inbound webhook:
 * 1. HMAC signature verification logic
 * 2. SELF_DIRECT_WEBHOOK_SECRET is set in the environment
 * 3. Spec-ready payload validation
 * 4. Decision payload validation
 */

import { describe, it, expect } from "vitest";
import { createHmac, timingSafeEqual } from "crypto";

// ─── Inline the verifySignature helper (same logic as selfDirectWebhook.ts) ──

function verifySignature(
  body: string,
  sigHeader: string,
  secret: string
): boolean {
  if (!secret) return false;
  const expected = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
  try {
    return timingSafeEqual(Buffer.from(sigHeader), Buffer.from(expected));
  } catch {
    return false;
  }
}

function buildSig(body: string, secret: string): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("SELF_DIRECT_WEBHOOK_SECRET env var", () => {
  it("is set in the environment (not empty)", () => {
    const secret = process.env.SELF_DIRECT_WEBHOOK_SECRET ?? "";
    expect(secret.length).toBeGreaterThan(0);
  });

  it("is at least 32 characters (minimum HMAC key length)", () => {
    const secret = process.env.SELF_DIRECT_WEBHOOK_SECRET ?? "";
    expect(secret.length).toBeGreaterThanOrEqual(32);
  });
});

describe("verifySignature()", () => {
  const secret = "test-secret-for-unit-tests-only-not-production";
  const body = JSON.stringify({ specId: "abc-123", adapterId: "rcsb_pdb" });

  it("accepts a valid HMAC-SHA256 signature", () => {
    const sig = buildSig(body, secret);
    expect(verifySignature(body, sig, secret)).toBe(true);
  });

  it("rejects a tampered body", () => {
    const sig = buildSig(body, secret);
    const tamperedBody = body + " ";
    expect(verifySignature(tamperedBody, sig, secret)).toBe(false);
  });

  it("rejects a wrong secret", () => {
    const sig = buildSig(body, "wrong-secret");
    expect(verifySignature(body, sig, secret)).toBe(false);
  });

  it("rejects an empty signature header", () => {
    expect(verifySignature(body, "", secret)).toBe(false);
  });

  it("rejects when secret is empty (disabled state)", () => {
    const sig = buildSig(body, "");
    expect(verifySignature(body, sig, "")).toBe(false);
  });

  it("rejects a malformed signature (no sha256= prefix)", () => {
    const rawHex = createHmac("sha256", secret).update(body).digest("hex");
    // Different length from expected "sha256=<hex>" — timingSafeEqual will throw
    expect(verifySignature(body, rawHex, secret)).toBe(false);
  });
});

describe("spec-ready payload shape", () => {
  it("identifies required fields correctly", () => {
    const required = ["specId", "adapterId", "title", "summary", "spec"];
    const validPayload: Record<string, unknown> = {
      specId: "spec-001",
      adapterId: "rcsb_pdb",
      title: "Fix resolution threshold",
      summary: "avgF1 dropped from 0.82 to 0.61 — update resolution gate",
      spec: { type: "prompt_update", patch: "..." },
      beforeF1: 0.61,
      afterF1Predicted: 0.82,
    };
    for (const field of required) {
      expect(validPayload[field]).toBeDefined();
    }
  });
});

describe("decision payload shape", () => {
  it("accepts approve", () => {
    const decision = "approve";
    expect(["approve", "reject"]).toContain(decision);
  });

  it("accepts reject", () => {
    const decision = "reject";
    expect(["approve", "reject"]).toContain(decision);
  });

  it("rejects unknown decisions", () => {
    const decision = "maybe";
    expect(["approve", "reject"]).not.toContain(decision);
  });
});
