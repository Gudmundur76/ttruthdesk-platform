import {
  eq,
  desc,
  asc,
  isNull,
  isNotNull,
  and,
  or,
  gt,
  gte,
  like,
  sql,
} from "drizzle-orm";
import type { ResultSetHeader } from "mysql2";
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
  graphEntities,
  graphRelations,
  InsertGraphEntity,
  InsertGraphRelation,
  GraphEntity,
  GraphRelation,
  predictionFeatures,
  predictionModels,
  InsertPredictionFeature,
  InsertPredictionModel,
  PredictionModel,
  webhookAlerts,
  overrideAuditLog,
  claimScoreHistory,
  ClaimScoreHistory,
  citations,
  Citation,
  InsertCitation,
} from "../drizzle/schema";
import { ENV } from "./_core/env";

let _db: ReturnType<typeof drizzle> | null = null;
let _dbInitPromise: Promise<ReturnType<typeof drizzle> | null> | null = null;

export async function getDb(): Promise<ReturnType<typeof drizzle> | null> {
  if (_db) return _db;
  // Prevent concurrent initializations from creating multiple connections
  if (!_dbInitPromise && process.env.DATABASE_URL) {
    _dbInitPromise = (async () => {
      try {
        _db = drizzle(process.env.DATABASE_URL!);
        return _db;
      } catch (error) {
        console.warn("[Database] Failed to connect:", error);
        _db = null;
        return null;
      } finally {
        _dbInitPromise = null;
      }
    })();
  }
  if (_dbInitPromise) return _dbInitPromise;
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
  await db
    .insert(users)
    .values(values)
    .onDuplicateKeyUpdate({ set: updateSet });
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db
    .select()
    .from(users)
    .where(eq(users.openId, openId))
    .limit(1);
  return result.length > 0 ? result[0] : undefined;
}

// ─── Magic Link Tokens ───────────────────────────────────────────────────────
export async function createMagicLinkToken(
  data: InsertMagicLinkToken
): Promise<void> {
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
        gt(magicLinkTokens.expiresAt, new Date())
      )
    )
    .limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function markMagicLinkTokenUsed(id: number): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db
    .update(magicLinkTokens)
    .set({ usedAt: new Date() })
    .where(eq(magicLinkTokens.id, id));
}

/** Count tokens created for this email in the last windowMs milliseconds (rate limiting) */
export async function countRecentMagicLinkRequests(
  email: string,
  windowMs: number
): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const since = new Date(Date.now() - windowMs);
  const result = await db
    .select({ count: sql<number>`count(*)` })
    .from(magicLinkTokens)
    .where(
      and(
        eq(magicLinkTokens.email, email),
        gt(magicLinkTokens.createdAt, since)
      )
    );
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
    .values({
      email,
      name: name ?? null,
      plan,
      trialExpiresAt,
      lastSignedIn: new Date(),
    })
    .onDuplicateKeyUpdate({ set: { lastSignedIn: new Date() } });
  const result = await db
    .select()
    .from(emailUsers)
    .where(eq(emailUsers.email, email))
    .limit(1);
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
  const result = await db
    .select()
    .from(emailUsers)
    .where(eq(emailUsers.email, email))
    .limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function getEmailUserById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db
    .select()
    .from(emailUsers)
    .where(eq(emailUsers.id, id))
    .limit(1);
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
  const rows = await db
    .select()
    .from(documents)
    .where(eq(documents.id, id))
    .limit(1);
  return rows[0] ?? null;
}

export async function getDocumentsByUser(userId: number) {
  const db = await getDb();
  if (!db) return [];
  const docs = await db
    .select()
    .from(documents)
    .where(eq(documents.userId, userId))
    .orderBy(desc(documents.createdAt));
  // Attach topVerdict: the most common non-null verdict for each document
  const VERDICT_PRIORITY = [
    "Contradicted",
    "Partially Supported",
    "Needs Expert Review",
    "Ambiguous",
    "Insufficient Evidence",
    "Supported",
    "Out of Scope",
  ];
  const docIds = docs.map(d => d.id);
  if (docIds.length === 0)
    return docs.map(d => ({ ...d, topVerdict: null as string | null }));
  const claimRows = await db
    .select({ documentId: claims.documentId, verdict: claims.verdict })
    .from(claims)
    .where(
      and(
        isNotNull(claims.verdict),
        sql`${claims.documentId} IN (${sql.join(
          docIds.map(id => sql`${id}`),
          sql`, `
        )})`
      )
    );
  // Count verdicts per document
  const verdictMap: Record<number, Record<string, number>> = {};
  for (const row of claimRows) {
    if (!row.verdict || !row.documentId) continue;
    verdictMap[row.documentId] ??= {};
    verdictMap[row.documentId][row.verdict] =
      (verdictMap[row.documentId][row.verdict] ?? 0) + 1;
  }
  return docs.map(d => {
    const counts = verdictMap[d.id];
    let topVerdict: string | null = null;
    if (counts) {
      // Pick highest-priority verdict that appears at least once
      topVerdict =
        VERDICT_PRIORITY.find(v => (counts[v] ?? 0) > 0) ??
        Object.keys(counts)[0] ??
        null;
    }
    return { ...d, topVerdict };
  });
}

export async function updateDocumentStatus(
  id: number,
  status:
    | "pending"
    | "extracting"
    | "validating"
    | "generating_report"
    | "complete"
    | "failed",
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
    verdictMethod?: string;
    sourceCompletenessScore?: number;
    // Phase 100: passage-level extraction
    sourcePassage?: string | null;
    passageConfidence?: number | null;
    passageStartChar?: number | null;
    passageEndChar?: number | null;
    // Phase 101: misrepresentation classification
    misrepresentationType?: string | null;
    // Phase 103: composite truth signal
    compositeTruthScore?: number | null;
    compositeTruthLabel?: string | null;
  }
) {
  const db = await getDb();
  if (!db) return;
  const {
    verdict,
    verdictRationale,
    pdbEvidenceUrl,
    pdbEvidenceRaw,
    pdbEvidenceCheckedAt,
    verdictMethod,
    sourceCompletenessScore,
    sourcePassage,
    passageConfidence,
    passageStartChar,
    passageEndChar,
  } = update;
  const setData: Record<string, unknown> = {};
  if (verdict !== undefined) setData.verdict = verdict;
  if (verdictRationale !== undefined)
    setData.verdictRationale = verdictRationale;
  if (pdbEvidenceUrl !== undefined) setData.pdbEvidenceUrl = pdbEvidenceUrl;
  if (pdbEvidenceRaw !== undefined) setData.pdbEvidenceRaw = pdbEvidenceRaw;
  if (pdbEvidenceCheckedAt !== undefined)
    setData.pdbEvidenceCheckedAt = pdbEvidenceCheckedAt;
  if (verdictMethod !== undefined) setData.verdictMethod = verdictMethod;
  if (sourceCompletenessScore !== undefined)
    setData.sourceCompletenessScore = sourceCompletenessScore;
  if (sourcePassage !== undefined) setData.sourcePassage = sourcePassage;
  if (passageConfidence !== undefined)
    setData.passageConfidence = passageConfidence;
  if (passageStartChar !== undefined)
    setData.passageStartChar = passageStartChar;
  if (passageEndChar !== undefined) setData.passageEndChar = passageEndChar;
  if (update.misrepresentationType !== undefined)
    setData.misrepresentationType = update.misrepresentationType;
  if (update.compositeTruthScore !== undefined)
    setData.compositeTruthScore = update.compositeTruthScore;
  if (update.compositeTruthLabel !== undefined)
    setData.compositeTruthLabel = update.compositeTruthLabel;
  if (Object.keys(setData).length > 0) {
    await db
      .update(claims)
      .set(setData as never)
      .where(eq(claims.id, claimId));
  }
}

export async function overrideClaimVerdict(
  claimId: number,
  reviewerId: number,
  overriddenVerdict: string,
  reviewNotes: string,
  options?: {
    justification?: string;
    overrideCategory?:
      | "domain_expertise"
      | "new_evidence"
      | "context_clarification"
      | "scope_adjustment"
      | "error_correction";
    documentId?: number;
  }
) {
  const db = await getDb();
  if (!db) return;

  // Enforce minimum justification length to preserve epistemic chain integrity
  const justification = (options?.justification ?? reviewNotes ?? "").trim();
  if (justification.length < 20) {
    throw new Error(
      "Override requires a justification of at least 20 characters to preserve epistemic chain integrity."
    );
  }

  // Fetch original verdict before overwriting
  const [existing] = await db
    .select({ verdict: claims.verdict, documentId: claims.documentId })
    .from(claims)
    .where(eq(claims.id, claimId))
    .limit(1);

  if (!existing) throw new Error(`Claim ${claimId} not found`);

  const originalVerdict = existing.verdict as string | null;
  const documentId = options?.documentId ?? existing.documentId;

  // Update the claim with the overridden verdict
  await db
    .update(claims)
    .set({
      overriddenVerdict: overriddenVerdict as never,
      reviewedBy: reviewerId,
      reviewedAt: new Date(),
      reviewNotes: justification,
    })
    .where(eq(claims.id, claimId));

  // Write to override_audit_log (epistemic chain record)
  if (originalVerdict && documentId) {
    await db.insert(overrideAuditLog).values({
      claimId,
      documentId,
      overriddenBy: reviewerId,
      originalVerdict: originalVerdict as never,
      newVerdict: overriddenVerdict as never,
      justification,
      overrideCategory: (options?.overrideCategory ??
        "error_correction") as never,
      wikiLogged: false,
    });
  }
}

/** Retrieve override audit log entries for a document */
export async function getOverrideAuditLog(documentId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(overrideAuditLog)
    .where(eq(overrideAuditLog.documentId, documentId))
    .orderBy(desc(overrideAuditLog.createdAt));
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
  await db
    .update(auditRequests)
    .set({ ownerNotified: true })
    .where(eq(auditRequests.id, id));
}

/** Returns the number of audit requests from a given email within the last windowMs milliseconds. */
export async function getRecentAuditRequestsByEmail(
  email: string,
  windowMs: number
): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const since = new Date(Date.now() - windowMs);
  const rows = await db
    .select({ id: auditRequests.id })
    .from(auditRequests)
    .where(
      and(
        eq(auditRequests.contactEmail, email),
        gt(auditRequests.createdAt, since)
      )
    );
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
  return db
    .select()
    .from(monitoringFeed)
    .orderBy(desc(monitoringFeed.discoveredAt))
    .limit(limit);
}

// ─── Monitoring Jobs ──────────────────────────────────────────────────────────
export async function upsertMonitoringJob(
  documentId: number,
  taskUid?: string
) {
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
  return db
    .select()
    .from(monitoringJobs)
    .where(eq(monitoringJobs.isActive, true));
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
  // Only return claims from fully completed documents — not failed or in-progress ones
  const rows = await db
    .select({
      claim: claims,
      documentId: claims.documentId,
    })
    .from(claims)
    .innerJoin(documents, eq(claims.documentId, documents.id))
    .where(and(isNotNull(claims.verdict), eq(documents.status, "complete")))
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
    {
      domain: string;
      totalDocs: number;
      completedDocs: number;
      totalClaims: number;
      supportedClaims: number;
    }
  >();

  for (const d of docs) {
    const domain = d.verticalDomain ?? "unknown";
    if (!stats.has(domain)) {
      stats.set(domain, {
        domain,
        totalDocs: 0,
        completedDocs: 0,
        totalClaims: 0,
        supportedClaims: 0,
      });
    }
    const s = stats.get(domain)!;
    s.totalDocs++;
    if (d.status === "complete") s.completedDocs++;
  }

  for (const c of claimRows) {
    // find domain via document
    const domain = docDomainMap.get(c.documentId) ?? "unknown";
    if (!stats.has(domain)) {
      stats.set(domain, {
        domain,
        totalDocs: 0,
        completedDocs: 0,
        totalClaims: 0,
        supportedClaims: 0,
      });
    }
    const s = stats.get(domain)!;
    s.totalClaims++;
    if (c.verdict === "Supported" || c.verdict === "Partially Supported")
      s.supportedClaims++;
  }

  return Array.from(stats.values());
}

// ─── Graph Entities ───────────────────────────────────────────────────────────

export async function upsertGraphEntity(
  data: InsertGraphEntity
): Promise<GraphEntity> {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db
    .insert(graphEntities)
    .values(data)
    .onDuplicateKeyUpdate({
      set: {
        wikiPagePath: data.wikiPagePath ?? null,
        metadata: data.metadata ?? null,
        updatedAt: new Date(),
      },
    });
  const [row] = await db
    .select()
    .from(graphEntities)
    .where(
      and(
        eq(graphEntities.entityType, data.entityType),
        eq(graphEntities.canonicalName, data.canonicalName)
      )
    )
    .limit(1);
  return row;
}

export async function getGraphEntityByTypeAndName(
  entityType: GraphEntity["entityType"],
  canonicalName: string
): Promise<GraphEntity | null> {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db
    .select()
    .from(graphEntities)
    .where(
      and(
        eq(graphEntities.entityType, entityType),
        eq(graphEntities.canonicalName, canonicalName)
      )
    )
    .limit(1);
  return row ?? null;
}

export async function getAllGraphEntities(limit = 500): Promise<GraphEntity[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(graphEntities)
    .orderBy(desc(graphEntities.createdAt))
    .limit(limit);
}

export async function getGraphEntitiesByType(
  entityType: GraphEntity["entityType"],
  limit = 200
): Promise<GraphEntity[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(graphEntities)
    .where(eq(graphEntities.entityType, entityType))
    .orderBy(graphEntities.canonicalName)
    .limit(limit);
}

// ─── Graph Relations ──────────────────────────────────────────────────────────

export async function upsertGraphRelation(
  data: InsertGraphRelation
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db
    .insert(graphRelations)
    .values(data)
    .onDuplicateKeyUpdate({
      set: {
        confidenceScore: data.confidenceScore ?? null,
        evidenceDocumentId: data.evidenceDocumentId ?? null,
      },
    });
}

export async function getRelationsBySourceEntity(
  sourceEntityId: number
): Promise<GraphRelation[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(graphRelations)
    .where(eq(graphRelations.sourceEntityId, sourceEntityId))
    .orderBy(desc(graphRelations.createdAt));
}

export async function getRelationsByTargetEntity(
  targetEntityId: number
): Promise<GraphRelation[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(graphRelations)
    .where(eq(graphRelations.targetEntityId, targetEntityId))
    .orderBy(desc(graphRelations.createdAt));
}

export async function getAllGraphRelations(
  limit = 2000
): Promise<GraphRelation[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(graphRelations)
    .orderBy(desc(graphRelations.createdAt))
    .limit(limit);
}

export async function getContradictionRelations(
  limit = 100
): Promise<GraphRelation[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(graphRelations)
    .where(eq(graphRelations.relationType, "contradicts"))
    .orderBy(desc(graphRelations.createdAt))
    .limit(limit);
}

/**
 * Find entities that have more than one claim of a given type — these are
 * candidates for the lint cycle to check for contradictions.
 */
export async function getEntitiesWithMultipleClaims(
  entityType: GraphEntity["entityType"] = "pdb_id",
  limit = 50
): Promise<GraphEntity[]> {
  const db = await getDb();
  if (!db) return [];
  // Return all entities of this type; the caller filters by claim count
  return db
    .select()
    .from(graphEntities)
    .where(eq(graphEntities.entityType, entityType))
    .orderBy(graphEntities.canonicalName)
    .limit(limit);
}

export async function getClaimById(claimId: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select()
    .from(claims)
    .where(eq(claims.id, claimId))
    .limit(1);
  return rows[0] ?? null;
}

export async function getClaimWithDocument(claimId: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select({
      claim: claims,
      document: documents,
    })
    .from(claims)
    .innerJoin(documents, eq(claims.documentId, documents.id))
    .where(eq(claims.id, claimId))
    .limit(1);
  return rows[0] ?? null;
}

export async function getEntityClaimSummary(entityName: string): Promise<{
  supported: number;
  contradicted: number;
  ambiguous: number;
  total: number;
  lastUpdated: Date | null;
}> {
  const db = await getDb();
  if (!db)
    return {
      supported: 0,
      contradicted: 0,
      ambiguous: 0,
      total: 0,
      lastUpdated: null,
    };
  const rows = await db
    .select()
    .from(claims)
    .where(
      or(
        like(claims.claimText, `%${entityName}%`),
        eq(claims.pdbId, entityName)
      )
    )
    .orderBy(desc(claims.createdAt))
    .limit(500);

  let supported = 0,
    contradicted = 0,
    ambiguous = 0;
  let lastUpdated: Date | null = null;
  for (const row of rows) {
    const v = row.verdict ?? "";
    if (v === "Supported" || v === "Partially Supported") supported++;
    else if (v === "Contradicted") contradicted++;
    else ambiguous++;
    if (row.createdAt && (!lastUpdated || row.createdAt > lastUpdated)) {
      lastUpdated = row.createdAt;
    }
  }
  return {
    supported,
    contradicted,
    ambiguous,
    total: rows.length,
    lastUpdated,
  };
}

// ─── Prediction helpers ──────────────────────────────────────────────────────

export async function savePredictionModel(
  data: InsertPredictionModel
): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const [result] = await db.insert(predictionModels).values(data);
  return (result as unknown as ResultSetHeader).insertId;
}

export async function getPredictionsByClaimId(
  claimId: number
): Promise<PredictionModel[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(predictionModels)
    .where(eq(predictionModels.targetClaimId, claimId))
    .orderBy(desc(predictionModels.createdAt))
    .limit(5);
}

export async function getLatestAuthorReliabilityPrediction(
  userId: number
): Promise<PredictionModel | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select()
    .from(predictionModels)
    .where(
      and(
        eq(predictionModels.targetUserId, userId),
        eq(predictionModels.modelType, "author_reliability")
      )
    )
    .orderBy(desc(predictionModels.createdAt))
    .limit(1);
  return rows[0] ?? null;
}

export async function savePredictionFeature(
  data: InsertPredictionFeature
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.insert(predictionFeatures).values(data);
}

export async function updatePredictionModelValidation(
  predictionId: number,
  result: "correct" | "incorrect"
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db
    .update(predictionModels)
    .set({ validationResult: result, validatedAt: new Date() })
    .where(eq(predictionModels.id, predictionId));
}

// ─── Prediction Calibration helpers ─────────────────────────────────────────

export async function getPredictionById(
  id: number
): Promise<PredictionModel | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select()
    .from(predictionModels)
    .where(eq(predictionModels.id, id))
    .limit(1);
  return rows[0] ?? null;
}

export async function getPredictionsForReview(
  limit = 50
): Promise<PredictionModel[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(predictionModels)
    .where(eq(predictionModels.validationResult, "pending"))
    .orderBy(desc(predictionModels.createdAt))
    .limit(limit);
}

export interface CalibrationBucket {
  bucket: string;
  bucketMin: number;
  bucketMax: number;
  total: number;
  correct: number;
  incorrect: number;
  actualRate: number;
  midpoint: number;
}

export interface AccuracyByDay {
  date: string;
  total: number;
  correct: number;
  accuracy: number;
}

export async function getCalibrationStats(modelType?: string): Promise<{
  buckets: CalibrationBucket[];
  byDay: AccuracyByDay[];
  overallAccuracy: number;
  totalValidated: number;
  totalPending: number;
}> {
  const db = await getDb();
  if (!db)
    return {
      buckets: [],
      byDay: [],
      overallAccuracy: 0,
      totalValidated: 0,
      totalPending: 0,
    };

  const conditions: ReturnType<typeof eq>[] = [
    sql`${predictionModels.validationResult} != 'pending'` as unknown as ReturnType<
      typeof eq
    >,
  ];
  if (modelType) {
    conditions.push(
      eq(predictionModels.modelType, modelType as PredictionModel["modelType"])
    );
  }

  const validated = await db
    .select()
    .from(predictionModels)
    .where(and(...conditions))
    .orderBy(asc(predictionModels.createdAt));

  const pendingRows = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(predictionModels)
    .where(eq(predictionModels.validationResult, "pending"));
  const totalPending = Number(pendingRows[0]?.count ?? 0);

  const BUCKET_COUNT = 10;
  const buckets: CalibrationBucket[] = Array.from(
    { length: BUCKET_COUNT },
    (_, i) => ({
      bucket: `${(i / BUCKET_COUNT).toFixed(1)}–${((i + 1) / BUCKET_COUNT).toFixed(1)}`,
      bucketMin: i / BUCKET_COUNT,
      bucketMax: (i + 1) / BUCKET_COUNT,
      midpoint: (i + 0.5) / BUCKET_COUNT,
      total: 0,
      correct: 0,
      incorrect: 0,
      actualRate: 0,
    })
  );

  const dayMap = new Map<string, { total: number; correct: number }>();

  for (const row of validated) {
    const pred = row.prediction as { probability?: number } | null;
    const prob = pred?.probability ?? 0.5;
    const bucketIdx = Math.min(
      Math.floor(prob * BUCKET_COUNT),
      BUCKET_COUNT - 1
    );
    const bucket = buckets[bucketIdx];
    bucket.total++;
    if (row.validationResult === "correct") bucket.correct++;
    else bucket.incorrect++;

    const day = row.validatedAt
      ? new Date(row.validatedAt).toISOString().slice(0, 10)
      : new Date(row.createdAt).toISOString().slice(0, 10);
    const existing = dayMap.get(day) ?? { total: 0, correct: 0 };
    existing.total++;
    if (row.validationResult === "correct") existing.correct++;
    dayMap.set(day, existing);
  }

  for (const b of buckets) {
    const denominator = b.correct + b.incorrect;
    b.actualRate = denominator > 0 ? b.correct / denominator : 0;
  }

  const byDay: AccuracyByDay[] = Array.from(dayMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, { total, correct }]) => ({
      date,
      total,
      correct,
      accuracy: total > 0 ? correct / total : 0,
    }));

  const totalValidated = validated.length;
  const totalCorrect = validated.filter(
    r => r.validationResult === "correct"
  ).length;
  const overallAccuracy =
    totalValidated > 0 ? totalCorrect / totalValidated : 0;

  return { buckets, byDay, overallAccuracy, totalValidated, totalPending };
}

// ─── Backfill helpers ─────────────────────────────────────────────────────────

export async function getAllCompletedDocuments(limit = 500) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(documents)
    .where(eq(documents.status, "complete"))
    .orderBy(desc(documents.createdAt))
    .limit(limit);
}

// ─── Sitemap helpers ──────────────────────────────────────────────────────────
export async function getVerifiedClaimsForSitemap(limit = 5000) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select({
      id: claims.id,
      updatedAt: claims.updatedAt,
      createdAt: claims.createdAt,
    })
    .from(claims)
    .where(sql`${claims.verdict} IS NOT NULL AND ${claims.verdict} != ''`)
    .orderBy(desc(claims.updatedAt))
    .limit(limit);
}

// ─── Webhook Alert helpers ────────────────────────────────────────────────────
export async function insertWebhookAlert(data: {
  userId: number;
  url: string;
  secret: string;
  label?: string;
  eventTypes: string[];
}) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.insert(webhookAlerts).values({
    userId: data.userId,
    url: data.url,
    secret: data.secret,
    label: data.label ?? null,
    eventTypes: data.eventTypes,
    active: true,
  });
  return result;
}

export async function getWebhookAlertsByUser(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(webhookAlerts)
    .where(eq(webhookAlerts.userId, userId))
    .orderBy(desc(webhookAlerts.createdAt));
}

export async function deleteWebhookAlert(id: number, userId: number) {
  const db = await getDb();
  if (!db) return;
  await db
    .delete(webhookAlerts)
    .where(and(eq(webhookAlerts.id, id), eq(webhookAlerts.userId, userId)));
}

export async function getActiveWebhookAlerts() {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(webhookAlerts)
    .where(eq(webhookAlerts.active, true))
    .orderBy(desc(webhookAlerts.createdAt));
}

export async function updateWebhookAlertLastFired(id: number) {
  const db = await getDb();
  if (!db) return;
  await db
    .update(webhookAlerts)
    .set({ lastFiredAt: new Date() })
    .where(eq(webhookAlerts.id, id));
}

/**
 * Platform-wide aggregate stats for the public home page hero section.
 * Returns total documents audited, total claims extracted, supported verdicts,
 * and the number of approved authoritative sources.
 */
export async function getGlobalPlatformStats() {
  const db = await getDb();
  if (!db) {
    return {
      totalDocuments: 0,
      totalClaims: 0,
      supportedVerdicts: 0,
      verifiedSources: 4,
    };
  }
  const [docRow] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(documents)
    .where(sql`${documents.status} = 'complete'`);
  const [claimRow] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(claims);
  const [supportedRow] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(claims)
    .where(sql`${claims.verdict} IN ('Supported', 'Partially Supported')`);
  return {
    totalDocuments: Number(docRow?.count ?? 0),
    totalClaims: Number(claimRow?.count ?? 0),
    supportedVerdicts: Number(supportedRow?.count ?? 0),
    verifiedSources: 4, // RCSB PDB, PubMed, UniProt, ClinicalTrials.gov
  };
}

/**
 * Returns today's corpus growth counters for the Live Corpus Growth widget.
 * "Today" is defined as the UTC calendar day of the call.
 */
export async function getCorpusGrowthStats(): Promise<{
  claimsToday: number;
  graphNodesToday: number;
  graphEdgesToday: number;
  papersToday: number;
  totalClaims: number;
  totalGraphNodes: number;
  totalGraphEdges: number;
}> {
  const db = await getDb();
  if (!db) {
    return {
      claimsToday: 0,
      graphNodesToday: 0,
      graphEdgesToday: 0,
      papersToday: 0,
      totalClaims: 0,
      totalGraphNodes: 0,
      totalGraphEdges: 0,
    };
  }

  // Start of today in UTC as a MySQL DATETIME string
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const todayStr = todayStart.toISOString().replace("T", " ").slice(0, 19);

  const [claimsToday] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(claims)
    .where(sql`${claims.createdAt} >= ${todayStr}`);

  const [totalClaims] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(claims);

  const [graphNodesToday] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(graphEntities)
    .where(sql`${graphEntities.createdAt} >= ${todayStr}`);

  const [totalGraphNodes] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(graphEntities);

  const [graphEdgesToday] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(graphRelations)
    .where(sql`${graphRelations.createdAt} >= ${todayStr}`);

  const [totalGraphEdges] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(graphRelations);

  const [papersToday] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(autoIngestedPapers)
    .where(sql`${autoIngestedPapers.ingestedAt} >= ${todayStr}`);

  return {
    claimsToday: Number(claimsToday?.count ?? 0),
    graphNodesToday: Number(graphNodesToday?.count ?? 0),
    graphEdgesToday: Number(graphEdgesToday?.count ?? 0),
    papersToday: Number(papersToday?.count ?? 0),
    totalClaims: Number(totalClaims?.count ?? 0),
    totalGraphNodes: Number(totalGraphNodes?.count ?? 0),
    totalGraphEdges: Number(totalGraphEdges?.count ?? 0),
  };
}

// ─── Paginated Public Claims API ─────────────────────────────────────────────

export type PublicClaimRow = {
  id: number;
  claimText: string;
  claimType: string;
  extractedValue: string | null;
  pdbId: string | null;
  verdict: string | null;
  verdictRationale: string | null;
  confidenceScore: number | null;
  verdictMethod: string | null;
  pdbEvidenceUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
  documentId: number;
  documentTitle: string;
  verticalDomain: string;
};

export async function getPaginatedPublicClaims(opts: {
  page: number; // 1-based
  pageSize?: number; // default 100, max 500
  verdict?: string; // filter by verdict
  vertical?: string; // filter by verticalDomain
  claimType?: string; // filter by claimType
  updatedSince?: Date; // cursor for incremental crawls
  q?: string; // full-text search across claim_text and verdict_rationale
}): Promise<{ rows: PublicClaimRow[]; total: number; totalPages: number }> {
  const db = await getDb();
  if (!db) return { rows: [], total: 0, totalPages: 0 };

  const pageSize = Math.min(opts.pageSize ?? 100, 500);
  const page = Math.max(1, opts.page);
  const offset = (page - 1) * pageSize;

  // Build WHERE conditions
  const conditions = [
    sql`${claims.verdict} IS NOT NULL AND ${claims.verdict} != ''`,
  ];
  if (opts.verdict) conditions.push(sql`${claims.verdict} = ${opts.verdict}`);
  if (opts.claimType)
    conditions.push(sql`${claims.claimType} = ${opts.claimType}`);
  if (opts.updatedSince)
    conditions.push(gte(claims.updatedAt, opts.updatedSince));
  if (opts.vertical)
    conditions.push(sql`${documents.verticalDomain} = ${opts.vertical}`);
  if (opts.q) {
    const pattern = `%${opts.q}%`;
    conditions.push(
      or(
        like(claims.claimText, pattern),
        like(claims.verdictRationale, pattern),
        like(claims.pdbId, pattern),
        like(claims.claimType, pattern)
      )!
    );
  }

  const whereClause =
    conditions.length === 1
      ? conditions[0]
      : and(
          ...(conditions as [
            ReturnType<typeof sql>,
            ...ReturnType<typeof sql>[],
          ])
        );

  const [countRow] = await db
    .select({ total: sql<number>`COUNT(*)` })
    .from(claims)
    .innerJoin(documents, eq(claims.documentId, documents.id))
    .where(whereClause);

  const total = Number(countRow?.total ?? 0);
  const totalPages = Math.ceil(total / pageSize);

  const rows = await db
    .select({
      id: claims.id,
      claimText: claims.claimText,
      claimType: claims.claimType,
      extractedValue: claims.extractedValue,
      pdbId: claims.pdbId,
      verdict: claims.verdict,
      verdictRationale: claims.verdictRationale,
      confidenceScore: claims.confidenceScore,
      verdictMethod: claims.verdictMethod,
      pdbEvidenceUrl: claims.pdbEvidenceUrl,
      createdAt: claims.createdAt,
      updatedAt: claims.updatedAt,
      documentId: documents.id,
      documentTitle: documents.title,
      verticalDomain: documents.verticalDomain,
    })
    .from(claims)
    .innerJoin(documents, eq(claims.documentId, documents.id))
    .where(whereClause)
    .orderBy(desc(claims.updatedAt), desc(claims.id))
    .limit(pageSize)
    .offset(offset);

  return { rows: rows as PublicClaimRow[], total, totalPages };
}

/**
 * Returns a lightweight index of all verified claims for crawler discovery.
 * Fetches only the fields needed to build /api/public/claims/index.json:
 * id, verdict, verticalDomain, updatedAt, and documentId.
 * Capped at 10,000 rows to avoid memory pressure.
 */
export async function getAllClaimIndexRows(limit = 10000) {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select({
      id: claims.id,
      verdict: claims.verdict,
      updatedAt: claims.updatedAt,
      documentId: documents.id,
      verticalDomain: documents.verticalDomain,
    })
    .from(claims)
    .innerJoin(documents, eq(claims.documentId, documents.id))
    .where(and(isNotNull(claims.verdict), eq(documents.status, "complete")))
    .orderBy(desc(claims.updatedAt), desc(claims.id))
    .limit(limit);
  return rows;
}

// ─── Claim Score History ──────────────────────────────────────────────────────

/**
 * Fetch the composite truth score history for a single claim.
 * Returns up to `limit` rows ordered oldest-first (for sparkline rendering).
 */
export async function getClaimScoreHistory(
  claimId: number,
  limit = 30
): Promise<ClaimScoreHistory[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(claimScoreHistory)
    .where(eq(claimScoreHistory.claimId, claimId))
    .orderBy(asc(claimScoreHistory.snapshotAt))
    .limit(limit);
}

/**
 * Insert a score snapshot for a claim.
 * Uses onDuplicateKeyUpdate to handle the rare case where two snapshots
 * land in the same second (unique index on claimId + snapshotAt).
 */
export async function insertClaimScoreSnapshot(
  claimId: number,
  score: number,
  label: string | null,
  triggerSource: string = "pipeline"
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db
    .insert(claimScoreHistory)
    .values({
      claimId,
      compositeTruthScore: score,
      compositeTruthLabel: label,
      triggerSource,
    })
    .onDuplicateKeyUpdate({
      set: {
        compositeTruthScore: score,
        compositeTruthLabel: label,
      },
    });
}

// ─── Citation DB Helpers (Phase 96-B) ─────────────────────────────────────────

export async function insertCitation(
  data: InsertCitation
): Promise<number | null> {
  const db = await getDb();
  if (!db) return null;
  const result = await db.insert(citations).values(data);
  const header = result as unknown as [{ insertId: number }];
  return header[0]?.insertId ?? null;
}

/**
 * Get all citations for a given claim, ordered by createdAt ascending.
 * Returns [] if DB is unavailable.
 */
export async function getCitationsByClaimId(
  claimId: number
): Promise<Citation[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(citations)
    .where(eq(citations.claimId, claimId))
    .orderBy(asc(citations.createdAt));
}

/**
 * Get all citations for a given document, ordered by claimId then createdAt.
 * Returns [] if DB is unavailable.
 */
export async function getCitationsByDocumentId(
  documentId: number
): Promise<Citation[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(citations)
    .where(eq(citations.documentId, documentId))
    .orderBy(asc(citations.claimId), asc(citations.createdAt));
}
