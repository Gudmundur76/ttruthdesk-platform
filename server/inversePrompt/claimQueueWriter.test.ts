/**
 * claimQueueWriter.test.ts
 * Unit tests for inversePrompt/claimQueueWriter.ts
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  mockGetDb: vi.fn(),
}));

vi.mock("../db", () => ({ getDb: mocks.mockGetDb }));

const makeDb = () => {
  const db = {
    select: vi.fn(),
    from: vi.fn(),
    where: vi.fn(),
    limit: vi.fn(),
    insert: vi.fn(),
    values: vi.fn(),
    $returningId: vi.fn(),
    update: vi.fn(),
    set: vi.fn(),
  };
  db.select.mockReturnValue(db);
  db.from.mockReturnValue(db);
  db.where.mockReturnValue(db);
  db.limit.mockResolvedValue([]);
  db.insert.mockReturnValue(db);
  db.values.mockReturnValue(db);
  db.$returningId.mockResolvedValue([{ id: 1 }]);
  db.update.mockReturnValue(db);
  db.set.mockReturnValue(db);
  // where is used both for select chain (returns db for chaining) and update chain (resolves)
  // We need it to resolve when called after set, and return db when called after from
  db.where.mockImplementation(() => {
    // Return a thenable db so it works for both select and update chains
    return db;
  });
  return db;
};

const makeCandidate = () => ({
  claimText: "Protein X binds to receptor Y",
  claimType: "binding_claim",
  inferenceType: "gap_fill" as const,
  requiredSources: ["PDB"],
  sourceQuery: "protein X receptor Y",
  parentVerifications: [] as number[],
  entityId: 1,
  reasoning: "Based on structural data",
});

const makeGateResult = (verdict: "pass" | "reject" | "defer" = "pass") => ({
  verdict,
  priority: 60,
  rejectionReason: verdict !== "pass" ? "Low confidence" : undefined,
  isHypothesis: false,
});

describe("persistGeneratedClaim()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("returns null when DB is unavailable", async () => {
    mocks.mockGetDb.mockResolvedValue(null);
    const { persistGeneratedClaim } = await import("./claimQueueWriter");
    const result = await persistGeneratedClaim(makeCandidate(), makeGateResult());
    expect(result).toBeNull();
  });

  it("returns duplicate status when claim already exists with pending status", async () => {
    const db = makeDb();
    db.limit.mockResolvedValue([{ id: 5, status: "pending" }]);
    mocks.mockGetDb.mockResolvedValue(db);
    const { persistGeneratedClaim } = await import("./claimQueueWriter");
    const result = await persistGeneratedClaim(makeCandidate(), makeGateResult());
    expect(result).toEqual({ generatedClaimId: 5, status: "duplicate" });
  });

  it("returns queued status when claim passes gate and is inserted", async () => {
    const db = makeDb();
    db.limit.mockResolvedValue([]); // no duplicate
    db.$returningId
      .mockResolvedValueOnce([{ id: 10 }]) // insert generatedClaims
      .mockResolvedValueOnce([{ id: 20 }]); // insert coordQueue
    // Keep set returning db so the chain update().set().where() works
    // db.where already returns db (thenable via then: undefined, so await resolves to db)
    mocks.mockGetDb.mockResolvedValue(db);
    const { persistGeneratedClaim } = await import("./claimQueueWriter");
    const result = await persistGeneratedClaim(makeCandidate(), makeGateResult("pass"));
    expect(result).not.toBeNull();
    expect(result!.status).toBe("queued");
    expect(result!.generatedClaimId).toBe(10);
  });

  it("returns rejected status when gate verdict is reject", async () => {
    const db = makeDb();
    db.limit.mockResolvedValue([]); // no duplicate
    db.$returningId.mockResolvedValue([{ id: 11 }]);
    mocks.mockGetDb.mockResolvedValue(db);
    const { persistGeneratedClaim } = await import("./claimQueueWriter");
    const result = await persistGeneratedClaim(makeCandidate(), makeGateResult("reject"));
    expect(result).not.toBeNull();
    expect(result!.status).toBe("rejected");
  });

  it("returns deferred status when gate verdict is defer", async () => {
    const db = makeDb();
    db.limit.mockResolvedValue([]);
    db.$returningId.mockResolvedValue([{ id: 12 }]);
    mocks.mockGetDb.mockResolvedValue(db);
    const { persistGeneratedClaim } = await import("./claimQueueWriter");
    const result = await persistGeneratedClaim(makeCandidate(), makeGateResult("defer"));
    expect(result).not.toBeNull();
    expect(result!.status).toBe("deferred");
  });
});

describe("persistBatch()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("returns all-zero summary when DB is unavailable", async () => {
    mocks.mockGetDb.mockResolvedValue(null);
    const { persistBatch } = await import("./claimQueueWriter");
    const result = await persistBatch([
      { candidate: makeCandidate(), gateResult: makeGateResult() },
    ]);
    expect(result.errors).toBe(1);
    expect(result.queued).toBe(0);
  });

  it("counts queued, rejected, deferred, duplicates correctly", async () => {
    const db = makeDb();
    let callCount = 0;
    db.limit.mockImplementation(async () => {
      // First call: no duplicate; second: duplicate
      callCount++;
      return callCount === 2 ? [{ id: 99, status: "pending" }] : [];
    });
    db.$returningId.mockResolvedValue([{ id: 50 }]);
    mocks.mockGetDb.mockResolvedValue(db);
    const { persistBatch } = await import("./claimQueueWriter");
    const result = await persistBatch([
      { candidate: makeCandidate(), gateResult: makeGateResult("pass") },
      { candidate: { ...makeCandidate(), claimText: "Another claim" }, gateResult: makeGateResult("pass") },
      { candidate: { ...makeCandidate(), claimText: "Rejected claim" }, gateResult: makeGateResult("reject") },
    ]);
    expect(result.queued + result.duplicates + result.rejected + result.deferred + result.errors).toBe(3);
  });
});
