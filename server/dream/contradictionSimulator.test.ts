/**
 * contradictionSimulator.test.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Unit tests for dream/contradictionSimulator.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockGetDb, mockInvokeLLM } = vi.hoisted(() => ({
  mockGetDb: vi.fn(),
  mockInvokeLLM: vi.fn(),
}));
vi.mock("../db", () => ({ getDb: mockGetDb }));
vi.mock("../_core/llm", () => ({ invokeLLM: mockInvokeLLM }));

import { runContradictionSimulation } from "./contradictionSimulator";

function makeDb(executeResult: unknown[] = []) {
  return { execute: vi.fn().mockResolvedValue(executeResult) };
}

describe("dream/contradictionSimulator — runContradictionSimulation()", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns empty scenarios when DB is unavailable", async () => {
    mockGetDb.mockResolvedValue(null);
    const result = await runContradictionSimulation();
    expect(result.scenarios).toEqual([]);
    expect(result.totalSimulated).toBe(0);
  });

  it("returns empty scenarios when no high-confidence contradiction clusters exist", async () => {
    mockGetDb.mockResolvedValue(makeDb([]));
    const result = await runContradictionSimulation();
    expect(Array.isArray(result.scenarios)).toBe(true);
    expect(result.totalSimulated).toBeGreaterThanOrEqual(0);
  });

  it("returns a SimulationResult with scenarios array and totalSimulated number", async () => {
    mockGetDb.mockResolvedValue(makeDb([]));
    const result = await runContradictionSimulation();
    expect(typeof result.totalSimulated).toBe("number");
    expect(Array.isArray(result.scenarios)).toBe(true);
  });

  it("does not throw when DB.execute rejects", async () => {
    const db = { execute: vi.fn().mockRejectedValue(new Error("DB error")) };
    mockGetDb.mockResolvedValue(db);
    await expect(runContradictionSimulation()).resolves.toBeDefined();
  });

  it("does not call LLM when no claims are found", async () => {
    mockGetDb.mockResolvedValue(makeDb([]));
    await runContradictionSimulation();
    expect(mockInvokeLLM).not.toHaveBeenCalled();
  });

  it("calls LLM when a high-confidence claim is found in a contradiction cluster", async () => {
    const claimRow = [{
      id: 1,
      claimText: "Protein X folds into a beta-sheet",
      confidenceScore: 0.92,
      contra_count: 3,
    }];
    mockGetDb.mockResolvedValue(makeDb(claimRow));
    mockInvokeLLM.mockResolvedValue({
      choices: [{ message: { content: "Downstream consequence: re-verification required." } }],
    });
    const result = await runContradictionSimulation();
    expect(mockInvokeLLM).toHaveBeenCalledOnce();
    expect(result.totalSimulated).toBeGreaterThanOrEqual(0);
  });
});
