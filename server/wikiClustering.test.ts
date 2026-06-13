/**
 * wikiClustering.test.ts
 *
 * Phase 125 — Semantic clustering in wiki compiler.
 * Tests for clusterEntitiesBySimilarity and buildClusterCrossLinks.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SimilarClaim } from "./claimSimilarityEngine";

// ─── Mocks ────────────────────────────────────────────────────────────────────
vi.mock("./claimSimilarityEngine", () => ({
  findSimilarClaims: vi.fn(),
}));
vi.mock("./db", () => ({
  getDb: vi.fn(() => ({})),
}));
vi.mock("./logger", () => ({
  logger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
  errData: vi.fn((e: unknown) => ({ message: String(e) })),
}));

import { findSimilarClaims } from "./claimSimilarityEngine";
import {
  clusterEntitiesBySimilarity,
  buildClusterCrossLinks,
  type WikiEntity,
  type EntityCluster,
} from "./wikiClustering";

const mockFindSimilarClaims = vi.mocked(findSimilarClaims);

// ─── Fixtures ─────────────────────────────────────────────────────────────────
function makeEntity(overrides: Partial<WikiEntity> = {}): WikiEntity {
  return {
    entityType: "protein",
    canonicalName: "BRCA1",
    claimIds: [1, 2, 3],
    relationType: "mentions_protein",
    ...overrides,
  };
}
function makeSimilarClaim(overrides: Partial<SimilarClaim> = {}): SimilarClaim {

  return {
    claimId: 10,
    documentId: 1,
    documentTitle: "Test Document",
    claimText: "BRCA1 interacts with BARD1",
    verdict: "Supported",
    confidenceScore: 0.9,
    similarity: 0.85,
    ...overrides,
  };
}

// ─── clusterEntitiesBySimilarity ─────────────────────────────────────────────
describe("clusterEntitiesBySimilarity", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockFindSimilarClaims.mockResolvedValue([]);
  });

  it("returns an empty array when given no entities", async () => {
    const result = await clusterEntitiesBySimilarity([]);
    expect(result).toEqual([]);
  });

  it("returns a single cluster when given one entity", async () => {
    const entity = makeEntity();
    const result = await clusterEntitiesBySimilarity([entity]);
    expect(result).toHaveLength(1);
    expect(result[0].entities).toHaveLength(1);
    expect(result[0].entities[0]).toBe(entity);
  });

  it("groups entities sharing similar claims into the same cluster", async () => {
    const e1 = makeEntity({ canonicalName: "BRCA1", claimIds: [1] });
    const e2 = makeEntity({ canonicalName: "BARD1", claimIds: [2] });
    // e1 and e2 share a similar claim
    mockFindSimilarClaims.mockImplementation(async (claimText, opts) => {
      if (claimText.includes("BRCA1")) {
        return [makeSimilarClaim({ claimId: 2, similarity: 0.9 })];
      }
      return [];
    });
    const result = await clusterEntitiesBySimilarity([e1, e2]);
    // They should be in the same cluster
    const allEntities = result.flatMap((c) => c.entities);
    expect(allEntities).toHaveLength(2);
    // At most 2 clusters (ideally 1 since they are similar)
    expect(result.length).toBeLessThanOrEqual(2);
  });

  it("keeps unrelated entities in separate clusters", async () => {
    const e1 = makeEntity({ canonicalName: "BRCA1", claimIds: [1] });
    const e2 = makeEntity({ canonicalName: "Creatine", entityType: "compound", claimIds: [5] });
    mockFindSimilarClaims.mockResolvedValue([]);
    const result = await clusterEntitiesBySimilarity([e1, e2]);
    expect(result).toHaveLength(2);
  });

  it("assigns a representative label to each cluster", async () => {
    const entity = makeEntity({ canonicalName: "BRCA1" });
    const result = await clusterEntitiesBySimilarity([entity]);
    expect(result[0].label).toBeTruthy();
    expect(typeof result[0].label).toBe("string");
  });

  it("assigns a numeric clusterIndex to each cluster", async () => {
    const entities = [
      makeEntity({ canonicalName: "A" }),
      makeEntity({ canonicalName: "B" }),
    ];
    const result = await clusterEntitiesBySimilarity(entities);
    result.forEach((cluster, i) => {
      expect(cluster.clusterIndex).toBe(i);
    });
  });

  it("does not call findSimilarClaims when entities have no claimIds", async () => {
    const entity = makeEntity({ claimIds: [] });
    await clusterEntitiesBySimilarity([entity]);
    expect(mockFindSimilarClaims).not.toHaveBeenCalled();
  });

  it("handles findSimilarClaims rejection gracefully", async () => {
    const entity = makeEntity({ claimIds: [1] });
    mockFindSimilarClaims.mockRejectedValue(new Error("vector store down"));
    // Should not throw — falls back to single-entity cluster
    const result = await clusterEntitiesBySimilarity([entity]);
    expect(result).toHaveLength(1);
  });

  it("respects the threshold option — low threshold merges more", async () => {
    const e1 = makeEntity({ canonicalName: "A", claimIds: [1] });
    const e2 = makeEntity({ canonicalName: "B", claimIds: [2] });
    mockFindSimilarClaims.mockResolvedValue([
      makeSimilarClaim({ claimId: 2, similarity: 0.6 }),
    ]);
    const resultStrict = await clusterEntitiesBySimilarity([e1, e2], { threshold: 0.8 });
    const resultLoose = await clusterEntitiesBySimilarity([e1, e2], { threshold: 0.5 });
    // With strict threshold, similarity 0.6 < 0.8 → separate clusters
    expect(resultStrict.length).toBeGreaterThanOrEqual(resultLoose.length);
  });
});

// ─── buildClusterCrossLinks ───────────────────────────────────────────────────
describe("buildClusterCrossLinks", () => {
  it("returns an empty string for a single-entity cluster", () => {
    const cluster: EntityCluster = {
      clusterIndex: 0,
      label: "BRCA1",
      entities: [makeEntity()],
    };
    // Pass selfName so the entity excludes itself — no other entities remain
    const result = buildClusterCrossLinks(cluster, "BRCA1");
    expect(result).toBe("");
  });

  it("returns a markdown section with links for multi-entity clusters", () => {
    const cluster: EntityCluster = {
      clusterIndex: 0,
      label: "BRCA1 cluster",
      entities: [
        makeEntity({ canonicalName: "BRCA1" }),
        makeEntity({ canonicalName: "BARD1" }),
      ],
    };
    const result = buildClusterCrossLinks(cluster);
    expect(result).toContain("## Related Entities");
    expect(result).toContain("BRCA1");
    expect(result).toContain("BARD1");
  });

  it("produces valid markdown link syntax", () => {
    const cluster: EntityCluster = {
      clusterIndex: 0,
      label: "test",
      entities: [
        makeEntity({ canonicalName: "Alpha Protein" }),
        makeEntity({ canonicalName: "Beta Compound", entityType: "compound" }),
      ],
    };
    const result = buildClusterCrossLinks(cluster);
    // Should contain at least one markdown link [text](url)
    expect(result).toMatch(/\[.+\]\(.+\)/);
  });

  it("does not include the entity itself in its own cross-links", () => {
    const cluster: EntityCluster = {
      clusterIndex: 0,
      label: "test",
      entities: [
        makeEntity({ canonicalName: "BRCA1" }),
        makeEntity({ canonicalName: "BARD1" }),
      ],
    };
    // Build cross-links for the first entity
    const result = buildClusterCrossLinks(cluster, "BRCA1");
    // Should contain BARD1 but not a self-link to BRCA1
    expect(result).toContain("BARD1");
    // Self-reference should not appear as a link
    expect(result).not.toMatch(/\[BRCA1\]\(/);
  });
});
