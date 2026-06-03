import { eq, desc, isNull, isNotNull, and, gt, sql } from "drizzle-orm";
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
  autoIngestedPapers,
  InsertDocument,
  InsertClaim,
  InsertAuditReport,
  InsertAuditRequest,
  InsertMonitoringFeedItem,
  InsertAutoIngestedPaper,
  magicLinkTokens,
  emailUsers,
  InsertMagicLinkToken,
  InsertEmailUser,
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

// ─── Magic Link Tokens ───────────────────────────────────────────────────────
export async function createMagicLinkToken(data: InsertMagicLinkToken): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.insert(magicLinkTokens).values(data);
}

export async function findValidMagicLinkToken(tokenHash: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db
    .select()
    .from(magicLinkTokens)
    .where(
      and(
        eq(magicLinkTokens.tokenHash, tokenHash),
        isNull(magicLinkTokens.usedAt),
        gt(magicLinkTokens.expiresAt, new Date()),
      )
    )
    .limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function markMagicLinkTokenUsed(id: number): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.update(magicLinkTokens).set({ usedAt: new Date() }).where(eq(magicLinkTokens.id, id));
}

/** Count tokens created for this email in the last windowMs milliseconds (rate limiting) */
export async function countRecentMagicLinkRequests(email: string, windowMs: number): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const since = new Date(Date.now() - windowMs);
  const result = await db
    .select({ count: sql<number>`count(*)` })
    .from(magicLinkTokens)
    .where(and(eq(magicLinkTokens.email, email), gt(magicLinkTokens.createdAt, since)));
  return Number(result[0]?.count ?? 0);
}

// ─── Email Users ──────────────────────────────────────────────────────────────
export async function upsertEmailUser(email: string, name?: string) {
  const db = await getDb();
  if (!db) return undefined;

  // Lazy import to avoid circular deps
  const { getPlanForEmail } = await import("./academicDomains");
  const { plan, trialExpiresAt } = getPlanForEmail(email);

  // On first insert: assign plan + trialExpiresAt. On duplicate: only update lastSignedIn.
  await db
    .insert(emailUsers)
    .values({ email, name: name ?? null, plan, trialExpiresAt, lastSignedIn: new Date() })
    .onDuplicateKeyUpdate({ set: { lastSignedIn: new Date() } });
  const result = await db.select().from(emailUsers).where(eq(emailUsers.email, email)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function incrementEmailUserAuditCount(id: number): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db
    .update(emailUsers)
    .set({ auditCount: sql`audit_count + 1` })
    .where(eq(emailUsers.id, id));
}

export async function getEmailUserByEmail(email: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(emailUsers).where(eq(emailUsers.email, email)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function getEmailUserById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(emailUsers).where(eq(emailUsers.id, id)).limit(1);
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
  extra?: {
    claimCount?: number;
    errorMessage?: string;
    llmProvider?: string;
    qualityTier?: "draft" | "verified";
    needsReview?: boolean;
  }
) {
  const db = await getDb();
  if (!db) return;
  await db
    .update(documents)
    .set({ status, ...(extra ?? {}) })
    .where(eq(documents.id, id));
}

export async function getFailedDocuments(limit = 100) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(documents)
    .where(eq(documents.status, "failed"))
    .orderBy(documents.createdAt)
    .limit(limit);
}

export async function getDraftDocuments(limit = 100) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(documents)
    .where(eq(documents.qualityTier, "draft"))
    .orderBy(documents.createdAt)
    .limit(limit);
}

// ─── Claims ───────────────────────────────────────────────────────────────────
export async function deleteClaimsByDocument(documentId: number) {
  const db = await getDb();
  if (!db) return;
  await db.delete(claims).where(eq(claims.documentId, documentId));
}

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

/** Returns the number of audit requests from a given email within the last windowMs milliseconds. */
export async function getRecentAuditRequestsByEmail(email: string, windowMs: number): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const since = new Date(Date.now() - windowMs);
  const rows = await db
    .select({ id: auditRequests.id })
    .from(auditRequests)
    .where(and(eq(auditRequests.contactEmail, email), gt(auditRequests.createdAt, since)));
  return rows.length;
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

// ────────────────────────────────────────────────────────────────────────────────
// Auto-Ingested Papers helpers
// ────────────────────────────────────────────────────────────────────────────────

export async function upsertAutoIngestedPaper(data: InsertAutoIngestedPaper) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  // Insert or ignore (unique on pmid)
  await db
    .insert(autoIngestedPapers)
    .values(data)
    .onDuplicateKeyUpdate({ set: { updatedAt: new Date() } });
  const [row] = await db
    .select()
    .from(autoIngestedPapers)
    .where(eq(autoIngestedPapers.pmid, data.pmid))
    .limit(1);
  return row;
}

export async function updateAutoIngestedPaperStatus(
  pmid: string,
  status: "fetched" | "submitted" | "complete" | "failed",
  extras: { documentId?: number; errorMessage?: string } = {}
) {
  const db = await getDb();
  if (!db) return;
  await db
    .update(autoIngestedPapers)
    .set({ status, ...extras })
    .where(eq(autoIngestedPapers.pmid, pmid));
}

export async function getAllAutoIngestedPapers() {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(autoIngestedPapers)
    .orderBy(desc(autoIngestedPapers.ingestedAt));
}

export async function getPublicAutoIngestedPapers() {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(autoIngestedPapers)
    .where(eq(autoIngestedPapers.isPublic, true))
    .orderBy(desc(autoIngestedPapers.ingestedAt));
}

export async function getAutoIngestedPaperByPmid(pmid: string) {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db
    .select()
    .from(autoIngestedPapers)
    .where(eq(autoIngestedPapers.pmid, pmid))
    .limit(1);
  return row ?? null;
}

export async function getCompletedPublicPapers() {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(autoIngestedPapers)
    .where(eq(autoIngestedPapers.status, "complete"))
    .orderBy(desc(autoIngestedPapers.ingestedAt));
}

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
    .where(isNotNull(claims.verdict))
    .orderBy(desc(claims.createdAt))
    .limit(limit);
  return rows;
}

/**
 * Fetch graph data: all completed documents with their claims for the
 * knowledge graph visualisation.  Returns a lightweight shape to avoid
 * sending full rawText over the wire.
 */
export async function getGraphData() {
  const db = await getDb();
  if (!db) return { documents: [], claims: [] };
  const docs = await db
    .select({
      id: documents.id,
      title: documents.title,
      status: documents.status,
      verticalDomain: documents.verticalDomain,
      createdAt: documents.createdAt,
    })
    .from(documents)
    .where(eq(documents.status, "complete"))
    .orderBy(desc(documents.createdAt))
    .limit(200);
  const claimRows = await db
    .select({
      id: claims.id,
      documentId: claims.documentId,
      claimType: claims.claimType,
      claimText: claims.claimText,
      verdict: claims.verdict,
      pdbId: claims.pdbId,
      confidenceScore: claims.confidenceScore,
    })
    .from(claims)
    .orderBy(desc(claims.createdAt))
    .limit(2000);
  return { documents: docs, claims: claimRows };
}

/**
 * Return per-domain document and claim counts for the /verticals page.
 */
export async function getVerticalStats() {
  const db = await getDb();
  if (!db) return [];

  const docs = await db
    .select({
      id: documents.id,
      verticalDomain: documents.verticalDomain,
      status: documents.status,
    })
    .from(documents);

  const claimRows = await db
    .select({
      documentId: claims.documentId,
      verdict: claims.verdict,
    })
    .from(claims);

  // Build a map of documentId → verticalDomain
  const docDomainMap = new Map<number, string>();
  for (const d of docs) {
    docDomainMap.set(d.id as unknown as number, d.verticalDomain ?? "unknown");
  }

  // Aggregate
  const stats = new Map<
    string,
    { domain: string; totalDocs: number; completedDocs: number; totalClaims: number; supportedClaims: number }
  >();

  for (const d of docs) {
    const domain = d.verticalDomain ?? "unknown";
    if (!stats.has(domain)) {
      stats.set(domain, { domain, totalDocs: 0, completedDocs: 0, totalClaims: 0, supportedClaims: 0 });
    }
    const s = stats.get(domain)!;
    s.totalDocs++;
    if (d.status === "complete") s.completedDocs++;
  }

  for (const c of claimRows) {
    // find domain via document
    const domain = docDomainMap.get(c.documentId) ?? "unknown";
    if (!stats.has(domain)) {
      stats.set(domain, { domain, totalDocs: 0, completedDocs: 0, totalClaims: 0, supportedClaims: 0 });
    }
    const s = stats.get(domain)!;
    s.totalClaims++;
    if (c.verdict === "Supported" || c.verdict === "Partially Supported") s.supportedClaims++;
  }

  return Array.from(stats.values());
}
