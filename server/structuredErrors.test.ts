/**
 * structuredErrors.test.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Unit tests for the structured error code constants and makeError() factory.
 */
import { describe, it, expect } from "vitest";
import {
  makeError,
  ERR_CLAIM_NOT_FOUND,
  ERR_RATE_LIMITED,
  ERR_DB_UNAVAILABLE,
  ERR_INVALID_INPUT,
  ERR_INGESTION_STALLED,
  ERR_VERDICT_FLIP,
  ERR_SOURCE_NOT_FOUND,
  ERR_UNAUTHORIZED,
  ERR_FORBIDDEN,
  ERR_INTERNAL,
  type StructuredError,
} from "./structuredErrors";

describe("structuredErrors — error code constants", () => {
  it("all ERR_* constants are non-empty strings", () => {
    const codes = [
      ERR_CLAIM_NOT_FOUND,
      ERR_RATE_LIMITED,
      ERR_DB_UNAVAILABLE,
      ERR_INVALID_INPUT,
      ERR_INGESTION_STALLED,
      ERR_VERDICT_FLIP,
      ERR_SOURCE_NOT_FOUND,
      ERR_UNAUTHORIZED,
      ERR_FORBIDDEN,
      ERR_INTERNAL,
    ];
    for (const code of codes) {
      expect(typeof code).toBe("string");
      expect(code.length).toBeGreaterThan(0);
      expect(code.startsWith("ERR_")).toBe(true);
    }
  });

  it("all ERR_* constants are unique", () => {
    const codes = [
      ERR_CLAIM_NOT_FOUND,
      ERR_RATE_LIMITED,
      ERR_DB_UNAVAILABLE,
      ERR_INVALID_INPUT,
      ERR_INGESTION_STALLED,
      ERR_VERDICT_FLIP,
      ERR_SOURCE_NOT_FOUND,
      ERR_UNAUTHORIZED,
      ERR_FORBIDDEN,
      ERR_INTERNAL,
    ];
    const unique = new Set(codes);
    expect(unique.size).toBe(codes.length);
  });
});

describe("structuredErrors — makeError()", () => {
  it("returns a StructuredError with code and message", () => {
    const err = makeError(ERR_CLAIM_NOT_FOUND, "Claim abc not found");
    expect(err.code).toBe(ERR_CLAIM_NOT_FOUND);
    expect(err.message).toBe("Claim abc not found");
    expect(err.details).toBeUndefined();
  });

  it("includes details when provided", () => {
    const err = makeError(ERR_RATE_LIMITED, "Too many requests", {
      retryAfter: 60,
    });
    expect(err.code).toBe(ERR_RATE_LIMITED);
    expect(err.details).toEqual({ retryAfter: 60 });
  });

  it("does NOT include details key when details is undefined", () => {
    const err = makeError(ERR_INTERNAL, "Unexpected error");
    expect(Object.prototype.hasOwnProperty.call(err, "details")).toBe(false);
  });

  it("accepts any string as code (not just ERR_* constants)", () => {
    const err = makeError("CUSTOM_CODE", "Custom message");
    expect(err.code).toBe("CUSTOM_CODE");
  });

  it("details can contain nested objects", () => {
    const err = makeError(ERR_INVALID_INPUT, "Bad input", {
      field: "email",
      constraint: { type: "format", pattern: "email" },
    });
    expect((err.details as Record<string, unknown>).field).toBe("email");
    expect((err.details as Record<string, unknown>).constraint).toEqual({
      type: "format",
      pattern: "email",
    });
  });

  it("satisfies the StructuredError interface shape", () => {
    const err: StructuredError = makeError(ERR_DB_UNAVAILABLE, "DB down");
    expect(err).toHaveProperty("code");
    expect(err).toHaveProperty("message");
  });
});
