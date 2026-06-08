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
  getPaginatedPublicClaims,
  getClaimWithDocument,
  getAllClaimIndexRows,
} from "./db";
import { buildClaimReviewJsonLd } from "./claimPageRoute";
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

  // ── Paginated public claims: GET /api/public/claims?page=N ─────────────────
  // Turns all 3,919+ verdicts into indexable URLs for AI crawlers.
  // Each page returns up to 100 claims with full metadata and RFC 5988 Link
  // headers so crawlers can walk the entire corpus page-by-page.
  app.options("/api/public/claims", (_req, res) => {
    res.set(CORS_HEADERS).status(204).end();
  });
  app.get("/api/public/claims", async (req: Request, res: Response) => {
    const pageParam = parseInt((req.query.page as string) ?? "1", 10);
    const pageSizeParam = parseInt((req.query.page_size as string) ?? "100", 10);
    const page = isNaN(pageParam) || pageParam < 1 ? 1 : pageParam;
    const pageSize = isNaN(pageSizeParam) ? 100 : Math.min(Math.max(1, pageSizeParam), 500);
    const verdict = typeof req.query.verdict === "string" ? req.query.verdict : undefined;
    const vertical = typeof req.query.vertical === "string" ? req.query.vertical : undefined;
    const claimType = typeof req.query.claim_type === "string" ? req.query.claim_type : undefined;
    const updatedSinceStr = typeof req.query.updated_since === "string" ? req.query.updated_since : undefined;
    const updatedSince = updatedSinceStr ? new Date(updatedSinceStr) : undefined;
    if (updatedSince && isNaN(updatedSince.getTime())) {
      return res.set(CORS_HEADERS).status(400).json({ error: "Invalid updated_since date" });
    }
    const q = typeof req.query.q === "string" && req.query.q.trim() ? req.query.q.trim() : undefined;
    const { rows, total, totalPages } = await getPaginatedPublicClaims({
      page, pageSize, verdict, vertical, claimType, updatedSince, q,
    });
    const base = originBase(req);
    // RFC 5988 Link headers for pagination
    const buildUrl = (p: number) => {
      const u = new URL(`${base}/api/public/claims`);
      u.searchParams.set("page", String(p));
      u.searchParams.set("page_size", String(pageSize));
      if (verdict) u.searchParams.set("verdict", verdict);
      if (vertical) u.searchParams.set("vertical", vertical);
      if (claimType) u.searchParams.set("claim_type", claimType);
      if (updatedSinceStr) u.searchParams.set("updated_since", updatedSinceStr);
      if (q) u.searchParams.set("q", q);
      return u.toString();
    };
    const linkParts = [
      `<${buildUrl(1)}>; rel="first"`,
      ...(page > 1 ? [`<${buildUrl(page - 1)}>; rel="prev"`] : []),
      ...(page < totalPages ? [`<${buildUrl(page + 1)}>; rel="next"`] : []),
      `<${buildUrl(totalPages || 1)}>; rel="last"`,
      `<${base}/api/public/schemas/claims.schema.json>; rel="describedby"; type="application/json"`,
    ];
    const claimItems = rows.map((r) => ({
      id: `ptd-${r.documentId}-${r.id}`,
      claim_id: r.id,
      document_id: r.documentId,
      document_title: r.documentTitle,
      vertical_domain: r.verticalDomain,
      claim_text: r.claimText,
      claim_type: r.claimType,
      extracted_value: r.extractedValue ?? null,
      pdb_id: r.pdbId ?? null,
      verdict: r.verdict,
      verdict_rationale: r.verdictRationale ?? null,
      confidence_score: r.confidenceScore ?? null,
      verdict_method: r.verdictMethod ?? null,
      evidence_url: r.pdbEvidenceUrl ?? null,
      page_url: `${base}/claim/${r.id}`,
      audit_url: `${base}/audit/${r.documentId}#claim-${r.id}`,
      created_at: r.createdAt.toISOString(),
      updated_at: r.updatedAt.toISOString(),
    }));
    res
      .set({
        ...CORS_HEADERS,
        Link: linkParts.join(", "),
        "X-Total-Count": String(total),
        "X-Total-Pages": String(totalPages),
        "X-Page": String(page),
        "X-Page-Size": String(pageSize),
      })
      .status(200)
      .json({
        $schema: `${base}/api/public/schemas/claims.schema.json`,
        generated_at: new Date().toISOString(),
        page,
        page_size: pageSize,
        total,
        total_pages: totalPages,
        filters: {
          verdict: verdict ?? null,
          vertical: vertical ?? null,
          claim_type: claimType ?? null,
          updated_since: updatedSinceStr ?? null,
          q: q ?? null,
        },
        claims: claimItems,
      });
  });

  // ── Lightweight claim index: GET /api/public/claims/index.json ─────────────
  // MUST be registered BEFORE /api/public/claims/:id to prevent Express from
  // treating "index.json" as a :id parameter.
  // Returns all claim IDs + verdicts + vertical slugs in a compact format.
  // Designed for crawler discovery — no full text, no rationale, minimal payload.
  app.options("/api/public/claims/index.json", (_req, res) => {
    res.set(CORS_HEADERS).status(204).end();
  });
  app.get("/api/public/claims/index.json", async (req: Request, res: Response) => {
    const rows = await getAllClaimIndexRows(10000);
    const base = originBase(req);
    const index = rows.map((r) => ({
      id: r.id,
      verdict: r.verdict,
      vertical: r.verticalDomain ?? null,
      document_id: r.documentId,
      updated_at: r.updatedAt?.toISOString() ?? null,
      url: `${base}/claim/${r.id}`,
      api_url: `${base}/api/public/claims/${r.id}`,
    }));
    return res
      .set({
        ...CORS_HEADERS,
        "Cache-Control": "public, max-age=900, s-maxage=3600, stale-while-revalidate=86400",
        "X-Total-Count": String(index.length),
        Link: [
          `<${base}/api/public/claims>; rel="collection"`,
          `<${base}/api/public/schemas/claims.schema.json>; rel="describedby"; type="application/json"`,
        ].join(", "),
      })
      .status(200)
      .json({
        $schema: `${base}/api/public/schemas/claims.schema.json`,
        generated_at: new Date().toISOString(),
        count: index.length,
        description: "Lightweight index of all verified claims. Use api_url to fetch full claim details.",
        claims: index,
      });
  });

  // ── Text search endpoint: GET /api/public/claims/search?q=... ─────────────
  // Dedicated search endpoint for external integrations (MCP tools, AI agents).
  // Returns up to 100 matching claims across the full corpus without pagination.
  // MUST be registered BEFORE /api/public/claims/:id.
  app.options("/api/public/claims/search", (_req, res) => {
    res.set(CORS_HEADERS).status(204).end();
  });
  app.get("/api/public/claims/search", async (req: Request, res: Response) => {
    const q = typeof req.query.q === "string" && req.query.q.trim() ? req.query.q.trim() : undefined;
    if (!q) {
      return res.set(CORS_HEADERS).status(400).json({
        error: "Missing required parameter: q",
        example: "/api/public/claims/search?q=Piscirickettsia+salmonis",
      });
    }
    const limitParam = parseInt((req.query.limit as string) ?? "50", 10);
    const limit = isNaN(limitParam) ? 50 : Math.min(Math.max(1, limitParam), 200);
    const verdict = typeof req.query.verdict === "string" ? req.query.verdict : undefined;
    const vertical = typeof req.query.vertical === "string" ? req.query.vertical : undefined;
    const { rows, total } = await getPaginatedPublicClaims({
      page: 1, pageSize: limit, q, verdict, vertical,
    });
    const base = originBase(req);
    const claimItems = rows.map((r) => ({
      id: `ptd-${r.documentId}-${r.id}`,
      claim_id: r.id,
      document_id: r.documentId,
      document_title: r.documentTitle,
      vertical_domain: r.verticalDomain,
      claim_text: r.claimText,
      claim_type: r.claimType,
      extracted_value: r.extractedValue ?? null,
      pdb_id: r.pdbId ?? null,
      verdict: r.verdict,
      verdict_rationale: r.verdictRationale ?? null,
      confidence_score: r.confidenceScore ?? null,
      evidence_url: r.pdbEvidenceUrl ?? null,
      page_url: `${base}/claim/${r.id}`,
      audit_url: `${base}/audit/${r.documentId}#claim-${r.id}`,
      timeline_url: `${base}/timeline?q=${encodeURIComponent(r.claimText)}`,
      created_at: r.createdAt.toISOString(),
      updated_at: r.updatedAt.toISOString(),
    }));
    return res
      .set({
        ...CORS_HEADERS,
        "X-Total-Count": String(total),
        "X-Returned-Count": String(claimItems.length),
        Link: [
          `<${base}/api/public/claims>; rel="collection"`,
          `<${base}/api/public/schemas/claims.schema.json>; rel="describedby"; type="application/json"`,
        ].join(", "),
      })
      .status(200)
      .json({
        $schema: `${base}/api/public/schemas/claims.schema.json`,
        generated_at: new Date().toISOString(),
        query: q,
        total_matches: total,
        returned: claimItems.length,
        limit,
        filters: { verdict: verdict ?? null, vertical: vertical ?? null },
        claims: claimItems,
      });
  });

  // ── Single-claim endpoint: GET /api/public/claims/:id ────────────────────
  // Returns full claim data with ClaimReview JSON-LD for AI crawlers and agents.
  app.options("/api/public/claims/:id", (_req, res) => {
    res.set(CORS_HEADERS).status(204).end();
  });
  app.get("/api/public/claims/:id", async (req: Request, res: Response) => {
    const claimId = parseInt(req.params.id ?? "", 10);
    if (isNaN(claimId)) {
      return res.set(CORS_HEADERS).status(400).json({ error: "Invalid claim ID" });
    }
    const row = await getClaimWithDocument(claimId);
    if (!row) {
      return res.set(CORS_HEADERS).status(404).json({ error: "Claim not found" });
    }
    const base = originBase(req);
    const { claimReview, faqPage } = buildClaimReviewJsonLd(row.claim, row.document, base);
    const lastModified = (row.claim.updatedAt ?? row.claim.createdAt ?? new Date()).toUTCString();
    return res
      .set({
        ...CORS_HEADERS,
        "Last-Modified": lastModified,
        Link: [
          `<${base}/api/public/claims>; rel="collection"`,
          `<${base}/audit/${row.document.id}#claim-${row.claim.id}>; rel="canonical"`,
          `<${base}/api/public/schemas/claims.schema.json>; rel="describedby"; type="application/json"`,
        ].join(", "),
      })
      .status(200)
      .json({
        claim_id: row.claim.id,
        document_id: row.document.id,
        document_title: row.document.title,
        claim_text: row.claim.claimText,
        claim_type: row.claim.claimType,
        extracted_value: row.claim.extractedValue ?? null,
        pdb_id: row.claim.pdbId ?? null,
        verdict: row.claim.verdict,
        verdict_rationale: row.claim.verdictRationale ?? null,
        confidence_score: row.claim.confidenceScore ?? null,
        evidence_url: row.claim.pdbEvidenceUrl ?? null,
        page_url: `${base}/claim/${row.claim.id}`,
        audit_url: `${base}/audit/${row.document.id}#claim-${row.claim.id}`,
        created_at: row.claim.createdAt?.toISOString() ?? null,
        updated_at: (row.claim.updatedAt ?? row.claim.createdAt)?.toISOString() ?? null,
        jsonld: [claimReview, faqPage],
      });
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
