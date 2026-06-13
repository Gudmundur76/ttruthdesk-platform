# Phase 116 — Agent Integration Test Harness TODO

## Spec
- [x] Phase 116 spec written to manus-persistent-drive/phase-116-spec.md

## Scaffold
- [ ] Create tests/integration/ directory structure
- [ ] Add pnpm test:integration script to package.json
- [ ] Write tests/integration/fixtures.ts (shared test data)
- [ ] Write tests/integration/helpers.ts (assert helpers, SSE collector)
- [ ] Write tests/integration/harness.ts (runner, report writer)

## RED phase — failing tests
- [ ] tests/integration/mcp.test.ts (verify_claim, search_claims, get_claim, get_source_version, ask_question)
- [ ] tests/integration/stream.test.ts (SSE 5-stage sequence)
- [ ] tests/integration/answer.test.ts (valid, oversized, rate-limited)
- [ ] tests/integration/rateLimit.test.ts (anon limit, auth bypass)
- [ ] Confirm all tests fail before implementation (RED confirmed)

## Implementation — rate limit reset header
- [ ] Add X-Test-Reset-RateLimit header support to answerRoute.ts (test-only)
- [ ] Add X-Test-Reset-RateLimit header support to mcpServer.ts (test-only)

## GREEN phase — all tests pass
- [ ] pnpm test:integration exits 0
- [ ] tests/integration/REPORT.md generated

## Gate
- [ ] tsc --noEmit: 0 errors
- [ ] ESLint: 0 errors/warnings on new files
- [ ] pnpm test (Vitest unit suite): 1350 tests still passing

## Commit & persist
- [ ] git commit + push to origin/main
- [ ] manus-persistent-drive phase-log.md updated
