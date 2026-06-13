# Phase 116 Integration Test Report

**Generated:** 2026-06-13T18:35:14.543Z
**Result:** 35/35 passed — ✅ ALL GREEN

## Results

| Status | Suite | Test | Duration |
|---|---|---|---|
| ✅ PASS | MCP Tools | initialize — response shape + streaming capability | 25ms |
| ✅ PASS | MCP Tools | tools/list — all 5 tools present | 5ms |
| ✅ PASS | MCP Tools | verify_claim — valid claim returns verdict shape | 6849ms |
| ✅ PASS | MCP Tools | verify_claim — missing claim param → INVALID_PARAMS | 4ms |
| ✅ PASS | MCP Tools | verify_claim — claim > 1000 chars → INVALID_PARAMS | 3ms |
| ✅ PASS | MCP Tools | search_claims — valid query returns total + array | 283ms |
| ✅ PASS | MCP Tools | search_claims — missing query → INVALID_PARAMS | 4ms |
| ✅ PASS | MCP Tools | get_claim — nonexistent ID → NOT_FOUND | 10ms |
| ✅ PASS | MCP Tools | get_claim — missing claimId → INVALID_PARAMS | 2ms |
| ✅ PASS | MCP Tools | get_source_version — known sourceId returns shape or NOT_FOUND | 14ms |
| ✅ PASS | MCP Tools | ask_question — valid question returns verdict shape | 2604ms |
| ✅ PASS | MCP Tools | ask_question — missing question → INVALID_PARAMS | 2ms |
| ✅ PASS | MCP Tools | unknown tool name → METHOD_NOT_FOUND | 2ms |
| ✅ PASS | MCP Tools | unknown JSON-RPC method → METHOD_NOT_FOUND | 2ms |
| ✅ PASS | MCP Tools | JSON-RPC id is reflected in response | 4ms |
| ✅ PASS | MCP Tools | /.well-known/mcp.json returns endpoint field | 4ms |
| ✅ PASS | Answer Endpoint | valid question returns verdict shape | 2420ms |
| ✅ PASS | Answer Endpoint | question at 1000 chars succeeds (boundary) | 2346ms |
| ✅ PASS | Answer Endpoint | question > 1000 chars → 400 | 2ms |
| ✅ PASS | Answer Endpoint | empty question → 400 | 2ms |
| ✅ PASS | Answer Endpoint | missing question field → 400 | 2ms |
| ✅ PASS | Answer Endpoint | non-JSON body → 400 or 415 | 2ms |
| ✅ PASS | Answer Endpoint | response includes loopTriggered boolean | 2575ms |
| ✅ PASS | Rate Limiting | 10 anonymous requests succeed | 31164ms |
| ✅ PASS | Rate Limiting | 11th anonymous request → 429 | 32409ms |
| ✅ PASS | Rate Limiting | 429 response includes X-RateLimit-Reset header | 29087ms |
| ✅ PASS | Rate Limiting | Bearer token bypasses rate limit | 1ms |
| ✅ PASS | Rate Limiting | 10 anonymous MCP requests succeed | 88809ms |
| ✅ PASS | SSE Stream | 4-stage event sequence arrives in order | 10ms |
| ✅ PASS | SSE Stream | final event has ok=true + verdict + streaming=true | 3ms |
| ✅ PASS | SSE Stream | stage:extraction event has primaryClaimText + stage=1 | 2ms |
| ✅ PASS | SSE Stream | stage:evidence event has pubmedCount + stage=2 | 3ms |
| ✅ PASS | SSE Stream | stage:verdict event has verdict + confidence in [0,1] | 2ms |
| ✅ PASS | SSE Stream | missing claim param → error event or 400 | 3ms |
| ✅ PASS | SSE Stream | OPTIONS preflight returns CORS headers | 0ms |


