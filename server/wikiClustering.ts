/**
 * wikiClustering.ts
 *
 * Phase 125 — Semantic clustering in wiki compiler.
 *
 * Groups extracted wiki entities by semantic similarity so that related
 * entities get cross-linked in their compiled wiki pages.
 *
 * Algorithm:
 *   1. For each entity that has at least one claim, call findSimilarClaims
 *      on a representative claim text to discover semantically related claims.
 *   2. Build an adjacency map: entity A and entity B are adjacent if any of
 *      B's claimIds appear in A's similar-claims result (above threshold).
 *   3. Run a simple union-find to group adjacent entities into clusters.
 *   4. Return clusters sorted by size (largest first), each with a label
 *      derived from the most representative entity name.
 */

import { logger } from "./logger";
import { findSimilarClaims } from "./claimSimilarityEngine";
// Inline slugify to avoid the wikiCompiler → seo/indexNow import chain in tests
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
}

const log = logger("wikiClustering");

// ─── Types ────────────────────────────────────────────────────────────────────

export interface WikiEntity {
  entityType: string;
  canonicalName: string;
  claimIds: number[];
  relationType: string;
}

export interface EntityCluster {
  clusterIndex: number;
  label: string;
  entities: WikiEntity[];
}

export interface ClusteringOptions {
  /** Minimum similarity score to consider two entities related. Default: 0.75 */
  threshold?: number;
  /** Maximum number of similar claims to fetch per entity. Default: 10 */
  topK?: number;
}

// ─── Union-Find ───────────────────────────────────────────────────────────────

class UnionFind {
  private parent: number[];
  private rank: number[];

  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i);
    this.rank = new Array(n).fill(0);
  }

  find(x: number): number {
    if (this.parent[x] !== x) {
      this.parent[x] = this.find(this.parent[x]);
    }
    return this.parent[x];
  }

  union(x: number, y: number): void {
    const px = this.find(x);
    const py = this.find(y);
    if (px === py) return;
    if (this.rank[px] < this.rank[py]) {
      this.parent[px] = py;
    } else if (this.rank[px] > this.rank[py]) {
      this.parent[py] = px;
    } else {
      this.parent[py] = px;
      this.rank[px]++;
    }
  }
}

// ─── clusterEntitiesBySimilarity ─────────────────────────────────────────────

/**
 * Groups a list of wiki entities into semantic clusters.
 *
 * Entities with overlapping similar-claim sets are merged into the same
 * cluster. Entities with no claims, or whose similarity queries fail, are
 * placed in singleton clusters.
 */
export async function clusterEntitiesBySimilarity(
  entities: WikiEntity[],
  options: ClusteringOptions = {}
): Promise<EntityCluster[]> {
  if (entities.length === 0) return [];

  const threshold = options.threshold ?? 0.75;
  const topK = options.topK ?? 10;

  // Build a map from claimId → entity indices
  const claimToEntities = new Map<number, number[]>();
  for (let i = 0; i < entities.length; i++) {
    for (const cid of entities[i].claimIds) {
      const existing = claimToEntities.get(cid) ?? [];
      existing.push(i);
      claimToEntities.set(cid, existing);
    }
  }

  const uf = new UnionFind(entities.length);

  // For each entity, find similar claims and merge with entities that share them
  for (let i = 0; i < entities.length; i++) {
    const entity = entities[i];
    if (entity.claimIds.length === 0) continue;

    try {
      const representativeText = `${entity.canonicalName} ${entity.entityType}`;
      const similar = await findSimilarClaims(representativeText, {
        topK,
        threshold,
      });

      for (const sim of similar) {
        if (sim.similarity < threshold) continue;
        // Find entities that own this similar claim
        const owners = claimToEntities.get(sim.claimId) ?? [];
        for (const j of owners) {
          if (j !== i) {
            uf.union(i, j);
          }
        }
      }
    } catch (err) {
      // Non-fatal — fall back to singleton cluster for this entity
      log.warn(
        `[wikiClustering] findSimilarClaims failed for "${entity.canonicalName}": ${String(err)}`
      );
    }
  }

  // Group entities by their root
  const rootToIndices = new Map<number, number[]>();
  for (let i = 0; i < entities.length; i++) {
    const root = uf.find(i);
    const group = rootToIndices.get(root) ?? [];
    group.push(i);
    rootToIndices.set(root, group);
  }

  // Build clusters sorted by size (largest first)
  const clusters: EntityCluster[] = [];
  let clusterIndex = 0;
  for (const indices of Array.from(rootToIndices.values())) {
    const clusterEntities = indices.map((i) => entities[i]);
    // Label: use the canonicalName of the first (or most prominent) entity
    const label = clusterEntities[0].canonicalName;
    clusters.push({ clusterIndex, label, entities: clusterEntities });
    clusterIndex++;
  }

  // Sort largest clusters first
  clusters.sort((a, b) => b.entities.length - a.entities.length);
  // Re-index after sort
  clusters.forEach((c, i) => {
    c.clusterIndex = i;
  });

  log.info(
    `[wikiClustering] ${entities.length} entities → ${clusters.length} clusters`
  );

  return clusters;
}

// ─── buildClusterCrossLinks ───────────────────────────────────────────────────

/**
 * Builds a markdown "Related Entities" section for a wiki page.
 *
 * @param cluster     The cluster this entity belongs to.
 * @param selfName    The canonicalName of the entity whose page is being built.
 *                    When provided, the entity itself is excluded from the links.
 * @returns           A markdown string, or "" if there are no other entities.
 */
export function buildClusterCrossLinks(
  cluster: EntityCluster,
  selfName?: string
): string {
  const others = selfName
    ? cluster.entities.filter((e) => e.canonicalName !== selfName)
    : cluster.entities;

  if (others.length === 0) return "";

  const lines = ["## Related Entities", ""];
  for (const entity of others) {
    const slug = slugify(entity.canonicalName);
    const path = `/wiki/${entity.entityType}/${slug}`;
    lines.push(`- [${entity.canonicalName}](${path})`);
  }

  return lines.join("\n");
}
