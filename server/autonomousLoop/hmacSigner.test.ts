/**
 * hmacSigner.test.ts — Tests for PRD-MASTER NFR-MASTER-06 HMAC signing.
 */
import { describe, it, expect } from "vitest";
import {
  signEvent,
  verifyEventSignature,
  buildSignedEnvelope,
  verifySignedEnvelope,
} from "./hmacSigner";

describe("signEvent", () => {
  it("returns a 64-char hex string", () => {
    const sig = signEvent("test payload", "secret");
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic for the same input", () => {
    const sig1 = signEvent("payload", "secret");
    const sig2 = signEvent("payload", "secret");
    expect(sig1).toBe(sig2);
  });

  it("produces different signatures for different payloads", () => {
    const sig1 = signEvent("payload1", "secret");
    const sig2 = signEvent("payload2", "secret");
    expect(sig1).not.toBe(sig2);
  });

  it("produces different signatures for different secrets", () => {
    const sig1 = signEvent("payload", "secret1");
    const sig2 = signEvent("payload", "secret2");
    expect(sig1).not.toBe(sig2);
  });
});

describe("verifyEventSignature", () => {
  it("returns true for a valid signature", () => {
    const payload = "test payload";
    const sig = signEvent(payload, "secret");
    expect(verifyEventSignature(payload, sig, "secret")).toBe(true);
  });

  it("returns false for a tampered payload", () => {
    const sig = signEvent("original", "secret");
    expect(verifyEventSignature("tampered", sig, "secret")).toBe(false);
  });

  it("returns false for a wrong secret", () => {
    const payload = "payload";
    const sig = signEvent(payload, "secret1");
    expect(verifyEventSignature(payload, sig, "secret2")).toBe(false);
  });

  it("returns false for an empty signature", () => {
    expect(verifyEventSignature("payload", "", "secret")).toBe(false);
  });

  it("returns false for a malformed signature", () => {
    expect(verifyEventSignature("payload", "not-hex!!!", "secret")).toBe(false);
  });
});

describe("buildSignedEnvelope", () => {
  it("returns an envelope with all required fields", () => {
    const env = buildSignedEnvelope("document_submitted", { id: 1 }, "corr-123");
    expect(env.eventType).toBe("document_submitted");
    expect(env.correlationId).toBe("corr-123");
    expect(env.timestamp).toBeGreaterThan(0);
    expect(env.signature).toMatch(/^[0-9a-f]{64}$/);
  });

  it("produces different signatures for different correlationIds", () => {
    const env1 = buildSignedEnvelope("evt", {}, "corr-1");
    const env2 = buildSignedEnvelope("evt", {}, "corr-2");
    expect(env1.signature).not.toBe(env2.signature);
  });
});

describe("verifySignedEnvelope", () => {
  it("returns true for a freshly built envelope", () => {
    const env = buildSignedEnvelope("document_submitted", { id: 1 }, "corr-123");
    expect(verifySignedEnvelope(env)).toBe(true);
  });

  it("returns false when the payload is tampered", () => {
    const env = buildSignedEnvelope("document_submitted", { id: 1 }, "corr-123");
    const tampered = { ...env, payload: { id: 999 } };
    expect(verifySignedEnvelope(tampered)).toBe(false);
  });

  it("returns false when the signature is tampered", () => {
    const env = buildSignedEnvelope("document_submitted", { id: 1 }, "corr-123");
    const tampered = { ...env, signature: "a".repeat(64) };
    expect(verifySignedEnvelope(tampered)).toBe(false);
  });
});
