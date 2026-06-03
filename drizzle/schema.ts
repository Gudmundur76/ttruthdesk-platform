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
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

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
});

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
});

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
});

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
export const emailUsers = mysqlTable("email_users", {
  id: int("id").autoincrement().primaryKey(),
  email: varchar("email", { length: 320 }).notNull().unique(),
  name: varchar("name", { length: 255 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type EmailUser = typeof emailUsers.$inferSelect;
export type InsertEmailUser = typeof emailUsers.$inferInsert;
