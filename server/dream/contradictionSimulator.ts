/**
 * contradictionSimulator.ts — Dream Cycle 5: Contradiction Simulation
 *
 * Simulates "what-if" scenarios to stress-test the knowledge graph's
 * robustness. Unlike the other cycles, this cycle uses the LLM to reason
 * about hypothetical changes and their downstream effects.
 *
 * Scenarios simulated:
 *   S1. "What if the top-confidence claim in each contradiction cluster were
 *       retracted?" — estimates how many downstream claims would be affected.
 *   S2. "What if a key protein entity were removed from the graph?" — estimates
 *       the number of orphaned relations and evidence gaps.
 *   S3. "What if the primary source for a high-traffic entity went offline?" —
 *       estimates coverage loss.
 *
 * Each simulation produces a recommendation that is stored in the dream
 * session's simulationLog.
 */

import { getDb } from "../db";
import { invokeLLM } from "../_core/llm";
import { sql } from "drizzle-orm";

export interface SimulationScenario {
  scenario: string;
  impactedClaimCount: number;
  impactedEntityCount: number;
  recommendation: string;
}

export interface SimulationResult {
  scenarios: SimulationScenario[];
  totalSimulated: number;
}

/**
 * Run the contradiction simulation pass.
 * Limits to 3 scenarios to keep dream cycle time bounded.
 */
export async function runContradictionSimulation(): Promise<SimulationResult> {
  const db = await getDb();
  const scenarios: SimulationScenario[] = [];

  if (!db) return { scenarios, totalSimulated: 0 };

  // ── S1: Top-confidence claim retraction in contradiction clusters ──────────
  try {
    const clusterRows = await db.execute(sql`
      SELECT c.id, c.claimText, c.confidenceScore,
             COUNT(c2.id) AS contra_count
      FROM claims c
      JOIN claims c2 ON c2.documentId != c.documentId
        AND c2.verdict IN ('Refuted', 'Contradicted')
      WHERE c.confidenceScore IS NOT NULL
        AND c.confidenceScore > 0.7
        AND c.verdict = 'Supported'
      GROUP BY c.id, c.claimText, c.confidenceScore
      HAVING contra_count >= 2
      ORDER BY c.confidenceScore DESC
      LIMIT 1
    `);
    const topClaims = (clusterRows as unknown) as Array<{
      id: number;
      claimText: string;
      confidenceScore: number;
      contra_count: number;
    }>;

    if (topClaims.length > 0) {
      const topClaim = topClaims[0];

      // Ask LLM to estimate downstream impact
      let recommendation =
        "If this claim were retracted, downstream claims citing it would require re-verification.";
      try {
        const llmResp = await invokeLLM({
          messages: [
            {
              role: "system",
              content:
                "You are a scientific knowledge graph analyst. Respond in 1-2 sentences only.",
            },
            {
              role: "user",
              content: `If the following high-confidence claim were retracted due to new evidence, what is the most important downstream consequence for a protein structure knowledge base?\n\nClaim: "${topClaim.claimText}"\nConfidence: ${topClaim.confidenceScore}\nContradicting claims: ${topClaim.contra_count}`,
            },
          ],
        });
        const rawContent = llmResp?.choices?.[0]?.message?.content;
        const content = typeof rawContent === "string" ? rawContent : null;
        if (content) recommendation = content;
      } catch { /* LLM unavailable — use default */ }

      scenarios.push({
        scenario: `Retraction of top-confidence claim (ID: ${topClaim.id}, confidence: ${topClaim.confidenceScore})`,
        impactedClaimCount: topClaim.contra_count,
        impactedEntityCount: 1,
        recommendation,
      });
    }
  } catch { /* non-fatal */ }

  // ── S2: Key entity removal impact ─────────────────────────────────────────
  try {
    const entityRows = await db.execute(sql`
      SELECT ge.id, ge.canonicalName,
             COUNT(gr.id) AS edge_count
      FROM graph_entities ge
      JOIN graph_relations gr ON gr.sourceEntityId = ge.id OR gr.targetEntityId = ge.id
      GROUP BY ge.id, ge.canonicalName
      ORDER BY edge_count DESC
      LIMIT 1
    `);
    const topEntities = (entityRows as unknown) as Array<{
      id: number;
      canonicalName: string;
      edge_count: number;
    }>;

    if (topEntities.length > 0) {
      const topEntity = topEntities[0];
      scenarios.push({
        scenario: `Removal of most-connected entity: ${topEntity.canonicalName} (${topEntity.edge_count} edges)`,
        impactedClaimCount: 0,
        impactedEntityCount: topEntity.edge_count,
        recommendation: `Removing ${topEntity.canonicalName} would orphan ${topEntity.edge_count} relations. Consider adding a redundant anchor entity or ensuring all relations have alternative evidence paths.`,
      });
    }
  } catch { /* non-fatal */ }

  // ── S3: Source coverage loss ──────────────────────────────────────────────
  try {
    const sourceRows = await db.execute(sql`
      SELECT sourceType, COUNT(*) AS claim_count
      FROM claims
      WHERE sourceType IS NOT NULL
      GROUP BY sourceType
      ORDER BY claim_count DESC
      LIMIT 1
    `);
    const topSources = (sourceRows as unknown) as Array<{
      sourceType: string;
      claim_count: number;
    }>;

    if (topSources.length > 0) {
      const topSource = topSources[0];
      scenarios.push({
        scenario: `Primary source offline: ${topSource.sourceType} (${topSource.claim_count} claims)`,
        impactedClaimCount: topSource.claim_count,
        impactedEntityCount: 0,
        recommendation: `${topSource.claim_count} claims rely on ${topSource.sourceType}. Ensure fallback sources are configured and monitoring alerts are active for this source.`,
      });
    }
  } catch { /* non-fatal */ }

  return { scenarios, totalSimulated: scenarios.length };
}
