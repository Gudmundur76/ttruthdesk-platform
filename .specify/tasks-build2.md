# Tasks: build2 — L0 Friction Engine + L2 Self-Prompt Engine

## Phase 1 — Schema Migrations

- [ ] T001 [US-L0-4] Add `preflight_cache` table to `drizzle/schema.ts` (columns: `id` INT PK autoincrement, `inputHash` VARCHAR(64) UNIQUE, `result` JSON, `createdAt` TIMESTAMP, `expiresAt` TIMESTAMP); generate migration and apply
- [ ] T002 [US-L2-5] Add nullable columns to `self_prompt_log`: `directivesIssued INT DEFAULT 0`, `directivesConsumed7d INT DEFAULT 0`, `llmRawResponse JSON`, `llmResponseMs INT`, `executionMs INT`, `totalDurationMs INT`; generate migration and apply
- [ ] T003 [US-L2-3] Add columns to `frontier_directives`: `directiveType ENUM('focus_gap','skip_mapping','prioritize_hypotheses','deep_dive_entity')`, `expiresAt TIMESTAMP`, `consumedAt TIMESTAMP`, `issuedByCycleId INT`, `confidence FLOAT DEFAULT 0.5`, `ttlMinutes INT DEFAULT 60`; generate migration and apply

## Phase 2 — L0 Engine: Type Contract Upgrade

- [ ] T004 [US-L0-1] Add `ConstraintSeverity = "blocking" | "warning" | "informational"` type and `confidence: number` field to `FrictionAssumption` in `server/frictionEngine.ts`
- [ ] T005 [US-L0-2] Add `severity: ConstraintSeverity` field to `FrictionConstraint` in `server/frictionEngine.ts`
- [ ] T006 [US-L0-2, US-L0-3] Add `decision_reasons: string[]`, `additional_questions?: string[]`, `scanDurationMs: number`, `modelUsed: string`, `similarClaimCount: number`, `databaseMatches: number` to `FrictionEngineResult`; keep `durationMs` as alias
- [ ] T007 [US-L0-3] Update `runPreflightScan` signature to `(text: string, options?: { forceAction?: RecommendedAction; skipGraphLookup?: boolean; maxAssumptions?: number; maxConstraints?: number }): Promise<FrictionEngineResult>`
- [ ] T008 [US-L0-1] Implement `jaccardSimilarity(a: string, b: string): number` helper and `deduplicateAssumptions(assumptions: FrictionAssumption[]): FrictionAssumption[]` in `server/frictionEngine.ts`
- [ ] T009 [US-L0-2] Implement blocking-constraint override: after LLM parse, if any constraint has `severity === "blocking"`, force `recommended_action` to `ask_user` (or `reject` if already reject)
- [ ] T010 [US-L0-3] Implement `forceAction` override: if `options.forceAction` is set, replace `recommended_action` in the final result
- [ ] T011 [US-L0-2] Populate `decision_reasons` array from analysis: record each factor that influenced the decision (blocking constraint present, high-risk assumption, graph match found, etc.)
- [ ] T012 [US-L0-4] Update `runOutputAudit` to return PRD-L0 §6.1 `OutputAuditResult` shape: `isUsable: boolean`, `dimensionScores: Record<AuditDimension, AuditScore>`, `rejection_reason?: string`, `caveat?: string`, `confidence: number`

## Phase 3 — L0 Layer: frictionLayer Hardening

- [ ] T013 [US-L0-4] Add circuit-breaker state to `server/autonomousLoop/layers/frictionLayer.ts`: module-level `failureCount`, `circuitOpen`, `lastFailureAt`; export `resetCircuitBreaker()` for test isolation
- [ ] T014 [US-L0-4] Implement `withRetry<T>(fn: () => Promise<T>, maxAttempts: number): Promise<T>` with exponential backoff (1s, 2s, 4s) in `frictionLayer.ts`
- [ ] T015 [US-L0-4] Implement `hashInput(text: string): string` using `crypto.createHash('sha256')` and `checkPreflightCache(hash)` / `storePreflightCache(hash, result)` using `preflight_cache` table
- [ ] T016 [US-L0-4] Implement PII redaction: `redactPii(result: FrictionEngineResult): FrictionEngineResult` strips email, phone (E.164 + local), credit card patterns from all string fields before storage
- [ ] T017 [US-L0-4] Wrap `findClaimsByTextSimilarity` call in try/catch; on failure set `databaseMatches: 0`, `similarClaimCount: 0`, `claims: []` (FR-L0-52)
- [ ] T018 [US-L0-4] Publish `L0_SCAN_COMPLETED` event (type, scanId, timestamp, recommendedAction, durationMs, assumptionCount, constraintCount, modelUsed) and `L0_SCAN_FAILED` event (type, scanId, timestamp, error, fallbackAction, durationMs) via `publishEvent`
- [ ] T019 [US-L0-4] Wire retry, circuit-breaker, cache, PII redaction, graph degradation, and event publication into `runFrictionGate` in `frictionLayer.ts`

## Phase 4 — L2 Types & Schema

- [ ] T020 [US-L2-2] Create `server/selfPrompt/types.ts` exporting all PRD-L2 §6.1 interfaces: `SelfPromptEvent`, `SystemState`, `ClaimStats`, `FrontierStats`, `SelfPromptStats`, `MetaStats`, `DreamStats`, `SelfPromptAction`, `ActionPriority`, `ActionType`, `FrontierDirectiveInput`, `FrontierDirectiveType`, `LlmResponse`, `SelfPromptCycleResult`, `ActionExecutionResult`
- [ ] T021 [US-L2-2] Create `server/selfPrompt/schema.ts` with zod schemas: `LlmResponseSchema` (reasoning min 100 chars, actions array with priority+justification, directives array, converged bool, convergenceReason nullable string)
- [ ] T022 [US-L2-2] Update `server/selfPrompt/engine.ts`, `stateCollector.ts`, `promptEngine.ts`, `actionExecutor.ts` to import types from `types.ts` instead of defining inline
- [ ] T023 [US-L2-2] Create `server/selfPrompt/index.ts` exporting public API: `runSelfPromptCycle`, `collectSystemState`, `runSelfPrompt`, `executeActions`, `shouldConverge`, `publishDirectives`

## Phase 5 — L2 State Collector: Temporal Trends

- [ ] T024 [US-L2-1] Add `claimStats.confidenceTrend7d`: compute average confidence delta (today's avg minus 7-days-ago avg) from `claims` table filtered by `createdAt >= NOW() - 7d`
- [ ] T025 [US-L2-1] Add `frontierStats.gapAgeDistribution`: 4-bucket histogram `[0-1d, 1-7d, 7-30d, 30d+]` from `frontier_gaps.createdAt`
- [ ] T026 [US-L2-1] Add `frontierStats.hypothesisVerificationRate7d`: `COUNT(verified) / COUNT(total)` from `frontier_hypotheses` where `createdAt >= NOW() - 7d`
- [ ] T027 [US-L2-1] Add `selfPromptStats.frontierDirectiveHitRate7d`: `COUNT(consumedAt IS NOT NULL) / COUNT(*)` from `frontier_directives` where `createdAt >= NOW() - 7d`
- [ ] T028 [US-L2-1] Add `activeDirectives`: query `frontier_directives` where `expiresAt > NOW()` and `consumedAt IS NULL`; return as `FrontierDirective[]`
- [ ] T029 [US-L2-1] Add `dreamStats`: query `dream_sessions` for `lastWakeAt`, `sessionsLast30d`, `pendingDreamInsights` (sessions with `status = 'pending'`)
- [ ] T030 [US-L2-1] Add `metaStats`: query `meta_agent_checks` for `lastHealthScore`, `openAlerts` from `meta_agent_alerts` where `resolvedAt IS NULL`, `driftFlagsLast7d`
- [ ] T031 [US-L2-1] Wrap each state section in try/catch; on error log warning and return 0/null for that section (FR-L2-06)

## Phase 6 — L2 Prompt Engine: Structured Output + Zod

- [ ] T032 [US-L2-2] Rewrite prompt template in `promptEngine.ts` to serialize full `SystemState` as JSON block and include last 5 `self_prompt_log` entries (reasoning, actionCount, converged) for oscillation prevention (FR-L2-10)
- [ ] T033 [US-L2-2] Add reasoning-chain instruction to prompt: (a) analyze most significant trend, (b) identify highest-impact action, (c) decide whether to issue frontier directive, (d) determine if converged
- [ ] T034 [US-L2-2] Add 30s `AbortController` timeout to LLM call; on timeout return fallback `LlmResponse` with `converged: true`, `reasoning: "LLM timeout — system converged by default"`, empty actions/directives
- [ ] T035 [US-L2-2] Validate LLM JSON output against `LlmResponseSchema`; on validation failure log raw output and return fallback result
- [ ] T036 [US-L2-2] Cap actions at 5 (top 5 by priority) and directives at 3 (top 3 by confidence) after parsing

## Phase 7 — L2 Directive Publisher

- [ ] T037 [US-L2-3] Create `server/selfPrompt/directivePublisher.ts` implementing `publishDirectives(directives: FrontierDirectiveInput[], cycleId: number): Promise<FrontierDirective[]>`
- [ ] T038 [US-L2-3] For each directive: query `frontier_directives` for active duplicate (same `directiveType` + `targetId`, `expiresAt > NOW()`, `consumedAt IS NULL`); skip if found (FR-L2-31)
- [ ] T039 [US-L2-3] Insert new directive row with `expiresAt = new Date(Date.now() + ttlMinutes * 60_000)`, `issuedByCycleId = cycleId`, `confidence`, `directiveType`
- [ ] T040 [US-L2-3] Publish `FRONTIER_DIRECTIVE_ISSUED` event via `publishEvent` for each successfully inserted directive

## Phase 8 — L2 Convergence Gate

- [ ] T041 [US-L2-5] Create `server/selfPrompt/convergenceGate.ts` implementing `shouldConverge(llmConverged: boolean, state: SystemState, actions: SelfPromptAction[], cycleCount: number): { converged: boolean; reason: string | null }`
- [ ] T042 [US-L2-5] Implement all 6 convergence-prevention criteria (OR logic): LLM says false, < 2 cycles in 24h, critical alerts open, gaps > 30d with no directive, cycleCount >= 10, manual trigger bypass

## Phase 9 — L2 Action Executor Hardening

- [ ] T043 [US-L2-4] Add `PRIORITY_ORDER` map and sort actions by priority before execution in `actionExecutor.ts`
- [ ] T044 [US-L2-4] Add deep-equality dedup: filter actions where same `actionType` + all scalar params already seen in current cycle
- [ ] T045 [US-L2-4] Add SQL injection scan: regex `/\b(SELECT|INSERT|UPDATE|DELETE|DROP|ALTER|EXEC|UNION|--|;)\b/i` on all string parameter values; reject action and log security alert if detected
- [ ] T046 [US-L2-4] Wrap each action execution in `Promise.race([execute(), new Promise((_, rej) => setTimeout(() => rej(new Error("TIMEOUT")), 10_000))])`
- [ ] T047 [US-L2-4] Add 30s total cap: track `totalElapsed`; if exceeded, mark remaining actions as `{ status: "skipped", ... }` without executing
- [ ] T048 [US-L2-4] Populate `ActionExecutionResult.delegatedTo` (module name string) and `durationMs` for every action result

## Phase 10 — L2 Engine Orchestration + Cycle Logging

- [ ] T049 [US-L2-5] Update `engine.ts` to import and use `convergenceGate.ts`, `directivePublisher.ts`, `types.ts`
- [ ] T050 [US-L2-5] Update `runSelfPromptCycle` to record `startTime`, collect state, run prompt, call `shouldConverge`, execute actions, publish directives, write log row, emit telemetry
- [ ] T051 [US-L2-5] Write `self_prompt_log` row with all new columns: `directivesIssued`, `directivesConsumed7d`, `llmRawResponse`, `llmResponseMs`, `executionMs`, `totalDurationMs`
- [ ] T052 [US-L2-5] Emit `emitTelemetry("L2", "self_prompt_cycle", cycleId, durationMs, success)` at cycle start (status: "started") and end (status: "completed" or "failed")
- [ ] T053 [US-L2-5] Add global try/catch per PRD-L2 §9.5: terminal failure returns `{ converged: true, convergenceReason: "Error: ...", actionsGenerated: 0, ... }`

## Phase 11 — Tests, TypeScript, CI

- [ ] T054 [US-L0-1] Expand `frictionEngine.test.ts`: confidence filtering (< 0.6 excluded from action calc), Jaccard dedup (> 0.85 removes lower-confidence), blocking constraint forces ask_user, decision_reasons non-empty, forceAction override, scanDurationMs present, graph degradation (findClaimsByTextSimilarity throws → empty signals)
- [ ] T055 [US-L0-4] Create `server/autonomousLoop/layers/frictionLayer.test.ts`: retry (3 attempts on failure), circuit-breaker (opens after 5 failures), cache hit (no LLM call), cache miss (LLM called, result stored), PII redaction (email/phone stripped), L0_SCAN_COMPLETED published, L0_SCAN_FAILED published on error
- [ ] T056 [US-L2-1] Expand `stateCollector.test.ts`: all 4 trend metrics with seeded data, missing-table returns 0/null without throw, activeDirectives filters expired
- [ ] T057 [US-L2-2] Expand `promptEngine.test.ts`: valid LLM response parsed correctly, timeout fallback (converged: true), schema violation fallback, oscillation history included in prompt, actions capped at 5, directives capped at 3
- [ ] T058 [US-L2-3] Create `server/selfPrompt/directivePublisher.test.ts`: persist new directive, skip duplicate (active matching), publish FRONTIER_DIRECTIVE_ISSUED, cap at 3, expiresAt computed correctly
- [ ] T059 [US-L2-5] Create `server/selfPrompt/convergenceGate.test.ts`: each of 6 criteria individually prevents convergence, all-clear → converged: true, manual trigger always processes
- [ ] T060 [US-L2-4] Expand `actionExecutor.test.ts`: priority sort (critical first), dedup (identical action skipped), timeout (10s → TIMEOUT error), SQL injection rejection, total 30s cap (remaining skipped), delegatedTo populated
- [ ] T061 [US-L2-5] Expand `engine.test.ts`: full cycle log row has all new columns, terminal error → converged: true, directive count in result, telemetry emitted twice
- [ ] T062 [P] Run `pnpm check` — 0 TypeScript errors
- [ ] T063 [P] Run `pnpm lint` — 0 ESLint errors
- [ ] T064 [P] Run `pnpm test` — 0 test failures (all 267+ test files pass)
- [ ] T065 [P] Commit as `build2: L0 Friction Engine + L2 Self-Prompt Engine hardening`, push to `origin/main`
- [ ] T066 [P] Update `manus-persistent-drive/compounding_log.md` with build2 Phase 141 log

## Estimation

| Phase                 | Tasks        | Estimated Effort |
| --------------------- | ------------ | ---------------- |
| Phase 1 — Schema      | T001–T003    | 0.5h             |
| Phase 2 — L0 Types    | T004–T012    | 2h               |
| Phase 3 — L0 Layer    | T013–T019    | 1.5h             |
| Phase 4 — L2 Types    | T020–T023    | 1h               |
| Phase 5 — L2 State    | T024–T031    | 2h               |
| Phase 6 — L2 Prompt   | T032–T036    | 1.5h             |
| Phase 7 — Directives  | T037–T040    | 1h               |
| Phase 8 — Convergence | T041–T042    | 0.5h             |
| Phase 9 — Executor    | T043–T048    | 1.5h             |
| Phase 10 — Engine     | T049–T053    | 1.5h             |
| Phase 11 — Tests/CI   | T054–T066    | 3h               |
| **Total**             | **66 tasks** | **~16h**         |
