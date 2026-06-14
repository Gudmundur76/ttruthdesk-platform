/**
 * llmProviderQuality.test.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Unit tests for the LLM Provider Quality tracker.
 * Tests: upsertModelRecord(), isModelAllowedForHighStakes(), banModel(), unbanModel().
 *
 * NOTE: All functions use getDb() (not getDbOrThrow()), so DB null → graceful
 * no-op (returns void) or fail-open (returns true for isModelAllowedForHighStakes).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockGetDb } = vi.hoisted(() => ({ mockGetDb: vi.fn() }));
vi.mock("./db", () => ({ getDb: mockGetDb }));

import {
  upsertModelRecord,
  isModelAllowedForHighStakes,
  banModel,
  unbanModel,
  HIGH_STAKES_ACCURACY_THRESHOLD,
  MIN_CLAIMS_FOR_ACCURACY,
} from "./llmProviderQuality";

// ─── DB mock helpers ──────────────────────────────────────────────────────────
function makeChain(rows: unknown[] = []) {
  const p = Promise.resolve(rows);
  const c: Record<string, unknown> = {};
  c.select = vi.fn().mockReturnValue(c);
  c.from = vi.fn().mockReturnValue(c);
  c.where = vi.fn().mockReturnValue(c);
  c.limit = vi.fn().mockResolvedValue(rows);
  c.insert = vi.fn().mockReturnValue(c);
  c.values = vi.fn().mockReturnValue(c);
  c.onDuplicateKeyUpdate = vi.fn().mockResolvedValue([{ affectedRows: 1 }]);
  c.update = vi.fn().mockReturnValue(c);
  c.set = vi.fn().mockReturnValue(c);
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
  };
}

// ─── upsertModelRecord ────────────────────────────────────────────────────────
describe("llmProviderQuality — upsertModelRecord()", () => {
  it("returns without error when DB is unavailable", async () => {
    mockGetDb.mockResolvedValue(null);

    await expect(
      upsertModelRecord("gpt-4o", "GPT-4o", "openai", false)
    ).resolves.toBeUndefined();
  });

  it("calls insert when DB is available", async () => {
    const db = makeDb([]);
    mockGetDb.mockResolvedValue(db);

    await upsertModelRecord("claude-3-5", "Claude 3.5", "anthropic", false);

    expect(db.insert).toHaveBeenCalledTimes(1);
  });
});

// ─── isModelAllowedForHighStakes ──────────────────────────────────────────────
describe("llmProviderQuality — isModelAllowedForHighStakes()", () => {
  it("returns true (fail-open) when DB is unavailable", async () => {
    mockGetDb.mockResolvedValue(null);

    const result = await isModelAllowedForHighStakes("any-model");

    expect(result).toBe(true);
  });

  it("returns true for unknown model (not in DB)", async () => {
    const db = makeDb([]);
    const chain = makeChain([]);
    chain.limit = vi.fn().mockResolvedValue([]);
    chain.where = vi.fn().mockReturnValue(chain);
    chain.from = vi.fn().mockReturnValue(chain);
    db.select = vi.fn().mockReturnValue(chain);
    mockGetDb.mockResolvedValue(db);

    const result = await isModelAllowedForHighStakes("unknown-model");

    expect(result).toBe(true);
  });

  it("returns false for banned model", async () => {
    const db = makeDb([]);
    const bannedRecord = {
      modelId: "bad-model",
      isBanned: true,
      allowedForHighStakes: false,
      totalClaims: 50,
      accuracyRate: 0.5,
    };
    const chain = makeChain([bannedRecord]);
    chain.limit = vi.fn().mockResolvedValue([bannedRecord]);
    chain.where = vi.fn().mockReturnValue(chain);
    chain.from = vi.fn().mockReturnValue(chain);
    db.select = vi.fn().mockReturnValue(chain);
    mockGetDb.mockResolvedValue(db);

    const result = await isModelAllowedForHighStakes("bad-model");

    expect(result).toBe(false);
  });

  it("returns false when accuracy is below threshold with enough data", async () => {
    const db = makeDb([]);
    const lowAccuracyRecord = {
      modelId: "low-acc-model",
      isBanned: false,
      allowedForHighStakes: true,
      totalClaims: MIN_CLAIMS_FOR_ACCURACY + 5,
      accuracyRate: HIGH_STAKES_ACCURACY_THRESHOLD - 0.1, // below threshold
    };
    const chain = makeChain([lowAccuracyRecord]);
    chain.limit = vi.fn().mockResolvedValue([lowAccuracyRecord]);
    chain.where = vi.fn().mockReturnValue(chain);
    chain.from = vi.fn().mockReturnValue(chain);
    db.select = vi.fn().mockReturnValue(chain);
    mockGetDb.mockResolvedValue(db);

    const result = await isModelAllowedForHighStakes("low-acc-model");

    expect(result).toBe(false);
  });

  it("returns true when accuracy meets threshold with enough data", async () => {
    const db = makeDb([]);
    const goodRecord = {
      modelId: "good-model",
      isBanned: false,
      allowedForHighStakes: true,
      totalClaims: MIN_CLAIMS_FOR_ACCURACY + 5,
      accuracyRate: HIGH_STAKES_ACCURACY_THRESHOLD + 0.1, // above threshold
    };
    const chain = makeChain([goodRecord]);
    chain.limit = vi.fn().mockResolvedValue([goodRecord]);
    chain.where = vi.fn().mockReturnValue(chain);
    chain.from = vi.fn().mockReturnValue(chain);
    db.select = vi.fn().mockReturnValue(chain);
    mockGetDb.mockResolvedValue(db);

    const result = await isModelAllowedForHighStakes("good-model");

    expect(result).toBe(true);
  });

  it("returns true when accuracy is below threshold but not enough data yet", async () => {
    const db = makeDb([]);
    const newRecord = {
      modelId: "new-model",
      isBanned: false,
      allowedForHighStakes: true,
      totalClaims: MIN_CLAIMS_FOR_ACCURACY - 1, // not enough data
      accuracyRate: 0.5, // low accuracy but insufficient data
    };
    const chain = makeChain([newRecord]);
    chain.limit = vi.fn().mockResolvedValue([newRecord]);
    chain.where = vi.fn().mockReturnValue(chain);
    chain.from = vi.fn().mockReturnValue(chain);
    db.select = vi.fn().mockReturnValue(chain);
    mockGetDb.mockResolvedValue(db);

    const result = await isModelAllowedForHighStakes("new-model");

    expect(result).toBe(true);
  });
});

// ─── banModel / unbanModel ────────────────────────────────────────────────────
describe("llmProviderQuality — banModel() / unbanModel()", () => {
  beforeEach(() => {
    const db = makeDb([]);
    const updateChain = makeChain([]);
    updateChain.set = vi.fn().mockReturnValue(updateChain);
    updateChain.where = vi.fn().mockResolvedValue([{ affectedRows: 1 }]);
    db.update = vi.fn().mockReturnValue(updateChain);
    mockGetDb.mockResolvedValue(db);
  });

  it("banModel returns without error when DB is unavailable", async () => {
    mockGetDb.mockResolvedValue(null);

    await expect(banModel("model-x", "low accuracy")).resolves.toBeUndefined();
  });

  it("banModel calls update when DB is available", async () => {
    const db = makeDb([]);
    const updateChain = makeChain([]);
    updateChain.set = vi.fn().mockReturnValue(updateChain);
    updateChain.where = vi.fn().mockResolvedValue([{ affectedRows: 1 }]);
    db.update = vi.fn().mockReturnValue(updateChain);
    mockGetDb.mockResolvedValue(db);

    await banModel("model-x", "low accuracy");

    expect(db.update).toHaveBeenCalledTimes(1);
  });

  it("unbanModel returns without error when DB is unavailable", async () => {
    mockGetDb.mockResolvedValue(null);

    await expect(unbanModel("model-x")).resolves.toBeUndefined();
  });

  it("unbanModel calls update when DB is available", async () => {
    const db = makeDb([]);
    const updateChain = makeChain([]);
    updateChain.set = vi.fn().mockReturnValue(updateChain);
    updateChain.where = vi.fn().mockResolvedValue([{ affectedRows: 1 }]);
    db.update = vi.fn().mockReturnValue(updateChain);
    mockGetDb.mockResolvedValue(db);

    await unbanModel("model-x");

    expect(db.update).toHaveBeenCalledTimes(1);
  });
});

// ─── Constants ────────────────────────────────────────────────────────────────
describe("llmProviderQuality — constants", () => {
  it("HIGH_STAKES_ACCURACY_THRESHOLD is in (0, 1)", () => {
    expect(HIGH_STAKES_ACCURACY_THRESHOLD).toBeGreaterThan(0);
    expect(HIGH_STAKES_ACCURACY_THRESHOLD).toBeLessThan(1);
  });

  it("MIN_CLAIMS_FOR_ACCURACY is a positive integer", () => {
    expect(MIN_CLAIMS_FOR_ACCURACY).toBeGreaterThan(0);
    expect(Number.isInteger(MIN_CLAIMS_FOR_ACCURACY)).toBe(true);
  });
});
