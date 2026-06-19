# Build3 Task Specification
## L3 Frontier Engine Hardening + L5 Dream State
### ttruthdesk-platform — Build 3

---

## PART 1: L3 Frontier Engine Hardening

### Phase 1: Schema & DirectiveStore (T001–T008)

- [ ] T001: Add `directive_boost` (FLOAT, default 0.0), `rank` (INT, nullable), `detection_count` (INT, default 1), `last_detected_at` (TIMESTAMP) columns to `knowledge_gaps` schema
- [ ] T002: Generate migration 0053 via `pnpm drizzle-kit generate` and apply via `webdev_execute_sql`
- [ ] T003: Create `server/frontier/directiveStore.ts` — in-memory DirectiveStore class with `add(directive)`, `getActive()` (filters by TTL), `clearConsumed()`, `applyToRun()` methods
- [ ] T004: Wire `frontier_directive` event bus subscription in `frontierLayer.ts` — on receive, call `directiveStore.add(directive)`
- [ ] T005: Export `DirectiveStore` singleton from `server/frontier/directiveStore.ts`
- [ ] T006: Add `DirectiveEffect` interface: `{ skippedMapping: boolean; focusGapIds: string[]; deepDiveEntityId: string | null; extraHypotheses: number; directivesApplied: number }`
- [ ] T007: Add `applyDirectives(directives)` method to DirectiveStore that returns `DirectiveEffect`
- [ ] T008: Write `server/frontier/directiveStore.test.ts` — 20+ tests: add/getActive/clearConsumed, TTL expiry, applyDirectives for all 4 types, additive composition

### Phase 2: GapRanker Hardening (T009–T014)

- [ ] T009: Replace `computePriorityScore` formula in `gapRanker.ts` with PRD formula: `priority_score = (base_weight[type] * recency_factor * frequency_multiplier) + directive_boost`
  - `base_weight = { structural: 0.7, evidence: 1.0, contradiction: 1.3, temporal: 0.5 }`
  - `recency_factor = max(0.1, 1.0 - (hours_since_detection / 168))`
  - `frequency_multiplier = 1.0 + (0.1 * detection_count)`
  - `directive_boost = 0.5 if gap matches active directive, else 0.0`
- [ ] T010: Update `rankAllOpenGaps` to accept optional `DirectiveEffect` parameter and pass `directive_boost` per gap
- [ ] T011: Persist `rank` column (position in ranked list) to `knowledge_gaps` in `rankAllOpenGaps`
- [ ] T012: Update `rankGaps` function signature to match PRD: `rankGaps(gaps, directives, topN)` returning `{ rankedIds: string[]; scores: Record<string, number> }`
- [ ] T013: Update `gapRanker.test.ts` — add tests for new formula, directive_boost=0.5 when gap matches directive, rank persistence
- [ ] T014: Add `detection_count` increment in `gapMapper.ts` when gap already exists (update `last_detected_at` and `detection_count` instead of creating duplicate)

### Phase 3: HypothesisGenerator Circuit Breaker (T015–T020)

- [ ] T015: Create `server/frontier/circuitBreaker.ts` — `FrontierCircuitBreaker` class with `consecutiveFailures`, `isOpen`, `openedAt`, `cooldownMs=300000`; methods: `recordSuccess()`, `recordFailure()`, `shouldSkip()`
- [ ] T016: Add circuit breaker instance to `hypothesisGenerator.ts` — skip generation when `circuitBreaker.shouldSkip()` returns true
- [ ] T017: On LLM failure or unparseable JSON: call `circuitBreaker.recordFailure()`; on success: call `circuitBreaker.recordSuccess()`
- [ ] T018: When circuit opens (3 consecutive failures): emit `frontier.llm_circuit_open` event via `publishEvent`
- [ ] T019: Add `llm_error` flag to `HypothesisGenerationResult` interface
- [ ] T020: Write `server/frontier/circuitBreaker.test.ts` — 15+ tests: open at 3 failures, reset on success, cooldown expiry, shouldSkip behavior

### Phase 4: Directive-Aware FrontierEngine (T021–T030)

- [ ] T021: Refactor `frontierEngine.ts` to class-based `FrontierEngine` with `constructor(deps)`, `runCycle()`, `applyDirectives()`, `onDirectiveReceived()` per PRD interface
- [ ] T022: Add `isDeepDive: boolean` to `FrontierEngineRunResult`
- [ ] T023: Implement `skip_mapping` directive: when active, skip Stage 1 entirely
- [ ] T024: Implement `focus_gap` directive: in Stage 3, ensure focus gap IDs are always included in top-N selection
- [ ] T025: Implement `prioritize_hypotheses` directive: increase `MAX_HYPOTHESES_PER_CYCLE` by 2 for this cycle
- [ ] T026: Implement `deep_dive_entity` directive: scope Stage 1 to target entity, skip ranking for non-target entities, increase hypotheses to 5, tag result with `isDeepDive: true`
- [ ] T027: Implement 60-second cycle timeout guard — abort cycle and emit `frontier.cycle.timeout` event if exceeded
- [ ] T028: Add `directivesApplied` count to `FrontierMetrics`
- [ ] T029: Update `frontierEngine.test.ts` — add 15+ tests: skip_mapping skips Stage 1, focus_gap included in pursuit, deep_dive tagging, timeout abort, directives cleared after cycle
- [ ] T030: Update `frontierLayer.ts` to call `frontierEngine.onDirectiveReceived()` when `frontier_directive` event received

### Phase 5: MetricReporter + Observability (T031–T038)

- [ ] T031: Create `server/frontier/metricReporter.ts` — `MetricReporter` class that collects metrics from all stages and builds `FrontierMetrics` object per PRD interface
- [ ] T032: Update `FrontierMetrics` interface to match PRD exactly: `{ gapsDetected: {structural, evidence, contradiction, temporal}; gapsRanked; pursuitsQueued; pursuitsFailed; hypothesesGenerated; hypothesesSubmitted; staleGapsMarked; directivesApplied; isDeepDive; llmLatencyMs; dbQueryLatencyMs }`
- [ ] T033: Add `frontier.cycle.started` event emission at cycle start with `{ cycleId, isDeepDive }`
- [ ] T034: Add `frontier.cycle.completed` event emission at cycle end with full `FrontierEngineRunResult`
- [ ] T035: Write structured log entry to `frontier_log` at end of every cycle (FR-L3-34)
- [ ] T036: Add `/health/frontier` metrics endpoint in `server/routers.ts` returning current FrontierMetrics
- [ ] T037: Write `server/frontier/metricReporter.test.ts` — 12+ tests: metric aggregation, event emission, log persistence
- [ ] T038: Write `server/frontier/frontierEngine.test.ts` additions — integration tests for full cycle with directives

---

## PART 2: L5 Dream State Hardening

### Phase 6: Schema + DreamEvent Types (T039–T048)

- [ ] T039: Add `dream_event_queue` table to `drizzle/schema.ts`: `event_id UUID PK, session_id INT, dream_priority VARCHAR(16), evidence_strength FLOAT, auto_trigger BOOLEAN, payload JSONB, status VARCHAR(16) default 'queued', created_at TIMESTAMPTZ, processed_at TIMESTAMPTZ`; indexes on `status`, `dream_priority+evidence_strength DESC`, `session_id`
- [ ] T040: Update `dream_sessions` schema to match PRD: add `max_cycles INT default 5`, `queue_pending_at_start INT`, `per_cycle_reports JSONB`, `events_published INT default 0`, `aggregate_risk_level VARCHAR(16)`, `abort_reason TEXT`, `status VARCHAR(16) default 'running'`
- [ ] T041: Update `confidence_history` schema to match PRD: add `rule_triggered VARCHAR(4)` (R1-R4), `session_id INT`, `old_confidence FLOAT`, `new_confidence FLOAT`, `evidence TEXT`, `applied BOOLEAN default false`
- [ ] T042: Generate migration 0054 and apply via `webdev_execute_sql`
- [ ] T043: Create `server/dream/types.ts` — define all PRD interfaces: `DreamEvent`, `DreamEligibility`, `DreamEngineDependencies`, `FrontierMetrics`, `DreamSessionReport`, `ConsolidationReport`, `PatternDetectionReport`, `HypothesisGenerationReport`, `RecalibrationReport`, `SimulationReport`, `ProposedGraphMutation`, `DetectedPattern`, `GraphAnomaly`, `DreamHypothesis`, `ConfidenceAdjustment`
- [ ] T044: Define `DreamEvent` extending base event: `source: "dream_state"`, `dreamPriority: "recalibrate" | "consolidate" | "hypothesize" | "alert"`, `cycleNumber: 1-5`, `evidenceStrength: 0.0-1.0`, `dreamOrigin: true`
- [ ] T045: Create `server/dream/dreamEventQueue.ts` — `enqueue(event)`, `dequeueNext()`, `getQueueDepth()`, evidence strength threshold check (> 0.7 auto-trigger, else `autoTrigger: false`)
- [ ] T046: Write `server/dream/dreamEventQueue.test.ts` — 20+ tests: enqueue, dequeue, evidence strength gating, priority ordering, status transitions
- [ ] T047: Add `dream_event_queue` to autonomous loop: check dream queue before main queue in `loopOrchestrator.ts`
- [ ] T048: Add `dreamOrigin: true` weight metadata — downstream layers weight dream findings at 1.5x (`DREAM_PRODUCER_WEIGHT_MULTIPLIER = 1.5`)

### Phase 7: Session Hardening (T049–T056)

- [ ] T049: Refactor `dreamEngine.ts` to class-based `DreamEngine` with `constructor(deps)`, `checkEligibility()`, `runDreamSession()`, `executeWakeProtocol()`, `abortSession()`
- [ ] T050: Implement three-condition eligibility gate: `queueEmpty` (coord_queue pending = 0), `cooldownOk` (last session > 6h ago), `healthOk` (health score >= 40)
- [ ] T051: Implement per-cycle time budget enforcement: C1=60s, C2=90s, C3=60s, C4=60s, C5=120s hard max
- [ ] T052: Implement session persistence in new PRD format: write `per_cycle_reports` JSONB, `events_published`, `aggregate_risk_level`, `status`, `abort_reason`
- [ ] T053: Implement `DreamCircuitBreaker` in `server/dream/dreamCircuitBreaker.ts`: `consecutiveFailures`, `isOpen`, `openedAt`, `cooldownMs=300000`; skip C4/C5 when open
- [ ] T054: Emit `dream.session.started` event with `{ sessionId, startedAt, healthScore }` at session start
- [ ] T055: Emit `dream.session.completed` with full `DreamSessionReport` on completion
- [ ] T056: Emit `dream.session.aborted` with `{ sessionId, reason, elapsedMs, cyclesCompleted }` on abort
- [ ] T057: Update `dreamEngine.test.ts` — add 20+ tests: eligibility gating all 3 conditions, per-cycle budget, circuit breaker skips C4/C5, abort on session timeout, wake protocol

### Phase 8: Cycle Hardening (T058–T075)

**C1: GraphConsolidator**
- [ ] T058: Harden `graphConsolidator.ts`: implement orphan detection (entities with no relations), edge deduplication (collapse redundant edges), mutation staging (write to `ProposedGraphMutation[]` only, never direct mutation)
- [ ] T059: Return `ConsolidationReport` with `orphanedNodesFound`, `orphanedNodeIds`, `redundantEdgesCollapsed`, `entitiesAffected`, `proposedMutations`, `durationMs`
- [ ] T060: Respect `budgetMs` parameter — abort if exceeded, return partial results

**C2: LatentPatternDetector**
- [ ] T061: Harden `latentPatternDetector.ts`: implement pattern scoring (`patternStrength < 0.5` → discard), anomaly detection (high betweenness, contradiction clusters > 5, evidence dead-ends)
- [ ] T062: Return `PatternDetectionReport` with `patternsFound`, `patterns: DetectedPattern[]`, `anomaliesFlagged: GraphAnomaly[]`, `durationMs`
- [ ] T063: Respect `budgetMs` parameter

**C3: TopologyHypothesisGenerator**
- [ ] T064: Harden `topologyHypothesisGenerator.ts`: implement `MAX_HYPOTHESES_PER_DREAM_CYCLE=3` cap, cosine similarity dedup (> 0.90 vs prior 14 days), submit to `coord_queue` with `source: 'dream_topology_hypothesis'`, `priority: 8`
- [ ] T065: Return `HypothesisGenerationReport` with `hypothesesGenerated`, `hypotheses: DreamHypothesis[]`, `duplicatesFiltered`, `queued`, `durationMs`
- [ ] T066: Respect `budgetMs` parameter

**C4: ConfidenceRecalibrator**
- [ ] T067: Harden `confidenceRecalibrator.ts`: implement all 4 rules with exact thresholds (R1: -15%, R2: -5%, R3: -10%, R4: +5%), write to `confidence_history` with `rule_triggered`, `session_id`, `old_confidence`, `new_confidence`, `evidence`, `applied`
- [ ] T068: Implement `autoApply` flag — only update `claims.confidence` when `autoApply=true`
- [ ] T069: Return `RecalibrationReport` with `claimsEvaluated`, `adjustmentsMade`, `rulesTriggered: Record<R1-R4, number>`, `adjustments: ConfidenceAdjustment[]`, `durationMs`
- [ ] T070: Respect `budgetMs` parameter; skip C4 when LLM circuit breaker is open

**C5: ContradictionSimulator**
- [ ] T071: Harden `contradictionSimulator.ts`: implement all 3 scenarios (S1 retraction, S2 entity removal, S3 source failure) with structured LLM output parsing
- [ ] T072: Parse LLM output: `affectedClaims`, `cascadeDepth`, `riskLevel (low|medium|high)`, `recommendedAction`
- [ ] T073: Return `SimulationReport` with `scenariosRun`, `scenarioResults: ScenarioResult[]`, `aggregateRisk` (highest risk across scenarios), `durationMs`
- [ ] T074: Respect `budgetMs` parameter; skip C5 when LLM circuit breaker is open
- [ ] T075: Update all 5 cycle test files — add 10+ tests each for budget enforcement, structured output, error handling

### Phase 9: Wake Protocol + Integration (T076–T084)

- [ ] T076: Implement `executeWakeProtocol()` in `dreamEngine.ts`: aggregate per-cycle results, classify into `DreamEvent`, compute `evidenceStrength`, enqueue to `dream_event_queue`, emit `dream.session.completed`
- [ ] T077: Implement `dream.cycle.completed` event emission after each cycle with `{ sessionId, cycleNumber, durationMs }`
- [ ] T078: Implement `dream.cycle.failed` event emission on cycle failure with `{ sessionId, cycleNumber, error }`
- [ ] T079: Implement `dream.recalibration.proposed` event via `dream_event_queue` from C4 results
- [ ] T080: Implement `dream.hypothesis.generated` event via `coord_queue` from C3 results
- [ ] T081: Implement `dream.alert.high_risk` event via `dream_event_queue` when C5 `aggregateRisk = 'high'`
- [ ] T082: Implement `dream.consolidation.proposed` event via `dream_event_queue` from C1 results
- [ ] T083: Add `dreamLayer.ts` in `server/autonomousLoop/layers/` — checks eligibility and triggers `DreamEngine.runDreamSession()` on `scheduled_tick` when queue is empty
- [ ] T084: Wire `dreamLayer.ts` into `loopOrchestrator.ts` — run after frontier layer

### Phase 10: Full Test Suite + CI (T085–T092)

- [ ] T085: Write `server/dream/dreamCircuitBreaker.test.ts` — 15+ tests
- [ ] T086: Write `server/dream/dreamLayer.test.ts` — 12+ tests for eligibility gating and session triggering
- [ ] T087: Run `pnpm tsc --noEmit` — 0 errors
- [ ] T088: Run `pnpm lint` — 0 warnings
- [ ] T089: Run `pnpm test` — all tests pass (target: 3500+ tests)
- [ ] T090: Update `todo.md` with build3 completion block
- [ ] T091: Commit with message: `feat(build3): L3 directive-aware frontier engine + L5 dream state hardening`
- [ ] T092: Push to origin/main and update manus-persistent-drive phase log (Phase 137)
