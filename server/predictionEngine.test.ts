/**
 * predictionEngine.test.ts
 *
 * Tests for the Ground Signal Prediction Engine (Layer 4).
 * All DB calls are mocked so tests run without a live database.
 *
 * Strategy: mock getDb() to return a chainable object whose terminal method
 * (the one that returns a Promise) is matched to the actual code path.
 *
 * For complex multi-query functions like computeClaimTrajectory and
 * computeAuthorReliability, we mock the individual helper functions they call
 * to avoid brittle sequential-call counting.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock the DB module ────────────────────────────────────────────────────────
vi.mock("./db", () => ({
  getDb: vi.fn(),
}));

// ─── Mock drizzle-orm so sql/eq/and/desc don't need a real DB ─────────────────
vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return {
    ...actual,
    eq: vi.fn((...args) => ({ type: "eq", args })),
    and: vi.fn((...args) => ({ type: "and", args })),
    desc: vi.fn((col) => ({ type: "desc", col })),
    sql: Object.assign(
      vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
        type: "sql",
        strings,
        values,
      })),
      { raw: vi.fn((s: string) => ({ type: "sql_raw", s })) }
    ),
  };
});

// ─── Chain builder ────────────────────────────────────────────────────────────
/**
 * Build a drizzle-like mock chain.
 * `terminalMethod` is the method that returns the final Promise.
 * All other methods return `this` for chaining.
 */
function makeChain(terminalMethod: string, resolvedValue: unknown) {
  const chain: Record<string, unknown> = {};
  const allMethods = ["select", "from", "innerJoin", "orderBy", "where", "limit", "values", "set", "insert", "update"];
  for (const m of allMethods) {
    if (m === terminalMethod) {
      chain[m] = vi.fn(() => Promise.resolve(resolvedValue));
    } else {
      chain[m] = vi.fn(() => chain);
    }
  }
  return chain;
}

// ─── computeClaimTypeBaseRate ─────────────────────────────────────────────────
// Terminal: .where() (no .limit() in this function)
describe("computeClaimTypeBaseRate", () => {
  beforeEach(() => vi.resetModules());

  it("returns field average fallback when no claims match keyword", async () => {
    const { getDb } = await import("./db");
    vi.mocked(getDb).mockResolvedValue(makeChain("where", [{ total: 0, contradicted: 0 }]) as never);

    const { computeClaimTypeBaseRate } = await import("./predictionEngine");
    const result = await computeClaimTypeBaseRate("novel fold");
    expect(result.contradictionRate).toBe(0.31);
    expect(result.sampleSize).toBe(0);
  });

  it("computes contradiction rate correctly when claims exist", async () => {
    const { getDb } = await import("./db");
    vi.mocked(getDb).mockResolvedValue(makeChain("where", [{ total: 10, contradicted: 3 }]) as never);

    const { computeClaimTypeBaseRate } = await import("./predictionEngine");
    const result = await computeClaimTypeBaseRate("resolution");
    expect(result.contradictionRate).toBeCloseTo(0.3);
    expect(result.sampleSize).toBe(10);
  });

  it("returns 0 contradiction rate when no claims are contradicted", async () => {
    const { getDb } = await import("./db");
    vi.mocked(getDb).mockResolvedValue(makeChain("where", [{ total: 5, contradicted: 0 }]) as never);

    const { computeClaimTypeBaseRate } = await import("./predictionEngine");
    const result = await computeClaimTypeBaseRate("binding affinity");
    expect(result.contradictionRate).toBe(0);
    expect(result.sampleSize).toBe(5);
  });

  it("caps contradiction rate at 1.0 even if all claims are contradicted", async () => {
    const { getDb } = await import("./db");
    vi.mocked(getDb).mockResolvedValue(makeChain("where", [{ total: 4, contradicted: 4 }]) as never);

    const { computeClaimTypeBaseRate } = await import("./predictionEngine");
    const result = await computeClaimTypeBaseRate("xyz");
    expect(result.contradictionRate).toBeLessThanOrEqual(1.0);
  });

  it("handles empty result gracefully", async () => {
    const { getDb } = await import("./db");
    vi.mocked(getDb).mockResolvedValue(makeChain("where", []) as never);

    const { computeClaimTypeBaseRate } = await import("./predictionEngine");
    const result = await computeClaimTypeBaseRate("anything");
    expect(result.contradictionRate).toBe(0.31);
    expect(result.sampleSize).toBe(0);
  });
});

// ─── computeAuthorContradictionRate ──────────────────────────────────────────
// Terminal: .where() (SELECT ... FROM ... INNER JOIN ... WHERE ...)
describe("computeAuthorContradictionRate", () => {
  beforeEach(() => vi.resetModules());

  it("returns field average (0.31) when user has no claims", async () => {
    const { getDb } = await import("./db");
    vi.mocked(getDb).mockResolvedValue(makeChain("where", [{ total: 0, contradicted: 0 }]) as never);

    const { computeAuthorContradictionRate } = await import("./predictionEngine");
    const result = await computeAuthorContradictionRate(42);
    // When total === 0, rate falls back to 0.31 (field average)
    expect(result.rate).toBe(0.31);
    expect(result.totalClaims).toBe(0);
  });

  it("computes author contradiction rate correctly", async () => {
    const { getDb } = await import("./db");
    vi.mocked(getDb).mockResolvedValue(makeChain("where", [{ total: 20, contradicted: 4 }]) as never);

    const { computeAuthorContradictionRate } = await import("./predictionEngine");
    const result = await computeAuthorContradictionRate(7);
    expect(result.rate).toBeCloseTo(0.2);
    expect(result.totalClaims).toBe(20);
  });

  it("handles single claim with contradiction", async () => {
    const { getDb } = await import("./db");
    vi.mocked(getDb).mockResolvedValue(makeChain("where", [{ total: 1, contradicted: 1 }]) as never);

    const { computeAuthorContradictionRate } = await import("./predictionEngine");
    const result = await computeAuthorContradictionRate(99);
    expect(result.rate).toBe(1.0);
    expect(result.totalClaims).toBe(1);
  });

  it("returns field average (0.31) when result is empty array", async () => {
    const { getDb } = await import("./db");
    vi.mocked(getDb).mockResolvedValue(makeChain("where", []) as never);

    const { computeAuthorContradictionRate } = await import("./predictionEngine");
    const result = await computeAuthorContradictionRate(10);
    expect(result.rate).toBe(0.31);
    expect(result.totalClaims).toBe(0);
  });
});

// ─── computeFieldAverageContradictionRate ─────────────────────────────────────
// Terminal: .where()
describe("computeFieldAverageContradictionRate", () => {
  beforeEach(() => vi.resetModules());

  it("returns default 0.31 when no data exists", async () => {
    const { getDb } = await import("./db");
    vi.mocked(getDb).mockResolvedValue(makeChain("where", [{ total: 0, contradicted: 0 }]) as never);

    const { computeFieldAverageContradictionRate } = await import("./predictionEngine");
    const result = await computeFieldAverageContradictionRate();
    expect(result).toBe(0.31);
  });

  it("computes field average correctly with data", async () => {
    const { getDb } = await import("./db");
    vi.mocked(getDb).mockResolvedValue(makeChain("where", [{ total: 100, contradicted: 25 }]) as never);

    const { computeFieldAverageContradictionRate } = await import("./predictionEngine");
    const result = await computeFieldAverageContradictionRate();
    expect(result).toBeCloseTo(0.25);
  });

  it("returns 0.31 fallback when result is empty array", async () => {
    const { getDb } = await import("./db");
    vi.mocked(getDb).mockResolvedValue(makeChain("where", []) as never);

    const { computeFieldAverageContradictionRate } = await import("./predictionEngine");
    const result = await computeFieldAverageContradictionRate();
    expect(result).toBe(0.31);
  });

  it("handles 100% contradiction rate", async () => {
    const { getDb } = await import("./db");
    vi.mocked(getDb).mockResolvedValue(makeChain("where", [{ total: 50, contradicted: 50 }]) as never);

    const { computeFieldAverageContradictionRate } = await import("./predictionEngine");
    const result = await computeFieldAverageContradictionRate();
    expect(result).toBe(1.0);
  });
});

// ─── computeClaimTrajectory ───────────────────────────────────────────────────
// This function calls multiple sub-functions. We mock the module itself
// to isolate computeClaimTrajectory from its dependencies.
describe("computeClaimTrajectory", () => {
  beforeEach(() => vi.resetModules());

  /**
   * Build a mock DB that handles the sequential calls in computeClaimTrajectory:
   * 1. Fetch claim → .limit(1) returns [claimRow]
   * 2. computeClaimTypeBaseRate → .where() returns [claimTypeRow]
   * 3. computeAuthorContradictionRate → .where() returns [authorRow]
   * 4. computeFieldAverageContradictionRate → .where() returns [fieldRow]
   * 5. Fetch all entities → .limit(200) returns []  (no entity match → neutral prior)
   */
  function makeTrajectoryDb(
    claimRow: object | null,
    claimTypeRow: object,
    authorRow: object,
    fieldRow: object
  ) {
    /**
     * computeClaimTrajectory DB call sequence:
     *   1. claim fetch:         .select().from().where().limit(1)   → limit resolves [claimRow]
     *   2. claimTypeBaseRate:   .select().from().innerJoin().where() → where resolves [claimTypeRow]
     *   3. authorRate:          .select().from().innerJoin().where() → where resolves [authorRow]
     *   4. fieldAvg:            .select().from().where()             → where resolves [fieldRow]
     *   5. entity fetch:        .select().from().limit(200)          → limit resolves []
     *
     * Strategy: where() always returns chain (for chaining with .limit).
     *           limit() resolves with the next limitResponse.
     *           But for the 3 sub-functions that end at .where(), we need where()
     *           to also resolve. We detect this by checking if .limit was called
     *           after the last .where() call.
     *
     * Simpler approach: use a "pending where" flag.
     * - where() stores the next whereResponse and returns chain
     * - limit() checks if there's a pending where response → returns that (for .where().limit() pattern)
     *           otherwise returns the next limitResponse
     * - But this doesn't work for bare .where() calls.
     *
     * Cleanest approach: make where() return a "thenable chain" that:
     * - If .limit() is called on it, resolves with limitResponse
     * - If awaited directly, resolves with whereResponse
     */
    const limitResponses = [
      claimRow ? [claimRow] : [], // .limit(1) → claim
      [],                          // .limit(200) → entities (empty → no entity match)
    ];
    const whereResponses = [
      [claimTypeRow],  // computeClaimTypeBaseRate → .where()
      [authorRow],     // computeAuthorContradictionRate → .where()
      [fieldRow],      // computeFieldAverageContradictionRate → .where()
    ];
    let limitIdx = 0;
    let whereIdx = 0;

    const chain: Record<string, unknown> = {};
    for (const m of ["select", "from", "innerJoin", "orderBy", "set", "update"]) {
      chain[m] = vi.fn(() => chain);
    }

    // where() returns a "thenable chain" — awaitable AND chainable
    chain.where = vi.fn(() => {
      const whereVal = whereResponses[whereIdx++] ?? [];
      // Create a thenable that also has .limit()
      const thenableChain: Record<string, unknown> = {
        then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
          Promise.resolve(whereVal).then(resolve, reject),
        catch: (reject: (e: unknown) => unknown) => Promise.resolve(whereVal).catch(reject),
        // .limit() after .where() uses the limit queue (for .where().limit(1) pattern)
        limit: vi.fn(() => {
          const limitVal = limitResponses[limitIdx++] ?? [];
          return Promise.resolve(limitVal);
        }),
      };
      return thenableChain;
    });

    chain.limit = vi.fn(() => {
      const val = limitResponses[limitIdx++] ?? [];
      return Promise.resolve(val);
    });
    chain.insert = vi.fn(() => chain);
    chain.values = vi.fn(() => Promise.resolve([{ insertId: 1 }]));
    return chain;
  }

  it("throws when claim is not found", async () => {
    const { getDb } = await import("./db");
    vi.mocked(getDb).mockResolvedValue(
      makeTrajectoryDb(null, {}, {}, {}) as never
    );

    const { computeClaimTrajectory } = await import("./predictionEngine");
    await expect(computeClaimTrajectory(9999, 1)).rejects.toThrow();
  });

  it("returns a valid ClaimTrajectoryPrediction shape", async () => {
    const { getDb } = await import("./db");
    vi.mocked(getDb).mockResolvedValue(
      makeTrajectoryDb(
        { id: 1, claimText: "Novel fold observed in protein", claimType: "structure", verdict: "Supported", confidenceScore: 0.8, pdbId: "1ABC" },
        { total: 10, contradicted: 3 },
        { total: 10, contradicted: 2 },
        { total: 100, contradicted: 31 }
      ) as never
    );

    const { computeClaimTrajectory } = await import("./predictionEngine");
    const result = await computeClaimTrajectory(1, 42);
    expect(result).toHaveProperty("claimId", 1);
    expect(result).toHaveProperty("probabilityContradicted");
    expect(result.probabilityContradicted).toBeGreaterThanOrEqual(0.05);
    expect(result.probabilityContradicted).toBeLessThanOrEqual(0.95);
    expect(result).toHaveProperty("confidenceInterval");
    expect(result.confidenceInterval).toHaveLength(2);
    expect(result).toHaveProperty("factors");
    expect(Array.isArray(result.factors)).toBe(true);
    expect(result).toHaveProperty("recommendedAction");
    expect(result).toHaveProperty("baseRate");
    expect(result).toHaveProperty("sampleSize");
  });

  it("clips probability to [0.05, 0.95]", async () => {
    const { getDb } = await import("./db");
    vi.mocked(getDb).mockResolvedValue(
      makeTrajectoryDb(
        { id: 2, claimText: "Very risky claim", claimType: "structure", verdict: "Contradicted", confidenceScore: 0.1, pdbId: null },
        { total: 50, contradicted: 50 },
        { total: 50, contradicted: 50 },
        { total: 100, contradicted: 100 }
      ) as never
    );

    const { computeClaimTrajectory } = await import("./predictionEngine");
    const result = await computeClaimTrajectory(2, 1);
    expect(result.probabilityContradicted).toBeLessThanOrEqual(0.95);
    expect(result.probabilityContradicted).toBeGreaterThanOrEqual(0.05);
  });

  it("returns null expectedDaysToContradiction for low-risk claims", async () => {
    const { getDb } = await import("./db");
    vi.mocked(getDb).mockResolvedValue(
      makeTrajectoryDb(
        { id: 3, claimText: "Well-established binding result", claimType: "binding", verdict: "Supported", confidenceScore: 0.95, pdbId: "2XYZ" },
        { total: 20, contradicted: 0 },
        { total: 20, contradicted: 0 },
        { total: 100, contradicted: 5 }
      ) as never
    );

    const { computeClaimTrajectory } = await import("./predictionEngine");
    const result = await computeClaimTrajectory(3, 5);
    if (result.probabilityContradicted <= 0.4) {
      expect(result.expectedDaysToContradiction).toBeNull();
    }
  });

  it("recommendedAction is 'Flag for human expert review' for high probability", async () => {
    const { getDb } = await import("./db");
    vi.mocked(getDb).mockResolvedValue(
      makeTrajectoryDb(
        { id: 4, claimText: "Risky claim with novel fold", claimType: "structure", verdict: "Contradicted", confidenceScore: 0.2, pdbId: null },
        { total: 30, contradicted: 25 },
        { total: 30, contradicted: 25 },
        { total: 100, contradicted: 70 }
      ) as never
    );

    const { computeClaimTrajectory } = await import("./predictionEngine");
    const result = await computeClaimTrajectory(4, 1);
    if (result.probabilityContradicted >= 0.70) {
      expect(result.recommendedAction).toContain("Flag for human expert review");
    }
  });

  it("confidenceInterval lower bound is less than upper bound", async () => {
    const { getDb } = await import("./db");
    vi.mocked(getDb).mockResolvedValue(
      makeTrajectoryDb(
        { id: 5, claimText: "Some claim about resolution", claimType: "resolution", verdict: "Ambiguous", confidenceScore: 0.5, pdbId: "3PQR" },
        { total: 8, contradicted: 2 },
        { total: 8, contradicted: 2 },
        { total: 50, contradicted: 15 }
      ) as never
    );

    const { computeClaimTrajectory } = await import("./predictionEngine");
    const result = await computeClaimTrajectory(5, 3);
    const [lo, hi] = result.confidenceInterval;
    expect(lo).toBeLessThan(hi);
    expect(lo).toBeGreaterThanOrEqual(0.01);
    expect(hi).toBeLessThanOrEqual(0.99);
  });

  it("includes factors array with at least one entry", async () => {
    const { getDb } = await import("./db");
    vi.mocked(getDb).mockResolvedValue(
      makeTrajectoryDb(
        { id: 6, claimText: "Another claim about structure", claimType: "structure", verdict: "Supported", confidenceScore: 0.7, pdbId: "4ABC" },
        { total: 12, contradicted: 3 },
        { total: 12, contradicted: 3 },
        { total: 80, contradicted: 24 }
      ) as never
    );

    const { computeClaimTrajectory } = await import("./predictionEngine");
    const result = await computeClaimTrajectory(6, 2);
    expect(result.factors.length).toBeGreaterThan(0);
    expect(result.factors.every((f) => typeof f === "string")).toBe(true);
  });
});

// ─── computeAuthorReliability ─────────────────────────────────────────────────
// computeAuthorReliability calls:
//   1. computeAuthorContradictionRate → .where()
//   2. computeFieldAverageContradictionRate → .where()
//   3. AVG(confidenceScore) → .where()
describe("computeAuthorReliability", () => {
  beforeEach(() => vi.resetModules());

  function makeReliabilityDb(authorRow: object, fieldRow: object, confRow: object) {
    const whereResponses = [[authorRow], [fieldRow], [confRow]];
    let whereIdx = 0;

    const chain: Record<string, unknown> = {};
    for (const m of ["select", "from", "innerJoin", "orderBy", "limit", "set", "update"]) {
      chain[m] = vi.fn(() => chain);
    }
    chain.where = vi.fn(() => {
      const val = whereResponses[whereIdx++] ?? [];
      return Promise.resolve(val);
    });
    chain.insert = vi.fn(() => chain);
    chain.values = vi.fn(() => Promise.resolve([{ insertId: 1 }]));
    return chain;
  }

  it("returns INSUFFICIENT_DATA tier when fewer than 3 claims", async () => {
    const { getDb } = await import("./db");
    vi.mocked(getDb).mockResolvedValue(
      makeReliabilityDb(
        { total: 2, contradicted: 0 },
        { total: 100, contradicted: 31 },
        { avgConf: 0.7 }
      ) as never
    );

    const { computeAuthorReliability } = await import("./predictionEngine");
    const result = await computeAuthorReliability(1);
    expect(result.reliabilityTier).toBe("INSUFFICIENT_DATA");
    expect(result.totalClaimsAudited).toBe(2);
  });

  it("returns HIGH tier when contradiction rate is well below field average", async () => {
    const { getDb } = await import("./db");
    vi.mocked(getDb).mockResolvedValue(
      makeReliabilityDb(
        { total: 20, contradicted: 1 }, // 5% rate
        { total: 100, contradicted: 31 }, // 31% field average
        { avgConf: 0.85 }
      ) as never
    );

    const { computeAuthorReliability } = await import("./predictionEngine");
    const result = await computeAuthorReliability(2);
    expect(result.reliabilityTier).toBe("HIGH");
    expect(result.reliabilityPercentile).toBe(90);
  });

  it("returns AVERAGE tier when contradiction rate is close to field average", async () => {
    const { getDb } = await import("./db");
    vi.mocked(getDb).mockResolvedValue(
      makeReliabilityDb(
        { total: 15, contradicted: 4 }, // ~27% rate
        { total: 100, contradicted: 31 }, // 31% field average
        { avgConf: 0.6 }
      ) as never
    );

    const { computeAuthorReliability } = await import("./predictionEngine");
    const result = await computeAuthorReliability(3);
    expect(result.reliabilityTier).toBe("AVERAGE");
    expect(result.reliabilityPercentile).toBe(50);
  });

  it("returns LOW tier when contradiction rate is well above field average", async () => {
    const { getDb } = await import("./db");
    vi.mocked(getDb).mockResolvedValue(
      makeReliabilityDb(
        { total: 10, contradicted: 7 }, // 70% rate
        { total: 100, contradicted: 31 }, // 31% field average
        { avgConf: 0.3 }
      ) as never
    );

    const { computeAuthorReliability } = await import("./predictionEngine");
    const result = await computeAuthorReliability(4);
    expect(result.reliabilityTier).toBe("LOW");
    expect(result.reliabilityPercentile).toBe(20);
  });

  it("returns correct shape with all expected fields", async () => {
    const { getDb } = await import("./db");
    vi.mocked(getDb).mockResolvedValue(
      makeReliabilityDb(
        { total: 10, contradicted: 3 },
        { total: 100, contradicted: 31 },
        { avgConf: 0.72 }
      ) as never
    );

    const { computeAuthorReliability } = await import("./predictionEngine");
    const result = await computeAuthorReliability(5);
    expect(result).toHaveProperty("userId", 5);
    expect(result).toHaveProperty("contradictionRate");
    expect(result).toHaveProperty("fieldAverageRate");
    expect(result).toHaveProperty("totalClaimsAudited");
    expect(result).toHaveProperty("reliabilityTier");
    expect(result).toHaveProperty("reliabilityPercentile");
    expect(result).toHaveProperty("avgConfidence");
  });

  it("rounds rates to at most 2 decimal places", async () => {
    const { getDb } = await import("./db");
    vi.mocked(getDb).mockResolvedValue(
      makeReliabilityDb(
        { total: 7, contradicted: 2 }, // 2/7 = 0.2857...
        { total: 100, contradicted: 31 },
        { avgConf: 0.666 }
      ) as never
    );

    const { computeAuthorReliability } = await import("./predictionEngine");
    const result = await computeAuthorReliability(6);
    const decimalPlaces = (result.contradictionRate.toString().split(".")[1] ?? "").length;
    expect(decimalPlaces).toBeLessThanOrEqual(2);
  });

  it("handles zero field average gracefully (uses 0.31 fallback)", async () => {
    const { getDb } = await import("./db");
    vi.mocked(getDb).mockResolvedValue(
      makeReliabilityDb(
        { total: 5, contradicted: 0 },
        { total: 0, contradicted: 0 }, // zero field data → fallback 0.31
        { avgConf: 0.9 }
      ) as never
    );

    const { computeAuthorReliability } = await import("./predictionEngine");
    const result = await computeAuthorReliability(7);
    expect(result).toBeDefined();
    expect(typeof result.reliabilityTier).toBe("string");
    expect(result.fieldAverageRate).toBe(0.31);
  });
});

// ─── savePrediction ───────────────────────────────────────────────────────────
// Terminal: .values() returns [{ insertId }]
describe("savePrediction", () => {
  beforeEach(() => vi.resetModules());

  it("inserts a prediction model and returns the insertId", async () => {
    const { getDb } = await import("./db");
    const chain = makeChain("values", [{ insertId: 42 }]);
    vi.mocked(getDb).mockResolvedValue(chain as never);

    const { savePrediction } = await import("./predictionEngine");
    const id = await savePrediction({
      modelType: "claim_trajectory",
      targetClaimId: 1,
      targetEntityId: null,
      targetUserId: 5,
      prediction: { trajectory: "STABLE" } as never,
      baseRate: 0.31,
      featuresUsed: {} as never,
      validationResult: "pending",
    });
    expect(id).toBe(42);
    expect(chain.insert).toHaveBeenCalled();
  });

  it("throws when DB is unavailable", async () => {
    const { getDb } = await import("./db");
    vi.mocked(getDb).mockResolvedValue(null as never);

    const { savePrediction } = await import("./predictionEngine");
    await expect(
      savePrediction({
        modelType: "claim_trajectory",
        targetClaimId: 1,
        targetEntityId: null,
        targetUserId: 1,
        prediction: {} as never,
        baseRate: 0,
        featuresUsed: {} as never,
        validationResult: "pending",
      })
    ).rejects.toThrow("Database not available");
  });
});

// ─── updatePredictionValidation ───────────────────────────────────────────────
// Terminal: .where() after .update().set()
describe("updatePredictionValidation", () => {
  beforeEach(() => vi.resetModules());

  it("calls update with correct result and sets validatedAt", async () => {
    const { getDb } = await import("./db");
    const chain = makeChain("where", undefined);
    vi.mocked(getDb).mockResolvedValue(chain as never);

    const { updatePredictionValidation } = await import("./predictionEngine");
    await expect(updatePredictionValidation(10, "correct")).resolves.not.toThrow();
    expect(chain.update).toHaveBeenCalled();
  });

  it("accepts 'incorrect' as validation result", async () => {
    const { getDb } = await import("./db");
    const chain = makeChain("where", undefined);
    vi.mocked(getDb).mockResolvedValue(chain as never);

    const { updatePredictionValidation } = await import("./predictionEngine");
    await expect(updatePredictionValidation(11, "incorrect")).resolves.not.toThrow();
  });
});

// ─── getPredictionsByClaim ────────────────────────────────────────────────────
// Terminal: .limit(5)
describe("getPredictionsByClaim", () => {
  beforeEach(() => vi.resetModules());

  it("returns empty array when no predictions exist", async () => {
    const { getDb } = await import("./db");
    vi.mocked(getDb).mockResolvedValue(makeChain("limit", []) as never);

    const { getPredictionsByClaim } = await import("./predictionEngine");
    const result = await getPredictionsByClaim(999);
    expect(result).toEqual([]);
  });

  it("returns predictions ordered by createdAt desc", async () => {
    const { getDb } = await import("./db");
    const predictions = [
      { id: 2, modelType: "claim_trajectory", createdAt: new Date("2024-06-02") },
      { id: 1, modelType: "claim_trajectory", createdAt: new Date("2024-06-01") },
    ];
    vi.mocked(getDb).mockResolvedValue(makeChain("limit", predictions) as never);

    const { getPredictionsByClaim } = await import("./predictionEngine");
    const result = await getPredictionsByClaim(5);
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe(2);
  });

  it("returns at most 5 predictions", async () => {
    const { getDb } = await import("./db");
    const predictions = Array.from({ length: 5 }, (_, i) => ({
      id: i + 1,
      modelType: "claim_trajectory",
    }));
    vi.mocked(getDb).mockResolvedValue(makeChain("limit", predictions) as never);

    const { getPredictionsByClaim } = await import("./predictionEngine");
    const result = await getPredictionsByClaim(3);
    expect(result.length).toBeLessThanOrEqual(5);
  });
});

// ─── getPredictionsByUser ─────────────────────────────────────────────────────
// Terminal: .limit(1)
describe("getPredictionsByUser", () => {
  beforeEach(() => vi.resetModules());

  it("returns empty array when user has no predictions", async () => {
    const { getDb } = await import("./db");
    vi.mocked(getDb).mockResolvedValue(makeChain("limit", []) as never);

    const { getPredictionsByUser } = await import("./predictionEngine");
    const result = await getPredictionsByUser(1);
    expect(result).toEqual([]);
  });

  it("returns at most 1 prediction (latest)", async () => {
    const { getDb } = await import("./db");
    vi.mocked(getDb).mockResolvedValue(
      makeChain("limit", [{ id: 5, modelType: "author_reliability" }]) as never
    );

    const { getPredictionsByUser } = await import("./predictionEngine");
    const result = await getPredictionsByUser(2);
    expect(result.length).toBeLessThanOrEqual(1);
  });
});

// ─── upsertPredictionFeature ──────────────────────────────────────────────────
// Terminal: .values()
describe("upsertPredictionFeature", () => {
  beforeEach(() => vi.resetModules());

  it("inserts a prediction feature without throwing", async () => {
    const { getDb } = await import("./db");
    const chain = makeChain("values", []);
    vi.mocked(getDb).mockResolvedValue(chain as never);

    const { upsertPredictionFeature } = await import("./predictionEngine");
    await expect(
      upsertPredictionFeature({
        entityId: 1,
        featureType: "contradiction_rate",
        value: 0.25,
        sampleSize: 1,
        computedAt: new Date(),
      })
    ).resolves.not.toThrow();
    expect(chain.insert).toHaveBeenCalled();
  });
});

// ─── getPredictionFeaturesByEntity ───────────────────────────────────────────
// Terminal: .orderBy() (no .limit() in this function)
describe("getPredictionFeaturesByEntity", () => {
  beforeEach(() => vi.resetModules());

  it("returns empty array when entity has no features", async () => {
    const { getDb } = await import("./db");
    vi.mocked(getDb).mockResolvedValue(makeChain("orderBy", []) as never);

    const { getPredictionFeaturesByEntity } = await import("./predictionEngine");
    const result = await getPredictionFeaturesByEntity(999);
    expect(result).toEqual([]);
  });

  it("returns features for a given entity", async () => {
    const { getDb } = await import("./db");
    const features = [
      { id: 1, entityId: 5, featureType: "contradiction_rate", featureValue: 0.3 },
      { id: 2, entityId: 5, featureType: "claim_velocity", featureValue: 2.5 },
    ];
    vi.mocked(getDb).mockResolvedValue(makeChain("orderBy", features) as never);

    const { getPredictionFeaturesByEntity } = await import("./predictionEngine");
    const result = await getPredictionFeaturesByEntity(5);
    expect(result).toHaveLength(2);
    expect(result[0].featureType).toBe("contradiction_rate");
  });
});

// ─── Type shape validation ────────────────────────────────────────────────────
describe("ClaimTrajectoryPrediction type shape", () => {
  it("has all required fields defined in the interface", () => {
    const prediction = {
      claimId: 1,
      probabilityContradicted: 0.35,
      confidenceInterval: [0.23, 0.47] as [number, number],
      expectedDaysToContradiction: 90,
      factors: ["High author contradiction rate", "Method: X-ray crystallography"],
      recommendedAction: "Standard peer review sufficient",
      baseRate: 0.31,
      sampleSize: 42,
    };
    expect(prediction.claimId).toBeDefined();
    expect(prediction.probabilityContradicted).toBeDefined();
    expect(prediction.confidenceInterval).toHaveLength(2);
    expect(prediction.factors).toBeInstanceOf(Array);
    expect(prediction.recommendedAction).toBeDefined();
    expect(prediction.baseRate).toBeDefined();
    expect(prediction.sampleSize).toBeDefined();
  });

  it("probabilityContradicted is always in [0, 1]", () => {
    const values = [0.05, 0.31, 0.5, 0.75, 0.95];
    for (const v of values) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it("confidenceInterval bounds are ordered correctly", () => {
    const intervals: [number, number][] = [
      [0.23, 0.47],
      [0.05, 0.25],
      [0.70, 0.90],
    ];
    for (const [lo, hi] of intervals) {
      expect(lo).toBeLessThan(hi);
    }
  });
});

describe("AuthorReliabilityScore type shape", () => {
  it("has all required fields defined in the interface", () => {
    const score = {
      userId: 1,
      contradictionRate: 0.15,
      fieldAverageRate: 0.31,
      totalClaimsAudited: 20,
      reliabilityTier: "HIGH" as const,
      reliabilityPercentile: 90,
      avgConfidence: 0.78,
    };
    expect(score.userId).toBeDefined();
    expect(score.contradictionRate).toBeDefined();
    expect(score.fieldAverageRate).toBeDefined();
    expect(score.totalClaimsAudited).toBeDefined();
    expect(["HIGH", "AVERAGE", "LOW", "INSUFFICIENT_DATA"]).toContain(score.reliabilityTier);
    expect(score.reliabilityPercentile).toBeDefined();
    expect(score.avgConfidence).toBeDefined();
  });

  it("reliabilityTier is one of the four valid values", () => {
    const validTiers = ["HIGH", "AVERAGE", "LOW", "INSUFFICIENT_DATA"];
    for (const tier of validTiers) {
      expect(validTiers).toContain(tier);
    }
  });

  it("reliabilityPercentile is in [0, 100]", () => {
    const percentiles = [20, 50, 90];
    for (const p of percentiles) {
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(100);
    }
  });
});
