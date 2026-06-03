/**
 * Phase 39 — Trust & Transparency Sprint tests
 *
 * These tests verify:
 * 1. The /trust route exists in App.tsx (static analysis via file content)
 * 2. The /docs/api route exists in App.tsx
 * 3. The HowWeVerifyPanel renders the correct step labels
 * 4. The Trust page contains the required compliance items
 * 5. The ApiDocs page contains the correct endpoint paths
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const ROOT = join(__dirname, "..");

function readClient(relPath: string): string {
  return readFileSync(join(ROOT, "client/src", relPath), "utf-8");
}

function readServer(relPath: string): string {
  return readFileSync(join(ROOT, "server", relPath), "utf-8");
}

// ── Route registration ────────────────────────────────────────────────────────
describe("App.tsx route registration", () => {
  const appContent = readClient("App.tsx");

  it("registers /trust route", () => {
    expect(appContent).toContain('path="/trust"');
    expect(appContent).toContain("Trust");
  });

  it("registers /docs/api route", () => {
    expect(appContent).toContain('path="/docs/api"');
    expect(appContent).toContain("ApiDocs");
  });
});

// ── TopNav links ──────────────────────────────────────────────────────────────
describe("TopNav.tsx nav links", () => {
  const navContent = readClient("components/TopNav.tsx");

  it("includes Trust nav link", () => {
    expect(navContent).toContain('href: "/trust"');
    expect(navContent).toContain('"Trust"');
  });

  it("includes API nav link", () => {
    expect(navContent).toContain('href: "/docs/api"');
    expect(navContent).toContain('"API"');
  });
});

// ── Trust page content ────────────────────────────────────────────────────────
describe("Trust.tsx page content", () => {
  const trustContent = readClient("pages/Trust.tsx");

  it("contains No Scraping manifesto section", () => {
    expect(trustContent).toContain("No-Scraping");
  });

  it("contains EU AI Act compliance section", () => {
    expect(trustContent).toContain("EU AI Act");
    expect(trustContent).toContain("LIMITED RISK");
  });

  it("lists all six data sources", () => {
    expect(trustContent).toContain("RCSB Protein Data Bank");
    expect(trustContent).toContain("PubMed E-utilities");
    expect(trustContent).toContain("Europe PMC");
    expect(trustContent).toContain("PubChem");
    expect(trustContent).toContain("bioRxiv");
    expect(trustContent).toContain("UniProt");
  });

  it("contains methodology pipeline steps", () => {
    expect(trustContent).toContain("Extract");
    expect(trustContent).toContain("Validate");
    expect(trustContent).toContain("Score");
    expect(trustContent).toContain("Report");
  });

  it("links to /docs/api", () => {
    expect(trustContent).toContain("/docs/api");
  });

  it("contains compliance checklist items", () => {
    expect(trustContent).toContain("Transparency obligation");
    expect(trustContent).toContain("Human oversight");
    expect(trustContent).toContain("No prohibited practices");
  });
});

// ── ApiDocs page content ──────────────────────────────────────────────────────
describe("ApiDocs.tsx page content", () => {
  const apiContent = readClient("pages/ApiDocs.tsx");

  it("documents the verify-claim endpoint", () => {
    expect(apiContent).toContain("/api/public/verify-claim");
    expect(apiContent).toContain("POST");
  });

  it("documents the claims.json endpoint", () => {
    expect(apiContent).toContain("/api/public/claims.json");
    expect(apiContent).toContain("GET");
  });

  it("documents the document claims endpoint", () => {
    expect(apiContent).toContain("/api/public/documents/:id/claims.json");
  });

  it("documents the claim detail page", () => {
    expect(apiContent).toContain("/claim/:id");
    expect(apiContent).toContain("ClaimReview");
  });

  it("includes curl examples", () => {
    expect(apiContent).toContain("curl");
  });

  it("includes Python examples", () => {
    expect(apiContent).toContain("import requests");
  });

  it("includes JavaScript examples", () => {
    expect(apiContent).toContain("await fetch");
  });

  it("documents error codes", () => {
    expect(apiContent).toContain("INVALID_INPUT");
    expect(apiContent).toContain("RATE_LIMITED");
    expect(apiContent).toContain("NOT_FOUND");
  });

  it("links to /trust page", () => {
    expect(apiContent).toContain("/trust");
  });
});

// ── HowWeVerifyPanel in AuditReport ──────────────────────────────────────────
describe("AuditReport.tsx HowWeVerifyPanel", () => {
  const auditContent = readClient("pages/AuditReport.tsx");

  it("contains HowWeVerifyPanel component", () => {
    expect(auditContent).toContain("HowWeVerifyPanel");
  });

  it("shows all 5 pipeline steps", () => {
    expect(auditContent).toContain("Document Ingested");
    expect(auditContent).toContain("Claims Extracted");
    expect(auditContent).toContain("Validated Against Databases");
    expect(auditContent).toContain("Confidence Scored");
    expect(auditContent).toContain("Report Generated");
  });

  it("links to /trust page", () => {
    expect(auditContent).toContain('href="/trust"');
  });

  it("mentions API-only data access", () => {
    expect(auditContent).toContain("API-only");
    expect(auditContent).toContain("No scraping");
  });
});
