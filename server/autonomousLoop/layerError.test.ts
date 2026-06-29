/**
 * layerError.test.ts
 * Unit tests for autonomousLoop/layerError.ts
 *
 * PRD-MASTER: LayerError typed error class with propagation support
 */
import { describe, it, expect } from "vitest";
import { LayerError } from "./layerError";

// ─── Constructor ──────────────────────────────────────────────────────────────

describe("LayerError constructor", () => {
  it("creates an instance with the given message", () => {
    const err = new LayerError("something went wrong");
    expect(err.message).toBe("something went wrong");
  });

  it("sets name to LayerError", () => {
    const err = new LayerError("test");
    expect(err.name).toBe("LayerError");
  });

  it("defaults severity to 'error'", () => {
    const err = new LayerError("test");
    expect(err.severity).toBe("error");
  });

  it("accepts 'warning' severity", () => {
    const err = new LayerError("test", { severity: "warning" });
    expect(err.severity).toBe("warning");
  });

  it("accepts 'fatal' severity", () => {
    const err = new LayerError("test", { severity: "fatal" });
    expect(err.severity).toBe("fatal");
  });

  it("stores context fields", () => {
    const err = new LayerError("test", {
      context: { correlationId: "corr-123", layerId: "L1", documentId: 42 },
    });
    expect(err.context.correlationId).toBe("corr-123");
    expect(err.context.layerId).toBe("L1");
    expect(err.context.documentId).toBe(42);
  });

  it("defaults context to empty object when not provided", () => {
    const err = new LayerError("test");
    expect(err.context).toEqual({});
  });

  it("stores cause when it is an Error instance", () => {
    const cause = new Error("root cause");
    const err = new LayerError("wrapper", { cause });
    expect(err.cause).toBe(cause);
  });

  it("sets cause to undefined when cause is not an Error", () => {
    const err = new LayerError("wrapper", { cause: "string cause" });
    expect(err.cause).toBeUndefined();
  });

  it("sets cause to undefined when no cause is provided", () => {
    const err = new LayerError("test");
    expect(err.cause).toBeUndefined();
  });

  it("records a timestamp close to now", () => {
    const before = Date.now();
    const err = new LayerError("test");
    const after = Date.now();
    expect(err.timestamp).toBeGreaterThanOrEqual(before);
    expect(err.timestamp).toBeLessThanOrEqual(after);
  });

  it("is an instance of Error", () => {
    const err = new LayerError("test");
    expect(err).toBeInstanceOf(Error);
  });

  it("is an instance of LayerError", () => {
    const err = new LayerError("test");
    expect(err).toBeInstanceOf(LayerError);
  });
});

// ─── isFatal() ────────────────────────────────────────────────────────────────

describe("LayerError.isFatal()", () => {
  it("returns true for fatal severity", () => {
    expect(new LayerError("test", { severity: "fatal" }).isFatal()).toBe(true);
  });

  it("returns false for error severity", () => {
    expect(new LayerError("test", { severity: "error" }).isFatal()).toBe(false);
  });

  it("returns false for warning severity", () => {
    expect(new LayerError("test", { severity: "warning" }).isFatal()).toBe(false);
  });
});

// ─── isRecoverable() ─────────────────────────────────────────────────────────

describe("LayerError.isRecoverable()", () => {
  it("returns true for warning severity", () => {
    expect(new LayerError("test", { severity: "warning" }).isRecoverable()).toBe(true);
  });

  it("returns true for error severity", () => {
    expect(new LayerError("test", { severity: "error" }).isRecoverable()).toBe(true);
  });

  it("returns false for fatal severity", () => {
    expect(new LayerError("test", { severity: "fatal" }).isRecoverable()).toBe(false);
  });
});

// ─── toJSON() ─────────────────────────────────────────────────────────────────

describe("LayerError.toJSON()", () => {
  it("includes all expected fields", () => {
    const cause = new Error("root");
    const err = new LayerError("wrapper", {
      severity: "fatal",
      context: { layerId: "L3" },
      cause,
    });
    const json = err.toJSON();
    expect(json.name).toBe("LayerError");
    expect(json.message).toBe("wrapper");
    expect(json.severity).toBe("fatal");
    expect((json.context as Record<string, unknown>).layerId).toBe("L3");
    expect(json.cause).toBe("root");
    expect(typeof json.timestamp).toBe("number");
    expect(typeof json.stack).toBe("string");
  });

  it("sets cause to undefined when no cause was provided", () => {
    const err = new LayerError("test");
    const json = err.toJSON();
    expect(json.cause).toBeUndefined();
  });
});

// ─── LayerError.wrap() ────────────────────────────────────────────────────────

describe("LayerError.wrap()", () => {
  it("returns the same LayerError instance when passed a LayerError", () => {
    const original = new LayerError("original");
    const wrapped = LayerError.wrap(original);
    expect(wrapped).toBe(original);
  });

  it("wraps a plain Error", () => {
    const plain = new Error("plain error");
    const wrapped = LayerError.wrap(plain, { layerId: "L2" });
    expect(wrapped).toBeInstanceOf(LayerError);
    expect(wrapped.message).toBe("plain error");
    expect(wrapped.cause).toBe(plain);
    expect(wrapped.context.layerId).toBe("L2");
  });

  it("wraps a string thrown value", () => {
    const wrapped = LayerError.wrap("string error");
    expect(wrapped).toBeInstanceOf(LayerError);
    expect(wrapped.message).toBe("string error");
    expect(wrapped.cause).toBeUndefined();
  });

  it("applies the provided severity override", () => {
    const wrapped = LayerError.wrap(new Error("test"), {}, "fatal");
    expect(wrapped.severity).toBe("fatal");
  });

  it("defaults severity to 'error' when not provided", () => {
    const wrapped = LayerError.wrap(new Error("test"));
    expect(wrapped.severity).toBe("error");
  });

  it("merges context fields from wrap call", () => {
    const wrapped = LayerError.wrap(new Error("test"), {
      correlationId: "corr-abc",
      eventType: "verdict_complete",
    });
    expect(wrapped.context.correlationId).toBe("corr-abc");
    expect(wrapped.context.eventType).toBe("verdict_complete");
  });
});
