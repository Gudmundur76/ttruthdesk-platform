/**
 * Tests for the claims registry serialiser.
 * Verifies that ClaimRecord output matches the Agent-Verifiable Standard v2.1
 * shape used by grow.contact.
 */

import { describe, it, expect } from "vitest";
import {
  serializeClaim,
  buildDocumentRegistry,
  buildGlobalRegistry,
} from "./claimsRegistrySerializer";
import type { Claim, Document, AuditReport } from "../drizzle/schema";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const BASE_URL = "https://protein-truth-desk.manus.space";

function makeClaim(overrides: Partial<Claim> = {}): Claim {
  return {
    id: 42,
    documentId: 7,
    claimText: "The crystal structure of lysozyme was solved at 1.8 Å resolution.",
    claimType: "resolution",
    extractedValue: "1.8",
    pdbId: "1LYZ",
    proteinName: "Lysozyme",
    experimentalMethod: "X-RAY DIFFRACTION",
    resolution: 1.8,
    organism: "Gallus gallus",
    ligand: null,
    verdict: "Supported",
    verdictRationale: "PDB 1LYZ confirms 1.8 Å resolution by X-ray diffraction.",
    pdbEvidenceRaw: null,
    pdbEvidenceUrl: "https://www.rcsb.org/structure/1LYZ",
    pdbEvidenceCheckedAt: new Date("2026-01-15T10:00:00Z"),
    reviewedBy: null,
    reviewedAt: null,
    reviewNotes: null,
    overriddenVerdict: null,
    createdAt: new Date("2026-01-14T09:00:00Z"),
    updatedAt: new Date("2026-01-15T10:00:00Z"),
    ...overrides,
  } as Claim;
}

function makeDocument(overrides: Partial<Document> = {}): Document {
  return {
    id: 7,
    userId: 1,
    title: "Lysozyme Structure Paper",
    sourceType: "paste",
    originalFileName: null,
    storageKey: null,
    storageUrl: null,
    rawText: "Full text...",
    status: "complete",
    errorMessage: null,
    claimCount: 1,
    createdAt: new Date("2026-01-14T08:00:00Z"),
    updatedAt: new Date("2026-01-15T10:00:00Z"),
    ...overrides,
  } as Document;
}

// ─── serializeClaim ───────────────────────────────────────────────────────────

describe("serializeClaim", () => {
  it("produces a stable id in ptd-<docId>-<claimId> format", () => {
    const record = serializeClaim(makeClaim(), 7, BASE_URL);
    expect(record.id).toBe("ptd-7-42");
  });

  it("preserves the verbatim claim text as value", () => {
    const claim = makeClaim();
    const record = serializeClaim(claim, 7, BASE_URL);
    expect(record.value).toBe(claim.claimText);
  });

  it("uses overriddenVerdict when present", () => {
    const claim = makeClaim({ overriddenVerdict: "Contradicted" as never });
    const record = serializeClaim(claim, 7, BASE_URL);
    expect(record.verdict).toBe("Contradicted");
    expect(record.manually_reviewed).toBe(true);
  });

  it("falls back to automated verdict when no override", () => {
    const claim = makeClaim({ overriddenVerdict: null });
    const record = serializeClaim(claim, 7, BASE_URL);
    expect(record.verdict).toBe("Supported");
    expect(record.manually_reviewed).toBe(false);
  });

  it("includes RCSB source ref when pdbId is present", () => {
    const record = serializeClaim(makeClaim(), 7, BASE_URL);
    expect(record.source_refs).toHaveLength(1);
    expect(record.source_refs[0].database).toBe("RCSB Protein Data Bank");
    expect(record.source_refs[0].entry_id).toBe("1LYZ");
    expect(record.source_refs[0].url).toBe("https://www.rcsb.org/structure/1LYZ");
  });

  it("returns empty source_refs when no pdbId", () => {
    const claim = makeClaim({ pdbId: null, pdbEvidenceUrl: null });
    const record = serializeClaim(claim, 7, BASE_URL);
    expect(record.source_refs).toHaveLength(0);
  });

  it("includes two page_anchors pointing to the audit report", () => {
    const record = serializeClaim(makeClaim(), 7, BASE_URL);
    expect(record.page_anchors).toHaveLength(2);
    expect(record.page_anchors[0]).toContain("/audit/7#claim-42");
  });

  it("serialises evidence_checked_at as ISO string", () => {
    const record = serializeClaim(makeClaim(), 7, BASE_URL);
    expect(record.evidence_checked_at).toBe("2026-01-15T10:00:00.000Z");
  });

  it("returns null evidence_checked_at when not set", () => {
    const claim = makeClaim({ pdbEvidenceCheckedAt: null });
    const record = serializeClaim(claim, 7, BASE_URL);
    expect(record.evidence_checked_at).toBeNull();
  });

  it("handles null verdict gracefully", () => {
    const claim = makeClaim({ verdict: null, overriddenVerdict: null });
    const record = serializeClaim(claim, 7, BASE_URL);
    expect(record.verdict).toBeNull();
  });
});

// ─── buildDocumentRegistry ────────────────────────────────────────────────────

describe("buildDocumentRegistry", () => {
  it("sets document_id and document_title from the document row", () => {
    const doc = makeDocument();
    const registry = buildDocumentRegistry(doc, [makeClaim()], null, BASE_URL);
    expect(registry.document_id).toBe(7);
    expect(registry.document_title).toBe("Lysozyme Structure Paper");
  });

  it("count matches the number of claim rows", () => {
    const registry = buildDocumentRegistry(
      makeDocument(),
      [makeClaim(), makeClaim({ id: 43 })],
      null,
      BASE_URL
    );
    expect(registry.count).toBe(2);
    expect(registry.claims).toHaveLength(2);
  });

  it("includes standard and license fields", () => {
    const registry = buildDocumentRegistry(makeDocument(), [], null, BASE_URL);
    expect(registry.standard).toBe("protein-truth-desk-verifiable-claims@1.0");
    expect(registry.license).toContain("creativecommons.org");
  });

  it("sets report_url to the audit page", () => {
    const registry = buildDocumentRegistry(makeDocument(), [], null, BASE_URL);
    expect(registry.report_url).toBe(`${BASE_URL}/audit/7`);
  });
});

// ─── buildGlobalRegistry ─────────────────────────────────────────────────────

describe("buildGlobalRegistry", () => {
  it("aggregates claims from multiple documents", () => {
    const rows = [
      { claim: makeClaim({ id: 1, documentId: 1 }), documentId: 1 },
      { claim: makeClaim({ id: 2, documentId: 2 }), documentId: 2 },
      { claim: makeClaim({ id: 3, documentId: 2 }), documentId: 2 },
    ];
    const registry = buildGlobalRegistry(rows, BASE_URL);
    expect(registry.count).toBe(3);
    expect(registry.claims[0].id).toBe("ptd-1-1");
    expect(registry.claims[1].id).toBe("ptd-2-2");
  });

  it("returns empty registry when no rows", () => {
    const registry = buildGlobalRegistry([], BASE_URL);
    expect(registry.count).toBe(0);
    expect(registry.claims).toHaveLength(0);
  });
});
