# Feature Specification: build2 — L0 Friction Engine + L2 Self-Prompt Engine

## Overview

This build hardens the two gatekeeper layers of the ttruthdesk-platform autonomous pipeline:

- **L0 Friction Engine** (`server/frictionEngine.ts`): adds assumption confidence scoring, constraint severity ranking, decision traceability (`decision_reasons`), `forceAction` override, multi-question support, frictionLayer circuit-breaker and retry, preflight cache, PII redaction, and graph-DB degradation handling.
- **L2 Self-Prompt Engine** (`server/selfPrompt/`): adds typed `SystemState` with temporal trends, structured LLM output schema (zod-validated), `directivePublisher.ts` for L2→L3 frontier directives, `convergenceGate.ts` with 6 hard criteria, action priority ordering / duplicate detection / per-action timeout / SQL-injection guard, and richer cycle logging with telemetry.

This spec covers two PRDs: **PRD-L0** (L0 Friction Engine v1.0) and **PRD-L2** (L2 Self-Prompting Engine v1.0.0).

---

## User Stories

### US-L0-1 — Assumption Confidence & Deduplication (FR-L0-12, FR-L0-13)

**As a** platform engineer,
**I want** each detected assumption to carry a `confidence` score (0.0–1.0) and for near-duplicate assumptions (Jaccard > 0.85) to be deduplicated,
**so that** low-quality detections are filtered from the `recommended_action` calculation while still being visible for transparency.

**Acceptance Criteria:**

- [ ] `FrictionAssumption` interface includes `confidence: number` (0.0–1.0)
- [ ] Assumptions with `confidence < 0.6` are excluded from `recommended_action` logic but retained in the `assumptions` array
- [ ] Jaccard similarity is computed on `statement` tokens; if two assumptions score > 0.85, the lower-confidence one is removed
- [ ] Tests: `frictionEngine.test.ts` covers confidence filtering and deduplication

### US-L0-2 — Constraint Severity & Decision Traceability (FR-L0-22, FR-L0-31)

**As a** platform engineer,
**I want** each constraint to carry a `severity` field (`blocking | warning | informational`) and the result to include `decision_reasons: string[]`,
**so that** blocking constraints force `ask_user`/`reject` and every routing decision is auditable.

**Acceptance Criteria:**

- [ ] `FrictionConstraint` interface includes `severity: ConstraintSeverity`
- [ ] Any `blocking` constraint forces `recommended_action` to `ask_user` or `reject`
- [ ] `FrictionEngineResult` includes `decision_reasons: string[]` (non-empty for every result)
- [ ] Tests cover blocking-constraint override and decision_reasons population

### US-L0-3 — Decision Override & Multi-Question Support (FR-L0-32, FR-L0-61)

**As an** admin,
**I want** to pass `forceAction?: RecommendedAction` to `runPreflightScan` and have the result include `additional_questions?: string[]`,
**so that** I can override routing for A/B testing and surface multiple clarifications for complex inputs.

**Acceptance Criteria:**

- [ ] `runPreflightScan(text, options?)` accepts `options.forceAction`; full analysis runs but `recommended_action` is set to the forced value
- [ ] `FrictionEngineResult` includes `additional_questions?: string[]`
- [ ] `scanDurationMs` and `modelUsed` fields are populated in every result
- [ ] Tests cover forceAction override and scanDurationMs presence

### US-L0-4 — frictionLayer Hardening (PRD-L0 §5.2)

**As a** platform SRE,
**I want** `frictionLayer.ts` to implement retry logic, circuit-breaker, result caching, and `L0_SCAN_COMPLETED`/`L0_SCAN_FAILED` event publication,
**so that** the L0 wrapper is production-grade rather than a thin pass-through.

**Acceptance Criteria:**

- [ ] `frictionLayer.ts` calls `runPreflightScan` with up to 3 retries on failure
- [ ] Circuit-breaker opens after 5 consecutive failures; returns `ask_user` fallback when open
- [ ] Preflight results are cached in `preflight_cache` table (keyed by SHA-256 of input text); cache TTL 24h
- [ ] `L0_SCAN_COMPLETED` and `L0_SCAN_FAILED` events are published to the event bus after every scan
- [ ] PII (email, phone, credit card) is redacted from stored results (NFR-L0-31)
- [ ] Graph DB unavailability is handled gracefully (FR-L0-52)

### US-L2-1 — Typed SystemState with Temporal Trends (FR-L2-01 through FR-L2-06)

**As a** platform engineer,
**I want** `stateCollector.ts` to assemble a fully typed `SystemState` with temporal trends (confidence trend, gap age distribution, hypothesis verification rate, directive hit rate),
**so that** L2 reasons about trajectories rather than point-in-time snapshots.

**Acceptance Criteria:**

- [ ] `SystemState` interface matches PRD-L2 §6.1 exactly (all 6 sub-interfaces)
- [ ] `claimStats.confidenceTrend7d` is computed as average confidence delta over last 7 days
- [ ] `frontierStats.gapAgeDistribution` is a 4-bucket histogram `[0-1d, 1-7d, 7-30d, 30d+]`
- [ ] `frontierStats.hypothesisVerificationRate7d` is ratio of verified to total hypotheses over 7 days
- [ ] `selfPromptStats.frontierDirectiveHitRate7d` is ratio of consumed to issued directives over 7 days
- [ ] Missing tables return 0/null without throwing (FR-L2-06)
- [ ] Tests: `stateCollector.test.ts` covers all trend computations with seeded data

### US-L2-2 — Structured LLM Output with Zod Validation (FR-L2-07 through FR-L2-12)

**As a** platform engineer,
**I want** `promptEngine.ts` to produce a structured `reasoning / actions / directives / converged / convergenceReason` JSON response validated by a zod schema,
**so that** LLM output is always parseable and invalid responses fall back gracefully.

**Acceptance Criteria:**

- [ ] LLM prompt includes full `SystemState` as structured text and last 5 cycle summaries (FR-L2-10)
- [ ] LLM output is validated against a zod schema; invalid responses produce fallback result
- [ ] LLM call has 30s timeout; timeout produces `converged: true` fallback (FR-L2-11)
- [ ] Each action includes `priority: ActionPriority` and `justification: string` (min 20 chars)
- [ ] Each directive includes `directiveType`, `targetId`, `confidence`, `ttlMinutes`, `justification`
- [ ] Tests: `promptEngine.test.ts` covers valid response, timeout fallback, schema violation

### US-L2-3 — Frontier Directive Publishing (FR-L2-25 through FR-L2-32)

**As a** data scientist,
**I want** L2 to publish typed `FRONTIER_DIRECTIVE_ISSUED` events and persist directives to `frontier_directives` with TTL and deduplication,
**so that** L3 always has fresh, non-duplicate directives to consume.

**Acceptance Criteria:**

- [ ] `directivePublisher.ts` exports `publishDirectives(directives, cycleId): Promise<FrontierDirective[]>`
- [ ] Directives are persisted to `frontier_directives` with `expiresAt = NOW() + ttlMinutes`
- [ ] Duplicate directives (same `directiveType` + `targetId`, active and unexpired) are skipped
- [ ] `FRONTIER_DIRECTIVE_ISSUED` event is published to event bus for each new directive
- [ ] Count capped at 3 per cycle (top 3 by confidence)
- [ ] Tests: `directivePublisher.test.ts` covers persist, dedup, event publish, cap

### US-L2-4 — Action Execution Hardening (FR-L2-13 through FR-L2-38)

**As a** platform engineer,
**I want** the action executor to sort by priority, deduplicate identical actions, enforce per-action 10s timeout and 30s total cap, and reject SQL-injection payloads,
**so that** L2 actions are safe, ordered, and bounded.

**Acceptance Criteria:**

- [ ] Actions are sorted by priority (`critical > high > normal > low`) before execution
- [ ] Identical actions (same `actionType` + scalar parameters) within a cycle are deduplicated
- [ ] Each action has a 10s timeout; timeout marks action as `failed` with error `"TIMEOUT"`
- [ ] Total execution time is capped at 30s; remaining actions are marked `skipped`
- [ ] Action parameters containing SQL keywords are rejected with a security alert
- [ ] `ActionExecutionResult` includes `delegatedTo: string` and `durationMs: number`
- [ ] Tests cover priority ordering, dedup, timeout, SQL injection rejection

### US-L2-5 — Convergence Gate & Cycle Logging (FR-L2-19 through FR-L2-24, FR-L2-39 through FR-L2-43)

**As a** platform SRE,
**I want** a `convergenceGate.ts` with 6 hard criteria and `self_prompt_log` rows that include directive counts, raw LLM response, and telemetry entries,
**so that** every L2 cycle is fully observable and the loop terminates reliably.

**Acceptance Criteria:**

- [ ] `convergenceGate.ts` exports `shouldConverge(llmConverged, state, actions, cycleCount): { converged, reason }`
- [ ] Convergence is prevented (OR logic) by: LLM says false, < 2 cycles in 24h, critical alerts open, gaps > 30d with no directive, cycle count >= 10, manual trigger
- [ ] `self_prompt_log` row includes `directivesIssued`, `directivesConsumed7d`, `llmRawResponse`, `llmResponseMs`, `executionMs`, `totalDurationMs`
- [ ] Telemetry is written at cycle start and end via `emitTelemetry`
- [ ] Tests: `convergenceGate.test.ts` covers all 6 criteria; `engine.test.ts` covers full cycle log row

---

## Out of Scope

- Batch scanning API (FR-L0 future)
- Prometheus metrics exposition (NFR-L2-08, deferred to build3)
- 90-day log archival cron (FR-L2-40, deferred to build3)
- Admin dashboard query API (FR-L2-41, deferred to build3)
- L0 typed `preflight_scans` table migration from JSON column (PRD-L0 Phase 3, deferred)
- A/B prompt testing infrastructure (PRD-L0 Phase 4, deferred)
