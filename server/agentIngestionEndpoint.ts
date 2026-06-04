/**
 * agentIngestionEndpoint.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * POST /api/coord/ingest — Agent result ingestion endpoint.
 *
 * Called by Manus agent tasks after they have processed a paper from the
 * coord_queue. The agent sends a structured JSON payload containing:
 *  - The queue item ID it was processing
 *  - The paper metadata (title, PMID, DOI, abstract)
 *  - Extracted claims with initial evidence data
 *
 * This endpoint:
 *  1. Validates the payload and the COORD_API_KEY header
 *  2. Creates a document record in the documents table
 *  3. Inserts claims with evidence data from the agent
 *  4. Runs the vertical adapter's lookupEvidence() for each claim
 *     (parallel, concurrency-capped at 6)
 *  5. Marks the queue item as completed in coord_queue
 *  6. Updates the coord_task heartbeat and itemsCompleted counter
 *  7. Triggers graph entity extraction for the new claims
 *
 * Authentication: x-coord-key header (same key as /api/coord/* endpoints)
 *
 * Rate limiting: max 10 concurrent ingestions (enforced by in-process semaphore)
 */
import type { Request, Response } from "express";
import { z } from "zod";
import {
  createDocument,
  insertClaims,
  updateDocumentStatus,
  updateClaimVerdict,
  getClaimsByDocument,
  upsertGraphEntity,
  upsertGraphRelation,
  getDb,
} from "./db";
import { coordQueue } from "../drizzle/schema";
import { eq, and } from "drizzle-orm";
import { getVertical } from "./verticalAdapters";
import { ENV } from "./_core/env";

// ─── Concurrency semaphore ────────────────────────────────────────────────────

let activeIngestions = 0;
const MAX_CONCURRENT_INGESTIONS = 10;

// ─── Request schema ───────────────────────────────────────────────────────────

const ExtractedClaimSchema = z.object({
  claimText: z.string().min(10).max(2000),
  claimType: z.enum([
    "pdb_id",
    "protein_name",
    "experimental_method",
    "resolution",
    "organism",
    "ligand",
    "general_molecular",
  ]).default("general_molecular"),
  extractedValue: z.string().max(512).optional(),
  pdbId: z.string().max(16).optional(),
  proteinName: z.string().max(512).optional(),
  experimentalMethod: z.string().max(256).optional(),
  resolution: z.number().optional(),
  organism: z.string().max(512).optional(),
  ligand: z.string().max(512).optional(),
  // Pre-computed evidence from the agent (optional — we re-verify server-side)
  agentVerdict: z.string().optional(),
  agentConfidence: z.number().min(0).max(1).optional(),
  agentEvidenceUrl: z.string().url().optional(),
});

const IngestionPayloadSchema = z.object({
  /** The coord_queue item ID this agent was processing */
  queueItemId: z.number().int().positive(),
  /** The coord_task taskId that processed this item */
  taskId: z.string().min(1).max(64),
  /** Paper metadata */
  paper: z.object({
    title: z.string().min(1).max(512),
    pmid: z.string().max(32).optional(),
    doi: z.string().max(256).optional(),
    paperUrl: z.string().url().optional(),
    abstract: z.string().max(10000).optional(),
    fullText: z.string().max(200000).optional(),
    publishedYear: z.number().int().min(1900).max(2100).optional(),
    authors: z.array(z.string()).max(50).optional(),
    journal: z.string().max(512).optional(),
  }),
  /** Research vertical this paper belongs to */
  vertical: z.string().min(1).max(64),
  /** Extracted claims from the paper */
  claims: z.array(ExtractedClaimSchema).min(0).max(200),
  /** Agent processing metadata */
  agentMeta: z.object({
    processingTimeMs: z.number().optional(),
    llmModel: z.string().optional(),
    extractionMethod: z.string().optional(),
  }).optional(),
});

export type IngestionPayload = z.infer<typeof IngestionPayloadSchema>;

// ─── System user ID (same as pubmedIngestJob) ─────────────────────────────────

const SYSTEM_USER_ID = 1;

// ─── Verdict mapping from agent strings ──────────────────────────────────────

function normaliseVerdict(raw: string | undefined): "Supported" | "Contradicted" | "Partially Supported" | "Ambiguous" | "Insufficient Evidence" | "Out of Scope" | "Needs Expert Review" {
  if (!raw) return "Insufficient Evidence";
  const lower = raw.toLowerCase();
  if (lower.includes("support")) return "Supported";
  if (lower.includes("contradict") || lower.includes("refut")) return "Contradicted";
  if (lower.includes("partial")) return "Partially Supported";
  if (lower.includes("ambig") || lower.includes("inconclus")) return "Ambiguous";
  if (lower.includes("scope")) return "Out of Scope";
  if (lower.includes("expert") || lower.includes("review")) return "Needs Expert Review";
  return "Insufficient Evidence";
}

// ─── Graph entity extraction ──────────────────────────────────────────────────

async function extractAndUpsertEntities(
  documentId: number,
  vertical: string,
  claims: Array<{ id: number; claimText: string; proteinName?: string | null; organism?: string | null; pdbId?: string | null; ligand?: string | null; verdict?: string | null }>
): Promise<void> {
  for (const claim of claims) {
    // Protein entities
    if (claim.proteinName) {
      const proteinEntity = await upsertGraphEntity({
        entityType: "protein",
        canonicalName: claim.proteinName.slice(0, 256),
        firstSeenDocumentId: documentId,
        metadata: { documentId, claimId: claim.id, vertical },
      });
      if (proteinEntity && claim.verdict) {
        // Link protein entity to the document via a "cites" relation
        const docEntity = await upsertGraphEntity({
          entityType: "document",
          canonicalName: `doc:${documentId}`,
          firstSeenDocumentId: documentId,
          metadata: { documentId },
        });
        if (docEntity) {
          await upsertGraphRelation({
            sourceEntityId: docEntity.id,
            targetEntityId: proteinEntity.id,
            relationType: "cites",
            evidenceDocumentId: documentId,
            confidenceScore: 1.0,
          });
        }
      }
    }
    // Organism entities
    if (claim.organism) {
      await upsertGraphEntity({
        entityType: "organism",
        canonicalName: claim.organism.slice(0, 256),
        firstSeenDocumentId: documentId,
        metadata: { documentId },
      });
    }
    // PDB ID entities
    if (claim.pdbId) {
      await upsertGraphEntity({
        entityType: "pdb_id",
        canonicalName: claim.pdbId.toUpperCase(),
        firstSeenDocumentId: documentId,
        metadata: { documentId },
      });
    }
  }
}

// ─── Main handler ─────────────────────────────────────────────────────────────

export async function agentIngestionHandler(req: Request, res: Response): Promise<void> {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const coordApiKey = ENV.coordApiKey;
  const providedKey = req.headers["x-coord-key"] as string | undefined;
  if (!coordApiKey || providedKey !== coordApiKey) {
    res.status(401).json({ ok: false, error: "Unauthorized" });
    return;
  }

  // ── Concurrency cap ───────────────────────────────────────────────────────
  if (activeIngestions >= MAX_CONCURRENT_INGESTIONS) {
    res.status(429).json({ ok: false, error: "Too many concurrent ingestions — retry in 30s" });
    return;
  }

  activeIngestions++;
  const startMs = Date.now();

  try {
    // ── Parse and validate payload ────────────────────────────────────────
    const parseResult = IngestionPayloadSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({
        ok: false,
        error: "Invalid payload",
        details: parseResult.error.flatten(),
      });
      return;
    }
    const payload = parseResult.data;

    const db = await getDb();
    if (!db) {
      res.status(503).json({ ok: false, error: "Database unavailable" });
      return;
    }

    // ── Verify queue item exists and is claimed by this task ──────────────
    const [queueItem] = await db
      .select()
      .from(coordQueue)
      .where(and(eq(coordQueue.id, payload.queueItemId), eq(coordQueue.status, "claimed")))
      .limit(1);

    if (!queueItem) {
      res.status(404).json({
        ok: false,
        error: `Queue item ${payload.queueItemId} not found or not in claimed state`,
      });
      return;
    }

    // ── Create document record ────────────────────────────────────────────
    const rawText = payload.paper.fullText ?? payload.paper.abstract ?? payload.paper.title;
    const documentId = await createDocument({
      userId: SYSTEM_USER_ID,
      title: payload.paper.title,
      sourceType: "paste",
      rawText,
      status: "extracting",
      verticalDomain: payload.vertical,
      llmProvider: payload.agentMeta?.llmModel ?? "agent",
      qualityTier: "draft",
      needsReview: true,
    });

    // ── Insert claims ─────────────────────────────────────────────────────
    if (payload.claims.length > 0) {
      await insertClaims(
        payload.claims.map((c) => ({
          documentId,
          claimText: c.claimText,
          claimType: c.claimType,
          extractedValue: c.extractedValue,
          pdbId: c.pdbId,
          proteinName: c.proteinName,
          experimentalMethod: c.experimentalMethod,
          resolution: c.resolution,
          organism: c.organism,
          ligand: c.ligand,
        })) as never
      );
    }

    await updateDocumentStatus(documentId, "validating", {
      claimCount: payload.claims.length,
    });

    // ── Get inserted claims and run vertical adapter evidence lookup ───────
    const insertedClaims = await getClaimsByDocument(documentId);
    const adapter = getVertical(payload.vertical);

    const EVIDENCE_CONCURRENCY = 6;
    for (let i = 0; i < insertedClaims.length; i += EVIDENCE_CONCURRENCY) {
      const batch = insertedClaims.slice(i, i + EVIDENCE_CONCURRENCY);
      await Promise.allSettled(
        batch.map(async (claim) => {
          try {
            // Use vertical adapter if available, otherwise use agent's pre-computed verdict
            if (adapter) {
              const evidence = await adapter.lookupEvidence({
                claimText: claim.claimText,
                extractedValue: claim.extractedValue ?? null,
              });

              // Map confidence score to verdict
              let verdict: ReturnType<typeof normaliseVerdict> = "Insufficient Evidence";
              if (evidence.confidenceScore >= 0.80) verdict = "Supported";
              else if (evidence.confidenceScore >= 0.60) verdict = "Partially Supported";
              else if (evidence.confidenceScore >= 0.40) verdict = "Ambiguous";
              else verdict = "Insufficient Evidence";

              await updateClaimVerdict(claim.id, {
                verdict,
                verdictRationale: evidence.confidenceFlags?.join("; ") ?? "Automated evidence lookup",
                pdbEvidenceUrl: evidence.sourceUrl ?? undefined,
                pdbEvidenceRaw: evidence.evidenceRaw ?? undefined,
                pdbEvidenceCheckedAt: new Date(),
              });
            } else {
              // No adapter — use agent's pre-computed verdict if provided
              const agentClaim = payload.claims[i];
              if (agentClaim?.agentVerdict) {
                await updateClaimVerdict(claim.id, {
                  verdict: normaliseVerdict(agentClaim.agentVerdict),
                  verdictRationale: `Agent verdict (${agentClaim.agentConfidence?.toFixed(2) ?? "n/a"} confidence)`,
                  pdbEvidenceUrl: agentClaim.agentEvidenceUrl,
                  pdbEvidenceCheckedAt: new Date(),
                });
              }
            }
          } catch (claimErr) {
            console.warn(`[AgentIngestion] Claim ${claim.id} evidence lookup failed:`, claimErr);
          }
        })
      );
    }

    // ── Mark document complete ────────────────────────────────────────────
    await updateDocumentStatus(documentId, "complete");

    // ── Extract graph entities ────────────────────────────────────────────
    const finalClaims = await getClaimsByDocument(documentId);
    await extractAndUpsertEntities(documentId, payload.vertical, finalClaims).catch((err) => {
      console.warn("[AgentIngestion] Graph entity extraction failed:", err);
    });

    // ── Mark queue item complete ──────────────────────────────────────────
    await db
      .update(coordQueue)
      .set({
        status: "completed",
        completedAt: new Date(),
        result: { documentId, claimCount: payload.claims.length },
      })
      .where(eq(coordQueue.id, payload.queueItemId));

    // ── Update coord_task heartbeat and itemsCompleted ────────────────────
    // Use a raw SQL increment to avoid race conditions on itemsCompleted
    await db.execute(
      `UPDATE coord_tasks SET itemsCompleted = itemsCompleted + 1, lastHeartbeatAt = NOW() WHERE taskId = '${payload.taskId.replace(/'/g, "''")}' LIMIT 1` as never
    );

    const processingMs = Date.now() - startMs;
    console.log(
      `[AgentIngestion] Ingested queueItem=${payload.queueItemId} vertical=${payload.vertical} ` +
      `claims=${payload.claims.length} documentId=${documentId} in ${processingMs}ms`
    );

    res.json({
      ok: true,
      documentId,
      claimCount: finalClaims.length,
      vertical: payload.vertical,
      processingMs,
    });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error("[AgentIngestion] Fatal error:", error);
    res.status(500).json({ ok: false, error });
  } finally {
    activeIngestions--;
  }
}
