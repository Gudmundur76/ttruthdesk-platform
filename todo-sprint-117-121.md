# Sprint 117–121 TODO

## Phase 117 — Verbatim Evidence Passages

- [ ] Write failing tests: pubmedAbstractFetcher.test.ts (RED)
- [ ] Create server/pubmedAbstractFetcher.ts
- [ ] Add pubmed_abstracts schema table + migration
- [ ] Update buildVerifyResult to populate evidence[].excerpt
- [ ] Update verifyClaimRoute to persist sourcePassage
- [ ] All tests GREEN
- [ ] TSC 0 errors, ESLint 0 warnings
- [ ] Commit + push
- [ ] Persistent drive log updated

## Phase 118 — Temporal Claim Versioning

- [ ] Write failing tests: temporalClaims.test.ts (RED)
- [ ] Schema migration: validFrom, validUntil, temporalConfidence on claims
- [ ] Create server/verifyClaimAtDateRoute.ts
- [ ] Add verify_claim_at_date MCP tool
- [ ] Create server/stalenessDetector.ts heartbeat job
- [ ] Wire reEvaluationEngine to set validUntil on contradiction
- [ ] All tests GREEN
- [ ] TSC 0 errors, ESLint 0 warnings
- [ ] Commit + push
- [ ] Persistent drive log updated

## Phase 119 — Batch Verification API

- [ ] Write failing tests: batchVerifyRoute.test.ts (RED)
- [ ] Schema migration: claimTextHash column + unique index on claims
- [ ] Create server/batchVerifyRoute.ts
- [ ] Add verify_claims_batch MCP tool
- [ ] Wire rate limiting for batch requests
- [ ] All tests GREEN
- [ ] TSC 0 errors, ESLint 0 warnings
- [ ] Commit + push
- [ ] Persistent drive log updated

## Phase 120 — Bidirectional Agent Feedback

- [ ] Write failing tests: agentFeedbackTools.test.ts (RED)
- [ ] Add submit_claim MCP tool
- [ ] Add flag_stale MCP tool
- [ ] Add report_contradiction MCP tool
- [ ] Wire abuse prevention + rate limiting
- [ ] All tests GREEN
- [ ] TSC 0 errors, ESLint 0 warnings
- [ ] Commit + push
- [ ] Persistent drive log updated

## Phase 121 — Epistemic Provenance Chain

- [x] Write failing tests: epistemicProvenance.test.ts (RED) — 27 tests
- [x] Add getDistortionChain() + getSemanticNeighbours() to epistemicProvenance.ts
- [x] Create server/epistemicProvenance.ts (GET /api/public/provenance/:claimId) — registered in \_core/index.ts
- [x] Add get_provenance MCP tool — PROVENANCE_TOOLS_MANIFEST, tool #11 in mcpServer.ts
- [x] Update integration harness — 12 tools confirmed in mcpServer.test.ts
- [x] All tests GREEN — 2686/2686
- [x] TSC 0 errors, ESLint 0 warnings
- [x] Commit + push — commit e0805c9
- [x] Persistent drive log updated + sprint summary
