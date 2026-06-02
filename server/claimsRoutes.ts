/**
 * claimsRoutes.ts
 *
 * Registers two public, unauthenticated Express routes:
 *
 *   GET /api/public/documents/:id/claims.json
 *     → ClaimsRegistry for a single document (all claims, all verdicts)
 *
 *   GET /api/public/claims.json
 *     → GlobalClaimsRegistry — most recent 200 verified claims across all docs
 *
 * Both endpoints:
 *   - Return JSON with CORS headers so any agent or tool can fetch them
 *   - Include a Link header pointing to the schema and the audit report
 *   - Cache for 5 minutes (s-maxage=300) at the CDN layer
 */

import type { Express, Request, Response } from "express";
import {
  getDocumentById,
  getClaimsByDocument,
  getAuditReportByDocument,
  getRecentVerifiedClaims,
} from "./db";
import {
  buildDocumentRegistry,
  buildGlobalRegistry,
} from "./claimsRegistrySerializer";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Cache-Control": "public, max-age=300, s-maxage=300, stale-while-revalidate=3600",
  "Content-Type": "application/json; charset=utf-8",
  "X-Content-Type-Options": "nosniff",
};

function originBase(req: Request): string {
  // Prefer the forwarded host (Manus proxy), fall back to req.hostname
  const proto = req.headers["x-forwarded-proto"] ?? req.protocol ?? "https";
  const host =
    req.headers["x-forwarded-host"] ??
    req.headers.host ??
    "protein-truth-desk.manus.space";
  return `${proto}://${host}`;
}

export function registerClaimsRoutes(app: Express): void {
  // ── Per-document claims.json ────────────────────────────────────────────────
  app.options("/api/public/documents/:id/claims.json", (_req, res) => {
    res.set(CORS_HEADERS).status(204).end();
  });

  app.get(
    "/api/public/documents/:id/claims.json",
    async (req: Request, res: Response) => {
      const docId = parseInt(req.params.id, 10);
      if (isNaN(docId)) {
        res.set(CORS_HEADERS).status(400).json({ error: "Invalid document id" });
        return;
      }

      const [doc, claimRows, report] = await Promise.all([
        getDocumentById(docId),
        getClaimsByDocument(docId),
        getAuditReportByDocument(docId),
      ]);

      if (!doc) {
        res.set(CORS_HEADERS).status(404).json({ error: "Document not found" });
        return;
      }

      const base = originBase(req);
      const registry = buildDocumentRegistry(doc, claimRows, report ?? null, base);

      res
        .set({
          ...CORS_HEADERS,
          Link: [
            `<${base}/api/public/schemas/claims.schema.json>; rel="describedby"; type="application/json"`,
            `<${base}/audit/${docId}>; rel="canonical"`,
          ].join(", "),
        })
        .status(200)
        .json(registry);
    }
  );

  // ── Global claims.json ──────────────────────────────────────────────────────
  app.options("/api/public/claims.json", (_req, res) => {
    res.set(CORS_HEADERS).status(204).end();
  });

  app.get("/api/public/claims.json", async (req: Request, res: Response) => {
    const limitParam = parseInt((req.query.limit as string) ?? "200", 10);
    const limit = isNaN(limitParam) ? 200 : Math.min(limitParam, 500);

    const rows = await getRecentVerifiedClaims(limit);
    const base = originBase(req);
    const registry = buildGlobalRegistry(
      rows.map((r) => ({ claim: r.claim, documentId: r.documentId })),
      base
    );

    res
      .set({
        ...CORS_HEADERS,
        Link: `<${base}/api/public/schemas/claims.schema.json>; rel="describedby"; type="application/json"`,
      })
      .status(200)
      .json(registry);
  });

  // ── JSON Schema (self-describing) ───────────────────────────────────────────
  app.get(
    "/api/public/schemas/claims.schema.json",
    (_req: Request, res: Response) => {
      res.set(CORS_HEADERS).status(200).json({
        $schema: "https://json-schema.org/draft/2020-12/schema",
        $id: "https://protein-truth-desk.manus.space/api/public/schemas/claims.schema.json",
        title: "Protein Truth Desk Verifiable Claims Registry",
        description:
          "Machine-readable registry of molecular claims extracted from scientific documents, each verified against the RCSB Protein Data Bank.",
        type: "object",
        required: ["$schema", "standard", "generated_at", "count", "claims"],
        properties: {
          $schema: { type: "string", format: "uri" },
          standard: { type: "string" },
          generated_at: { type: "string", format: "date-time" },
          document_id: { type: "integer" },
          document_title: { type: "string" },
          report_url: { type: ["string", "null"], format: "uri" },
          license: { type: "string", format: "uri" },
          attribution: { type: "string" },
          count: { type: "integer", minimum: 0 },
          claims: {
            type: "array",
            items: {
              type: "object",
              required: ["id", "value", "label", "claim_type", "verdict", "date_observed"],
              properties: {
                id: { type: "string", description: "Stable claim identifier: ptd-<docId>-<claimId>" },
                value: { type: "string", description: "Verbatim claim text from the document" },
                label: { type: "string" },
                claim_type: {
                  type: "string",
                  enum: [
                    "pdb_id",
                    "protein_name",
                    "experimental_method",
                    "resolution",
                    "organism",
                    "ligand",
                    "general_molecular",
                  ],
                },
                extracted_value: { type: ["string", "null"] },
                verdict: {
                  type: ["string", "null"],
                  enum: [
                    "Supported",
                    "Contradicted",
                    "Partially Supported",
                    "Ambiguous",
                    "Insufficient Evidence",
                    "Out of Scope",
                    "Needs Expert Review",
                    null,
                  ],
                },
                verdict_rationale: { type: ["string", "null"] },
                manually_reviewed: { type: "boolean" },
                evidence_checked_at: { type: ["string", "null"], format: "date-time" },
                source_refs: {
                  type: "array",
                  items: {
                    type: "object",
                    required: ["database", "entry_id", "url"],
                    properties: {
                      database: { type: "string" },
                      entry_id: { type: "string" },
                      url: { type: "string", format: "uri" },
                      description: { type: "string" },
                    },
                  },
                },
                page_anchors: {
                  type: "array",
                  items: { type: "string", format: "uri" },
                },
                date_observed: { type: "string", format: "date-time" },
              },
            },
          },
        },
      });
    }
  );
}
