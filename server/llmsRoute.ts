/**
 * llmsRoute.ts
 *
 * Serves /llms.txt — the AI Engine Optimisation (AEO) standard file that
 * makes the platform discoverable and citable by AI agents such as
 * ChatGPT, Claude, Perplexity, and any MCP-compatible agent.
 */

import type { Express, Request, Response } from "express";

export function registerLlmsRoute(app: Express): void {
  app.get("/llms.txt", (_req: Request, res: Response) => {
    const content = `# Truth Desk
> Autonomous multi-vertical scientific claims verification platform

## What this platform does

Truth Desk extracts verifiable scientific claims from biotech documents
(whitepapers, pitch decks, abstracts, patents) and checks each claim against
authoritative databases — the RCSB Protein Data Bank (PDB), PubChem,
PMC Open Access, and UniProt.

Every claim receives one of seven verdicts:
- Supported
- Partially Supported
- Contradicted
- Ambiguous
- Insufficient Evidence
- Out of Scope
- Needs Expert Review

Results are published as machine-readable JSON registries that any AI agent,
investor due diligence tool, or regulatory system can query directly.

## Research verticals

- Structural Biology (live) — verified against RCSB PDB
- Salmon Biotech (beta) — verified against PubChem and PMC Open Access
- Drug Discovery (coming soon) — will use ChEMBL and DrugBank
- Clinical Genomics (coming soon) — will use ClinVar and dbSNP

## Machine-readable endpoints (no authentication required)

Global claims registry (latest 200 verified claims across all documents):
  GET /api/public/claims.json

Per-document claims registry:
  GET /api/public/documents/{id}/claims.json

Single-claim verification API:
  POST /api/public/verify-claim
  Body: { "claim": "string", "vertical": "structural_biology|salmon_biotech" }

MCP tool card (for AI agent integration):
  GET /.well-known/mcp.json

Markdown summary (for LLM context):
  GET /api/md

JSON Schema (self-describing):
  GET /api/public/schemas/claims.schema.json

Sitemap (all public audit report URLs):
  GET /sitemap.xml

## Public audit report pages

Each completed audit report has a public human-readable page with full
JSON-LD structured data (schema.org ScholarlyArticle + Claim types):
  /reports/{id}

These pages are indexed in /sitemap.xml and are designed to be discovered
and cited by AI search engines (ChatGPT, Perplexity, Google AI Overview).

## Automated ingestion

The platform automatically ingests new papers from PMC Open Access via a
nightly feed using PubMed E-utilities and MeSH term queries. Each paper
is audited and published to the Registry and /reports/{id} automatically.

## Standard

All claim records follow the Truth Desk Verifiable Claims Standard v1.0,
derived from the grow.contact Agent-Verifiable Standard v2.1.

Each claim record includes:
- id: stable identifier in format td-{documentId}-{claimId}
- value: verbatim claim text from the source document
- verdict: one of the seven verdicts above
- source_refs: authoritative database references
- page_anchors: permalinks to the human-readable audit report
- evidence_checked_at: ISO timestamp of when the database was queried
- manually_reviewed: boolean indicating expert override
- llm_provider: which model extracted the claim
- quality_tier: draft (free-tier LLM) or verified (premium model)

## License

All claim registry data is published under CC BY 4.0.
Attribution: Truth Desk (https://protein-desk-5r5rzpyg.manus.space)

## Contact

For API access, partnership, or audit requests:
  /pricing — Request a professional audit

## Registry

Browse all publicly available audit reports:
  /registry

## Knowledge Graph

Interactive force-directed graph of all verified claims:
  /graph
  Embed: /graph?embed=1

## Provenance

This platform was built on the "Validating Verifiable Truth" concept,
which originated in the grow.contact GEO scoring project.
The platform is operated by Arctic Media LLC.
`;

    res
      .set({
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "public, max-age=3600, s-maxage=86400",
        "X-Content-Type-Options": "nosniff",
      })
      .status(200)
      .send(content);
  });
}
