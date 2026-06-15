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

- Run `npx vitest run` (currently 2719 tests, all passing).
- Run `npx tsc --noEmit` to check types.
- Run `pnpm lint` to check ESLint (0 warnings allowed).

## AAIF Toolchain — Mandatory Pre-Sprint Validation

Before starting any sprint, the agent MUST run the following validation sequence using the AAIF toolchain. This is not optional — it ensures the agent has current state before making any code changes.

### Step 1 — Read Letta memory blocks (persistent state)

```bash
python3 /home/ubuntu/manus-persistent-drive/scripts/memory.py read sprint_state
```

This restores corpus density, CI state, domain density, and last commit SHAs from the previous sprint. If the file is missing, re-clone `Gudmundur76/manus-persistent-drive`.

### Step 2 — Verify citation.is/mcp is live (goose validation)

```bash
curl -s -X POST https://citation.is/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_claim","arguments":{"id":1}}}' \
  --max-time 10
```

Expected: JSON with `claimText`, `verdict`, `confidence`. If this returns HTML or times out, the MCP server is down — do not proceed with sprint work until resolved.

### Step 3 — Check production stats

```bash
curl -s https://ttruthdesk.claims/api/public/stats
```

Compare `totalClaims` against the value stored in Letta memory. If it grew, the autonomous ingest loop is healthy. Record the delta.

### Step 4 — Start agentgateway (route all MCP calls through it)

```bash
agentgateway -f infra/agentgateway/config.yaml &
```

All MCP traffic must route through the gateway so calls are observable and logged. The config proxies `citation.is/mcp` via TLS.

### Step 5 — Write sprint results to Letta memory (end of sprint)

```bash
python3 /home/ubuntu/manus-persistent-drive/scripts/memory.py write sprint_state '{
  "current_sprint": N,
  "status": "complete",
  "last_commit_ttruthdesk": "HASH",
  "last_commit_citation_desk": "HASH",
  "ci_state": "green|pending|failed",
  "domain_density": { ... },
  "next_sprint_N+1": [ ... ]
}'
```

Then commit and push `manus-persistent-drive` so the memory persists across sandbox resets.

## Deployment

The production server at `ttruthdesk.claims` is a Manus webdev deployment. Code changes pushed to `main` are **not** automatically deployed — the webdev project must be republished from the Manus UI. After every sprint that changes server routes or adds new API endpoints, the webdev project must be republished before the new endpoints are live.

## Domain Ingest Scheduler

- **Endpoint:** `POST /api/scheduled/domain-ingest` (requires `Authorization: Bearer <BUILT_IN_FORGE_API_KEY>`)
- **Cron:** Every 6 hours via Manus scheduled task `domain-ingest-6h` (task_uid: `PrRB8eBgFuH2XA4QowVNAY`)
- **Domains:** biology, medicine, chemistry, physics, climate (3 PubMed queries each)
- **SLM threshold:** 50 claim pairs per domain triggers `CorpusWatcher` → `IncrementalTrainer`
- **Status endpoint:** `GET /api/public/status/domains` — returns per-domain claim counts + `slm` block
