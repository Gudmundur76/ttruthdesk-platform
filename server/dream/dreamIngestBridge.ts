/**
 * dreamIngestBridge.ts — Dream → Ingest Pipeline Bridge
 * ─────────────────────────────────────────────────────────────────────────────
 * Picks up generated_claims with status = "pending" that passed the
 * verifiability gate (passedGate = true) and enqueues them to coordQueue
 * for evidence pursuit by the standard ingestion pipeline.
 *
 * This closes the loop: Dream State generates hypotheses → bridge enqueues
 * them → ingestion pipeline pursues evidence → verdictEngine evaluates.
 *
 * Called by:
 *   - autonomousLoop/loopOrchestrator.ts (after dream_session_complete event)
 *   - POST /api/v2/dream/start (after manual trigger completes)
 *   - Scheduled heartbeat job (every 30 minutes)
 */
import { getDb } from "../db";
import { generatedClaims, coordQueue } from "../../drizzle/schema";
import { eq, and } from "drizzle-orm";
import { logger, errData } from "../logger";

const log = logger("dream/dreamIngestBridge");

// ─── Types ────────────────────────────────────────────────────────────────────
export interface BridgeResult {
  processed: number;
  queued: number;
  skipped: number;
  bridgedAt: Date;
  error?: string;
}

export interface DreamIngestStats {
  pendingDreamClaims: number;
  queuedDreamClaims: number;
}

// ─── Bridge ───────────────────────────────────────────────────────────────────
/**
 * Pick up pending dream-originated claims and enqueue them for evidence pursuit.
 * Only claims that passed the verifiability gate are enqueued.
 */
export async function bridgeDreamClaimsToIngest(
  batchSize = 20
): Promise<BridgeResult> {
  const bridgedAt = new Date();
  const db = await getDb();

  if (!db) {
    return { processed: 0, queued: 0, skipped: 0, bridgedAt, error: "Database unavailable" };
  }

  let processed = 0;
  let queued = 0;
  let skipped = 0;

  try {
    const pending = await db
      .select()
      .from(generatedClaims)
      .where(eq(generatedClaims.status, "pending"))
      .limit(batchSize);

    for (const claim of pending) {
      processed++;

      // Skip claims that did not pass the verifiability gate
      if (!claim.passedGate) {
        skipped++;
        // Mark as rejected so we don't process it again
        await db
          .update(generatedClaims)
          .set({ status: "rejected" })
          .where(eq(generatedClaims.id, claim.id));
        continue;
      }

      try {
        // Determine the vertical from requiredSources
        const sources = claim.requiredSources as string[];
        const vertical = resolveVertical(sources, claim.claimType);

        // Enqueue to coordQueue for evidence pursuit
        const [insertResult] = await db.insert(coordQueue).values({
          vertical,
          pmid: null,
          doi: null,
          paperUrl: null,
          title: claim.claimText.slice(0, 255),
          priority: claim.priority ?? 50,
          status: "pending",
          retryCount: 0,
        });

        const coordQueueId = (insertResult as { insertId: number }).insertId;

        // Update generated_claim to "queued" and record the coordQueue reference
        await db
          .update(generatedClaims)
          .set({ status: "queued", coordQueueId })
          .where(eq(generatedClaims.id, claim.id));

        queued++;
        log.info(`Bridged dream claim ${claim.id} → coordQueue ${coordQueueId} (${vertical})`);
      } catch (itemErr: unknown) {
        log.error(`Failed to bridge dream claim ${claim.id}`, errData(itemErr));
        skipped++;
      }
    }
  } catch (err: unknown) {
    log.error("bridgeDreamClaimsToIngest failed", errData(err));
    return { processed, queued, skipped, bridgedAt, error: String(err) };
  }

  return { processed, queued, skipped, bridgedAt };
}

/**
 * Return current counts of pending and queued dream-originated claims.
 */
export async function getDreamIngestStats(): Promise<DreamIngestStats> {
  const db = await getDb();
  if (!db) return { pendingDreamClaims: 0, queuedDreamClaims: 0 };

  const allPending = await db
    .select()
    .from(generatedClaims)
    .where(and(eq(generatedClaims.status, "pending"), eq(generatedClaims.passedGate, true)));

  const allQueued = await db
    .select()
    .from(generatedClaims)
    .where(eq(generatedClaims.status, "queued"));

  return {
    pendingDreamClaims: (allPending as unknown[]).length,
    queuedDreamClaims: (allQueued as unknown[]).length,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function resolveVertical(requiredSources: string[], claimType: string): string {
  if (requiredSources.includes("rcsb_pdb") || requiredSources.includes("uniprot")) {
    return "structural_biology";
  }
  if (requiredSources.includes("pubmed") || requiredSources.includes("pmc")) {
    return "protein_biology";
  }
  if (requiredSources.includes("chembl") || requiredSources.includes("drugbank")) {
    return "pharmacology";
  }
  if (claimType.includes("molecular")) return "protein_biology";
  return "protein_biology"; // safe default
}
