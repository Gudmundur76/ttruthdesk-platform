/**
 * claimsRegistrySerializer.ts
 *
 * Converts Protein Truth Desk audit claims into a grow.contact-style
 * machine-readable ClaimRecord registry.  The output is served at:
 *
 *   GET /api/public/documents/:id/claims.json   — per-document registry
 *   GET /api/public/claims.json                 — global registry (latest 200)
 *
 * Schema mirrors the Agent-Verifiable Standard v2.1 used by grow.contact
 * so that AI agents, investor tools, and regulatory systems can verify
 * any claim back to its authoritative PDB source in one hop.
 */

import type { Claim, Document, AuditReport } from "../drizzle/schema";

// ─── Output types (mirrors grow.contact ClaimRecord) ─────────────────────────

export type ClaimSourceRef = {
  database: string;
  entry_id: string;
  url: string;
  description?: string;
};

export type ClaimRecord = {
  /** Stable identifier: ptd-<documentId>-<claimId> */
  id: string;
  /** The verbatim claim text extracted from the document */
  value: string;
  /** Human-readable label describing what is being claimed */
  label: string;
  /** Claim category */
  claim_type: string;
  /** Extracted structured value (PDB ID, resolution, etc.) */
  extracted_value: string | null;
  /** Final verdict (override takes precedence over automated) */
  verdict: string | null;
  /** Rationale explaining the verdict */
  verdict_rationale: string | null;
  /** Whether this verdict was manually overridden by a reviewer */
  manually_reviewed: boolean;
  /** ISO date when the PDB evidence was checked */
  evidence_checked_at: string | null;
  /** Authoritative source references */
  source_refs: ClaimSourceRef[];
  /** Permalink to the audit report containing this claim */
  page_anchors: string[];
  /** ISO date this claim was first extracted */
  date_observed: string;
  /** Phase 103: Composite truth label combining upstream verdict + provenance + citation chain */
  composite_truth_label: string | null;
  /** Phase 103: Composite truth score 0.0–1.0 (null = not yet computed) */
  composite_truth_score: number | null;
};

export type ClaimsRegistry = {
  $schema: string;
  standard: string;
  generated_at: string;
  document_id: number;
  document_title: string;
  report_url: string | null;
  license: string;
  attribution: string;
  count: number;
  claims: ClaimRecord[];
};

export type GlobalClaimsRegistry = {
  $schema: string;
  standard: string;
  generated_at: string;
  license: string;
  attribution: string;
  count: number;
  claims: ClaimRecord[];
};

// ─── Schema URL (self-describing) ────────────────────────────────────────────

const SCHEMA_URL =
  "https://protein-truth-desk.manus.space/api/public/schemas/claims.schema.json";

const STANDARD = "protein-truth-desk-verifiable-claims@1.0";

// ─── Serialiser helpers ───────────────────────────────────────────────────────

function buildSourceRefs(claim: Claim): ClaimSourceRef[] {
  const refs: ClaimSourceRef[] = [];

  if (claim.pdbId) {
    refs.push({
      database: "RCSB Protein Data Bank",
      entry_id: claim.pdbId.toUpperCase(),
      url:
        claim.pdbEvidenceUrl ??
        `https://www.rcsb.org/structure/${claim.pdbId.toUpperCase()}`,
      description: `PDB entry for ${claim.pdbId.toUpperCase()}`,
    });
  }

  return refs;
}

function buildLabel(claim: Claim): string {
  switch (claim.claimType) {
    case "pdb_id":
      return `PDB structure identifier: ${claim.extractedValue ?? claim.pdbId ?? "unknown"}`;
    case "resolution":
      return `Crystal structure resolution${claim.pdbId ? ` for ${claim.pdbId.toUpperCase()}` : ""}`;
    case "experimental_method":
      return `Experimental determination method${claim.pdbId ? ` for ${claim.pdbId.toUpperCase()}` : ""}`;
    case "protein_name":
      return `Protein name claim`;
    case "organism":
      return `Source organism claim`;
    case "ligand":
      return `Ligand / small molecule claim`;
    case "general_molecular":
      return `General molecular biology claim`;
    default:
      return `Molecular claim`;
  }
}

function effectiveVerdict(claim: Claim): string | null {
  return claim.overriddenVerdict ?? claim.verdict ?? null;
}

export function serializeClaim(
  claim: Claim,
  documentId: number,
  originBase: string
): ClaimRecord {
  const verdictSlug = (effectiveVerdict(claim) ?? "unverified")
    .toLowerCase()
    .replace(/\s+/g, "-");

  return {
    id: `ptd-${documentId}-${claim.id}`,
    value: claim.claimText,
    label: buildLabel(claim),
    claim_type: claim.claimType,
    extracted_value: claim.extractedValue ?? null,
    verdict: effectiveVerdict(claim),
    verdict_rationale: claim.verdictRationale ?? null,
    manually_reviewed: claim.overriddenVerdict !== null,
    evidence_checked_at: claim.pdbEvidenceCheckedAt
      ? new Date(claim.pdbEvidenceCheckedAt).toISOString()
      : null,
    source_refs: buildSourceRefs(claim),
    page_anchors: [
      `${originBase}/audit/${documentId}#claim-${claim.id}`,
      `${originBase}/audit/${documentId}#verdict-${verdictSlug}`,
    ],
    date_observed: new Date(claim.createdAt).toISOString(),
    composite_truth_label:
      ((claim as Record<string, unknown>).compositeTruthLabel as
        | string
        | null) ?? null,
    composite_truth_score:
      ((claim as Record<string, unknown>).compositeTruthScore as
        | number
        | null) ?? null,
  };
}

export function buildDocumentRegistry(
  doc: Document,
  claimRows: Claim[],
  _report: AuditReport | null,
  originBase: string
): ClaimsRegistry {
  return {
    $schema: SCHEMA_URL,
    standard: STANDARD,
    generated_at: new Date().toISOString(),
    document_id: doc.id,
    document_title: doc.title,
    report_url: `${originBase}/audit/${doc.id}`,
    license: "https://creativecommons.org/licenses/by/4.0/",
    attribution: `Protein Truth Desk verifiable-claims registry for document "${doc.title}" (CC BY 4.0)`,
    count: claimRows.length,
    claims: claimRows.map(c => serializeClaim(c, doc.id, originBase)),
  };
}

export function buildGlobalRegistry(
  rows: Array<{ claim: Claim; documentId: number }>,
  originBase: string
): GlobalClaimsRegistry {
  return {
    $schema: SCHEMA_URL,
    standard: STANDARD,
    generated_at: new Date().toISOString(),
    license: "https://creativecommons.org/licenses/by/4.0/",
    attribution:
      "Protein Truth Desk global verifiable-claims registry (CC BY 4.0)",
    count: rows.length,
    claims: rows.map(({ claim, documentId }) =>
      serializeClaim(claim, documentId, originBase)
    ),
  };
}
