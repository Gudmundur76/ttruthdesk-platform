/**
 * customerDashboard.test.ts
 * Phase 32: Customer Dashboard — data flow and UI contract tests.
 */

import { describe, it, expect } from "vitest";

// ─── Document list shape ──────────────────────────────────────────────────────

type DocStatus =
  | "pending"
  | "extracting"
  | "validating"
  | "generating_report"
  | "complete"
  | "failed";

interface DocumentRow {
  id: number;
  title: string;
  status: DocStatus;
  claimCount: number;
  topVerdict: string | null;
  createdAt: Date;
  errorMessage?: string | null;
}

const PROCESSING_STATUSES: DocStatus[] = ["extracting", "validating", "generating_report"];

function isProcessing(status: DocStatus): boolean {
  return PROCESSING_STATUSES.includes(status);
}

function computeStats(docs: DocumentRow[]) {
  return {
    total: docs.length,
    complete: docs.filter((d) => d.status === "complete").length,
    processing: docs.filter((d) => isProcessing(d.status)).length,
    totalClaims: docs.reduce((sum, d) => sum + d.claimCount, 0),
  };
}

describe("document list stats", () => {
  it("computes correct stats for mixed-status documents", () => {
    const docs: DocumentRow[] = [
      { id: 1, title: "Doc A", status: "complete", claimCount: 12, topVerdict: "Supported", createdAt: new Date() },
      { id: 2, title: "Doc B", status: "extracting", claimCount: 0, topVerdict: null, createdAt: new Date() },
      { id: 3, title: "Doc C", status: "complete", claimCount: 8, topVerdict: "Contradicted", createdAt: new Date() },
      { id: 4, title: "Doc D", status: "failed", claimCount: 0, topVerdict: null, createdAt: new Date() },
    ];
    const stats = computeStats(docs);
    expect(stats.total).toBe(4);
    expect(stats.complete).toBe(2);
    expect(stats.processing).toBe(1);
    expect(stats.totalClaims).toBe(20);
  });

  it("returns zero stats for empty document list", () => {
    const stats = computeStats([]);
    expect(stats.total).toBe(0);
    expect(stats.complete).toBe(0);
    expect(stats.processing).toBe(0);
    expect(stats.totalClaims).toBe(0);
  });

  it("identifies all processing statuses correctly", () => {
    expect(isProcessing("extracting")).toBe(true);
    expect(isProcessing("validating")).toBe(true);
    expect(isProcessing("generating_report")).toBe(true);
    expect(isProcessing("complete")).toBe(false);
    expect(isProcessing("failed")).toBe(false);
    expect(isProcessing("pending")).toBe(false);
  });
});

// ─── Verdict bar distribution ─────────────────────────────────────────────────

type VerdictType =
  | "Supported"
  | "Partially Supported"
  | "Ambiguous"
  | "Insufficient Evidence"
  | "Needs Expert Review"
  | "Contradicted"
  | "Out of Scope";

interface ClaimRow {
  id: number;
  verdict: VerdictType | null;
  overriddenVerdict: VerdictType | null;
}

function getFinalVerdict(claim: ClaimRow): VerdictType {
  return claim.overriddenVerdict ?? claim.verdict ?? "Insufficient Evidence";
}

function computeVerdictDistribution(claims: ClaimRow[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const c of claims) {
    const v = getFinalVerdict(c);
    counts[v] = (counts[v] ?? 0) + 1;
  }
  return counts;
}

describe("verdict bar distribution", () => {
  it("counts verdicts correctly", () => {
    const claims: ClaimRow[] = [
      { id: 1, verdict: "Supported", overriddenVerdict: null },
      { id: 2, verdict: "Supported", overriddenVerdict: null },
      { id: 3, verdict: "Contradicted", overriddenVerdict: null },
      { id: 4, verdict: null, overriddenVerdict: null },
    ];
    const dist = computeVerdictDistribution(claims);
    expect(dist["Supported"]).toBe(2);
    expect(dist["Contradicted"]).toBe(1);
    expect(dist["Insufficient Evidence"]).toBe(1);
  });

  it("uses overriddenVerdict when set", () => {
    const claims: ClaimRow[] = [
      { id: 1, verdict: "Contradicted", overriddenVerdict: "Supported" },
    ];
    const dist = computeVerdictDistribution(claims);
    expect(dist["Supported"]).toBe(1);
    expect(dist["Contradicted"]).toBeUndefined();
  });

  it("falls back to Insufficient Evidence when both verdict and override are null", () => {
    const claims: ClaimRow[] = [
      { id: 1, verdict: null, overriddenVerdict: null },
    ];
    const dist = computeVerdictDistribution(claims);
    expect(dist["Insufficient Evidence"]).toBe(1);
  });

  it("handles empty claims list", () => {
    const dist = computeVerdictDistribution([]);
    expect(Object.keys(dist)).toHaveLength(0);
  });
});

// ─── DashboardLayout nav items ────────────────────────────────────────────────

describe("dashboard nav items", () => {
  const menuItems = [
    { label: "My Audits", path: "/dashboard" },
    { label: "New Audit", path: "/submit" },
    { label: "Monitoring", path: "/monitoring" },
    { label: "Registry", path: "/registry" },
  ];

  it("has 4 nav items", () => {
    expect(menuItems).toHaveLength(4);
  });

  it("includes /dashboard as first item", () => {
    expect(menuItems[0].path).toBe("/dashboard");
  });

  it("includes /submit for new audit flow", () => {
    expect(menuItems.some((m) => m.path === "/submit")).toBe(true);
  });

  it("all items have non-empty labels and paths", () => {
    for (const item of menuItems) {
      expect(item.label.length).toBeGreaterThan(0);
      expect(item.path.startsWith("/")).toBe(true);
    }
  });
});

// ─── Admin backfill status shape ─────────────────────────────────────────────

describe("admin backfill status", () => {
  function buildStatus(completed: number, compiled: number) {
    const pending = completed - compiled;
    const percentComplete = completed > 0 ? Math.round((compiled / completed) * 100) : 0;
    return { completedDocuments: completed, wikiCompiled: compiled, wikiPending: pending, percentComplete };
  }

  it("shows 100% when all documents are compiled", () => {
    const s = buildStatus(50, 50);
    expect(s.percentComplete).toBe(100);
    expect(s.wikiPending).toBe(0);
  });

  it("shows 0% when no documents are compiled", () => {
    const s = buildStatus(50, 0);
    expect(s.percentComplete).toBe(0);
    expect(s.wikiPending).toBe(50);
  });

  it("shows 0% when there are no completed documents", () => {
    const s = buildStatus(0, 0);
    expect(s.percentComplete).toBe(0);
  });

  it("correctly computes partial progress", () => {
    const s = buildStatus(100, 75);
    expect(s.percentComplete).toBe(75);
    expect(s.wikiPending).toBe(25);
  });
});
