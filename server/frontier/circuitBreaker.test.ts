/**
 * circuitBreaker.test.ts — Unit tests for FrontierCircuitBreaker
 * Covers FR-L3-19, Section 9.3
 */
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { FrontierCircuitBreaker } from "./circuitBreaker";

describe("FrontierCircuitBreaker", () => {
  let cb: FrontierCircuitBreaker;

  beforeEach(() => {
    cb = new FrontierCircuitBreaker(300_000); // 5 min cooldown
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── Initial state ───────────────────────────────────────────────────────────

  it("starts closed with zero failures", () => {
    expect(cb.isOpen).toBe(false);
    expect(cb.consecutiveFailures).toBe(0);
    expect(cb.openedAt).toBeNull();
  });

  it("shouldSkip returns false when circuit is closed", () => {
    expect(cb.shouldSkip()).toBe(false);
  });

  // ── recordFailure ───────────────────────────────────────────────────────────

  it("increments consecutiveFailures on each failure", () => {
    cb.recordFailure();
    expect(cb.consecutiveFailures).toBe(1);
    cb.recordFailure();
    expect(cb.consecutiveFailures).toBe(2);
  });

  it("does not open circuit before 3 consecutive failures", () => {
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.isOpen).toBe(false);
    expect(cb.shouldSkip()).toBe(false);
  });

  it("opens circuit at exactly 3 consecutive failures (FR-L3-19)", () => {
    cb.recordFailure();
    cb.recordFailure();
    const opened = cb.recordFailure();
    expect(opened).toBe(true);
    expect(cb.isOpen).toBe(true);
    expect(cb.openedAt).not.toBeNull();
  });

  it("returns false from recordFailure for first two failures", () => {
    expect(cb.recordFailure()).toBe(false);
    expect(cb.recordFailure()).toBe(false);
  });

  it("shouldSkip returns true after circuit opens", () => {
    cb.recordFailure();
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.shouldSkip()).toBe(true);
  });

  it("continues incrementing failures after circuit opens", () => {
    cb.recordFailure();
    cb.recordFailure();
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.consecutiveFailures).toBe(4);
    expect(cb.isOpen).toBe(true);
  });

  // ── recordSuccess ───────────────────────────────────────────────────────────

  it("recordSuccess resets consecutiveFailures to 0", () => {
    cb.recordFailure();
    cb.recordFailure();
    cb.recordSuccess();
    expect(cb.consecutiveFailures).toBe(0);
  });

  it("recordSuccess closes the circuit", () => {
    cb.recordFailure();
    cb.recordFailure();
    cb.recordFailure();
    cb.recordSuccess();
    expect(cb.isOpen).toBe(false);
    expect(cb.openedAt).toBeNull();
  });

  it("shouldSkip returns false after recordSuccess", () => {
    cb.recordFailure();
    cb.recordFailure();
    cb.recordFailure();
    cb.recordSuccess();
    expect(cb.shouldSkip()).toBe(false);
  });

  it("failures after success restart the counter from 0", () => {
    cb.recordFailure();
    cb.recordFailure();
    cb.recordSuccess();
    cb.recordFailure();
    expect(cb.consecutiveFailures).toBe(1);
    expect(cb.isOpen).toBe(false);
  });

  // ── cooldown expiry ─────────────────────────────────────────────────────────

  it("shouldSkip returns false after cooldown expires", () => {
    vi.useFakeTimers();
    const shortCb = new FrontierCircuitBreaker(1000); // 1 second cooldown
    shortCb.recordFailure();
    shortCb.recordFailure();
    shortCb.recordFailure();
    expect(shortCb.shouldSkip()).toBe(true);

    // Advance time past cooldown
    vi.advanceTimersByTime(1001);
    expect(shortCb.shouldSkip()).toBe(false);
    expect(shortCb.isOpen).toBe(false);
    expect(shortCb.consecutiveFailures).toBe(0);
  });

  it("circuit remains open within cooldown window", () => {
    vi.useFakeTimers();
    const shortCb = new FrontierCircuitBreaker(5000);
    shortCb.recordFailure();
    shortCb.recordFailure();
    shortCb.recordFailure();

    vi.advanceTimersByTime(4999); // just before cooldown
    expect(shortCb.shouldSkip()).toBe(true);
  });

  // ── getState ────────────────────────────────────────────────────────────────

  it("getState returns correct snapshot when closed", () => {
    const state = cb.getState();
    expect(state.isOpen).toBe(false);
    expect(state.consecutiveFailures).toBe(0);
    expect(state.openedAt).toBeNull();
    expect(state.cooldownMs).toBe(300_000);
  });

  it("getState returns correct snapshot when open", () => {
    cb.recordFailure();
    cb.recordFailure();
    cb.recordFailure();
    const state = cb.getState();
    expect(state.isOpen).toBe(true);
    expect(state.consecutiveFailures).toBe(3);
    expect(state.openedAt).toBeInstanceOf(Date);
  });

  // ── custom cooldown ─────────────────────────────────────────────────────────

  it("respects custom cooldownMs in constructor", () => {
    const customCb = new FrontierCircuitBreaker(60_000);
    expect(customCb.cooldownMs).toBe(60_000);
  });
});
