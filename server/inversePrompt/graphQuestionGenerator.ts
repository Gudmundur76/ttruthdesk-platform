/**
 * graphQuestionGenerator.ts
 *
 * Inverse Prompt Architecture:
 * Verified truth in the knowledge graph → structured, testable claims → coord_queue
 *
 * Three question types:
 *   1. gap_fill          — known entity, missing edge type
 *   2. homology_projection — verified pattern on A → test on homolog B
 *   3. contradiction_chase — contradicted edges → generate resolution query
 */

import { getDb } from "../db";
import { invokeLLM } from "../_core/llm";
import { graphEntities, graphRelations } from "../../drizzle/schema";
import { eq, inArray, sql } from "drizzle-orm";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface GeneratedClaimCandidate {
  claimText: string;
  claimType: string;
  inferenceType: "gap_fill" | "homology_projection" | "contradiction_chase";
  requiredSources: string[];
  sourceQuery: string;
  parentVerifications: number[];
  entityId: number;
  reasoning: string;
}

type RelationType = "cites" | "contradicts" | "validates" | "homologous_to" | "binds" | "expressed_in" | "uses_method" | "authored_by" | "related_to";

interface EdgeInfo {
  id: number;
  relationType: RelationType;
  targetEntityId: number;
  targetName: string;
  targetType: string;
  evidenceDocumentId: number | null;
  confidenceScore: number | null;
}

interface VerifiedSubgraph {
  centralEntity: { id: number; entityType: string; canonicalName: string };
  verifiedEdges: EdgeInfo[];
  contradictedEdges: EdgeInfo[];
  existingEdgeTypes: Set<string>;
}

// ─── Whitelisted source databases ─────────────────────────────────────────────

const WHITELISTED_SOURCES: Record<string, string[]> = {
  pdb_id:               ["rcsb_pdb"],
  protein_name:         ["rcsb_pdb", "uniprot"],
  resolution:           ["rcsb_pdb"],
  experimental_method:  ["rcsb_pdb"],
  organism:             ["rcsb_pdb", "uniprot"],
  ligand:               ["rcsb_pdb", "chembl"],
  homology:             ["rcsb_pdb", "uniprot"],
  general_molecular:    ["pubmed", "rcsb_pdb"],
};

// Expected edge types per entity type — gaps are edges that SHOULD exist but don't
const EXPECTED_EDGES_BY_TYPE: Record<string, RelationType[]> = {
  protein:  ["homologous_to", "binds", "expressed_in", "uses_method"],
  pdb_id:   ["uses_method", "expressed_in"],
  ligand:   ["binds"],
  organism: ["expressed_in"],
};

// ─── Core subgraph query ───────────────────────────────────────────────────────

async function getVerifiedSubgraph(entityId: number): Promise<VerifiedSubgraph | null> {
  const db = await getDb();
  if (!db) return null;

  const [entity] = await db
    .select({ id: graphEntities.id, entityType: graphEntities.entityType, canonicalName: graphEntities.canonicalName })
    .from(graphEntities)
    .where(eq(graphEntities.id, entityId))
    .limit(1);

  if (!entity) return null;

  const relations = await db
    .select({
      id: graphRelations.id,
      relationType: graphRelations.relationType,
      targetEntityId: graphRelations.targetEntityId,
      evidenceDocumentId: graphRelations.evidenceDocumentId,
      confidenceScore: graphRelations.confidenceScore,
    })
    .from(graphRelations)
    .where(eq(graphRelations.sourceEntityId, entityId));

  const targetIds = Array.from(new Set(relations.map((r) => r.targetEntityId)));
  const targetEntities = targetIds.length > 0
    ? await db
        .select({ id: graphEntities.id, canonicalName: graphEntities.canonicalName, entityType: graphEntities.entityType })
        .from(graphEntities)
        .where(inArray(graphEntities.id, targetIds))
    : [];

  const targetMap = new Map(targetEntities.map((e) => [e.id, e]));

  const verifiedEdges: EdgeInfo[] = [];
  const contradictedEdges: EdgeInfo[] = [];
  const existingEdgeTypes = new Set<string>();

  for (const rel of relations) {
    const target = targetMap.get(rel.targetEntityId);
    if (!target) continue;
    existingEdgeTypes.add(rel.relationType);
    const edge: EdgeInfo = {
      id: rel.id,
      relationType: rel.relationType as RelationType,
      targetEntityId: rel.targetEntityId,
      targetName: target.canonicalName,
      targetType: target.entityType,
      evidenceDocumentId: rel.evidenceDocumentId,
      confidenceScore: rel.confidenceScore,
    };
    // High-confidence edges are treated as "verified"
    if (rel.relationType === "validates" || (rel.confidenceScore !== null && rel.confidenceScore >= 0.8)) {
      verifiedEdges.push(edge);
    } else if (rel.relationType === "contradicts") {
      contradictedEdges.push(edge);
    } else {
      // moderate confidence — still count as verified for gap analysis
      verifiedEdges.push(edge);
    }
  }

  return { centralEntity: entity, verifiedEdges, contradictedEdges, existingEdgeTypes };
}

// ─── Gap-fill question generator ──────────────────────────────────────────────

async function generateGapFillClaims(subgraph: VerifiedSubgraph): Promise<GeneratedClaimCandidate[]> {
  const { centralEntity, verifiedEdges, existingEdgeTypes } = subgraph;
  const expectedEdges = EXPECTED_EDGES_BY_TYPE[centralEntity.entityType] ?? [];
  const missingEdgeTypes = expectedEdges.filter((e) => !existingEdgeTypes.has(e));

  if (missingEdgeTypes.length === 0 || verifiedEdges.length === 0) return [];

  const prompt = `You are a structural biology knowledge graph analyst.

Entity: "${centralEntity.canonicalName}" (type: ${centralEntity.entityType})
Verified edges: ${verifiedEdges.map((e) => `${e.relationType} → ${e.targetName}`).join(", ")}
Missing edge types (gaps): ${missingEdgeTypes.join(", ")}

For each missing edge type, generate a structured testable claim. Return a JSON array:
[{
  "claimText": "...",
  "claimType": "pdb_id|protein_name|resolution|experimental_method|organism|ligand|general_molecular",
  "sourceQuery": "exact query string to run against the source database",
  "requiredSources": ["rcsb_pdb"|"uniprot"|"pubmed"],
  "reasoning": "why this gap matters given the verified edges"
}]

Rules:
- Only generate claims answerable by querying rcsb_pdb, uniprot, or pubmed
- claimText must be a falsifiable statement, not a question
- Maximum 3 claims
- Return ONLY the JSON array, no other text`;

  try {
    const response = await invokeLLM({ messages: [{ role: "user", content: prompt }] });
    const rawContent = response.choices?.[0]?.message?.content ?? "[]";
    const raw = (typeof rawContent === "string" ? rawContent : JSON.stringify(rawContent)).trim();
    const jsonStr = raw.startsWith("[") ? raw : raw.replace(/^[^[]*/, "").replace(/[^\]]*$/, "");
    const arr = JSON.parse(jsonStr || "[]") as Array<{
      claimText: string; claimType: string; sourceQuery: string; requiredSources: string[]; reasoning: string;
    }>;

    return arr.slice(0, 3).map((item) => ({
      claimText: item.claimText,
      claimType: item.claimType ?? "general_molecular",
      inferenceType: "gap_fill" as const,
      requiredSources: item.requiredSources?.length ? item.requiredSources : (WHITELISTED_SOURCES[item.claimType ?? "general_molecular"] ?? ["rcsb_pdb"]),
      sourceQuery: item.sourceQuery ?? "",
      parentVerifications: verifiedEdges.map((e) => e.id),
      entityId: centralEntity.id,
      reasoning: item.reasoning ?? `Gap in ${missingEdgeTypes.join(", ")} for ${centralEntity.canonicalName}`,
    }));
  } catch {
    return [];
  }
}

// ─── Homology projection generator ────────────────────────────────────────────

async function generateHomologyClaims(subgraph: VerifiedSubgraph): Promise<GeneratedClaimCandidate[]> {
  const { centralEntity, verifiedEdges } = subgraph;

  const homologEdges = verifiedEdges.filter((e) => e.relationType === "homologous_to");
  if (homologEdges.length === 0) return [];

  const bindingEdges = verifiedEdges.filter((e) => (["binds", "uses_method"] as RelationType[]).includes(e.relationType));
  if (bindingEdges.length === 0) return [];

  const db = await getDb();
  if (!db) return [];

  const candidates: GeneratedClaimCandidate[] = [];

  for (const homolog of homologEdges.slice(0, 2)) {
    const homologRelations = await db
      .select({ relationType: graphRelations.relationType })
      .from(graphRelations)
      .where(eq(graphRelations.sourceEntityId, homolog.targetEntityId));

    const homologEdgeTypes = new Set(homologRelations.map((r) => r.relationType));

    for (const binding of bindingEdges.slice(0, 2)) {
      if (homologEdgeTypes.has(binding.relationType)) continue;

      candidates.push({
        claimText: `${homolog.targetName} has a ${binding.relationType.replace(/_/g, " ")} relationship with ${binding.targetName} (homology projection from ${centralEntity.canonicalName})`,
        claimType: binding.relationType === "uses_method" ? "experimental_method" : "general_molecular",
        inferenceType: "homology_projection",
        requiredSources: WHITELISTED_SOURCES["homology"],
        sourceQuery: `search ${homolog.targetName} ${binding.targetName} in rcsb_pdb uniprot`,
        parentVerifications: [binding.id, homolog.id],
        entityId: homolog.targetEntityId,
        reasoning: `${centralEntity.canonicalName} (verified ${binding.relationType} → ${binding.targetName}) is homologous to ${homolog.targetName}. Testing if homolog shares the same relationship.`,
      });
    }
  }

  return candidates.slice(0, 3);
}

// ─── Contradiction chase generator ────────────────────────────────────────────

function generateContradictionChaseClaims(subgraph: VerifiedSubgraph): GeneratedClaimCandidate[] {
  const { centralEntity, contradictedEdges, verifiedEdges } = subgraph;
  if (contradictedEdges.length === 0) return [];

  return contradictedEdges.slice(0, 3).map((contradiction) => {
    const verifiedCounterpart = verifiedEdges.find((e) => e.relationType === contradiction.relationType);
    const parentIds = [contradiction.id, ...(verifiedCounterpart ? [verifiedCounterpart.id] : [])];

    return {
      claimText: `There exists an authoritative source that resolves the discrepancy in ${contradiction.relationType.replace(/_/g, " ")} for ${centralEntity.canonicalName}: verified value is "${verifiedCounterpart?.targetName ?? "unknown"}" but contradicted sources claim "${contradiction.targetName}"`,
      claimType: "general_molecular",
      inferenceType: "contradiction_chase" as const,
      requiredSources: ["rcsb_pdb", "pubmed"],
      sourceQuery: `search ${centralEntity.canonicalName} ${contradiction.relationType} discrepancy resolution`,
      parentVerifications: parentIds,
      entityId: centralEntity.id,
      reasoning: `Contradiction detected: sources disagree on ${contradiction.relationType} for ${centralEntity.canonicalName}. Chasing resolution evidence.`,
    };
  });
}

// ─── Main entry points ────────────────────────────────────────────────────────

export async function generateQuestionsFromVerifiedTruth(
  entityId: number
): Promise<GeneratedClaimCandidate[]> {
  const subgraph = await getVerifiedSubgraph(entityId);
  if (!subgraph) return [];

  const [gapClaims, homologyClaims] = await Promise.all([
    generateGapFillClaims(subgraph),
    generateHomologyClaims(subgraph),
  ]);
  const contradictionClaims = generateContradictionChaseClaims(subgraph);

  return [...gapClaims, ...homologyClaims, ...contradictionClaims];
}

/**
 * Run generation across the top N most-connected entities in the graph.
 * Used by the scheduled heartbeat and the Self-Prompting Engine.
 */
export async function generateQuestionsFromTopEntities(limit = 20): Promise<GeneratedClaimCandidate[]> {
  const db = await getDb();
  if (!db) return [];

  const topEntities = await db
    .select({
      entityId: graphRelations.sourceEntityId,
      count: sql<number>`count(*)`.as("count"),
    })
    .from(graphRelations)
    .groupBy(graphRelations.sourceEntityId)
    .orderBy(sql`count(*) DESC`)
    .limit(limit);

  const allCandidates: GeneratedClaimCandidate[] = [];

  for (const row of topEntities) {
    const candidates = await generateQuestionsFromVerifiedTruth(row.entityId);
    allCandidates.push(...candidates);
  }

  return allCandidates;
}
