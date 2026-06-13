/**
 * logger.test.ts
 * Tests for the structured logger (server/logger.ts)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { logger, errData } from "./logger";

describe("logger factory", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let stdoutSpy: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let stderrSpy: any;

  beforeEach(() => {
    stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("creates a logger with all four methods", () => {
    const log = logger("test");
    expect(typeof log.debug).toBe("function");
    expect(typeof log.info).toBe("function");
    expect(typeof log.warn).toBe("function");
    expect(typeof log.error).toBe("function");
  });

  it("writes info to stdout", () => {
    const log = logger("test-component");
    log.info("hello world");
    expect(stdoutSpy).toHaveBeenCalled();
    const written = String(stdoutSpy.mock.calls[0]?.[0] ?? "");
    expect(written).toContain("hello world");
  });

  it("writes error to stderr", () => {
    const log = logger("test-component");
    log.error("something broke");
    expect(stderrSpy).toHaveBeenCalled();
    const written = String(stderrSpy.mock.calls[0]?.[0] ?? "");
    expect(written).toContain("something broke");
  });

  it("includes component name in output", () => {
    const log = logger("analysisPipeline");
    log.info("pipeline started");
    const written = String(stdoutSpy.mock.calls[0]?.[0] ?? "");
    expect(written).toContain("analysisPipeline");
  });

  it("includes structured data when provided", () => {
    const log = logger("test");
    log.warn("evidence failed", { sourceId: "pubmed", claimId: "abc123" });
    const written = String(stdoutSpy.mock.calls[0]?.[0] ?? "");
    expect(written).toContain("pubmed");
    expect(written).toContain("abc123");
  });

  it("does not throw when data is undefined", () => {
    const log = logger("test");
    expect(() => log.info("no data")).not.toThrow();
  });

  it("different components produce independent loggers", () => {
    const logA = logger("componentA");
    const logB = logger("componentB");
    logA.info("from A");
    logB.info("from B");
    const writtenA = String(stdoutSpy.mock.calls[0]?.[0] ?? "");
    const writtenB = String(stdoutSpy.mock.calls[1]?.[0] ?? "");
    expect(writtenA).toContain("componentA");
    expect(writtenB).toContain("componentB");
  });
});

describe("errData helper", () => {
  it("extracts message from Error instance", () => {
    const err = new Error("something failed");
    const data = errData(err);
    expect(data.err).toBe("something failed");
  });

  it("includes truncated stack trace", () => {
    const err = new Error("with stack");
    const data = errData(err);
    expect(typeof data.stack).toBe("string");
  });

  it("handles string errors", () => {
    const data = errData("plain string error");
    expect(data.err).toBe("plain string error");
  });

  it("handles unknown thrown values", () => {
    const data = errData(42);
    expect(data.err).toBe("42");
  });

  it("handles null gracefully", () => {
    const data = errData(null);
    expect(data.err).toBe("null");
  });
});
