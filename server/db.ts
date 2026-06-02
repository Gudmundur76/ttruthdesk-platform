import { eq, desc } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import {
  InsertUser,
  users,
  documents,
  claims,
  auditReports,
  auditRequests,
  monitoringFeed,
  monitoringJobs,
  InsertDocument,
  InsertClaim,
  InsertAuditReport,
  InsertAuditRequest,
  InsertMonitoringFeedItem,
} from "../drizzle/schema";
import { ENV } from "./_core/env";

let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

// ─── Users ────────────────────────────────────────────────────────────────────
export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db) return;
  const values: InsertUser = { openId: user.openId };
  const updateSet: Record<string, unknown> = {};
  const textFields = ["name", "email", "loginMethod"] as const;
  for (const field of textFields) {
    const value = user[field];
    if (value === undefined) continue;
    const normalized = value ?? null;
    values[field] = normalized;
    updateSet[field] = normalized;
  }
  if (user.lastSignedIn !== undefined) {
    values.lastSignedIn = user.lastSignedIn;
    updateSet.lastSignedIn = user.lastSignedIn;
  }
  if (user.role !== undefined) {
    values.role = user.role;
    updateSet.role = user.role;
  } else if (user.openId === ENV.ownerOpenId) {
    values.role = "admin";
    updateSet.role = "admin";
  }
  if (!values.lastSignedIn) values.lastSignedIn = new Date();
  if (Object.keys(updateSet).length === 0) updateSet.lastSignedIn = new Date();
  await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

// ─── Documents ────────────────────────────────────────────────────────────────
export async function createDocument(doc: InsertDocument) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const [result] = await db.insert(documents).values(doc);
  return result.insertId as number;
}

export async function getDocumentById(id: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(documents).where(eq(documents.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function getDocumentsByUser(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(documents).where(eq(documents.userId, userId)).orderBy(desc(documents.createdAt));
}

export async function updateDocumentStatus(
  id: number,
  status: "pending" | "extracting" | "validating" | "generating_report" | "complete" | "failed",
  extra?: { claimCount?: number; errorMessage?: string }
) {
  const db = await getDb();
  if (!db) return;
  await db
    .update(documents)
    .set({ status, ...(extra ?? {}) })
    .where(eq(documents.id, id));
}

// ─── Claims ───────────────────────────────────────────────────────────────────
export async function insertClaims(claimList: InsertClaim[]) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  if (claimList.length === 0) return;
  await db.insert(claims).values(claimList);
}

export async function getClaimsByDocument(documentId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(claims).where(eq(claims.documentId, documentId));
}

export async function updateClaimVerdict(
  claimId: number,
  update: {
    verdict?: string;
    verdictRationale?: string;
    pdbEvidenceUrl?: string;
    pdbEvidenceRaw?: unknown;
    pdbEvidenceCheckedAt?: Date;
  }
) {
  const db = await getDb();
  if (!db) return;
  const { verdict, verdictRationale, pdbEvidenceUrl, pdbEvidenceRaw, pdbEvidenceCheckedAt } = update;
  const setData: Record<string, unknown> = {};
  if (verdict !== undefined) setData.verdict = verdict;
  if (verdictRationale !== undefined) setData.verdictRationale = verdictRationale;
  if (pdbEvidenceUrl !== undefined) setData.pdbEvidenceUrl = pdbEvidenceUrl;
  if (pdbEvidenceRaw !== undefined) setData.pdbEvidenceRaw = pdbEvidenceRaw;
  if (pdbEvidenceCheckedAt !== undefined) setData.pdbEvidenceCheckedAt = pdbEvidenceCheckedAt;
  if (Object.keys(setData).length > 0) {
    await db.update(claims).set(setData as never).where(eq(claims.id, claimId));
  }
}

export async function overrideClaimVerdict(
  claimId: number,
  reviewerId: number,
  overriddenVerdict: string,
  reviewNotes: string
) {
  const db = await getDb();
  if (!db) return;
  await db
    .update(claims)
    .set({
      overriddenVerdict: overriddenVerdict as never,
      reviewedBy: reviewerId,
      reviewedAt: new Date(),
      reviewNotes,
    })
    .where(eq(claims.id, claimId));
}

// ─── Audit Reports ────────────────────────────────────────────────────────────
export async function upsertAuditReport(report: InsertAuditReport) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db
    .insert(auditReports)
    .values(report)
    .onDuplicateKeyUpdate({ set: report as Record<string, unknown> });
}

export async function getAuditReportByDocument(documentId: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select()
    .from(auditReports)
    .where(eq(auditReports.documentId, documentId))
    .limit(1);
  return rows[0] ?? null;
}

// ─── Audit Requests ───────────────────────────────────────────────────────────
export async function createAuditRequest(req: InsertAuditRequest) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const [result] = await db.insert(auditRequests).values(req);
  return result.insertId as number;
}

export async function getAllAuditRequests() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(auditRequests).orderBy(desc(auditRequests.createdAt));
}

export async function markAuditRequestOwnerNotified(id: number) {
  const db = await getDb();
  if (!db) return;
  await db.update(auditRequests).set({ ownerNotified: true }).where(eq(auditRequests.id, id));
}

// ─── Monitoring Feed ──────────────────────────────────────────────────────────
export async function insertMonitoringItems(items: InsertMonitoringFeedItem[]) {
  const db = await getDb();
  if (!db) return;
  if (items.length === 0) return;
  await db.insert(monitoringFeed).values(items);
}

export async function getMonitoringFeedByDocument(documentId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(monitoringFeed)
    .where(eq(monitoringFeed.documentId, documentId))
    .orderBy(desc(monitoringFeed.discoveredAt));
}

export async function getAllMonitoringFeed(limit = 50) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(monitoringFeed).orderBy(desc(monitoringFeed.discoveredAt)).limit(limit);
}

// ─── Monitoring Jobs ──────────────────────────────────────────────────────────
export async function upsertMonitoringJob(documentId: number, taskUid?: string) {
  const db = await getDb();
  if (!db) return;
  await db
    .insert(monitoringJobs)
    .values({ documentId, scheduleCronTaskUid: taskUid ?? null })
    .onDuplicateKeyUpdate({
      set: { scheduleCronTaskUid: taskUid ?? null, updatedAt: new Date() },
    });
}

export async function getMonitoringJobByTaskUid(taskUid: string) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select()
    .from(monitoringJobs)
    .where(eq(monitoringJobs.scheduleCronTaskUid, taskUid))
    .limit(1);
  return rows[0] ?? null;
}

export async function getAllActiveMonitoringJobs() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(monitoringJobs).where(eq(monitoringJobs.isActive, true));
}

export async function updateMonitoringJobLastRun(documentId: number) {
  const db = await getDb();
  if (!db) return;
  await db
    .update(monitoringJobs)
    .set({ lastRunAt: new Date() })
    .where(eq(monitoringJobs.documentId, documentId));
}

// ─── Claims Registry ──────────────────────────────────────────────────────────

/**
 * Fetch the most recent verified claims across all documents for the global
 * claims.json registry.  Only claims that have a verdict are included.
 */
export async function getRecentVerifiedClaims(limit = 200) {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select({
      claim: claims,
      documentId: claims.documentId,
    })
    .from(claims)
    .where(eq(claims.verdict, claims.verdict)) // all rows with non-null verdict handled below
    .orderBy(desc(claims.createdAt))
    .limit(limit);
  // Filter in JS to keep the query simple (verdict is nullable)
  return rows.filter((r) => r.claim.verdict !== null);
}
