import {
  int,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  varchar,
  float,
  boolean,
  json,
  index,
  uniqueIndex,
} from "drizzle-orm/mysql-core";

// ─── Users ────────────────────────────────────────────────────────────────────
export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

// ─── Documents ────────────────────────────────────────────────────────────────
export const documents = mysqlTable("documents", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  title: varchar("title", { length: 512 }).notNull(),
  sourceType: mysqlEnum("sourceType", ["upload", "paste"]).notNull(),
  originalFileName: varchar("originalFileName", { length: 512 }),
  storageKey: varchar("storageKey", { length: 1024 }),
  storageUrl: varchar("storageUrl", { length: 2048 }),
  rawText: text("rawText"),
  status: mysqlEnum("status", [
    "pending",
    "extracting",
    "validating",
    "generating_report",
    "complete",
    "failed",
  ])
    .default("pending")
    .notNull(),
  errorMessage: text("errorMessage"),
  claimCount: int("claimCount").default(0).notNull(),
  verticalDomain: varchar("verticalDomain", { length: 64 }).default("structural_biology").notNull(),
  // Two-pass corpus quality tracking
  llmProvider: varchar("llmProvider", { length: 64 }).default("manus_builtin").notNull(),
  qualityTier: mysqlEnum("qualityTier", ["draft", "verified"]).default("draft").notNull(),
  needsReview: boolean("needsReview").default(true).notNull(),
  wikiCompiledAt: timestamp("wikiCompiledAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (t) => ({
  userIdIdx: index("documents_userId_idx").on(t.userId),
  statusIdx: index("documents_status_idx").on(t.status),
  verticalIdx: index("documents_vertical_idx").on(t.verticalDomain),
}));

export type Document = typeof documents.$inferSelect;
export type InsertDocument = typeof documents.$inferInsert;

// ─── Claims ───────────────────────────────────────────────────────────────────
export const claims = mysqlTable("claims", {
  id: int("id").autoincrement().primaryKey(),
  documentId: int("documentId").notNull(),
  claimText: text("claimText").notNull(),
  claimType: mysqlEnum("claimType", [
    "pdb_id",
    "protein_name",
    "experimental_method",
    "resolution",
    "organism",
    "ligand",
    "general_molecular",
  ]).notNull(),
  extractedValue: varchar("extractedValue", { length: 512 }),
  // PDB-specific fields
  pdbId: varchar("pdbId", { length: 16 }),
  proteinName: varchar("proteinName", { length: 512 }),
  experimentalMethod: varchar("experimentalMethod", { length: 256 }),
  resolution: float("resolution"),
  organism: varchar("organism", { length: 512 }),
  ligand: varchar("ligand", { length: 512 }),
  // Verdict
  verdict: mysqlEnum("verdict", [
    "Supported",
    "Contradicted",
    "Partially Supported",
    "Ambiguous",
    "Insufficient Evidence",
    "Out of Scope",
    "Needs Expert Review",
  ]),
  verdictRationale: text("verdictRationale"),
  // PDB evidence
  pdbEvidenceRaw: json("pdbEvidenceRaw"),
  pdbEvidenceUrl: varchar("pdbEvidenceUrl", { length: 2048 }),
  pdbEvidenceCheckedAt: timestamp("pdbEvidenceCheckedAt"),
  // Confidence scoring
  confidenceScore: float("confidenceScore"),  // 0.0–1.0; null = not yet scored
  confidenceFlags: json("confidenceFlags"),   // array of flag strings explaining low confidence
  // Review
  reviewedBy: int("reviewedBy"),
  reviewedAt: timestamp("reviewedAt"),
  reviewNotes: text("reviewNotes"),
  overriddenVerdict: mysqlEnum("overriddenVerdict", [
    "Supported",
    "Contradicted",
    "Partially Supported",
    "Ambiguous",
    "Insufficient Evidence",
    "Out of Scope",
    "Needs Expert Review",
  ]),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (t) => ({
  documentIdIdx: index("claims_documentId_idx").on(t.documentId),
  verdictIdx: index("claims_verdict_idx").on(t.verdict),
}));

export type Claim = typeof claims.$inferSelect;
export type InsertClaim = typeof claims.$inferInsert;

// ─── Audit Reports ────────────────────────────────────────────────────────────
export const auditReports = mysqlTable("audit_reports", {
  id: int("id").autoincrement().primaryKey(),
  documentId: int("documentId").notNull().unique(),
  userId: int("userId").notNull(),
  htmlStorageKey: varchar("htmlStorageKey", { length: 1024 }),
  htmlStorageUrl: varchar("htmlStorageUrl", { length: 2048 }),
  pdfStorageKey: varchar("pdfStorageKey", { length: 1024 }),
  pdfStorageUrl: varchar("pdfStorageUrl", { length: 2048 }),
  verdictSummary: json("verdictSummary"), // { Supported: n, Contradicted: n, ... }
  highRiskCount: int("highRiskCount").default(0).notNull(),
  totalClaims: int("totalClaims").default(0).notNull(),
  notifiedCustomer: boolean("notifiedCustomer").default(false).notNull(),
  generatedAt: timestamp("generatedAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type AuditReport = typeof auditReports.$inferSelect;
export type InsertAuditReport = typeof auditReports.$inferInsert;

// ─── Monitoring Feed ──────────────────────────────────────────────────────────
export const monitoringFeed = mysqlTable("monitoring_feed", {
  id: int("id").autoincrement().primaryKey(),
  documentId: int("documentId").notNull(),
  source: mysqlEnum("source", ["pubmed", "biorxiv", "patent"]).notNull(),
  title: varchar("title", { length: 1024 }).notNull(),
  summary: text("summary"),
  url: varchar("url", { length: 2048 }),
  relevanceScore: float("relevanceScore"),
  publishedAt: timestamp("publishedAt"),
  discoveredAt: timestamp("discoveredAt").defaultNow().notNull(),
}, (t) => ({
  documentIdIdx: index("monitoring_feed_documentId_idx").on(t.documentId),
}));

export type MonitoringFeedItem = typeof monitoringFeed.$inferSelect;
export type InsertMonitoringFeedItem = typeof monitoringFeed.$inferInsert;

// ─── Audit Requests (Intake / Pricing) ───────────────────────────────────────
export const auditRequests = mysqlTable("audit_requests", {
  id: int("id").autoincrement().primaryKey(),
  tier: mysqlEnum("tier", ["starter", "diligence", "platform_pilot"]).notNull(),
  contactName: varchar("contactName", { length: 256 }).notNull(),
  contactEmail: varchar("contactEmail", { length: 320 }).notNull(),
  organization: varchar("organization", { length: 256 }),
  documentDescription: text("documentDescription").notNull(),
  additionalNotes: text("additionalNotes"),
  status: mysqlEnum("status", ["new", "in_review", "in_progress", "complete", "declined"])
    .default("new")
    .notNull(),
  ownerNotified: boolean("ownerNotified").default(false).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type AuditRequest = typeof auditRequests.$inferSelect;
export type InsertAuditRequest = typeof auditRequests.$inferInsert;

// ─── Monitoring Job Config ────────────────────────────────────────────────────
export const monitoringJobs = mysqlTable("monitoring_jobs", {
  id: int("id").autoincrement().primaryKey(),
  documentId: int("documentId").notNull().unique(),
  scheduleCronTaskUid: varchar("scheduleCronTaskUid", { length: 65 }),
  isActive: boolean("isActive").default(true).notNull(),
  lastRunAt: timestamp("lastRunAt"),
  nextRunAt: timestamp("nextRunAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type MonitoringJob = typeof monitoringJobs.$inferSelect;

// ─── Auto-Ingested Papers ─────────────────────────────────────────────────────
// Tracks papers automatically fetched from PubMed (e.g. deCODE Genetics)
// so we never re-ingest the same paper twice.
export const autoIngestedPapers = mysqlTable("auto_ingested_papers", {
  id: int("id").autoincrement().primaryKey(),
  pmid: varchar("pmid", { length: 32 }).notNull().unique(),
  doi: varchar("doi", { length: 512 }),
  title: varchar("title", { length: 1024 }).notNull(),
  authors: text("authors"),
  journal: varchar("journal", { length: 512 }),
  pubYear: varchar("pubYear", { length: 8 }),
  searchQuery: varchar("searchQuery", { length: 512 }).notNull(),
  documentId: int("documentId"),          // set once audit pipeline completes
  status: mysqlEnum("status", [
    "fetched",       // fetched from PubMed, not yet submitted
    "submitted",     // submitted to audit pipeline
    "complete",      // audit report generated
    "failed",        // pipeline error
  ]).default("fetched").notNull(),
  errorMessage: text("errorMessage"),
  isPublic: boolean("isPublic").default(true).notNull(),
  verticalDomain: varchar("verticalDomain", { length: 64 }).default("structural_biology").notNull(),
  ingestSource: mysqlEnum("ingestSource", ["pubmed", "biorxiv", "pdb_linked"]).default("pubmed").notNull(),
  ingestedAt: timestamp("ingestedAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (t) => ({
  statusIdx: index("auto_ingested_papers_status_idx").on(t.status),
  verticalIdx: index("auto_ingested_papers_vertical_idx").on(t.verticalDomain),
}));

export type AutoIngestedPaper = typeof autoIngestedPapers.$inferSelect;
export type InsertAutoIngestedPaper = typeof autoIngestedPapers.$inferInsert;

// ─── Magic Link Tokens ────────────────────────────────────────────────────────
// tokenHash: SHA-256 of the raw token (never store raw token)
// usedAt: set on first use — subsequent uses are rejected
// rateLimitKey: email + floor(createdAt / 10min) — used to enforce max 3/10min
export const magicLinkTokens = mysqlTable("magic_link_tokens", {
  id: int("id").autoincrement().primaryKey(),
  email: varchar("email", { length: 320 }).notNull(),
  tokenHash: varchar("tokenHash", { length: 64 }).notNull().unique(),
  expiresAt: timestamp("expiresAt").notNull(),
  usedAt: timestamp("usedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type MagicLinkToken = typeof magicLinkTokens.$inferSelect;
export type InsertMagicLinkToken = typeof magicLinkTokens.$inferInsert;

// ─── Email Users ──────────────────────────────────────────────────────────────
// Separate from Manus OAuth users — email-only accounts created via magic link
// plan: free_trial (30 days, 3 audits), academic (unlimited, domain-gated), starter/diligence/platform (paid)
export const emailUsers = mysqlTable("email_users", {
  id: int("id").autoincrement().primaryKey(),
  email: varchar("email", { length: 320 }).notNull().unique(),
  name: varchar("name", { length: 255 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  plan: mysqlEnum("plan", ["free_trial", "academic", "starter", "diligence", "platform"])
    .default("free_trial")
    .notNull(),
  trialExpiresAt: timestamp("trialExpiresAt"),  // null for non-trial plans
  auditCount: int("auditCount").default(0).notNull(),  // lifetime audit submissions
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type EmailUser = typeof emailUsers.$inferSelect;
export type InsertEmailUser = typeof emailUsers.$inferInsert;

// ─── Knowledge Graph ──────────────────────────────────────────────────────────
// Karpathy-style persistent entity graph.
// Each unique scientific entity (protein, PDB ID, method, organism, ligand,
// author, concept, document) gets a canonical node. Relations between nodes
// are typed edges (cites, contradicts, validates, homologous_to, …).
// Wiki markdown pages for each entity are stored in S3 and referenced by
// wikiPagePath.

export const graphEntities = mysqlTable("graph_entities", {
  id: int("id").autoincrement().primaryKey(),
  entityType: mysqlEnum("entityType", [
    "protein",
    "pdb_id",
    "method",
    "organism",
    "ligand",
    "author",
    "concept",
    "document",
  ]).notNull(),
  canonicalName: varchar("canonicalName", { length: 512 }).notNull(),
  wikiPagePath: varchar("wikiPagePath", { length: 1024 }),  // S3 key, e.g. wiki/pdb_id_1LYZ.md
  firstSeenDocumentId: int("firstSeenDocumentId"),
  metadata: json("metadata"),  // { pdbUrl, uniprotId, aliases, … }
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (t) => ({
  entityTypeNameIdx: index("entity_type_name_idx").on(t.entityType, t.canonicalName),
  entityCanonicalUnique: uniqueIndex("entity_canonical_unique").on(t.entityType, t.canonicalName),
}));

export type GraphEntity = typeof graphEntities.$inferSelect;
export type InsertGraphEntity = typeof graphEntities.$inferInsert;

export const graphRelations = mysqlTable("graph_relations", {
  id: int("id").autoincrement().primaryKey(),
  sourceEntityId: int("sourceEntityId").notNull(),
  targetEntityId: int("targetEntityId").notNull(),
  relationType: mysqlEnum("relationType", [
    "cites",           // document → entity
    "contradicts",     // claim → claim / entity → entity
    "validates",       // evidence → claim
    "homologous_to",   // protein → protein
    "binds",           // protein → ligand
    "expressed_in",    // protein → organism
    "uses_method",     // document → method
    "authored_by",     // document → author
    "related_to",      // generic
  ]).notNull(),
  evidenceDocumentId: int("evidenceDocumentId"),  // which doc created this edge
  confidenceScore: float("confidenceScore"),       // LLM-assigned 0.0–1.0
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (t) => ({
  relationSourceIdx: index("relation_source_idx").on(t.sourceEntityId),
  relationTargetIdx: index("relation_target_idx").on(t.targetEntityId),
  relationTypeIdx: index("relation_type_idx").on(t.relationType),
  relationUnique: uniqueIndex("relation_unique").on(
    t.sourceEntityId,
    t.targetEntityId,
    t.relationType,
  ),
}));

export type GraphRelation = typeof graphRelations.$inferSelect;
export type InsertGraphRelation = typeof graphRelations.$inferInsert;

// ─── User Subscriptions (PayPal) ─────────────────────────────────────────────
export const userSubscriptions = mysqlTable("user_subscriptions", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  paypalOrderId: varchar("paypalOrderId", { length: 128 }).notNull().unique(),
  paypalCaptureId: varchar("paypalCaptureId", { length: 128 }),
  planTier: mysqlEnum("planTier", ["starter", "diligence", "platform"]).notNull(),
  status: mysqlEnum("status", ["pending", "active", "cancelled", "refunded"]).default("pending").notNull(),
  auditsLimit: int("auditsLimit").notNull(),       // -1 = unlimited
  auditsUsed: int("auditsUsed").default(0).notNull(),
  amountUsd: int("amountUsd").notNull(),           // cents
  currency: varchar("currency", { length: 8 }).default("USD").notNull(),
  activatedAt: timestamp("activatedAt"),
  expiresAt: timestamp("expiresAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (t) => ({
  userIdIdx: index("subscriptions_userId_idx").on(t.userId),
  statusIdx: index("subscriptions_status_idx").on(t.status),
}));

export type UserSubscription = typeof userSubscriptions.$inferSelect;
export type InsertUserSubscription = typeof userSubscriptions.$inferInsert;

// ─── Prediction Engine (Ground Signal — Layer 4) ──────────────────────────────

export const predictionFeatures = mysqlTable("prediction_features", {
  id: int("id").autoincrement().primaryKey(),
  entityId: int("entityId"), // graph_entities.id — null means global/author-level feature
  userId: int("userId"),     // users.id — for author_contradiction_history features
  featureType: mysqlEnum("featureType", [
    "contradiction_rate",
    "claim_velocity",
    "author_contradiction_history",
    "method_reliability",
    "temporal_drift",
    "network_centrality",
    "evidence_strength_distribution",
  ]).notNull(),
  value: float("value").notNull(),
  sampleSize: int("sampleSize").notNull().default(0),
  computedAt: timestamp("computedAt").defaultNow().notNull(),
}, (t) => ({
  entityFeatureIdx: index("pf_entity_feature_idx").on(t.entityId, t.featureType),
  userFeatureIdx: index("pf_user_feature_idx").on(t.userId, t.featureType),
}));
export type PredictionFeature = typeof predictionFeatures.$inferSelect;
export type InsertPredictionFeature = typeof predictionFeatures.$inferInsert;

export const predictionModels = mysqlTable("prediction_models", {
  id: int("id").autoincrement().primaryKey(),
  modelType: mysqlEnum("modelType", [
    "claim_trajectory",
    "author_reliability",
    "consensus_velocity",
    "market_signal",
    "citation_decay",
  ]).notNull(),
  targetEntityId: int("targetEntityId"),  // graph_entities.id
  targetClaimId: int("targetClaimId"),    // claims.id
  targetUserId: int("targetUserId"),      // users.id (for author_reliability)
  prediction: json("prediction").notNull(), // { probability, confidenceInterval, rationale, factors[] }
  baseRate: float("baseRate"),
  featuresUsed: json("featuresUsed"),     // which features informed this prediction
  validatedAt: timestamp("validatedAt"),  // when actual verdict came in
  validationResult: mysqlEnum("validationResult", ["correct", "incorrect", "pending"]).default("pending"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (t) => ({
  claimIdx: index("pm_claim_idx").on(t.targetClaimId),
  entityIdx: index("pm_entity_idx").on(t.targetEntityId),
  userIdx: index("pm_user_idx").on(t.targetUserId),
  typeIdx: index("pm_type_idx").on(t.modelType),
}));
export type PredictionModel = typeof predictionModels.$inferSelect;
export type InsertPredictionModel = typeof predictionModels.$inferInsert;

// ─── Webhook Alert Subscriptions ──────────────────────────────────────────────
// Users register webhook URLs to receive real-time alerts when a claim is
// flagged as high-risk (contradictionProbability >= 0.70).
export const webhookAlerts = mysqlTable("webhook_alerts", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  url: varchar("url", { length: 2048 }).notNull(),
  secret: varchar("secret", { length: 128 }).notNull(),
  label: varchar("label", { length: 128 }),
  eventTypes: json("eventTypes").notNull(),
  active: boolean("active").notNull().default(true),
  lastFiredAt: timestamp("lastFiredAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (t) => ({
  userIdx: index("wa_user_idx").on(t.userId),
  activeIdx: index("wa_active_idx").on(t.active),
}));
export type WebhookAlert = typeof webhookAlerts.$inferSelect;
export type InsertWebhookAlert = typeof webhookAlerts.$inferInsert;

// ─── Manus Coordination Layer ─────────────────────────────────────────────────
// Three tables that enable 50+ parallel Manus tasks to coordinate through
// Truth Desk's DB as a shared substrate:
//   coord_tasks   — task registry (who is doing what)
//   coord_queue   — atomic work queue (papers to process)
//   coord_context — shared KV store (cross-task memory, mirrors manus-persistent-drive)

export const coordTasks = mysqlTable("coord_tasks", {
  id: int("id").autoincrement().primaryKey(),
  /** Unique identifier for this coordination task (UUID generated by caller) */
  taskId: varchar("taskId", { length: 64 }).notNull().unique(),
  /** Manus platform task ID returned by task.create API */
  manusTaskId: varchar("manusTaskId", { length: 128 }),
  /** Research vertical this task is working on */
  vertical: varchar("vertical", { length: 64 }).notNull(),
  /** Current phase label (e.g. 'ingest', 'validate', 'compile') */
  phase: varchar("phase", { length: 64 }).notNull().default("idle"),
  /** Current status */
  status: mysqlEnum("status", ["pending", "running", "completed", "failed", "stalled"]).notNull().default("pending"),
  /** ID of the work item currently being processed from coord_queue */
  workItemId: int("workItemId"),
  /** Arbitrary metadata JSON (agent config, spawn params, etc.) */
  meta: json("meta"),
  /** Error message if status=failed */
  errorMsg: text("errorMsg"),
  /** Items completed by this task */
  itemsCompleted: int("itemsCompleted").notNull().default(0),
  startedAt: timestamp("startedAt").defaultNow().notNull(),
  lastHeartbeatAt: timestamp("lastHeartbeatAt").defaultNow().notNull(),
  completedAt: timestamp("completedAt"),
}, (t) => ({
  statusIdx: index("ct_status_idx").on(t.status),
  verticalIdx: index("ct_vertical_idx").on(t.vertical),
  manusTaskIdx: index("ct_manus_task_idx").on(t.manusTaskId),
}));
export type CoordTask = typeof coordTasks.$inferSelect;
export type InsertCoordTask = typeof coordTasks.$inferInsert;

export const coordQueue = mysqlTable("coord_queue", {
  id: int("id").autoincrement().primaryKey(),
  /** Research vertical this item belongs to */
  vertical: varchar("vertical", { length: 64 }).notNull(),
  /** PubMed ID of the paper to process */
  pmid: varchar("pmid", { length: 32 }),
  /** DOI of the paper to process */
  doi: varchar("doi", { length: 256 }),
  /** Full URL of the paper (for non-PubMed sources) */
  paperUrl: varchar("paperUrl", { length: 2048 }),
  /** Title of the paper (pre-fetched to avoid redundant API calls) */
  title: text("title"),
  /** Priority: higher = processed first (0=normal, 10=high, 100=urgent) */
  priority: int("priority").notNull().default(0),
  /** Current status of this work item */
  status: mysqlEnum("status", ["pending", "claimed", "completed", "failed", "skipped"]).notNull().default("pending"),
  /** taskId of the coord_task that claimed this item */
  claimedBy: varchar("claimedBy", { length: 64 }),
  /** When this item was claimed (for stale-claim detection) */
  claimedAt: timestamp("claimedAt"),
  /** Processing result JSON (documentId, claimCount, verdict summary, etc.) */
  result: json("result"),
  /** Error message if status=failed */
  errorMsg: text("errorMsg"),
  /** Number of times this item has been retried */
  retryCount: int("retryCount").notNull().default(0),
  /** Source that added this item (e.g. 'pmc_feed', 'manual', 'orchestrator') */
  source: varchar("source", { length: 64 }).notNull().default("manual"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  completedAt: timestamp("completedAt"),
}, (t) => ({
  statusIdx: index("cq_status_idx").on(t.status),
  verticalIdx: index("cq_vertical_idx").on(t.vertical),
  priorityIdx: index("cq_priority_idx").on(t.priority),
  pmidIdx: index("cq_pmid_idx").on(t.pmid),
  claimedByIdx: index("cq_claimed_by_idx").on(t.claimedBy),
}));
export type CoordQueueItem = typeof coordQueue.$inferSelect;
export type InsertCoordQueueItem = typeof coordQueue.$inferInsert;

export const coordContext = mysqlTable("coord_context", {
  id: int("id").autoincrement().primaryKey(),
  /** Namespaced key, e.g. 'graph:lysozyme:known_claims' or 'task:abc123:progress' */
  key: varchar("key", { length: 512 }).notNull().unique(),
  /** JSON value — mirrors manus-persistent-drive KnowledgeGraphMemory node structure */
  value: json("value").notNull(),
  /** Optional namespace prefix for bulk queries */
  namespace: varchar("namespace", { length: 128 }).notNull().default("global"),
  /** TTL: if set, entries older than this are considered stale */
  expiresAt: timestamp("expiresAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (t) => ({
  namespaceIdx: index("cc_namespace_idx").on(t.namespace),
  expiresIdx: index("cc_expires_idx").on(t.expiresAt),
}));
export type CoordContext = typeof coordContext.$inferSelect;
export type InsertCoordContext = typeof coordContext.$inferInsert;

// ─── Vertical Alert Subscriptions ────────────────────────────────────────────
// Users subscribe to one or more research verticals and receive digest emails
// when new high-confidence claims or contradictions are published.

export const verticalAlerts = mysqlTable("vertical_alerts", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  /** Domain key matching VERTICAL_FEED_CONFIGS, e.g. 'creatine_ergogenics' */
  verticalDomain: varchar("verticalDomain", { length: 128 }).notNull(),
  /** Minimum confidence score (0–1) to trigger a notification */
  minConfidence: float("minConfidence").notNull().default(0.7),
  /** Notify on new contradictions in this vertical */
  notifyContradictions: boolean("notifyContradictions").notNull().default(true),
  /** Notify when a new high-confidence Supported claim is added */
  notifySupported: boolean("notifySupported").notNull().default(true),
  /** Digest frequency: 'instant' | 'daily' | 'weekly' */
  frequency: mysqlEnum("frequency", ["instant", "daily", "weekly"]).notNull().default("daily"),
  active: boolean("active").notNull().default(true),
  /** Last time a digest was sent for this subscription */
  lastSentAt: timestamp("lastSentAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (t) => ({
  userVerticalUnique: uniqueIndex("va_user_vertical_unique").on(t.userId, t.verticalDomain),
  userIdx: index("va_user_idx").on(t.userId),
  verticalIdx: index("va_vertical_idx").on(t.verticalDomain),
  activeIdx: index("va_active_idx").on(t.active),
}));
export type VerticalAlert = typeof verticalAlerts.$inferSelect;
export type InsertVerticalAlert = typeof verticalAlerts.$inferInsert;

// ─── Notification Log ─────────────────────────────────────────────────────────
// Tracks every notification sent to avoid duplicates and support audit trails.

export const notificationLog = mysqlTable("notification_log", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  /** Type: 'vertical_digest' | 'contradiction_alert' | 'high_confidence_claim' */
  notifType: varchar("notifType", { length: 64 }).notNull(),
  /** JSON payload: { verticalDomain, claimIds, contradictionIds, etc. } */
  payload: json("payload").notNull(),
  /** Delivery channel: 'manus' (built-in notification) | 'webhook' */
  channel: mysqlEnum("channel", ["manus", "webhook"]).notNull().default("manus"),
  /** Delivery status */
  status: mysqlEnum("status", ["sent", "failed", "skipped"]).notNull().default("sent"),
  errorMsg: text("errorMsg"),
  sentAt: timestamp("sentAt").defaultNow().notNull(),
}, (t) => ({
  userIdx: index("nl_user_idx").on(t.userId),
  typeIdx: index("nl_type_idx").on(t.notifType),
  sentAtIdx: index("nl_sent_at_idx").on(t.sentAt),
}));
export type NotificationLogEntry = typeof notificationLog.$inferSelect;
export type InsertNotificationLogEntry = typeof notificationLog.$inferInsert;

// ─── Webhook Delivery Log ─────────────────────────────────────────────────────
// Tracks every outbound webhook POST — status, response, latency, and retry history.
// Enables the admin delivery log UI and retry-on-failure logic.
export const webhookDeliveryLog = mysqlTable("webhook_delivery_log", {
  id: int("id").autoincrement().primaryKey(),
  /** FK → webhook_alerts.id */
  webhookId: int("webhookId").notNull(),
  /** Snapshot of the target URL at delivery time */
  url: varchar("url", { length: 2048 }).notNull(),
  /** Event type that triggered this delivery */
  eventType: varchar("eventType", { length: 64 }).notNull(),
  /** Full JSON payload sent */
  payload: json("payload").notNull(),
  /** HTTP status code returned (null if network error) */
  httpStatus: int("httpStatus"),
  /** Delivery outcome */
  status: mysqlEnum("status", ["success", "failed", "timeout", "retry_pending"]).notNull(),
  /** Response body (first 2048 chars) */
  responseBody: text("responseBody"),
  /** Round-trip latency in milliseconds */
  latencyMs: int("latencyMs"),
  /** Number of delivery attempts so far (1 = first try) */
  attemptCount: int("attemptCount").notNull().default(1),
  /** Timestamp of next scheduled retry (null if no retry needed) */
  nextRetryAt: timestamp("nextRetryAt"),
  /** Error message if delivery failed */
  errorMsg: text("errorMsg"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (t) => ({
  webhookIdx: index("wdl_webhook_idx").on(t.webhookId),
  statusIdx: index("wdl_status_idx").on(t.status),
  createdAtIdx: index("wdl_created_at_idx").on(t.createdAt),
  retryIdx: index("wdl_retry_idx").on(t.nextRetryAt),
}));
export type WebhookDeliveryLog = typeof webhookDeliveryLog.$inferSelect;
export type InsertWebhookDeliveryLog = typeof webhookDeliveryLog.$inferInsert;

// ─── Claim Provenance Events ──────────────────────────────────────────────────
// Each row records one step in the pipeline that produced or modified a claim.
// Steps: extraction → evidence_lookup → quality_scoring → verdict_override
export const claimProvenanceEvents = mysqlTable("claim_provenance_events", {
  id: int("id").autoincrement().primaryKey(),
  claimId: int("claimId").notNull(),
  documentId: int("documentId").notNull(),
  /** Pipeline step name */
  step: mysqlEnum("step", [
    "extraction",
    "evidence_lookup",
    "quality_scoring",
    "verdict_override",
    "agent_ingestion",
    "similarity_check",
  ]).notNull(),
  /** Who or what performed this step */
  actor: varchar("actor", { length: 128 }).notNull().default("system"),
  /** Input snapshot (claim text, config, etc.) */
  inputSnapshot: json("inputSnapshot"),
  /** Output snapshot (verdict, score, evidence URL, etc.) */
  outputSnapshot: json("outputSnapshot"),
  /** Duration of this step in milliseconds */
  durationMs: int("durationMs"),
  /** Whether this step succeeded */
  success: boolean("success").notNull().default(true),
  /** Error message if step failed */
  errorMsg: text("errorMsg"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (t) => ({
  claimIdIdx: index("cpe_claim_id_idx").on(t.claimId),
  documentIdIdx: index("cpe_document_id_idx").on(t.documentId),
  stepIdx: index("cpe_step_idx").on(t.step),
  createdAtIdx: index("cpe_created_at_idx").on(t.createdAt),
}));
export type ClaimProvenanceEvent = typeof claimProvenanceEvents.$inferSelect;
export type InsertClaimProvenanceEvent = typeof claimProvenanceEvents.$inferInsert;

// ─── Entity Co-occurrence ─────────────────────────────────────────────────────
// Tracks how often two entities appear together in the same document.
// Used to power the co-occurrence graph UI.
export const entityCooccurrences = mysqlTable("entity_cooccurrences", {
  id: int("id").autoincrement().primaryKey(),
  entityAId: int("entityAId").notNull(),
  entityBId: int("entityBId").notNull(),
  documentId: int("documentId").notNull(),
  /** Number of times these two entities co-occur in the same document */
  coCount: int("coCount").notNull().default(1),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (t) => ({
  entityPairDocIdx: uniqueIndex("cooc_entity_pair_doc_idx").on(t.entityAId, t.entityBId, t.documentId),
  entityAIdx: index("cooc_entity_a_idx").on(t.entityAId),
  entityBIdx: index("cooc_entity_b_idx").on(t.entityBId),
  documentIdIdx: index("cooc_document_id_idx").on(t.documentId),
}));
export type EntityCooccurrence = typeof entityCooccurrences.$inferSelect;
export type InsertEntityCooccurrence = typeof entityCooccurrences.$inferInsert;

// ─── Confidence History ───────────────────────────────────────────────────────
// Tracks confidence score changes over time for each claim.
// Used to power the confidence trend sparkline in ClaimPage.tsx.
export const confidenceHistory = mysqlTable("confidence_history", {
  id: int("id").autoincrement().primaryKey(),
  claimId: int("claimId").notNull(),
  documentId: int("documentId").notNull(),
  /** Confidence score at this point in time (0.0–1.0) */
  score: float("score").notNull(),
  /** Label for the event that triggered this score (e.g. "initial", "quality_pass", "human_review") */
  trigger: varchar("trigger", { length: 64 }).notNull().default("initial"),
  /** Optional flags array explaining the score */
  flags: json("flags"),
  recordedAt: timestamp("recordedAt").defaultNow().notNull(),
}, (t) => ({
  claimIdIdx: index("ch_claim_id_idx").on(t.claimId),
  documentIdIdx: index("ch_document_id_idx").on(t.documentId),
  recordedAtIdx: index("ch_recorded_at_idx").on(t.recordedAt),
}));
export type ConfidenceHistory = typeof confidenceHistory.$inferSelect;
export type InsertConfidenceHistory = typeof confidenceHistory.$inferInsert;

// ─── API Keys ─────────────────────────────────────────────────────────────────
// User-generated API keys for programmatic access to the Truth Desk API.
// Raw key is never stored — only a SHA-256 hash.
// Scopes: "read" (GET only), "write" (POST/PUT/DELETE), "admin" (all)
export const apiKeys = mysqlTable("api_keys", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  /** SHA-256 hex of the raw key — never store raw key */
  keyHash: varchar("keyHash", { length: 64 }).notNull().unique(),
  /** Human-readable label set by the user */
  label: varchar("label", { length: 128 }).notNull(),
  /** JSON array of scope strings: ["read"], ["write"], ["read","write"], ["admin"] */
  scopes: json("scopes").notNull(),
  /** Prefix shown to user to identify the key (first 8 chars of raw key) */
  keyPrefix: varchar("keyPrefix", { length: 16 }).notNull(),
  lastUsedAt: timestamp("lastUsedAt"),
  revokedAt: timestamp("revokedAt"),
  expiresAt: timestamp("expiresAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (t) => ({
  userIdIdx: index("ak_user_id_idx").on(t.userId),
  keyHashIdx: uniqueIndex("ak_key_hash_idx").on(t.keyHash),
  revokedAtIdx: index("ak_revoked_at_idx").on(t.revokedAt),
}));
export type ApiKey = typeof apiKeys.$inferSelect;
export type InsertApiKey = typeof apiKeys.$inferInsert;
