# Tasks: build1_foundation

## Phase 1 — Setup (Database Schema)

- [ ] T001 Add `layer_telemetry`, `frontier_directives`, `meta_agent_alerts` tables to `drizzle/schema.ts`; verify `dream_sessions` and `meta_agent_checks` columns match PRD-MASTER §8.1 and PRD-L4 §3.7
- [ ] T002 Run `pnpm drizzle-kit generate` to produce migration SQL, then apply via `webdev_execute_sql`
- [ ] T003 Add `priority` DECIMAL column (default 1.0) to `event_queue` table in `drizzle/schema.ts` and apply migration

## Phase 2 — Foundational (Event Schemas & Typed Envelope)

- [ ] T004 [P] Create `server/autonomousLoop/eventSchemas.ts` with Zod schemas for all 15 `EventTypeEnum` values (`CLAIM_SUBMITTED`, `CLAIM_PREPARED`, `EVIDENCE_RETRIEVED`, `VERDICT_PUBLISHED`, `FRONTIER_DIRECTIVE`, `FRONTIER_COMPLETE`, `CONVERGENCE_REACHED`, `CONVERGENCE_PENDING`, `DRIFT_DETECTED`, `DREAM_SESSION_REQUEST`, `DREAM_SESSION_APPROVED`, `DREAM_COMPLETE`, `CONFIDENCE_UPDATE`, `LAYER_ERROR`, `LAYER_TELEMETRY`)
- [ ] T005 Update `publishEvent()` in `server/autonomousLoop/eventBus.ts` to accept and validate `TypedEvent<T>` envelope with `eventId` (UUID v4 via `crypto.randomUUID()`), `correlationId`, `ttl` (epoch ms, 7-day default), `sourceLayer`, `timestamp` (ISO 8601); reject invalid payloads with `SCHEMA_VALIDATION_ERROR`
- [ ] T006 Update `loopOrchestrator.ts` to propagate `correlationId` from incoming event to all child `publishEvent()` calls dispatched within the same claim pipeline
- [ ] T007 [P] Write Vitest tests in `server/autonomousLoop/eventBus.test.ts` covering: valid envelope accepted, missing `correlationId` rejected, invalid payload rejected, `correlationId` propagated to child events

## Phase 3 — US2: Unified Telemetry Plane

- [ ] T008 Create `server/autonomousLoop/telemetry.ts` exporting `emitTelemetry(layer, eventType, eventId, durationMs, success, errorCode?)` helper that writes to `layer_telemetry` as a fire-and-forget operation (errors logged, not thrown)
- [ ] T009 [P] Instrument `server/autonomousLoop/layers/frictionLayer.ts` with `emitTelemetry` on loop start and loop end
- [ ] T010 [P] Instrument `server/autonomousLoop/layers/truthLayer.ts` with `emitTelemetry` on loop start and loop end
- [ ] T011 [P] Instrument `server/autonomousLoop/layers/selfPromptLayer.ts` with `emitTelemetry` on loop start and loop end
- [ ] T012 [P] Instrument `server/autonomousLoop/layers/frontierLayer.ts` with `emitTelemetry` on loop start and loop end
- [ ] T013 [P] Instrument `server/autonomousLoop/layers/metaLayer.ts` with `emitTelemetry` on loop start and loop end
- [ ] T014 [P] Write Vitest tests in `server/autonomousLoop/telemetry.test.ts` covering: successful write, DB failure does not throw, all 6 layer enum values accepted

## Phase 4 — US3: FrontierDirective Protocol

- [ ] T015 [US3] Update `server/autonomousLoop/layers/selfPromptLayer.ts` to publish `FRONTIER_DIRECTIVE` event (with `directiveId`, `triggerReason`, `priority`, `targetGapIds`, `maxIterations`, `evidenceStrengthThreshold`) when convergence is stalled or confidence is below threshold; write directive row to `frontier_directives` table
- [ ] T016 [US3] Update `server/autonomousLoop/layers/frontierLayer.ts` to: read `maxIterations` from the triggering `FrontierDirective` event, enforce hard stop after that many iterations, publish `FRONTIER_COMPLETE` event on completion or max-iterations reached, write `directive_id` FK to `frontier_sessions` rows
- [ ] T017 [US3] Add `directive_id` nullable FK column to `frontier_sessions` table in `drizzle/schema.ts` and apply migration
- [ ] T018 [P] [US3] Write Vitest tests in `server/autonomousLoop/layers/frontierLayer.test.ts` covering: directive consumed, `maxIterations` hard stop, `FrontierComplete` published, `directive_id` written to session

## Phase 5 — US4: Dream Layer Extraction

- [ ] T019 [US4] Create `server/autonomousLoop/layers/dreamLayer.ts` implementing `runDreamLayer(event)` that: filters evidence by strength ≥ 0.7, processes `DREAM_SESSION_REQUEST` and `DREAM_SESSION_APPROVED` events, publishes `DREAM_COMPLETE` event, writes to `dream_sessions` table
- [ ] T020 [US4] Update `server/autonomousLoop/loopOrchestrator.ts` to route `DREAM_SESSION_REQUEST`, `DREAM_SESSION_APPROVED`, `DREAM_COMPLETE` events to `dreamLayer.ts`; remove the inline `dream_session_complete` special-case branch
- [ ] T021 [US4] Update `publishEvent()` in `eventBus.ts` to use `priority` column (0.3 for dream events, 1.0 for all others) when inserting into `event_queue`
- [ ] T022 [P] [US4] Write Vitest tests in `server/autonomousLoop/layers/dreamLayer.test.ts` covering: evidence strength filter applied, dream session written to DB, `DREAM_COMPLETE` published, low-priority queue insertion

## Phase 6 — US5: L4 Meta-Agent Foundation

- [ ] T023 [US5] Create `server/metaAgent/types.ts` exporting all interfaces from PRD-L4 §6: `CodeGuardianReport`, `MetaFinding`, `CodeDriftReport`, `StubLedgerReport`, `StubEscalation`, `PipelineGuardianReport`, `InvariantResult`, `AlertHandler`, `AlertSeverity`; update all existing metaAgent files to import from `types.ts` instead of defining inline
- [ ] T024 [US5] Refactor `server/metaAgent/codeGuardian.ts` to use `Promise.allSettled` for sub-check parallelism; ensure partial failure (one sub-check throws) produces a partial report rather than a full failure; write result to `meta_agent_checks` table on every run
- [ ] T025 [US5] Refactor `server/metaAgent/alertRouter.ts` to support: `register(handler: AlertHandler)`, severity-tier dispatch (critical→all handlers, warning→warning+info handlers, info→info-only handlers), `meta_agent_alerts` table writes via `dbHandler`
- [ ] T026 [US5] Add `TEST_DRIFT_EXCLUDE` env var support to `server/metaAgent/codeDriftService.ts` (comma-separated glob list; defaults to `**/*.d.ts,**/index.ts,**/types.ts,**/*.config.ts`)
- [ ] T027 [US5] Add `HEALTH_GRADE_THRESHOLDS` env var support to `server/metaAgent/codeGuardian.ts` (format `A:90,B:75,C:60,D:40`; defaults to PRD-L4 §3.5 values)
- [ ] T028 [P] [US5] Write integration tests in `server/metaAgent/codeGuardian.test.ts` covering TC-G-01 through TC-G-05: full run all-pass, drift findings score subtraction, overdue stubs score subtraction, pipeline failures score subtraction, DB unavailable partial report

## Phase 7 — Polish & Cross-Cutting

- [ ] T029 [P] Run `pnpm check` (TypeScript) — fix all type errors introduced by the new typed envelope
- [ ] T030 [P] Run full Vitest suite (`pnpm test`) — all tests must pass (target: 0 failures)
- [ ] T031 Copy all changes from webdev project to GitHub clone (`/home/ubuntu/ttruthdesk-platform`), commit as `build1_foundation: unified orchestration + L4 meta-agent foundation`, push to `origin/main`
- [ ] T032 Save webdev checkpoint and update `manus-persistent-drive/compounding_log.md` with build1_foundation Phase 138 log

## Estimation

| Phase | Tasks | Estimated Effort |
|---|---|---|
| Phase 1 — Schema | T001–T003 | 1 hour |
| Phase 2 — Event Schemas | T004–T007 | 2 hours |
| Phase 3 — Telemetry | T008–T014 | 1.5 hours |
| Phase 4 — FrontierDirective | T015–T018 | 2 hours |
| Phase 5 — Dream Layer | T019–T022 | 2 hours |
| Phase 6 — L4 Foundation | T023–T028 | 3 hours |
| Phase 7 — Polish | T029–T032 | 1 hour |
| **Total** | **32 tasks** | **~12.5 hours** |

## MVP Scope

Tasks T001–T014 (Phases 1–3) deliver the minimum viable foundation: schema migrations, typed event envelopes, and telemetry instrumentation. This is independently deployable and testable before the FrontierDirective and Dream Layer work begins.
