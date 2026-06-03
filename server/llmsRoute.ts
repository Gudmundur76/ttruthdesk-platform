/**
 * llmsRoute.ts
 *
 * Serves /llms.txt — the AI Engine Optimisation (AEO) standard file that
 * makes the platform discoverable and citable by AI agents such as
 * ChatGPT, Claude, Perplexity, and any MCP-compatible agent.
 *
 * The dynamic section is generated from the live knowledge graph (graph_entities
 * + graph_relations tables) and prepended to the static platform description.
 * Falls back to a static version if the DB is unavailable.
 */

import type { Express, Request, Response } from "express";
import { generateLlmsTxt } from "./wikiCompiler";

const STATIC_FOOTER = `
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

Sitemap (all public audit report URLs):
  GET /sitemap.xml

## Public pages

Each completed audit report:
  /reports/{id}

Each entity wiki page:
  /wiki/{entityType}/{entitySlug}

Each individual claim:
  /claim/{id}

## Standard

All claim records follow the Truth Desk Verifiable Claims Standard v1.0.
Each claim record includes:
- id: stable identifier in format td-{documentId}-{claimId}
- verdict: one of the seven verdicts above
- source_refs: authoritative database references
- evidence_checked_at: ISO timestamp of when the database was queried

## License

All claim registry data is published under CC BY 4.0.
Attribution: Truth Desk (https://protein-desk-5r5rzpyg.manus.space)

## Contact

For API access, partnership, or audit requests: /pricing
`;

export function registerLlmsRoute(app: Express): void {
  app.get("/llms.txt", async (req: Request, res: Response) => {
    try {
      const origin =
        process.env.VITE_APP_URL ??
        `${req.protocol}://${req.get("host") ?? "protein-desk-5r5rzpyg.manus.space"}`;

      const dynamicSection = await generateLlmsTxt(origin);
      const content = dynamicSection + STATIC_FOOTER;

      res
        .set({
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "public, max-age=1800, s-maxage=3600",
          "X-Content-Type-Options": "nosniff",
          // Link headers — point agents to MCP and API catalog
          Link: [
            `<${origin}/.well-known/mcp.json>; rel="mcp"`,
            `<${origin}/api/trpc>; rel="api-catalog"`,
          ].join(", "),
        })
        .status(200)
        .send(content);
    } catch (err) {
      console.error("[llmsRoute] Failed to generate dynamic llms.txt:", err);
      // Fallback static response
      res
        .set({ "Content-Type": "text/plain; charset=utf-8" })
        .status(200)
        .send(
          `# Truth Desk · Protein Knowledge Graph\n> Autonomous evidence auditing for molecular biology claims.\n\n` +
            STATIC_FOOTER
        );
    }
  });
}
