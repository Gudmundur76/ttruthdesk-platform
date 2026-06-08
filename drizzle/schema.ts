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
  /** FrictionEngine pre-submission scan result stored at submission time */
  preflightResult: json("preflightResult"),
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
  // Deterministic verdict provenance (Phase 79)
  verdictMethod: mysqlEnum("verdictMethod", [
    "deterministic_source",
    "confidence_threshold",
    "completeness_gate",
    "override",
    "fallback",
  ]),
  sourceCompletenessScore: float("sourceCompletenessScore"), // 0.0–1.0 at time of verdict
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

// ─── Wiki Pages ───────────────────────────────────────────────────────────────
// LLM-maintained wiki pages (entity pages, concept pages, synthesis pages).
// The LLM writes and updates content; humans read.
export const wikiPages = mysqlTable("wiki_pages", {
  id: int("id").autoincrement().primaryKey(),
  /** URL-safe slug, unique per page (e.g. "entity-lysozyme", "concept-x-ray-crystallography") */
  slug: varchar("slug", { length: 256 }).notNull().unique(),
  /** Human-readable page title */
  title: varchar("title", { length: 512 }).notNull(),
  /** Page category: entity | concept | synthesis | source_summary */
  category: mysqlEnum("category", ["entity", "concept", "synthesis", "source_summary"]).notNull().default("entity"),
  /** Full markdown content of the page — written and maintained by the LLM */
  content: text("content").notNull().default(""),
  /** Number of source documents that have contributed to this page */
  sourceCount: int("sourceCount").notNull().default(0),
  /** JSON array of slugs that link to this page */
  inboundLinks: json("inboundLinks").$type<string[]>().notNull().default([]),
  /** JSON array of slugs this page links to */
  outboundLinks: json("outboundLinks").$type<string[]>().notNull().default([]),
  /** Average confidence score of claims on this page (0-1) */
  avgConfidence: float("avgConfidence").default(0),
  /** Vertical domain this page belongs to */
  verticalDomain: varchar("verticalDomain", { length: 64 }).default("structural_biology").notNull(),
  /** ISO timestamp of last LLM update */
  lastCompiledAt: timestamp("lastCompiledAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (t) => ({
  slugIdx: uniqueIndex("wp_slug_idx").on(t.slug),
  categoryIdx: index("wp_category_idx").on(t.category),
  verticalIdx: index("wp_vertical_idx").on(t.verticalDomain),
  updatedAtIdx: index("wp_updated_at_idx").on(t.updatedAt),
}));
export type WikiPage = typeof wikiPages.$inferSelect;
export type InsertWikiPage = typeof wikiPages.$inferInsert;

// ─── Wiki Index ───────────────────────────────────────────────────────────────
// Serialised index.md — the LLM-maintained catalog of all wiki pages.
// Single row, replaced on each rebuild.
export const wikiIndex = mysqlTable("wiki_index", {
  id: int("id").autoincrement().primaryKey(),
  /** Full markdown content of the index */
  content: text("content").notNull().default(""),
  /** Total page count at last build */
  pageCount: int("pageCount").notNull().default(0),
  lastBuiltAt: timestamp("lastBuiltAt").defaultNow().notNull(),
});
export type WikiIndex = typeof wikiIndex.$inferSelect;

// ─── Wiki Log ─────────────────────────────────────────────────────────────────
// Append-only chronological log of wiki operations (ingest, lint, query).
export const wikiLog = mysqlTable("wiki_log", {
  id: int("id").autoincrement().primaryKey(),
  /** Operation type: ingest | lint | query | update */
  action: mysqlEnum("action", ["ingest", "lint", "query", "update"]).notNull(),
  /** Page slug affected (null for lint/query operations) */
  slug: varchar("slug", { length: 256 }),
  /** Human-readable summary of what happened */
  summary: text("summary").notNull(),
  /** Number of pages touched by this operation */
  pagesAffected: int("pagesAffected").notNull().default(0),
  /** Source document ID if triggered by an ingest */
  documentId: int("documentId"),
  recordedAt: timestamp("recordedAt").defaultNow().notNull(),
}, (t) => ({
  actionIdx: index("wl_action_idx").on(t.action),
  recordedAtIdx: index("wl_recorded_at_idx").on(t.recordedAt),
  documentIdIdx: index("wl_document_id_idx").on(t.documentId),
}));
export type WikiLogEntry = typeof wikiLog.$inferSelect;
export type InsertWikiLogEntry = typeof wikiLog.$inferInsert;

// ─── Meta-Agent Checks ───────────────────────────────────────────────────────
// Persistent log of every check the codeGuardianAgent (swarm Agent 7) runs.
// Each row is one invariant evaluation — not a script output, but a typed record.
export const metaAgentChecks = mysqlTable("meta_agent_checks", {
  id: int("id").autoincrement().primaryKey(),
  /** Which agent produced this check (always 'codeGuardianAgent' for now) */
  agentName: varchar("agentName", { length: 128 }).notNull().default("codeGuardianAgent"),
  /** Layer + check type: e.g. 'schemaDrift', 'stubOverdue', 'stuckDocuments', 'orphanedClaims' */
  checkType: varchar("checkType", { length: 128 }).notNull(),
  /** Structured finding — shape depends on checkType */
  finding: json("finding").$type<Record<string, unknown>>().notNull(),
  /** What the agent did: 'ok' | 'alerted' | 'queuedFix' | 'autoResolved' | 'escalated' */
  actionTaken: mysqlEnum("actionTaken", ["ok", "alerted", "queuedFix", "autoResolved", "escalated"])
    .notNull()
    .default("ok"),
  /** Severity of the finding: 'info' | 'warning' | 'critical' */
  severity: mysqlEnum("severity", ["info", "warning", "critical"]).notNull().default("info"),
  /** Agent's self-reported confidence in this finding (0.0–1.0) */
  confidence: float("confidence").notNull().default(1.0),
  /** Set when a human has reviewed this decision */
  humanReviewedAt: timestamp("humanReviewedAt"),
  /** true = human agreed, false = human overrode, null = not yet reviewed */
  humanOverride: boolean("humanOverride"),
  /** ISO timestamp when the check was recorded */
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (t) => ({
  checkTypeIdx: index("mac_check_type_idx").on(t.checkType),
  severityIdx: index("mac_severity_idx").on(t.severity),
  actionIdx: index("mac_action_idx").on(t.actionTaken),
  createdAtIdx: index("mac_created_at_idx").on(t.createdAt),
  reviewIdx: index("mac_review_idx").on(t.humanReviewedAt),
}));
export type MetaAgentCheck = typeof metaAgentChecks.$inferSelect;
export type InsertMetaAgentCheck = typeof metaAgentChecks.$inferInsert;

// ─── Prediction Calibration (Platt Scaling) ───────────────────────────────────
/**
 * Stores learned Platt scaling parameters (w, b) for the prediction engine.
 * Updated by the calibration job after each batch of validated predictions.
 *
 * Platt scaling: P_calibrated = sigmoid(w * raw_score + b)
 * where w and b are fitted by logistic regression on (raw_score, actual_outcome) pairs.
 */
export const predictionCalibration = mysqlTable("prediction_calibration", {
  id: int("id").autoincrement().primaryKey(),
  /** Which prediction model type these weights apply to */
  modelType: mysqlEnum("modelType", [
    "claim_trajectory",
    "author_reliability",
    "consensus_velocity",
    "market_signal",
    "citation_decay",
  ]).notNull(),
  /** Platt scaling slope (w) — learned from historical data */
  plattW: float("plattW").notNull().default(1.0),
  /** Platt scaling intercept (b) — learned from historical data */
  plattB: float("plattB").notNull().default(0.0),
  /** Feature weights learned from data [claimType, author, entity, method] */
  featureWeights: json("featureWeights").notNull().$type<number[]>(),
  /** Number of validated predictions used to fit these weights */
  trainingSampleSize: int("trainingSampleSize").notNull().default(0),
  /** Brier score on the training set (lower = better calibrated) */
  brierScore: float("brierScore"),
  /** Log-loss on the training set */
  logLoss: float("logLoss"),
  /** Whether this is the active calibration for this model type */
  isActive: boolean("isActive").notNull().default(false),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (t) => ({
  modelTypeIdx: index("pc_model_type_idx").on(t.modelType),
  activeIdx: index("pc_active_idx").on(t.isActive),
}));
export type PredictionCalibration = typeof predictionCalibration.$inferSelect;
export type InsertPredictionCalibration = typeof predictionCalibration.$inferInsert;

// ─── Override Audit Log ───────────────────────────────────────────────────────
/**
 * Every human override of an LLM verdict is recorded here.
 * Enforces epistemic chain integrity: overrides require justification,
 * are flagged in the verdict display, and are logged for calibration.
 */
export const overrideAuditLog = mysqlTable("override_audit_log", {
  id: int("id").autoincrement().primaryKey(),
  claimId: int("claimId").notNull(),
  documentId: int("documentId").notNull(),
  /** User who performed the override */
  overriddenBy: int("overriddenBy").notNull(),
  /** Original LLM-generated verdict */
  originalVerdict: mysqlEnum("originalVerdict", [
    "Supported",
    "Contradicted",
    "Partially Supported",
    "Ambiguous",
    "Insufficient Evidence",
    "Out of Scope",
    "Needs Expert Review",
  ]).notNull(),
  /** New verdict set by the human */
  newVerdict: mysqlEnum("newVerdict", [
    "Supported",
    "Contradicted",
    "Partially Supported",
    "Ambiguous",
    "Insufficient Evidence",
    "Out of Scope",
    "Needs Expert Review",
  ]).notNull(),
  /** Required justification — must be ≥20 characters */
  justification: text("justification").notNull(),
  /** Epistemic category of the override */
  overrideCategory: mysqlEnum("overrideCategory", [
    "domain_expertise",      // human has domain knowledge LLM lacks
    "new_evidence",          // new evidence not in LLM training data
    "context_clarification", // LLM misunderstood context
    "scope_adjustment",      // claim scope differs from LLM interpretation
    "error_correction",      // LLM made a factual error
  ]).notNull(),
  /** Whether this override was logged to the wiki audit trail */
  wikiLogged: boolean("wikiLogged").notNull().default(false),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (t) => ({
  claimIdIdx: index("oal_claim_id_idx").on(t.claimId),
  documentIdIdx: index("oal_document_id_idx").on(t.documentId),
  overriddenByIdx: index("oal_overridden_by_idx").on(t.overriddenBy),
  createdAtIdx: index("oal_created_at_idx").on(t.createdAt),
}));
export type OverrideAuditLog = typeof overrideAuditLog.$inferSelect;
export type InsertOverrideAuditLog = typeof overrideAuditLog.$inferInsert;

// ─── LLM Provider Quality Scores ─────────────────────────────────────────────
/**
 * Tracks per-model accuracy and quality metrics.
 * Used to ban free/low-quality models from high-stakes verdicts.
 */
export const llmProviderQuality = mysqlTable("llm_provider_quality", {
  id: int("id").autoincrement().primaryKey(),
  /** Model identifier, e.g. "gpt-4o", "claude-3-5-sonnet", "mistral-7b-free" */
  modelId: varchar("modelId", { length: 128 }).notNull().unique(),
  /** Display name */
  modelName: varchar("modelName", { length: 256 }).notNull(),
  /** Provider: "openai" | "anthropic" | "openrouter" | "manus_builtin" */
  provider: varchar("provider", { length: 64 }).notNull(),
  /** Whether this is a free/community model */
  isFree: boolean("isFree").notNull().default(false),
  /** Allowed for high-stakes verdicts (Supported/Contradicted on peer-reviewed claims) */
  allowedForHighStakes: boolean("allowedForHighStakes").notNull().default(true),
  /** Total claims processed by this model */
  totalClaims: int("totalClaims").notNull().default(0),
  /** Claims where model verdict matched final validated verdict */
  correctPredictions: int("correctPredictions").notNull().default(0),
  /** Accuracy rate (correctPredictions / totalClaims) — updated by calibration job */
  accuracyRate: float("accuracyRate"),
  /** Average confidence score of claims processed by this model */
  avgConfidence: float("avgConfidence"),
  /** Brier score for this model's probability estimates */
  brierScore: float("brierScore"),
  /** Whether this model is currently banned from high-stakes use */
  isBanned: boolean("isBanned").notNull().default(false),
  /** Reason for ban (if isBanned = true) */
  banReason: text("banReason"),
  /** Timestamp of last quality score update */
  lastUpdatedAt: timestamp("lastUpdatedAt").defaultNow().notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (t) => ({
  modelIdIdx: uniqueIndex("lpq_model_id_idx").on(t.modelId),
  providerIdx: index("lpq_provider_idx").on(t.provider),
  bannedIdx: index("lpq_banned_idx").on(t.isBanned),
  highStakesIdx: index("lpq_high_stakes_idx").on(t.allowedForHighStakes),
}));
export type LlmProviderQuality = typeof llmProviderQuality.$inferSelect;
export type InsertLlmProviderQuality = typeof llmProviderQuality.$inferInsert;

// ─── Frontier Engine ──────────────────────────────────────────────────────────
/**
 * knowledge_gaps — Frontier Engine's gap registry.
 *
 * The Frontier Engine has WRITE access to this table only.
 * It NEVER writes to graph_entities, graphRelations, claims, or verdicts.
 * Every claim it generates goes through the full Truth Desk pipeline.
 */
export const knowledgeGaps = mysqlTable("knowledge_gaps", {
  id: int("id").autoincrement().primaryKey(),
  /** Optional: entity A involved in the gap (e.g. a protein) */
  entityAId: int("entityAId"),
  /** Optional: entity B involved in the gap (e.g. a ligand or method) */
  entityBId: int("entityBId"),
  /**
   * Gap type:
   *   structural      — entity has no relations in the graph
   *   evidence        — claims exist but no source could verify them
   *   contradiction   — multiple contradicts edges between related entities
   *   temporal        — claims verified with old data; newer data unavailable
   *   hypothesis      — Frontier-generated hypothesis awaiting verification
   */
  gapType: mysqlEnum("gapType", [
    "structural",
    "evidence",
    "contradiction",
    "temporal",
    "hypothesis",
  ]).notNull(),
  /**
   * Priority score: contradictionSeverity × entityCentrality × recencyOfConflict × communityDemand
   * Higher = more urgent to close.
   */
  priorityScore: float("priorityScore").notNull().default(0),
  /** Human-readable description of the gap */
  description: text("description").notNull(),
  /** Source that detected this gap: "frontier_scan" | "pipeline_trigger" | "manual" */
  detectionSource: varchar("detectionSource", { length: 64 }).notNull().default("frontier_scan"),
  /**
   * Gap lifecycle status:
   *   open            — detected, not yet pursued
   *   pursued         — evidence pursuit queued or in progress
   *   narrowing       — partial evidence found, gap partially closed
   *   closed_verified — closed by new verified evidence (Supported/Contradicted)
   *   closed_resolved — closed by contradiction resolution
   *   stale           — no progress after extended pursuit; deprioritized
   */
  status: mysqlEnum("status", [
    "open",
    "pursued",
    "narrowing",
    "closed_verified",
    "closed_resolved",
    "stale",
  ]).notNull().default("open"),
  /** Number of evidence pursuit attempts made */
  evidenceAttempts: int("evidenceAttempts").notNull().default(0),
  /** Number of claims that contributed to detecting this gap */
  contributingClaimCount: int("contributingClaimCount").notNull().default(0),
  /** ID of the coord_queue item that was created to pursue this gap */
  pursuitQueueId: int("pursuitQueueId"),
  /** ID of the claim/evidence that closed this gap (if closed) */
  closingEvidenceId: int("closingEvidenceId"),
  /** Estimated time to closure based on swarm throughput */
  projectedClosureAt: timestamp("projectedClosureAt"),
  /** When evidence pursuit was last attempted */
  lastPursuedAt: timestamp("lastPursuedAt"),
  openedAt: timestamp("openedAt").defaultNow().notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (t) => ({
  gapTypeIdx: index("kg_gap_type_idx").on(t.gapType),
  statusIdx: index("kg_status_idx").on(t.status),
  priorityIdx: index("kg_priority_idx").on(t.priorityScore),
  entityAIdx: index("kg_entity_a_idx").on(t.entityAId),
  entityBIdx: index("kg_entity_b_idx").on(t.entityBId),
}));
export type KnowledgeGap = typeof knowledgeGaps.$inferSelect;
export type InsertKnowledgeGap = typeof knowledgeGaps.$inferInsert;

/**
 * frontier_log — Audit trail of the Frontier Engine's reasoning.
 *
 * Records every action the Frontier Engine takes: gap detection, hypothesis
 * generation, search term expansion, queue priority adjustments.
 * This is the only place the Frontier Engine's name appears in the DB.
 * The knowledge graph itself (graph_entities, graphRelations) never references
 * the Frontier Engine — all graph writes go through the Truth Desk pipeline.
 */
export const frontierLog = mysqlTable("frontier_log", {
  id: int("id").autoincrement().primaryKey(),
  /**
   * Action type:
   *   gap_detected        — a new gap was written to knowledge_gaps
   *   hypothesis_queued   — a hypothesis was submitted to coord_queue
   *   search_expanded     — MeSH/search terms expanded for a vertical
   *   priority_adjusted   — a coord_queue item's priority was raised
   *   gap_closed          — a gap was closed by verified evidence
   *   hypothesis_verified — a Frontier hypothesis became a Supported claim
   *   hypothesis_refuted  — a Frontier hypothesis was Contradicted
   */
  actionType: mysqlEnum("actionType", [
    "gap_detected",
    "hypothesis_queued",
    "search_expanded",
    "priority_adjusted",
    "gap_closed",
    "hypothesis_verified",
    "hypothesis_refuted",
  ]).notNull(),
  /** ID of the knowledge_gap this action relates to (if any) */
  gapId: int("gapId"),
  /** ID of the coord_queue item this action relates to (if any) */
  queueItemId: int("queueItemId"),
  /** Structured reasoning snapshot: what pattern was detected, what action was taken */
  reasoning: json("reasoning"),
  /** Outcome of the action (if known at log time) */
  outcome: varchar("outcome", { length: 256 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (t) => ({
  actionTypeIdx: index("fl_action_type_idx").on(t.actionType),
  gapIdIdx: index("fl_gap_id_idx").on(t.gapId),
  createdAtIdx: index("fl_created_at_idx").on(t.createdAt),
}));
export type FrontierLogEntry = typeof frontierLog.$inferSelect;
export type InsertFrontierLogEntry = typeof frontierLog.$inferInsert;

// ─── Self-Prompting Engine Log ────────────────────────────────────────────────
/**
 * self_prompt_log — Audit trail of every Self-Prompting Engine decision cycle.
 *
 * Each row represents one State → Prompt → Action cycle:
 *   - The triggering event (what just happened)
 *   - The system state snapshot at the time of the decision
 *   - The LLM's reasoning
 *   - The prioritized action list it generated
 *   - Whether the system converged (stopped) or continued
 *   - Execution results for each action
 */
export const selfPromptLog = mysqlTable("self_prompt_log", {
  id: int("id").autoincrement().primaryKey(),
  /** The event type that triggered this self-prompt cycle */
  eventType: varchar("eventType", { length: 64 }).notNull(),
  /** JSON: the full SystemState snapshot used for reasoning */
  stateSnapshot: json("stateSnapshot").$type<Record<string, unknown>>().notNull(),
  /** The LLM's reasoning string */
  reasoning: text("reasoning").notNull(),
  /** JSON: the prioritized action list the LLM generated */
  actions: json("actions").$type<Array<Record<string, unknown>>>().notNull(),
  /** Whether the convergence gate fired (system decided to stop) */
  converged: boolean("converged").notNull().default(false),
  /** Total actions generated */
  actionCount: int("actionCount").notNull().default(0),
  /** Actions actually executed (not skipped by convergence gate) */
  executedCount: int("executedCount").notNull().default(0),
  /** JSON: execution results per action */
  executionResults: json("executionResults").$type<Array<Record<string, unknown>>>(),
  /** Duration of the full cycle in milliseconds */
  durationMs: int("durationMs"),
  /** Optional: claim ID that triggered this cycle */
  claimId: int("claimId"),
  /** Optional: document ID that triggered this cycle */
  documentId: int("documentId"),
  /** Optional: gap ID that triggered this cycle */
  gapId: int("gapId"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (t) => ({
  eventTypeIdx: index("spl_event_type_idx").on(t.eventType),
  convergedIdx: index("spl_converged_idx").on(t.converged),
  claimIdIdx: index("spl_claim_id_idx").on(t.claimId),
  documentIdIdx: index("spl_document_id_idx").on(t.documentId),
  createdAtIdx: index("spl_created_at_idx").on(t.createdAt),
}));
export type SelfPromptLogEntry = typeof selfPromptLog.$inferSelect;
export type InsertSelfPromptLogEntry = typeof selfPromptLog.$inferInsert;

// ─── Inverse Prompt Architecture ──────────────────────────────────────────────

/**
 * generated_claims — structured, verifiable claims produced by the
 * GraphQuestionGenerator from verified graph truth.
 */
export const generatedClaims = mysqlTable("generated_claims", {
  id: int("id").autoincrement().primaryKey(),
  claimText: text("claimText").notNull(),
  claimType: varchar("claimType", { length: 64 }).notNull(),
  inferenceType: mysqlEnum("inferenceType", [
    "gap_fill",
    "homology_projection",
    "contradiction_chase",
  ]).notNull(),
  requiredSources: json("requiredSources").$type<string[]>().notNull(),
  sourceQuery: text("sourceQuery"),
  parentVerifications: json("parentVerifications").$type<number[]>().notNull(),
  entityId: int("entityId"),
  reasoning: text("reasoning").notNull(),
  passedGate: boolean("passedGate").notNull().default(false),
  rejectionReason: varchar("rejectionReason", { length: 256 }),
  status: mysqlEnum("status", [
    "pending",
    "queued",
    "processing",
    "verified",
    "contradicted",
    "insufficient",
    "failed",
    "rejected",
    "deferred",
  ]).notNull().default("pending"),
  coordQueueId: int("coordQueueId"),
  priority: int("priority").notNull().default(50),
  documentId: int("documentId"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull().onUpdateNow(),
}, (t) => ({
  statusIdx: index("gc_status_idx").on(t.status),
  entityIdIdx: index("gc_entity_id_idx").on(t.entityId),
  inferenceTypeIdx: index("gc_inference_type_idx").on(t.inferenceType),
  passedGateIdx: index("gc_passed_gate_idx").on(t.passedGate),
  createdAtIdx: index("gc_created_at_idx").on(t.createdAt),
}));
export type GeneratedClaim = typeof generatedClaims.$inferSelect;
export type InsertGeneratedClaim = typeof generatedClaims.$inferInsert;

// ─── Autonomous Loop ───────────────────────────────────────────────────────────
// ─── Dream State ──────────────────────────────────────────────────────────────
/**
 * dream_sessions — audit log of every Dream State session.
 * One row per completed (or interrupted) dream cycle.
 * The Dream State is Layer 5 (L5): offline consolidation that runs only when
 * the system has converged and no external events are pending.
 */
export const dreamSessions = mysqlTable("dream_sessions", {
  id: int("id").autoincrement().primaryKey(),
  startedAt: timestamp("startedAt").defaultNow().notNull(),
  wokeAt: timestamp("wokeAt"),
  durationMs: int("durationMs"),
  cyclesCompleted: int("cyclesCompleted").notNull().default(0),
  /** Why the dream ended: max_cycles | external_event | critical_pattern | health_drop | duration_cap | in_progress */
  reasonForWaking: varchar("reasonForWaking", { length: 128 }),
  patternsFound: int("patternsFound").notNull().default(0),
  hypothesesGenerated: int("hypothesesGenerated").notNull().default(0),
  graphOptimizations: int("graphOptimizations").notNull().default(0),
  confidenceRecalibrations: int("confidenceRecalibrations").notNull().default(0),
  simulatedScenarios: int("simulatedScenarios").notNull().default(0),
  patternLog: json("patternLog").$type<Array<{
    type: string;
    description: string;
    urgency: "low" | "medium" | "high" | "critical";
    entityIds: number[];
    evidence: string;
  }>>(),
  simulationLog: json("simulationLog").$type<Array<{
    scenario: string;
    impactedClaimCount: number;
    impactedEntityCount: number;
    recommendation: string;
  }>>(),
  recalibrationLog: json("recalibrationLog").$type<Array<{
    claimId: number;
    currentConfidence: number;
    suggestedConfidence: number;
    reason: string;
  }>>(),
  manualTrigger: boolean("manualTrigger").notNull().default(false),
  healthScoreAtEntry: int("healthScoreAtEntry"),
  entityCountAtEntry: int("entityCountAtEntry"),
}, (t) => ({
  startedAtIdx: index("ds_started_at_idx").on(t.startedAt),
  wokeAtIdx: index("ds_woke_at_idx").on(t.wokeAt),
}));
export type DreamSession = typeof dreamSessions.$inferSelect;
export type InsertDreamSession = typeof dreamSessions.$inferInsert;

/**
 * event_queue — the central event bus for the autonomous loop.
 * Every event that enters the system is persisted here before processing.
 */
export const eventQueue = mysqlTable("event_queue", {
  id: int("id").autoincrement().primaryKey(),
  eventType: mysqlEnum("eventType", [
    "document_submitted",
    "paper_discovered",
    "source_data_changed",
    "verdict_complete",
    "contradiction_found",
    "gap_closed",
    "source_status_change",
    "system_health_change",
    "hypothesis_resolved",
    "manual_review_complete",
    "scheduled_tick",
    "loop_action_complete",
    "dream_pattern_detected",
    "confidence_review_needed",
    "dream_session_complete",
  ]).notNull(),
  payload: json("payload").$type<Record<string, unknown>>().notNull(),
  status: mysqlEnum("status", [
    "pending",
    "processing",
    "processed",
    "skipped",
    "failed",
  ]).notNull().default("pending"),
  /** Layer the event entered at (0=Friction, 1=Truth, 2=SelfPrompt, 3=Frontier, 4=Meta) */
  entryLayer: int("entryLayer").notNull().default(0),
  /** ID of the loop_run that processed this event */
  loopRunId: int("loopRunId"),
  /** Why the event was skipped (redundant/no-payload) */
  skipReason: varchar("skipReason", { length: 256 }),
  /** How many times processing was attempted */
  attempts: int("attempts").notNull().default(0),
  errorMessage: text("errorMessage"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  processedAt: timestamp("processedAt"),
}, (t) => ({
  statusIdx: index("eq_status_idx").on(t.status),
  eventTypeIdx: index("eq_event_type_idx").on(t.eventType),
  createdAtIdx: index("eq_created_at_idx").on(t.createdAt),
}));
export type EventQueueEntry = typeof eventQueue.$inferSelect;
export type InsertEventQueueEntry = typeof eventQueue.$inferInsert;

/**
 * loop_run — one full pass through the autonomous loop for a single event.
 * Tracks which layers were executed, what actions were taken, and whether
 * the system converged.
 */
export const loopRun = mysqlTable("loop_run", {
  id: int("id").autoincrement().primaryKey(),
  eventQueueId: int("eventQueueId").notNull(),
  eventType: varchar("eventType", { length: 64 }).notNull(),
  /** Layers executed as a bitmask: bit 0=L0, bit 1=L1, ... bit 4=L4 */
  layersExecuted: int("layersExecuted").notNull().default(0),
  /** JSON array of action objects: { type, description, priority, result } */
  actionsExecuted: json("actionsExecuted").$type<Array<{
    type: string;
    description: string;
    priority: number;
    result: "success" | "skipped" | "failed";
    error?: string;
  }>>().notNull(),
  converged: boolean("converged").notNull().default(false),
  convergenceReason: varchar("convergenceReason", { length: 512 }),
  /** Health score at the time of this run */
  healthScore: int("healthScore"),
  /** Whether the system entered safe mode during this run */
  safeModeTriggered: boolean("safeModeTriggered").notNull().default(false),
  durationMs: int("durationMs"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (t) => ({
  eventQueueIdIdx: index("lr_event_queue_id_idx").on(t.eventQueueId),
  eventTypeIdx: index("lr_event_type_idx").on(t.eventType),
  convergedIdx: index("lr_converged_idx").on(t.converged),
  createdAtIdx: index("lr_created_at_idx").on(t.createdAt),
}));
export type LoopRun = typeof loopRun.$inferSelect;
export type InsertLoopRun = typeof loopRun.$inferInsert;

/**
 * loop_config — singleton row for system-wide autonomous loop configuration.
 * Only one row should ever exist (id=1).
 */
export const loopConfig = mysqlTable("loop_config", {
  id: int("id").primaryKey().default(1),
  safeMode: boolean("safeMode").notNull().default(false),
  safeModeReason: varchar("safeModeReason", { length: 512 }),
  safeModeTriggeredAt: timestamp("safeModeTriggeredAt"),
  convergeThreshold: int("convergeThreshold").notNull().default(30),
  healthyThreshold: int("healthyThreshold").notNull().default(80),
  safeModeThreshold: int("safeModeThreshold").notNull().default(40),
  haltThreshold: int("haltThreshold").notNull().default(60),
  maxLoopDepth: int("maxLoopDepth").notNull().default(10),
  updatedAt: timestamp("updatedAt").defaultNow().notNull().onUpdateNow(),
});
export type LoopConfig = typeof loopConfig.$inferSelect;

/**
 * vertical_configs — admin-managed research vertical definitions.
 * Allows adding new verticals without code changes via the Vertical Expansion Wizard.
 */
export const verticalConfigs = mysqlTable("vertical_configs", {
  id: int("id").primaryKey().autoincrement(),
  domainKey: varchar("domainKey", { length: 64 }).notNull().unique(),
  displayName: varchar("displayName", { length: 128 }).notNull(),
  description: text("description"),
  /** JSON array of PubMed MeSH search terms */
  meshTerms: json("meshTerms").$type<string[]>().notNull().default([]),
  /** JSON array of approved source IDs for this vertical */
  sourceWhitelist: json("sourceWhitelist").$type<string[]>().notNull().default([]),
  /** Quality tier: 'draft' uses free LLM, 'verified' uses Kimi K2 */
  qualityTier: varchar("qualityTier", { length: 16 }).notNull().default("draft"),
  /** Whether this vertical is active and included in feed jobs */
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull().onUpdateNow(),
}, (t) => ({
  domainKeyIdx: index("vc_domain_key_idx").on(t.domainKey),
  enabledIdx: index("vc_enabled_idx").on(t.enabled),
}));
export type VerticalConfig = typeof verticalConfigs.$inferSelect;
export type InsertVerticalConfig = typeof verticalConfigs.$inferInsert;

/**
 * cron_run_log — execution history for all scheduled heartbeat jobs.
 * Each job handler writes one row per run so the Cron Health Dashboard
 * can show the last N runs per job with status, duration, and summary.
 */
export const cronRunLog = mysqlTable("cron_run_log", {
  id: int("id").primaryKey().autoincrement(),
  /** Matches the job name used in the heartbeat schedule (e.g. "discovery-loop-daily") */
  jobName: varchar("jobName", { length: 128 }).notNull(),
  /** "ok" | "error" | "skipped" */
  status: varchar("status", { length: 16 }).notNull().default("ok"),
  /** Wall-clock duration in milliseconds */
  durationMs: int("durationMs").notNull().default(0),
  /** Human-readable summary of what the run did (e.g. "Ingested 12 papers, 3 skipped") */
  summary: text("summary"),
  /** Error message if status = "error" */
  errorMessage: text("errorMessage"),
  /** UTC timestamp when the run started */
  ranAt: timestamp("ranAt").defaultNow().notNull(),
}, (t) => ({
  jobNameIdx: index("crl_job_name_idx").on(t.jobName),
  ranAtIdx: index("crl_ran_at_idx").on(t.ranAt),
}));
export type CronRunLog = typeof cronRunLog.$inferSelect;
export type InsertCronRunLog = typeof cronRunLog.$inferInsert;

// ─── Sprint I: Deployment Architecture ────────────────────────────────────────

/**
 * micron_deployments — tracks each "Micron" standalone site deployment.
 * A Micron is a lightweight, auto-generated static site for a vertical that
 * can be deployed to Vercel, Netlify, Docker, or IPFS.
 */
export const micronDeployments = mysqlTable("micron_deployments", {
  id: int("id").primaryKey().autoincrement(),
  /** FK to vertical_configs.domainKey */
  verticalKey: varchar("verticalKey", { length: 64 }).notNull(),
  /** Human-readable display name for this deployment */
  displayName: varchar("displayName", { length: 256 }).notNull(),
  /** Custom domain for the deployed site */
  domain: varchar("domain", { length: 512 }),
  /** Deploy target: vercel | netlify | docker | ipfs */
  deployTarget: mysqlEnum("deployTarget", ["vercel", "netlify", "docker", "ipfs"]).notNull(),
  /** Deployment status */
  status: mysqlEnum("status", ["pending", "building", "deployed", "failed", "cancelled"])
    .default("pending")
    .notNull(),
  /** Public URL of the deployed site */
  siteUrl: varchar("siteUrl", { length: 2048 }),
  /** Deployment-target-specific config (API tokens, project IDs, etc.) */
  config: json("config").$type<Record<string, string>>().notNull().default({}),
  /** Error message if status = failed */
  errorMessage: text("errorMessage"),
  /** Owner user ID */
  userId: int("userId").notNull(),
  deployedAt: timestamp("deployedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull().onUpdateNow(),
}, (t) => ({
  verticalKeyIdx: index("md_vertical_key_idx").on(t.verticalKey),
  statusIdx: index("md_status_idx").on(t.status),
  userIdx: index("md_user_idx").on(t.userId),
}));
export type MicronDeployment = typeof micronDeployments.$inferSelect;
export type InsertMicronDeployment = typeof micronDeployments.$inferInsert;

/**
 * discovery_runs — records each Auto-Discovery Engine run.
 * A run probes a set of candidate sources and produces adapter stubs.
 */
export const discoveryRuns = mysqlTable("discovery_runs", {
  id: int("id").primaryKey().autoincrement(),
  /** Vertical domain this run targeted */
  verticalKey: varchar("verticalKey", { length: 64 }).notNull(),
  /** Run status */
  status: mysqlEnum("status", ["running", "complete", "failed"]).default("running").notNull(),
  /** Phase currently executing: match | search | test | configure | register | monitor */
  currentPhase: varchar("currentPhase", { length: 32 }).default("match"),
  /** Number of sources matched */
  sourcesMatched: int("sourcesMatched").notNull().default(0),
  /** Number of sources successfully probed */
  sourcesProbed: int("sourcesProbed").notNull().default(0),
  /** Number of adapter stubs generated */
  adaptersGenerated: int("adaptersGenerated").notNull().default(0),
  /** JSON array of source IDs that were registered */
  registeredSources: json("registeredSources").$type<string[]>().notNull().default([]),
  /** JSON array of generated adapter file paths in S3 */
  adapterFiles: json("adapterFiles").$type<string[]>().notNull().default([]),
  /** Error message if status = failed */
  errorMessage: text("errorMessage"),
  /** Full structured log of the run phases */
  runLog: json("runLog").$type<Array<{ phase: string; message: string; ts: number }>>().notNull().default([]),
  startedAt: timestamp("startedAt").defaultNow().notNull(),
  completedAt: timestamp("completedAt"),
}, (t) => ({
  verticalKeyIdx: index("dr_vertical_key_idx").on(t.verticalKey),
  statusIdx: index("dr_status_idx").on(t.status),
  startedAtIdx: index("dr_started_at_idx").on(t.startedAt),
}));
export type DiscoveryRun = typeof discoveryRuns.$inferSelect;
export type InsertDiscoveryRun = typeof discoveryRuns.$inferInsert;

/**
 * source_registry_entries — persisted registry of discovered/approved sources.
 * Complements the in-memory SOURCE_WHITELIST with DB-backed entries that
 * survive restarts and can be managed via the admin UI.
 */
export const sourceRegistryEntries = mysqlTable("source_registry_entries", {
  id: int("id").primaryKey().autoincrement(),
  /** Stable machine-readable source ID, e.g. "rcsb_pdb" */
  sourceId: varchar("sourceId", { length: 128 }).notNull().unique(),
  /** Human-readable name */
  displayName: varchar("displayName", { length: 256 }).notNull(),
  /** Base URL of the source API */
  baseUrl: varchar("baseUrl", { length: 2048 }).notNull(),
  /** Source category */
  category: mysqlEnum("category", [
    "protein_structure",
    "sequence",
    "literature",
    "clinical",
    "chemistry",
    "genomics",
    "nutrition",
    "regulatory",
    "other",
  ]).notNull().default("other"),
  /** Approval status */
  approvalStatus: mysqlEnum("approvalStatus", ["pending", "approved", "rejected"])
    .default("pending")
    .notNull(),
  /** Whether the source is currently healthy */
  isHealthy: boolean("isHealthy").notNull().default(true),
  /** Last health check timestamp */
  lastHealthCheckAt: timestamp("lastHealthCheckAt"),
  /** HTTP status code from last health check */
  lastHealthStatus: int("lastHealthStatus"),
  /** Verticals this source is assigned to */
  verticals: json("verticals").$type<string[]>().notNull().default([]),
  /** Auto-generated adapter stub code (TypeScript) */
  adapterStub: text("adapterStub"),
  /** Discovery run that found this source (nullable for manually added sources) */
  discoveryRunId: int("discoveryRunId"),
  /** Schema description inferred during probing */
  schemaDescription: text("schemaDescription"),
  /** Rate limit info (requests per minute) */
  rateLimitRpm: int("rateLimitRpm"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull().onUpdateNow(),
}, (t) => ({
  sourceIdIdx: uniqueIndex("sre_source_id_idx").on(t.sourceId),
  categoryIdx: index("sre_category_idx").on(t.category),
  approvalStatusIdx: index("sre_approval_status_idx").on(t.approvalStatus),
}));
export type SourceRegistryEntry = typeof sourceRegistryEntries.$inferSelect;
export type InsertSourceRegistryEntry = typeof sourceRegistryEntries.$inferInsert;

// ─── Saved Research ───────────────────────────────────────────────────────────
export const savedResearch = mysqlTable("saved_research", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  question: text("question").notNull(),
  claimsJson: json("claimsJson").$type<unknown[]>().notNull().default([]),
  totalPapers: int("totalPapers").notNull().default(0),
  supportedClaims: int("supportedClaims").notNull().default(0),
  claimsAnalysed: int("claimsAnalysed").notNull().default(0),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (t) => ({
  userIdIdx: index("sr_user_id_idx").on(t.userId),
}));
export type SavedResearch = typeof savedResearch.$inferSelect;
export type InsertSavedResearch = typeof savedResearch.$inferInsert;

// ─── Public Submissions ───────────────────────────────────────────────────────
// Tracks claims submitted via POST /api/public/submit-claim
// (from Lovable site, external agents, MCP tools). Not tied to a user account.
export const publicSubmissions = mysqlTable("public_submissions", {
  id: int("id").autoincrement().primaryKey(),
  claimText: text("claimText").notNull(),
  verticalDomain: varchar("verticalDomain", { length: 64 }).default("structural_biology").notNull(),
  source: varchar("source", { length: 64 }).default("api").notNull(),
  documentId: int("documentId"),
  status: mysqlEnum("status", ["queued", "processing", "done", "failed"]).default("queued").notNull(),
  submitterIp: varchar("submitterIp", { length: 64 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull().onUpdateNow(),
}, (t) => ({
  statusIdx: index("ps_status_idx").on(t.status),
  createdAtIdx: index("ps_created_at_idx").on(t.createdAt),
  documentIdIdx: index("ps_document_id_idx").on(t.documentId),
}));
export type PublicSubmission = typeof publicSubmissions.$inferSelect;
export type InsertPublicSubmission = typeof publicSubmissions.$inferInsert;
