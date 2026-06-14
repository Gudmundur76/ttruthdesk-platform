/**
 * inversePromptEngine.test.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Unit tests for inversePrompt/inversePromptEngine.ts
 *
 * runInversePromptEngine(topN, vertical) and runInversePromptForEntity(entityId, vertical)
 * both call generateQuestionsFromTopEntities / generateQuestionsFromVerifiedTruth
 * which use getDb internally. We mock at the db level.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  mockGetDb: vi.fn(),
  mockInvokeLLM: vi.fn(),
}));

vi.mock("../db", () => ({ getDb: mocks.mockGetDb }));
vi.mock("../_core/llm", () => ({ invokeLLM: mocks.mockInvokeLLM }));

const makeDb = () => {
  const db = {
    select: vi.fn(),
    from: vi.fn(),
    where: vi.fn(),
    groupBy: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
    update: vi.fn(),
    set: vi.fn(),
    insert: vi.fn(),
    values: vi.fn(),
  };
  db.select.mockReturnValue(db);
  db.from.mockReturnValue(db);
  db.where.mockReturnValue(db);
  db.groupBy.mockReturnValue(db);
  db.orderBy.mockReturnValue(db);
  db.limit.mockResolvedValue([]);
  db.update.mockReturnValue(db);
  db.set.mockReturnValue(db);
  db.insert.mockReturnValue(db);
  db.values.mockResolvedValue([{ insertId: 1 }]);
  return db;
};

describe("runInversePromptEngine()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("returns zero candidatesGenerated when DB returns no entities", async () => {
    const db = makeDb();
    db.limit.mockResolvedValue([]); // no top entities
    mocks.mockGetDb.mockResolvedValue(db);
    const { runInversePromptEngine } = await import("./inversePromptEngine");
    const result = await runInversePromptEngine(5);
    expect(result.entitiesScanned).toBe(5);
    expect(result.candidatesGenerated).toBe(0);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("returns result with all expected fields", async () => {
    const db = makeDb();
    db.limit.mockResolvedValue([]);
    mocks.mockGetDb.mockResolvedValue(db);
    const { runInversePromptEngine } = await import("./inversePromptEngine");
    const result = await runInversePromptEngine(3, "proteomics");
    expect(result).toHaveProperty("durationMs");
    expect(result).toHaveProperty("queued");
    expect(result).toHaveProperty("errors");
    expect(result).toHaveProperty("passedGate");
    expect(result).toHaveProperty("rejected");
  });

  it("resolves with zero counts when DB is null (getDb returns null)", async () => {
    // generateQuestionsFromTopEntities uses getDb() and returns [] when null
    mocks.mockGetDb.mockResolvedValue(null);
    const { runInversePromptEngine } = await import("./inversePromptEngine");
    const result = await runInversePromptEngine(5);
    expect(result.candidatesGenerated).toBe(0);
    expect(result.errors).toBe(0);
    expect(result.entitiesScanned).toBe(5);
  });
});

describe("runInversePromptForEntity()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("returns entitiesScanned=1 with zero candidates when DB returns nothing", async () => {
    const db = makeDb();
    db.limit.mockResolvedValue([]); // entity not found in getVerifiedSubgraph
    mocks.mockGetDb.mockResolvedValue(db);
    const { runInversePromptForEntity } = await import("./inversePromptEngine");
    const result = await runInversePromptForEntity(42);
    expect(result.entitiesScanned).toBe(1);
    expect(result.candidatesGenerated).toBe(0);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("resolves with zero counts when DB is null (getDb returns null)", async () => {
    // generateQuestionsFromVerifiedTruth uses getDb() and returns [] when null
    mocks.mockGetDb.mockResolvedValue(null);
    const { runInversePromptForEntity } = await import("./inversePromptEngine");
    const result = await runInversePromptForEntity(1);
    expect(result.entitiesScanned).toBe(1);
    expect(result.candidatesGenerated).toBe(0);
  });
});
