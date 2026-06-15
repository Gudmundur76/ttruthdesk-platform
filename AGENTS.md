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
7. `Partially Supported` (Yellow-Green)

## MCP Server

- **Endpoint:** `POST /api/mcp`
- **Discovery:** `GET /.well-known/mcp.json`
- **Tools (12):** `verify_claim`, `search_claims`, `get_claim`, `ask_question`, `find_similar`, `get_provenance`, `submit_claim`, `flag_stale`, `report_contradiction`, `verify_claim_at_date`, `verify_claims_batch`, `get_source_version`.
- **Live Routing:** `verify_claim` sets `loopTriggered: true` when it hits PubMed and triggers autonomous ingest.

## Known Bugs / Pending Work

1. **Organism Routing:** Adapter selection logic sometimes fails to route specific species queries to the correct specialized database.
2. **MCP SSE Stream:** `GET /mcp` connection drops prematurely under heavy load.
3. **Graph Enrichment:** `graph_relations` table needs a background pipeline to populate semantic links between claims.

## Sprint 24 Infrastructure Fixes (COMPLETE — 15 Jun 2026)

- `confidenceScore` is now a real computed value (was null in all API responses). Formula: `verdictBase + pubmedBoost + signalBoost`. Returns a 0–1 float rounded to 2 decimal places.
- PubMed results are now keyword-filtered by claim text before being returned. Prevents topically-adjacent but claim-irrelevant papers from inflating verdict confidence.
- `agent_memory_blocks.json` `sprint_state` block repaired (was malformed, causing `memory.py read` to fail at every sprint start).
- `cognitive-loop-framework` now has `typecheck`, `lint`, and `ci` scripts — quality gate is enforced before every commit.
- `AGENTS.md` updated to Sprint 24 state.

## companion repos

### cognitive-loop-framework

- **Location:** `/tmp/cognitive-loop-framework` (GitHub: `Gudmundur76/cognitive-loop-framework`)
- **Tests:** 121 passing (Vitest)
- **CI gate:** `pnpm ci` → `typecheck && lint && test:run` — must be green before every commit
- **Key files:** `src/memory/ruVectorClient.ts`, `src/memory/compoundingLog.ts`, `src/indexer/astIndexer.ts`, `src/loop/cognitiveLoopServer.ts`
- **Version:** `0.2.0` (RuVector native graph memory substrate)

### slm-infra-deploy

- **Location:** `/tmp/slm-infra-deploy` (GitHub: `Gudmundur76/slm-infra-deploy`)
- **Tests:** 15 passing (pytest)
- **Key files:** `finetunePipeline.py`, `Modelfile`, `Dockerfile`, `docker-compose.yml`, `cortex.yaml`, `cortex.py`
- **Status:** Built, not yet deployed to production

## Testing

- Run `pnpm test` (currently 2,772 tests, all passing).
- Run `pnpm run check` to check types (`tsc --noEmit`).
- Run `pnpm lint` to check ESLint (0 warnings allowed).

## AAIF Toolchain — Mandatory Pre-Sprint Validation

Before starting any sprint, the agent MUST run the following validation sequence using the AAIF toolchain. This is not optional — it ensures the agent has current state before making any code changes.

### Step 1 — Read Letta memory blocks (persistent state)

```bash
python3 /home/ubuntu/manus-persistent-drive/scripts/memory.py read sprint_state
```

This restores corpus density, CI state, domain density, and last commit SHAs from the previous sprint. If the file is missing, re-clone `Gudmundur76/manus-persistent-drive`.

### Step 2 — Verify ttruthdesk.claims/api/mcp is live

```bash
curl -s -X POST https://ttruthdesk.claims/api/mcp \
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

All MCP traffic must route through the gateway so calls are observable and logged. The config proxies `ttruthdesk.claims/api/mcp` via TLS.

### Step 5 — Write sprint results to Letta memory (end of sprint)

```bash
python3 /home/ubuntu/manus-persistent-drive/scripts/memory.py write sprint_state '{
  "current_sprint": N,
  "status": "complete",
  "last_commit_ttruthdesk": "HASH",
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
