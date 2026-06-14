/**
 * graphQuestionGenerator.test.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Unit tests for the Inverse Prompt Graph Question Generator.
 * Tests: generateQuestionsFromVerifiedTruth(), generateQuestionsFromTopEntities().
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockGetDb, mockInvokeLLM } = vi.hoisted(() => ({
  mockGetDb: vi.fn(),
  mockInvokeLLM: vi.fn(),
}));

vi.mock("../../server/db", () => ({ getDb: mockGetDb }));
vi.mock("../../server/_core/llm", () => ({ invokeLLM: mockInvokeLLM }));

import {
  generateQuestionsFromVerifiedTruth,
  generateQuestionsFromTopEntities,
  type GeneratedClaimCandidate,
} from "./graphQuestionGenerator";

// ─── DB mock helpers ──────────────────────────────────────────────────────────
function makeChain(rows: unknown[] = []) {
  const p = Promise.resolve(rows);
  const c: Record<string, unknown> = {};
  c.select = vi.fn().mockReturnValue(c);
  c.from = vi.fn().mockReturnValue(c);
  c.where = vi.fn().mockReturnValue(c);
  c.orderBy = vi.fn().mockReturnValue(c);
  c.groupBy = vi.fn().mockReturnValue(c);
  c.limit = vi.fn().mockResolvedValue(rows);
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
  };
}

// ─── generateQuestionsFromVerifiedTruth ──────────────────────────────────────
describe("graphQuestionGenerator — generateQuestionsFromVerifiedTruth()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns empty array when DB is unavailable", async () => {
    mockGetDb.mockResolvedValue(null);

    const result = await generateQuestionsFromVerifiedTruth(1);

    expect(result).toEqual([]);
  });

  it("returns empty array when entity has no subgraph", async () => {
    const db = makeDb([]);
    // Entity lookup returns no rows → no subgraph
    const chain = makeChain([]);
    chain.limit = vi.fn().mockResolvedValue([]);
    chain.where = vi.fn().mockReturnValue(chain);
    chain.from = vi.fn().mockReturnValue(chain);
    db.select = vi.fn().mockReturnValue(chain);
    mockGetDb.mockResolvedValue(db);

    const result = await generateQuestionsFromVerifiedTruth(999);

    expect(result).toEqual([]);
  });

  it("returns an array of GeneratedClaimCandidate objects when LLM responds", async () => {
    const db = makeDb([]);
    // Entity exists
    const entityRow = { id: 1, name: "Hemoglobin", entityType: "protein" };
    const relRow = {
      sourceEntityId: 1,
      targetEntityId: 2,
      relationshipType: "binds",
      evidence: "PDB 1HHO",
      confidenceScore: 0.9,
    };
    const entityChain = makeChain([entityRow]);
    entityChain.limit = vi.fn().mockResolvedValue([entityRow]);
    entityChain.where = vi.fn().mockReturnValue(entityChain);
    entityChain.from = vi.fn().mockReturnValue(entityChain);

    const relChain = makeChain([relRow]);
    relChain.limit = vi.fn().mockResolvedValue([relRow]);
    relChain.where = vi.fn().mockReturnValue(relChain);
    relChain.from = vi.fn().mockReturnValue(relChain);

    let callCount = 0;
    db.select = vi.fn().mockImplementation(() => {
      callCount++;
      return callCount === 1 ? entityChain : relChain;
    });
    mockGetDb.mockResolvedValue(db);

    // LLM returns gap-fill claims
    const llmResponse = {
      choices: [
        {
          message: {
            content: JSON.stringify([
              {
                claimText: "Hemoglobin binds oxygen at the heme group",
                claimType: "mechanism",
                targetEntityName: "Hemoglobin",
                targetEntityType: "protein",
                rationale: "Gap in binding mechanism",
                priority: 0.8,
              },
            ]),
          },
        },
      ],
    };
    mockInvokeLLM.mockResolvedValue(llmResponse);

    const result = await generateQuestionsFromVerifiedTruth(1);

    expect(Array.isArray(result)).toBe(true);
    // Each item should have the GeneratedClaimCandidate shape
    for (const item of result) {
      expect(typeof item.claimText).toBe("string");
      expect(typeof item.claimType).toBe("string");
    }
  });
});

// ─── generateQuestionsFromTopEntities ────────────────────────────────────────
describe("graphQuestionGenerator — generateQuestionsFromTopEntities()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns empty array when DB is unavailable", async () => {
    mockGetDb.mockResolvedValue(null);

    const result = await generateQuestionsFromTopEntities(10);

    expect(result).toEqual([]);
  });

  it("returns empty array when no top entities found", async () => {
    const db = makeDb([]);
    const chain = makeChain([]);
    chain.limit = vi.fn().mockResolvedValue([]);
    chain.orderBy = vi.fn().mockReturnValue(chain);
    chain.groupBy = vi.fn().mockReturnValue(chain);
    chain.from = vi.fn().mockReturnValue(chain);
    db.select = vi.fn().mockReturnValue(chain);
    mockGetDb.mockResolvedValue(db);

    const result = await generateQuestionsFromTopEntities(5);

    expect(result).toEqual([]);
  });

  it("uses default limit of 20", async () => {
    const db = makeDb([]);
    const chain = makeChain([]);
    chain.limit = vi.fn().mockResolvedValue([]);
    chain.orderBy = vi.fn().mockReturnValue(chain);
    chain.groupBy = vi.fn().mockReturnValue(chain);
    chain.from = vi.fn().mockReturnValue(chain);
    db.select = vi.fn().mockReturnValue(chain);
    mockGetDb.mockResolvedValue(db);

    await generateQuestionsFromTopEntities();

    // limit(20) should have been called
    expect(chain.limit).toHaveBeenCalledWith(20);
  });

  it("aggregates candidates from multiple entities", async () => {
    const db = makeDb([]);
    // Top entities: two entities
    const topEntities = [
      { entityId: 1, count: 10 },
      { entityId: 2, count: 5 },
    ];
    const topChain = makeChain(topEntities);
    topChain.limit = vi.fn().mockResolvedValue(topEntities);
    topChain.orderBy = vi.fn().mockReturnValue(topChain);
    topChain.groupBy = vi.fn().mockReturnValue(topChain);
    topChain.from = vi.fn().mockReturnValue(topChain);

    // For each entity lookup → no subgraph (returns [])
    const emptyChain = makeChain([]);
    emptyChain.limit = vi.fn().mockResolvedValue([]);
    emptyChain.where = vi.fn().mockReturnValue(emptyChain);
    emptyChain.from = vi.fn().mockReturnValue(emptyChain);

    let callCount = 0;
    db.select = vi.fn().mockImplementation(() => {
      callCount++;
      return callCount === 1 ? topChain : emptyChain;
    });
    mockGetDb.mockResolvedValue(db);

    const result = await generateQuestionsFromTopEntities(2);

    expect(Array.isArray(result)).toBe(true);
  });
});
