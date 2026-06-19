/**
 * evidencePursuer.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Frontier Engine — Layer 3: Autonomous Evidence Pursuit
 *
 * When a high-priority gap is identified, the Frontier Engine:
 *   1. Expands search terms to target the gap (MeSH query expansion)
 *   2. Raises the priority of relevant coord_queue items
 *   3. Queues new discovery tasks if no existing queue item covers the gap
 *   4. Logs all actions to frontier_log
 *
 * The Frontier Engine NEVER writes verdicts, graph edges, or claim records.
 * It only modifies coord_queue (priority + new items) and knowledge_gaps (status).
 */

import { getDb } from "../db";
import { knowledgeGaps, frontierLog, coordQueue } from "../../drizzle/schema";
import { eq, sql, and } from "drizzle-orm";

// ─── DB helper ────────────────────────────────────────────────────────────────
async function getDbOrThrow() {
  const d = await getDb();
  if (!d) throw new Error("[FrontierEngine] Database not available");
  return d;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PursuitResult {
  gapId: number;
  action: "priority_raised" | "queue_item_created" | "search_expanded" | "no_action";
  queueItemId?: number;
  details: string;
}

// ─── Core: expandSearchTerms ──────────────────────────────────────────────────

/**
 * Generates expanded MeSH search terms for a gap based on its description.
 * Uses simple keyword extraction — the hypothesis generator handles LLM-based expansion.
 */
function expandSearchTermsForGap(description: string, gapType: string): string[] {
  const terms: string[] = [];

  // Extract quoted entity names from description
  const quoted = description.match(/"([^"]+)"/g)?.map((s) => s.replace(/"/g, "")) ?? [];
  terms.push(...quoted);

  // Add gap-type specific MeSH terms
  switch (gapType) {
    case "contradiction":
      terms.push("systematic review", "meta-analysis", "replication study");
      break;
    case "evidence":
      terms.push("experimental validation", "in vitro study", "structural analysis");
      break;
    case "temporal":
      terms.push("recent advances", "updated evidence", "current state");
      break;
    case "structural":
      terms.push("protein structure", "molecular characterization", "functional analysis");
      break;
    case "hypothesis":
      terms.push("binding assay", "interaction study", "homology modeling");
      break;
  }

  return Array.from(new Set(terms)).slice(0, 8); // Deduplicate, max 8 terms
}

// ─── Core: pursueGap ─────────────────────────────────────────────────────────

/**
 * Pursues a single high-priority gap:
 *   1. Check if a coord_queue item already exists for this gap
 *   2. If yes, raise its priority
 *   3. If no, create a new queue item with expanded search terms
 *   4. Update gap status to "pursued"
 */
export async function pursueGap(gap: typeof knowledgeGaps.$inferSelect): Promise<PursuitResult> {
  const db = await getDbOrThrow();

  try {
    // Check if a queue item already exists for this gap
    const existing = await db
      .select({ id: coordQueue.id, priority: coordQueue.priority })
      .from(coordQueue)
      .where(
        and(
          eq(coordQueue.source, "frontier_hypothesis"),
          sql`JSON_EXTRACT(result, '$.gapId') = ${gap.id}`
        )
      )
      .limit(1);

    const searchTerms = expandSearchTermsForGap(gap.description, gap.gapType);

    if (existing.length > 0) {
      // Raise priority of existing queue item
      const newPriority = Math.min((existing[0].priority ?? 0) + 50, 100);
      await db
        .update(coordQueue)
        .set({ priority: newPriority })
        .where(eq(coordQueue.id, existing[0].id));

      await db.insert(frontierLog).values({
        actionType: "priority_adjusted",
        gapId: gap.id,
        queueItemId: existing[0].id,
        reasoning: {
          gapId: gap.id,
          gapType: gap.gapType,
          priorityScore: gap.priorityScore,
          newQueuePriority: newPriority,
          searchTerms,
        },
        outcome: `Queue item #${existing[0].id} priority raised to ${newPriority}`,
      });

      return {
        gapId: gap.id,
        action: "priority_raised",
        queueItemId: existing[0].id,
        details: `Queue item #${existing[0].id} priority raised to ${newPriority}`,
      };
    }

    // Create a new coord_queue item for this gap
    // The discovery agent will pick this up and find papers addressing the gap
    const [inserted] = await db.insert(coordQueue).values({
      vertical: "protein", // Default vertical — hypothesis generator refines this
      priority: 50, // High priority for Frontier-initiated pursuit
      status: "pending",
      source: "frontier_hypothesis",
      title: `[Frontier] Evidence pursuit for gap: ${gap.description.slice(0, 200)}`,
      result: { gapId: gap.id, searchTerms, gapType: gap.gapType } as unknown as null,
    });

    const queueItemId = (inserted as unknown as { insertId: number }).insertId;

    // Update gap status to "pursued" and record the queue item
    await db
      .update(knowledgeGaps)
      .set({
        status: "pursued",
        pursuitQueueId: queueItemId,
        lastPursuedAt: new Date(),
        evidenceAttempts: sql`evidenceAttempts + 1`,
        updatedAt: new Date(),
      })
      .where(eq(knowledgeGaps.id, gap.id));

    await db.insert(frontierLog).values({
      actionType: "hypothesis_queued",
      gapId: gap.id,
      queueItemId,
      reasoning: {
        gapId: gap.id,
        gapType: gap.gapType,
        priorityScore: gap.priorityScore,
        searchTerms,
        description: gap.description.slice(0, 300),
      },
      outcome: `New coord_queue item #${queueItemId} created for evidence pursuit`,
    });

    return {
      gapId: gap.id,
      action: "queue_item_created",
      queueItemId,
      details: `New queue item #${queueItemId} created with search terms: ${searchTerms.join(", ")}`,
    };
  } catch (err) {
    return {
      gapId: gap.id,
      action: "no_action",
      details: `Error pursuing gap: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

// ─── Public: pursueTopGaps ────────────────────────────────────────────────────

/**
 * Pursues the top N highest-priority open gaps.
 * Called by the Frontier Engine orchestrator on each tick.
 */
export async function pursueTopGaps(
  limit = 5,
  /** Build3: If set, only pursue gaps involving this entity (deep_dive_entity directive) */
  entityId?: number
): Promise<PursuitResult[]> {
  const db = await getDbOrThrow();

  const whereClause = entityId
    ? sql`status = 'open' AND (entityAId = ${entityId} OR entityBId = ${entityId})`
    : eq(knowledgeGaps.status, "open");

  const topGaps = await db
    .select()
    .from(knowledgeGaps)
    .where(whereClause)
    .orderBy(sql`priorityScore DESC`)
    .limit(limit);

  const results: PursuitResult[] = [];
  for (const gap of topGaps) {
    const result = await pursueGap(gap);
    results.push(result);
  }

  return results;
}

/**
 * Marks a gap as closed when verified evidence is found.
 * Called by analysisPipeline when a previously "Insufficient Evidence" claim
 * is re-verified with a Supported or Contradicted verdict.
 */
export async function closeGap(
  gapId: number,
  closingEvidenceId: number,
  resolution: "closed_verified" | "closed_resolved"
): Promise<void> {
  const db = await getDbOrThrow();

  await db
    .update(knowledgeGaps)
    .set({
      status: resolution,
      closingEvidenceId,
      updatedAt: new Date(),
    })
    .where(eq(knowledgeGaps.id, gapId));

  await db.insert(frontierLog).values({
    actionType: "gap_closed",
    gapId,
    reasoning: {
      closingEvidenceId,
      resolution,
    },
    outcome: `Gap #${gapId} closed with status: ${resolution}`,
  });
}
