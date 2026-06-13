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
- [ ] Write failing tests: provenanceRoute.test.ts (RED)
- [ ] Add getDistortionChain() + getSemanticNeighbours() to claimProvenanceService.ts
- [ ] Create server/provenanceRoute.ts (GET /api/public/provenance/:claimId)
- [ ] Add get_provenance MCP tool
- [ ] Update integration harness mcp.test.ts for new tools
- [ ] All tests GREEN
- [ ] TSC 0 errors, ESLint 0 warnings
- [ ] Commit + push
- [ ] Persistent drive log updated + sprint summary
