# ttruthdesk-platform / citation.is Backend

This file provides persistent context for autonomous agents (Manus, goose, etc.) working on this repository.

## Architecture

- **Role:** Core backend engine, verification pipeline, autonomous ingest loop, MCP server.
- **Frontend:** citation-desk (runs on port 3000, proxies to this backend on port 3001).
- **Stack:** Express, tRPC, Drizzle ORM, MySQL (TiDB), Vitest.

## Database Schema (Drizzle)

- `claims`: Core registry. `id`, `claimText`, `domain`, `status`, `createdAt`.
- `verifications`: Verification results. `id`, `claimId`, `verdict`, `confidenceScore`, `evidenceSource`, `rationale`, `sourceUrl`.
- `graph_relations`: (Pending) Will store semantic relationships between claims.

## Verdict Taxonomy

Must strictly use one of:

1. `Supported` (Green)
2. `Contradicted` (Red)
3. `Ambiguous` (Yellow)
4. `Insufficient Evidence` (Gray)
5. `Out of Scope` (Gray)
6. `Needs Expert Review` (Orange)

## MCP Server

- **Endpoint:** `POST /api/mcp`
- **Discovery:** `GET /.well-known/mcp.json`
- **Tools (12):** `verify_claim`, `search_claims`, `get_claim`, `ask_question`, `find_similar`, `get_provenance`, `submit_claim`, `flag_stale`, `report_contradiction`, `verify_claim_at_date`, `verify_claims_batch`, `get_source_version`.
- **Live Routing:** `verify_claim` sets `loopTriggered: true` when it hits PubMed and triggers autonomous ingest.

## Known Bugs / Pending Work

1. **Organism Routing:** Adapter selection logic sometimes fails to route specific species queries to the correct specialized database.
2. **MCP SSE Stream:** `GET /mcp` connection drops prematurely under heavy load.
3. **Graph Enrichment:** `graph_relations` table needs a background pipeline to populate semantic links between claims.

## Testing

- Run `npx vitest run` (currently 2712 tests, all passing).
- Run `npx tsc --noEmit` to check types.
