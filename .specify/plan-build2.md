# Implementation Plan: build2 — L0 Friction Engine + L2 Self-Prompt Engine

## Tech Stack & Architecture

**Runtime:** Node.js 22, TypeScript 5, tRPC 11, Drizzle ORM, MySQL/TiDB
**Testing:** Vitest, zod for schema validation
**New files:** `server/selfPrompt/types.ts`, `server/selfPrompt/schema.ts`, `server/selfPrompt/directivePublisher.ts`, `server/selfPrompt/convergenceGate.ts`, `server/selfPrompt/index.ts`
**Modified files:** `server/frictionEngine.ts`, `server/frictionEngine.test.ts`, `server/autonomousLoop/layers/frictionLayer.ts`, `server/selfPrompt/engine.ts`, `server/selfPrompt/stateCollector.ts`, `server/selfPrompt/promptEngine.ts`, `server/selfPrompt/actionExecutor.ts`, `drizzle/schema.ts`

## Approach

The build follows a strict phase sequence: schema first, then L0 engine changes, then L0 layer hardening, then L2 types/state, then L2 prompt/directives, then L2 execution/logging, then tests and CI. Each phase is independently compilable and testable.

All changes are backward-compatible with existing Sprint 40/41 and build1_foundation code. The existing `FrictionEngineResult` shape is extended (additive fields only). The `self_prompt_log` table gains new columns via migration. The `frontier_directives` table gains `expiresAt` and `consumedAt` columns via migration.

---

## Phase 1 — Schema Migrations

**Goal:** Add `preflight_cache` table; extend `self_prompt_log` with directive/LLM columns; extend `frontier_directives` with `expiresAt`, `consumedAt`, `issuedByCycleId`.

**Steps:**

1. Add `preflight_cache` table to `drizzle/schema.ts` (columns: `id`, `inputHash`, `result` JSON, `createdAt`, `expiresAt`)
2. Add columns to `self_prompt_log`: `directivesIssued INT`, `directivesConsumed7d INT`, `llmRawResponse JSON`, `llmResponseMs INT`, `executionMs INT`, `totalDurationMs INT`
3. Add columns to `frontier_directives`: `directiveType ENUM`, `expiresAt TIMESTAMP`, `consumedAt TIMESTAMP`, `issuedByCycleId INT`, `confidence FLOAT`, `ttlMinutes INT`
4. Run `pnpm drizzle-kit generate` and apply via `webdev_execute_sql`

**Exit criteria:** `pnpm check` passes, DB schema matches Drizzle types.

---

## Phase 2 — L0 Engine: Type Contract Upgrade

**Goal:** Extend `frictionEngine.ts` types and `runPreflightScan` signature per PRD-L0 §6.1.

**Steps:**

1. Add `ConstraintSeverity` type and `confidence` to `FrictionAssumption`
2. Add `severity` to `FrictionConstraint`
3. Add `decision_reasons`, `additional_questions?`, `scanDurationMs`, `modelUsed`, `similarClaimCount`, `databaseMatches` to `FrictionEngineResult`
4. Rename `durationMs` → `scanDurationMs` (keep `durationMs` as alias for backward compat)
5. Update `runPreflightScan(text, options?)` signature with `forceAction`, `skipGraphLookup`, `maxAssumptions`, `maxConstraints`
6. Implement Jaccard deduplication helper for assumptions
7. Implement blocking-constraint → `ask_user` override logic
8. Implement `forceAction` override at result construction
9. Populate `decision_reasons` from analysis results
10. Update `runOutputAudit` to return PRD-L0 §6.1 `OutputAuditResult` shape with `dimensionScores`

**Exit criteria:** `pnpm check` passes; all existing `frictionEngine.test.ts` tests still pass.

---

## Phase 3 — L0 Layer: frictionLayer Hardening

**Goal:** Upgrade `frictionLayer.ts` from a thin pass-through to a production-grade wrapper.

**Steps:**

1. Add circuit-breaker state (failure count, open/closed, last-failure timestamp) as module-level variables
2. Implement `withRetry(fn, maxAttempts=3)` helper with exponential backoff
3. Implement `checkPrefightCache(hash)` / `storePrefightCache(hash, result)` using `preflight_cache` table
4. Add SHA-256 input hashing (Node.js `crypto.createHash`)
5. Add PII redaction: strip email, phone, credit card from result before storage
6. Add graph-DB degradation: wrap `findClaimsByTextSimilarity` in try/catch; return empty on failure
7. Publish `L0_SCAN_COMPLETED` / `L0_SCAN_FAILED` events via `publishEvent`
8. Wire all above into the `runFrictionGate` function

**Exit criteria:** `pnpm check` passes; new `frictionLayer.test.ts` tests pass.

---

## Phase 4 — L2 Types & Schema

**Goal:** Create `server/selfPrompt/types.ts` and `server/selfPrompt/schema.ts` with all PRD-L2 §6.1 interfaces and zod schemas.

**Steps:**

1. Create `types.ts` with: `SelfPromptEvent`, `SystemState` (and all 6 sub-interfaces), `SelfPromptAction`, `ActionPriority`, `ActionType`, `FrontierDirectiveInput`, `FrontierDirectiveType`, `LlmResponse`, `SelfPromptCycleResult`, `ActionExecutionResult`
2. Create `schema.ts` with zod schemas for `LlmResponse` (reasoning min 100 chars, actions array, directives array, converged bool, convergenceReason nullable)
3. Update all existing `selfPrompt/*.ts` files to import from `types.ts`

**Exit criteria:** `pnpm check` passes; no inline type definitions remain in selfPrompt files.

---

## Phase 5 — L2 State Collector: Temporal Trends

**Goal:** Expand `stateCollector.ts` to compute all 4 temporal trend metrics and assemble the full `SystemState`.

**Steps:**

1. Add `claimStats.confidenceTrend7d`: query average confidence delta over last 7 days
2. Add `frontierStats.gapAgeDistribution`: 4-bucket histogram from `frontier_gaps.createdAt`
3. Add `frontierStats.hypothesisVerificationRate7d`: ratio from `frontier_hypotheses`
4. Add `selfPromptStats.frontierDirectiveHitRate7d`: ratio from `frontier_directives.consumedAt`
5. Add `activeDirectives`: query `frontier_directives` where `expiresAt > NOW()` and `consumedAt IS NULL`
6. Add `dreamStats`: query `dream_sessions` for last wake, session count, pending insights
7. Add `metaStats`: query `meta_agent_checks` for last health score, open alerts, drift flags
8. Wrap each section in try/catch; return 0/null on missing table (FR-L2-06)

**Exit criteria:** `pnpm check` passes; `stateCollector.test.ts` covers all trend computations.

---

## Phase 6 — L2 Prompt Engine: Structured Output + Zod

**Goal:** Upgrade `promptEngine.ts` to produce and validate the PRD-L2 §6.1 `LlmResponse` schema.

**Steps:**

1. Rewrite prompt template to include full `SystemState` as JSON and last 5 cycle summaries
2. Add reasoning-chain instruction (analyze trend → identify action → decide directive → determine convergence)
3. Add 30s `AbortController` timeout to LLM call
4. Validate LLM JSON output against `schema.ts` zod schema; fallback on failure
5. Extract `actions` (cap at 5, sort by priority), `directives` (cap at 3, sort by confidence), `converged`, `convergenceReason`, `reasoning`
6. Return typed `LlmResponse`

**Exit criteria:** `pnpm check` passes; `promptEngine.test.ts` covers valid, timeout, and schema-violation cases.

---

## Phase 7 — L2 Directive Publisher

**Goal:** Create `server/selfPrompt/directivePublisher.ts` implementing PRD-L2 §3.5.

**Steps:**

1. Implement `publishDirectives(directives: FrontierDirectiveInput[], cycleId: number): Promise<FrontierDirective[]>`
2. For each directive: check for active duplicate (same `directiveType` + `targetId`, `expiresAt > NOW()`, `consumedAt IS NULL`); skip if found
3. Insert new directive row with `expiresAt = NOW() + ttlMinutes * 60 * 1000`, `issuedByCycleId = cycleId`
4. Publish `FRONTIER_DIRECTIVE_ISSUED` event via `publishEvent`
5. Cap at 3 directives per cycle (top 3 by confidence before processing)

**Exit criteria:** `pnpm check` passes; `directivePublisher.test.ts` covers all 5 acceptance criteria.

---

## Phase 8 — L2 Convergence Gate

**Goal:** Create `server/selfPrompt/convergenceGate.ts` implementing PRD-L2 §3.4.

**Steps:**

1. Implement `shouldConverge(llmConverged, state, actions, cycleCount): { converged: boolean; reason: string | null }`
2. Apply OR logic: any one of 6 criteria prevents convergence
   - LLM says `converged: false`
   - Fewer than 2 cycles in last 24h (from `selfPromptStats.cyclesLast24h`)
   - Critical alerts open (`metaStats.openAlerts > 0`)
   - Gaps older than 30d with no active directive
   - `cycleCount >= 10` (hard limit)
   - Manual trigger always bypasses (process at least once)
3. Return `{ converged: true, reason: null }` only when none of the 6 criteria apply

**Exit criteria:** `pnpm check` passes; `convergenceGate.test.ts` covers all 6 criteria individually and combined.

---

## Phase 9 — L2 Action Executor Hardening

**Goal:** Upgrade `actionExecutor.ts` to implement PRD-L2 §3.6 (priority, dedup, timeout, SQL guard, richer result).

**Steps:**

1. Add `PRIORITY_ORDER: Record<ActionPriority, number>` = `{ critical: 0, high: 1, normal: 2, low: 3 }`
2. Sort actions by priority before execution
3. Add deep-equality dedup: filter actions where same `actionType` + scalar params already seen in cycle
4. Add SQL injection scan: regex check on all string parameter values; reject + log security alert if detected
5. Wrap each action in `Promise.race([execute(), timeout(10_000)])`
6. Add 30s total cap: track elapsed time; mark remaining as `skipped` if exceeded
7. Populate `ActionExecutionResult.delegatedTo` and `durationMs` for every action
8. Update `executeActions` return type to `ActionExecutionResult[]`

**Exit criteria:** `pnpm check` passes; `actionExecutor.test.ts` covers all 8 new behaviors.

---

## Phase 10 — L2 Engine Orchestration + Cycle Logging

**Goal:** Update `engine.ts` to wire all new components and write the richer `self_prompt_log` row.

**Steps:**

1. Import `types.ts`, `convergenceGate.ts`, `directivePublisher.ts`
2. Update `runSelfPromptCycle` to:
   - Record `startTime`
   - Collect `SystemState` via `collectSystemState`
   - Run `runSelfPrompt` (structured output)
   - Call `shouldConverge`; if converged, skip actions
   - Call `executeActions` (sorted, deduped, timeout-guarded)
   - Call `publishDirectives` with directives from LLM response
   - Write `self_prompt_log` row with all new columns
   - Emit telemetry at start and end
3. Update `SelfPromptCycleResult` to include `directivesIssued`, `directivesActive`, `actionsFailed`
4. Add global try/catch per PRD-L2 §9.5 (terminal failure → converged: true)

**Exit criteria:** `pnpm check` passes; `engine.test.ts` covers happy path, convergence, LLM timeout, action failure, terminal error.

---

## Phase 11 — Tests, TypeScript, CI

**Goal:** Achieve full test coverage, TypeScript clean, ESLint clean, CI green.

**Steps:**

1. Expand `frictionEngine.test.ts`: add tests for confidence filtering, dedup, blocking constraint, decision_reasons, forceAction, scanDurationMs, graph degradation
2. Create `frictionLayer.test.ts`: retry, circuit-breaker, cache hit/miss, PII redaction, event publication
3. Expand `stateCollector.test.ts`: all 4 trend metrics with seeded data, missing-table graceful degradation
4. Expand `promptEngine.test.ts`: valid response, timeout fallback, schema violation, oscillation history
5. Create `directivePublisher.test.ts`: persist, dedup, event publish, cap at 3
6. Create `convergenceGate.test.ts`: all 6 criteria
7. Expand `actionExecutor.test.ts`: priority sort, dedup, timeout, SQL injection, total cap
8. Expand `engine.test.ts`: full cycle log row, terminal error, directive count
9. Run `pnpm check` — 0 errors
10. Run `pnpm lint` — 0 errors
11. Run `pnpm test` — 0 failures
12. Commit and push to `origin/main`

**Exit criteria:** CI Quality Gate green; all tests pass; TypeScript and ESLint clean.

---

## Risks & Mitigations

| Risk                                              | Mitigation                                                                    |
| ------------------------------------------------- | ----------------------------------------------------------------------------- |
| `self_prompt_log` migration breaks existing tests | Add new columns as nullable with defaults; existing insert paths remain valid |
| `frontier_directives` schema diverges from build1 | Additive columns only; existing columns unchanged                             |
| LLM timeout in tests                              | Mock `invokeMultiLLM` with `vi.fn()` returning delayed response               |
| Circuit-breaker state leaks between tests         | Reset module-level state in `beforeEach` via exported `resetCircuitBreaker()` |
| Zod schema too strict for existing LLM output     | Start with permissive schema; tighten in build3                               |
