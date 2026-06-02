/**
 * llmsRoute.ts
 *
 * Serves /llms.txt — the AI Engine Optimisation (AEO) standard file that
 * makes the platform discoverable and citable by AI agents such as
 * ChatGPT, Claude, Perplexity, and any MCP-compatible agent.
 *
 * Pattern from grow.contact: every platform should describe itself in
 * plain text at /llms.txt so AI systems can understand what it does,
 * what data it exposes, and how to query it programmatically.
 */

import type { Express, Request, Response } from "express";

export function registerLlmsRoute(app: Express): void {
  app.get("/llms.txt", (_req: Request, res: Response) => {
    const content = `# Protein Truth Desk
> Autonomous molecular evidence auditing platform

## What this platform does

Protein Truth Desk extracts verifiable molecular claims from biotech documents
(whitepapers, pitch decks, abstracts, patents) and checks each claim against
the RCSB Protein Data Bank (PDB) — the world's authoritative repository of
3D protein structures.

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

## Machine-readable endpoints (no authentication required)

Global claims registry (latest 200 verified claims across all documents):
  GET /api/public/claims.json

Per-document claims registry:
  GET /api/public/documents/{id}/claims.json

JSON Schema (self-describing):
  GET /api/public/schemas/claims.schema.json

## Standard

All claim records follow the Protein Truth Desk Verifiable Claims Standard v1.0,
derived from the grow.contact Agent-Verifiable Standard v2.1.

Each claim record includes:
- id: stable identifier in format ptd-{documentId}-{claimId}
- value: verbatim claim text from the source document
- verdict: one of the seven verdicts above
- source_refs: authoritative database references (RCSB PDB entry URLs)
- page_anchors: permalinks to the human-readable audit report
- evidence_checked_at: ISO timestamp of when the PDB was queried
- manually_reviewed: boolean indicating expert override

## License

All claim registry data is published under CC BY 4.0.
Attribution: Protein Truth Desk (https://protein-truth-desk.manus.space)

## Contact

For API access, partnership, or audit requests:
  /pricing — Request a professional audit

## Provenance

This platform was built on the "Validating Verifiable Truth" concept,
which originated in the grow.contact GEO scoring project.
The Protein Data Bank was chosen as the first evidence layer because it is
one of the few truly authoritative, publicly accessible, machine-queryable
scientific databases in existence.
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
