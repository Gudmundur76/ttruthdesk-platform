/**
 * hypothesisGenerator.test.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Unit tests for the Frontier hypothesis generator — runHypothesisGenerator()
 * and recordHypothesisOutcome().
 *
 * NOTE: getDbOrThrow() throws when DB is null — so DB-unavailable scenarios
 * propagate rejections. Internal sub-functions (detectHomologyHypotheses,
 * detectContradictionHypotheses) each call getDbOrThrow() and have their own
 * try/catch that returns []. runHypothesisGenerator() itself has no try/catch,
 * so if getDbOrThrow() throws inside a sub-function, that sub-function returns [].
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockGetDb } = vi.hoisted(() => ({ mockGetDb: vi.fn() }));
vi.mock("../../server/db", () => ({ getDb: mockGetDb }));

import {
  runHypothesisGenerator,
  recordHypothesisOutcome,
  type HypothesisGenerationResult,
} from "./hypothesisGenerator";

// ─── DB mock helpers ──────────────────────────────────────────────────────────
function makeChain(rows: unknown[] = []) {
  const p = Promise.resolve(rows);
  const c: Record<string, unknown> = {};
  c.select = vi.fn().mockReturnValue(c);
  c.from = vi.fn().mockReturnValue(c);
  c.where = vi.fn().mockReturnValue(c);
  c.leftJoin = vi.fn().mockReturnValue(c);
  c.innerJoin = vi.fn().mockReturnValue(c);
  c.groupBy = vi.fn().mockReturnValue(c);
  c.orderBy = vi.fn().mockReturnValue(c);
  c.limit = vi.fn().mockResolvedValue(rows);
  c.insert = vi.fn().mockReturnValue(c);
  c.values = vi.fn().mockResolvedValue([{ insertId: 1 }]);
  c.update = vi.fn().mockReturnValue(c);
  c.set = vi.fn().mockReturnValue(c);
  c.execute = vi.fn().mockResolvedValue([rows]);
  c.then = (a: unknown, b: unknown) =>
    p.then(
      a as Parameters<typeof p.then>[0],
      b as Parameters<typeof p.then>[1]
    );
  c.catch = p.catch.bind(p);
  c.finally = p.finally.bind(p);
  return c;
}

function makeDb(rows: unknown[] = []) {
  const chain = makeChain(rows);
  return {
    select: vi.fn().mockReturnValue(chain),
    insert: vi.fn().mockReturnValue(chain),
    update: vi.fn().mockReturnValue(chain),
    execute: vi.fn().mockResolvedValue([rows]),
  };
}

// ─── runHypothesisGenerator ───────────────────────────────────────────────────
describe("hypothesisGenerator — runHypothesisGenerator()", () => {
  beforeEach(() => {
    mockGetDb.mockResolvedValue(makeDb([]));
  });

  it("returns a HypothesisGenerationResult with required fields", async () => {
    const result: HypothesisGenerationResult = await runHypothesisGenerator();

    expect(typeof result.hypothesesGenerated).toBe("number");
    expect(typeof result.queueItemsCreated).toBe("number");
    expect(Array.isArray(result.hypotheses)).toBe(true);
  });

  it("hypothesesGenerated equals hypotheses.length", async () => {
    const result = await runHypothesisGenerator();

    expect(result.hypothesesGenerated).toBe(result.hypotheses.length);
  });

  it("queueItemsCreated is non-negative", async () => {
    const result = await runHypothesisGenerator();

    expect(result.queueItemsCreated).toBeGreaterThanOrEqual(0);
  });

  it("returns zero hypotheses when DB returns empty rows", async () => {
    const result = await runHypothesisGenerator();

    expect(result.hypothesesGenerated).toBe(0);
    expect(result.hypotheses).toHaveLength(0);
  });

  it("propagates rejection when DB is null (getDbOrThrow throws before try/catch)", async () => {
    // getDbOrThrow() throws at the top of detectHomologyHypotheses — before the try block
    // so the error propagates through runHypothesisGenerator
    mockGetDb.mockResolvedValue(null);

    await expect(runHypothesisGenerator()).rejects.toThrow();
  });
});

// ─── recordHypothesisOutcome ──────────────────────────────────────────────────
describe("hypothesisGenerator — recordHypothesisOutcome()", () => {
  beforeEach(() => {
    mockGetDb.mockResolvedValue(makeDb([]));
  });

  it("resolves without throwing for Supported verdict", async () => {
    await expect(
      recordHypothesisOutcome(1, "Supported", 42)
    ).resolves.toBeUndefined();
  });

  it("resolves without throwing for Contradicted verdict", async () => {
    await expect(
      recordHypothesisOutcome(2, "Contradicted")
    ).resolves.toBeUndefined();
  });

  it("resolves without throwing for Insufficient Evidence verdict", async () => {
    await expect(
      recordHypothesisOutcome(3, "Insufficient Evidence")
    ).resolves.toBeUndefined();
  });

  it("propagates rejection when DB is unavailable (getDbOrThrow throws)", async () => {
    mockGetDb.mockResolvedValue(null);

    await expect(
      recordHypothesisOutcome(1, "Supported")
    ).rejects.toThrow();
  });
});
