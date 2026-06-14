/**
 * topologyHypothesisGenerator.test.ts
 * Unit tests for dream/topologyHypothesisGenerator.ts
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  mockGetDb: vi.fn(),
  mockRunVerifiabilityGate: vi.fn(),
  mockPersistGeneratedClaim: vi.fn(),
}));

vi.mock("../db", () => ({ getDb: mocks.mockGetDb }));
vi.mock("../inversePrompt/verifiabilityGate", () => ({
  runVerifiabilityGate: mocks.mockRunVerifiabilityGate,
}));
vi.mock("../inversePrompt/claimQueueWriter", () => ({
  persistGeneratedClaim: mocks.mockPersistGeneratedClaim,
}));

const makeDb = () => {
  const db = {
    select: vi.fn(),
    from: vi.fn(),
    where: vi.fn(),
    limit: vi.fn(),
  };
  db.select.mockReturnValue(db);
  db.from.mockReturnValue(db);
  db.where.mockReturnValue(db);
  db.limit.mockResolvedValue([]);
  return db;
};

import type { DetectedPattern } from "./latentPatternDetector";

const makeHomologyPattern = (): DetectedPattern => ({
  type: "homology_bridge",
  entityIds: [1, 2],
  evidence: "shared experimental methods",
  description: "Two proteins share experimental methods but lack homologous_to edge",
  urgency: "medium" as const,
});

const makeContradictionPattern = (): DetectedPattern => ({
  type: "contradiction_cluster",
  entityIds: [3],
  evidence: "high contradiction degree",
  description: "Entity has multiple contradicting claims",
  urgency: "high" as const,
});

describe("generateTopologyHypotheses()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mocks.mockRunVerifiabilityGate.mockReturnValue({
      verdict: "pass",
      priority: 60,
      isHypothesis: true,
    });
    mocks.mockPersistGeneratedClaim.mockResolvedValue({ status: "queued", generatedClaimId: 1 });
  });

  it("returns zero result when DB is unavailable", async () => {
    mocks.mockGetDb.mockResolvedValue(null);
    const { generateTopologyHypotheses } = await import("./topologyHypothesisGenerator");
    const result = await generateTopologyHypotheses([makeHomologyPattern()]);
    expect(result.hypothesesQueued).toBe(0);
    expect(result.hypothesesRejected).toBe(0);
    expect(result.hypothesesDeferred).toBe(0);
  });

  it("returns zero result when patterns array is empty", async () => {
    mocks.mockGetDb.mockResolvedValue(makeDb());
    const { generateTopologyHypotheses } = await import("./topologyHypothesisGenerator");
    const result = await generateTopologyHypotheses([]);
    expect(result.hypothesesQueued).toBe(0);
  });

  it("queues homology hypothesis when both entities exist", async () => {
    const db = makeDb();
    db.limit
      .mockResolvedValueOnce([{ canonicalName: "Protein A" }])  // entityA
      .mockResolvedValueOnce([{ canonicalName: "Protein B" }]); // entityB
    mocks.mockGetDb.mockResolvedValue(db);
    const { generateTopologyHypotheses } = await import("./topologyHypothesisGenerator");
    const result = await generateTopologyHypotheses([makeHomologyPattern()]);
    expect(result.hypothesesQueued).toBe(1);
    expect(mocks.mockPersistGeneratedClaim).toHaveBeenCalledOnce();
  });

  it("skips homology hypothesis when entity lookup returns empty", async () => {
    const db = makeDb();
    db.limit.mockResolvedValue([]); // both entities not found
    mocks.mockGetDb.mockResolvedValue(db);
    const { generateTopologyHypotheses } = await import("./topologyHypothesisGenerator");
    const result = await generateTopologyHypotheses([makeHomologyPattern()]);
    expect(result.hypothesesQueued).toBe(0);
    expect(mocks.mockPersistGeneratedClaim).not.toHaveBeenCalled();
  });

  it("queues contradiction-chase hypothesis when entity exists", async () => {
    const db = makeDb();
    db.limit.mockResolvedValueOnce([{ canonicalName: "Protein C" }]);
    mocks.mockGetDb.mockResolvedValue(db);
    const { generateTopologyHypotheses } = await import("./topologyHypothesisGenerator");
    const result = await generateTopologyHypotheses([makeContradictionPattern()]);
    expect(result.hypothesesQueued).toBe(1);
  });

  it("counts rejected hypotheses when gate returns reject", async () => {
    const db = makeDb();
    db.limit
      .mockResolvedValueOnce([{ canonicalName: "Protein A" }])
      .mockResolvedValueOnce([{ canonicalName: "Protein B" }]);
    mocks.mockGetDb.mockResolvedValue(db);
    mocks.mockPersistGeneratedClaim.mockResolvedValue({ status: "rejected", generatedClaimId: 2 });
    const { generateTopologyHypotheses } = await import("./topologyHypothesisGenerator");
    const result = await generateTopologyHypotheses([makeHomologyPattern()]);
    expect(result.hypothesesRejected).toBe(1);
    expect(result.hypothesesQueued).toBe(0);
  });

  it("handles multiple patterns and accumulates counts", async () => {
    const db = makeDb();
    db.limit
      .mockResolvedValueOnce([{ canonicalName: "Protein A" }])
      .mockResolvedValueOnce([{ canonicalName: "Protein B" }])
      .mockResolvedValueOnce([{ canonicalName: "Protein C" }]);
    mocks.mockGetDb.mockResolvedValue(db);
    const { generateTopologyHypotheses } = await import("./topologyHypothesisGenerator");
    const result = await generateTopologyHypotheses([
      makeHomologyPattern(),
      makeContradictionPattern(),
    ]);
    expect(result.hypothesesQueued).toBe(2);
  });
});
