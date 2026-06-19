/**
 * convergenceGate.test.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Unit tests for selfPrompt/convergenceGate.ts — applyConvergenceGate()
 *
 * T059 coverage:
 *   - FR-L2-19: Convergence declared only when LLM returns converged:true AND gate validates
 *   - FR-L2-20: Block convergence if fewer than 2 L2 cycles in last 24 hours
 *   - FR-L2-21: Block convergence if critical-severity open alerts from L4
 *   - FR-L2-22: Block convergence if frontier gaps older than 30 days with no active directive
 *   - FR-L2-23: Force convergence after MAX_CYCLES_PER_TRIGGER (10)
 *   - Gate never forces convergence when LLM says no
 *   - DB unavailable defaults (fail-safe)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  mockGetDb: vi.fn(),
}));

vi.mock("../db", () => ({ getDb: mocks.mockGetDb }));
vi.mock("../logger", () => {
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return { logger: () => log, errData: (e: unknown) => e };
});

import {
  applyConvergenceGate,
  MAX_CYCLES_PER_TRIGGER,
  type ConvergenceGateInput,
  type ConvergenceGateResult,
} from "./convergenceGate";

function makeInput(
  overrides: Partial<ConvergenceGateInput> = {}
): ConvergenceGateInput {
  return {
    llmConverged: true,
    cycleCount: 3,
    openCriticalAlerts: 0,
    staleGapsWithNoDirective: 0,
    ...overrides,
  };
}

/** Build a DB mock that returns `cnt` for all count queries */
function makeDb(cnt = 5) {
  const chain = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    then: (resolve: (v: unknown) => void) => resolve([{ cnt }]),
  };
  return { select: vi.fn().mockReturnValue(chain), then: undefined };
}

describe("applyConvergenceGate() — T059", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: DB available with enough cycles (5 > MIN_CYCLES_24H=2)
    mocks.mockGetDb.mockResolvedValue(makeDb(5));
  });

  // ─── FR-L2-23: Max cycles force convergence ───────────────────────────────
  it("FR-L2-23: forces convergence when cycleCount >= MAX_CYCLES_PER_TRIGGER", async () => {
    const result = await applyConvergenceGate(
      makeInput({ cycleCount: MAX_CYCLES_PER_TRIGGER })
    );
    expect(result.converged).toBe(true);
    expect(result.reason).toContain("max_cycles_reached");
  });

  it("FR-L2-23: MAX_CYCLES_PER_TRIGGER is 10", () => {
    expect(MAX_CYCLES_PER_TRIGGER).toBe(10);
  });

  it("FR-L2-23: forces convergence even when LLM did not converge (cycleCount >= max)", async () => {
    const result = await applyConvergenceGate(
      makeInput({ cycleCount: 10, llmConverged: false })
    );
    expect(result.converged).toBe(true);
    expect(result.overridden).toBe(true);
  });

  it("FR-L2-23: does NOT force convergence when cycleCount < MAX_CYCLES_PER_TRIGGER", async () => {
    const result = await applyConvergenceGate(makeInput({ cycleCount: 9 }));
    // Should not be forced by cycle count; converge depends on other constraints
    expect(result.reason).not.toContain("max_cycles_reached");
  });

  // ─── FR-L2-19: LLM not converged → gate cannot force convergence ─────────
  it("FR-L2-19: returns converged: false when LLM did not converge (below max cycles)", async () => {
    const result = await applyConvergenceGate(
      makeInput({ llmConverged: false, cycleCount: 3 })
    );
    expect(result.converged).toBe(false);
    expect(result.reason).toBe("llm_not_converged");
    expect(result.overridden).toBe(false);
  });

  // ─── FR-L2-20: Minimum activity check ────────────────────────────────────
  it("FR-L2-20: blocks convergence when fewer than 2 L2 cycles in last 24h", async () => {
    // DB returns only 1 cycle (below MIN_CYCLES_24H=2)
    mocks.mockGetDb.mockResolvedValue(makeDb(1));
    const result = await applyConvergenceGate(
      makeInput({ llmConverged: true })
    );
    expect(result.converged).toBe(false);
    expect(result.reason).toContain("insufficient_recent_cycles");
    expect(result.overridden).toBe(true);
  });

  it("FR-L2-20: allows convergence when exactly 2 cycles in last 24h", async () => {
    mocks.mockGetDb.mockResolvedValue(makeDb(2));
    const result = await applyConvergenceGate(
      makeInput({ llmConverged: true })
    );
    // 2 >= MIN_CYCLES_24H=2, so this constraint passes
    expect(result.reason).not.toContain("insufficient_recent_cycles");
  });

  it("FR-L2-20: DB unavailable defaults to MIN_CYCLES_24H (fail-safe allows convergence)", async () => {
    mocks.mockGetDb.mockResolvedValue(null);
    const result = await applyConvergenceGate(
      makeInput({ llmConverged: true })
    );
    // When DB is null, countRecentL2Cycles returns MIN_CYCLES_24H (2) — constraint passes
    expect(result.reason).not.toContain("insufficient_recent_cycles");
  });

  // ─── FR-L2-21: Critical alert check ──────────────────────────────────────
  it("FR-L2-21: blocks convergence when openCriticalAlerts > 0 (provided inline)", async () => {
    const result = await applyConvergenceGate(
      makeInput({ openCriticalAlerts: 2 })
    );
    expect(result.converged).toBe(false);
    expect(result.reason).toContain("open_critical_alerts");
    expect(result.overridden).toBe(true);
  });

  it("FR-L2-21: allows convergence when openCriticalAlerts = 0 (provided inline)", async () => {
    const result = await applyConvergenceGate(
      makeInput({ openCriticalAlerts: 0 })
    );
    expect(result.reason).not.toContain("open_critical_alerts");
  });

  it("FR-L2-21: blocks convergence when DB returns critical alerts > 0", async () => {
    // DB returns 3 for all counts — critical alerts = 3
    mocks.mockGetDb.mockResolvedValue(makeDb(3));
    // Don't provide inline openCriticalAlerts so DB is queried
    const result = await applyConvergenceGate({
      llmConverged: true,
      cycleCount: 3,
      staleGapsWithNoDirective: 0,
    });
    expect(result.converged).toBe(false);
    expect(result.reason).toContain("open_critical_alerts");
  });

  // ─── FR-L2-22: Stale gap check ────────────────────────────────────────────
  it("FR-L2-22: blocks convergence when staleGapsWithNoDirective > 0 (provided inline)", async () => {
    const result = await applyConvergenceGate(
      makeInput({ staleGapsWithNoDirective: 3 })
    );
    expect(result.converged).toBe(false);
    expect(result.reason).toContain("stale_gaps_no_directive");
    expect(result.overridden).toBe(true);
  });

  it("FR-L2-22: allows convergence when staleGapsWithNoDirective = 0 (provided inline)", async () => {
    const result = await applyConvergenceGate(
      makeInput({ staleGapsWithNoDirective: 0 })
    );
    expect(result.reason).not.toContain("stale_gaps_no_directive");
  });

  // ─── All constraints passed ───────────────────────────────────────────────
  it("allows convergence when all constraints pass (inline values)", async () => {
    const result = await applyConvergenceGate(
      makeInput({
        llmConverged: true,
        cycleCount: 3,
        openCriticalAlerts: 0,
        staleGapsWithNoDirective: 0,
      })
    );
    expect(result.converged).toBe(true);
    expect(result.reason).toBe("all_constraints_passed");
    expect(result.overridden).toBe(false);
  });

  // ─── Result shape ─────────────────────────────────────────────────────────
  it("always returns converged, reason, and overridden fields", async () => {
    const result: ConvergenceGateResult =
      await applyConvergenceGate(makeInput());
    expect(typeof result.converged).toBe("boolean");
    expect(typeof result.reason).toBe("string");
    expect(typeof result.overridden).toBe("boolean");
  });

  it("overridden is false when gate agrees with LLM", async () => {
    const result = await applyConvergenceGate(
      makeInput({ llmConverged: false })
    );
    expect(result.overridden).toBe(false);
  });

  // ─── Priority order ───────────────────────────────────────────────────────
  it("max_cycles check takes priority over all other constraints", async () => {
    // Even with critical alerts, max cycles should fire first
    const result = await applyConvergenceGate(
      makeInput({
        cycleCount: 10,
        llmConverged: false,
        openCriticalAlerts: 5,
      })
    );
    expect(result.reason).toContain("max_cycles_reached");
    expect(result.converged).toBe(true);
  });
});
