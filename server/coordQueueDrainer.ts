/**
 * coordQueueDrainer.ts — Coord Queue Drainer
 *
 * Closes the loop between the Frontier Engine (which writes to coord_queue)
 * and the Analysis Pipeline (which produces verified claims).
 *
 * The drainer:
 *   1. Atomically claims up to BATCH_SIZE pending coord_queue items
 *   2. For each item: fetches PubMed abstract + full text (best-effort)
 *   3. Creates a document and fires runAnalysisPipeline
 *   4. Marks the queue item completed (or failed with retry logic)
 *
 * Authority boundary:
 *   ✅ Reads from: coord_queue, auto_ingested_papers
 *   ✅ Writes to: coord_queue (status updates), documents, auto_ingested_papers
 *   ✅ Delegates to: runAnalysisPipeline, publishEvent
 *   ❌ NEVER writes directly to: graph_entities, graph_relations, claims
 */
import { getDb } from "./db";
import { coordQueue } from "../drizzle/schema";
import { eq, and, lt, sql } from "drizzle-orm";
import { runAnalysisPipeline } from "./analysisPipeline";
import { createDocument } from "./db";
import { getAutoIngestedPaperByPmid, upsertAutoIngestedPaper, updateAutoIngestedPaperStatus } from "./db";
import { publishEvent } from "./autonomousLoop/eventBus";

// ─── Configuration ─────────────────────────────────────────────────────────────
const DRAINER_TASK_ID = "coord-queue-drainer";
const BATCH_SIZE = 5;
const STALE_CLAIM_MINUTES = 10;
const NCBI_RATE_DELAY_MS = 400;
const SYSTEM_USER_ID = 1;

// ─── Types ────────────────────────────────────────────────────────────────────
export interface DrainerResult {
  itemsProcessed: number;
  itemsSucceeded: number;
  itemsFailed: number;
  itemsSkipped: number;
  durationMs: number;
  errors: string[];
}

interface CoordQueueItem {
  id: number;
  vertical: string;
  pmid: string | null;
  doi: string | null;
  paperUrl: string | null;
  title: string | null;
  priority: number;
  retryCount: number;
}

// ─── NCBI Fetch Helpers ───────────────────────────────────────────────────────
async function fetchAbstractByPmid(pmid: string): Promise<{ title: string; abstract: string } | null> {
  try {
    const url = new URL("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi");
    url.searchParams.set("db", "pubmed");
    url.searchParams.set("id", pmid);
    url.searchParams.set("rettype", "xml");
    url.searchParams.set("retmode", "xml");
    url.searchParams.set("tool", "TruthDeskDrainer");
    url.searchParams.set("email", "pippinlitli@hotmail.com");
    const res = await fetch(url.toString());
    if (!res.ok) return null;
    const xml = await res.text();
    const titleMatch = xml.match(/<ArticleTitle[^>]*>([\s\S]*?)<\/ArticleTitle>/);
    const title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, "").trim() : "";
    const abstractParts = Array.from(xml.matchAll(/<AbstractText[^>]*>([\s\S]*?)<\/AbstractText>/g));
    const abstract = abstractParts.map((m) => m[1].replace(/<[^>]+>/g, "").trim()).join(" ");
    if (!title) return null;
    return { title, abstract };
  } catch {
    return null;
  }
}

async function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── Claim/Release Helpers ────────────────────────────────────────────────────
async function claimNextBatch(db: NonNullable<Awaited<ReturnType<typeof getDb>>>): Promise<CoordQueueItem[]> {
  const staleThreshold = new Date(Date.now() - STALE_CLAIM_MINUTES * 60 * 1000);

  // Release stale claims
  await db
    .update(coordQueue)
    .set({ status: "pending", claimedBy: null, claimedAt: null })
    .where(
      and(
        eq(coordQueue.status, "claimed"),
        lt(coordQueue.claimedAt, staleThreshold)
      )
    );

  // Claim up to BATCH_SIZE pending items
  const pending = await db
    .select()
    .from(coordQueue)
    .where(eq(coordQueue.status, "pending"))
    .orderBy(sql`${coordQueue.priority} DESC`, coordQueue.createdAt)
    .limit(BATCH_SIZE);

  if (pending.length === 0) return [];

  // Atomically mark as claimed
  for (const item of pending) {
    await db
      .update(coordQueue)
      .set({ status: "claimed", claimedBy: DRAINER_TASK_ID, claimedAt: new Date() })
      .where(and(eq(coordQueue.id, item.id), eq(coordQueue.status, "pending")));
  }

  return pending as CoordQueueItem[];
}

async function markItemComplete(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  itemId: number,
  result: Record<string, unknown>
): Promise<void> {
  await db
    .update(coordQueue)
    .set({ status: "completed", result, completedAt: new Date() })
    .where(and(eq(coordQueue.id, itemId), eq(coordQueue.claimedBy, DRAINER_TASK_ID)));
}

async function markItemFailed(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  itemId: number,
  errorMsg: string,
  currentRetryCount: number
): Promise<void> {
  const newRetryCount = currentRetryCount + 1;
  const newStatus = newRetryCount < 3 ? ("pending" as const) : ("failed" as const);
  await db
    .update(coordQueue)
    .set({
      status: newStatus,
      claimedBy: null,
      claimedAt: null,
      errorMsg,
      retryCount: newRetryCount,
    })
    .where(eq(coordQueue.id, itemId));
}

// ─── Process a Single Item ────────────────────────────────────────────────────
async function processItem(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  item: CoordQueueItem
): Promise<{ success: boolean; skipped: boolean; error?: string }> {
  // Skip items with no PMID and no paperUrl — nothing to fetch
  if (!item.pmid && !item.paperUrl) {
    return { success: false, skipped: true };
  }

  // Deduplication: skip if already ingested
  if (item.pmid) {
    const existing = await getAutoIngestedPaperByPmid(item.pmid);
    if (existing?.status === "complete" || existing?.status === "submitted") {
      return { success: true, skipped: true };
    }
  }

  // Fetch abstract from PubMed
  let title = item.title ?? "";
  let abstract = "";

  if (item.pmid) {
    await delay(NCBI_RATE_DELAY_MS);
    const fetched = await fetchAbstractByPmid(item.pmid);
    if (fetched) {
      title = fetched.title || title;
      abstract = fetched.abstract;
    }
  }

  if (!title) {
    return { success: false, skipped: false, error: "No title available — cannot create document" };
  }

  const rawText = abstract
    ? `Title: ${title}\n\nAbstract: ${abstract}`
    : `Title: ${title}`;

  // Upsert auto-ingested paper record
  if (item.pmid) {
    await upsertAutoIngestedPaper({
      pmid: item.pmid,
      doi: item.doi ?? undefined,
      title,
      searchQuery: `coord-queue:${item.vertical}`,
      status: "fetched",
      isPublic: true,
      verticalDomain: item.vertical,
      ingestSource: "pubmed",
    });
  }

  // Create document
  const docId = await createDocument({
    userId: SYSTEM_USER_ID,
    title,
    sourceType: "paste",
    rawText,
    verticalDomain: item.vertical,
  });

  if (item.pmid) {
    await updateAutoIngestedPaperStatus(item.pmid, "submitted", { documentId: docId });
  }

  // Publish paper_discovered event
  publishEvent("paper_discovered", {
    documentId: docId,
    pmid: item.pmid ?? undefined,
    title,
    vertical: item.vertical,
  }).catch(() => {/* non-fatal */});

  // Fire analysis pipeline (fire-and-forget)
  runAnalysisPipeline(docId, rawText, SYSTEM_USER_ID)
    .then(async () => {
      if (item.pmid) {
        await updateAutoIngestedPaperStatus(item.pmid, "complete", { documentId: docId });
      }
    })
    .catch((err) => {
      console.warn(`[CoordQueueDrainer] Pipeline failed for item ${item.id}:`, err);
    });

  return { success: true, skipped: false };
}

// ─── Main Entry Point ─────────────────────────────────────────────────────────
/**
 * Drain up to BATCH_SIZE pending coord_queue items through the analysis pipeline.
 * Safe to call on a schedule — idempotent, non-blocking.
 */
export async function drainCoordQueue(): Promise<DrainerResult> {
  const startMs = Date.now();
  const result: DrainerResult = {
    itemsProcessed: 0,
    itemsSucceeded: 0,
    itemsFailed: 0,
    itemsSkipped: 0,
    durationMs: 0,
    errors: [],
  };

  const db = await getDb();
  if (!db) {
    result.errors.push("Database unavailable");
    result.durationMs = Date.now() - startMs;
    return result;
  }

  const batch = await claimNextBatch(db);
  if (batch.length === 0) {
    console.log("[CoordQueueDrainer] No pending items to process");
    result.durationMs = Date.now() - startMs;
    return result;
  }

  console.log(`[CoordQueueDrainer] Processing ${batch.length} items`);

  for (const item of batch) {
    result.itemsProcessed++;
    try {
      const { success, skipped, error } = await processItem(db, item);
      if (skipped) {
        result.itemsSkipped++;
        await markItemComplete(db, item.id, { skipped: true, reason: "duplicate_or_no_source" });
      } else if (success) {
        result.itemsSucceeded++;
        await markItemComplete(db, item.id, { success: true });
      } else {
        result.itemsFailed++;
        const errMsg = error ?? "Unknown processing error";
        result.errors.push(`Item ${item.id}: ${errMsg}`);
        await markItemFailed(db, item.id, errMsg, item.retryCount);
      }
    } catch (err) {
      result.itemsFailed++;
      const errMsg = String(err);
      result.errors.push(`Item ${item.id}: ${errMsg}`);
      await markItemFailed(db, item.id, errMsg, item.retryCount).catch(() => {/* non-fatal */});
    }
  }

  result.durationMs = Date.now() - startMs;
  console.log(
    `[CoordQueueDrainer] Done: ${result.itemsSucceeded} succeeded, ` +
    `${result.itemsFailed} failed, ${result.itemsSkipped} skipped in ${result.durationMs}ms`
  );
  return result;
}

/**
 * Get the current count of pending coord_queue items.
 */
export async function getCoordQueuePendingCount(): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const [row] = await db
    .select({ cnt: sql<number>`COUNT(*)` })
    .from(coordQueue)
    .where(eq(coordQueue.status, "pending"));
  return Number(row?.cnt ?? 0);
}
