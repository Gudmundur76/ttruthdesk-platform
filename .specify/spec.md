# Feature Specification: build1_foundation — 6-Layer Autonomous Coordination

## Overview

Establish the foundational infrastructure for the ttruthdesk-platform's 6-layer autonomous architecture. This build delivers the cross-layer coordination primitives that all subsequent feature work depends on: a typed event bus with correlation and TTL, a unified telemetry plane, the L2→L3 FrontierDirective protocol, the L5 Dream State priority queue, and the L4 Meta-Agent foundation with health scoring and alert routing.

This spec covers three PRDs: PRD-MASTER-001 (system infrastructure), PRD-L1 (Truth Engine gaps), and PRD-L4 (Meta-Agent).

## User Stories

### US1 — Typed Event Contracts (PRD-MASTER FR-MASTER-03)

**As a** platform engineer,
**I want** all inter-layer events to carry a `correlationId`, `eventId` (UUID v4), `ttl`, and Zod-validated `payload`,
**so that** I can trace any claim's full event chain from submission to verdict without losing context across layer boundaries.

**Acceptance Criteria:**
- [ ] Every event published to the event bus includes `eventId` (UUID v4), `correlationId` (UUID), `ttl` (epoch ms, 7-day default), `sourceLayer`, `timestamp` (ISO 8601)
- [ ] Events without required fields are rejected at the TypeScript type level (compile-time)
- [ ] Zod schema validation runs on every `publishEvent()` call; invalid payloads throw `SCHEMA_VALIDATION_ERROR`
- [ ] `correlationId` is propagated from parent event to all child events dispatched in the same claim pipeline
- [ ] 100% of existing event types are migrated to the new schema without breaking existing tests

### US2 — Unified Telemetry Plane (PRD-MASTER FR-MASTER-06)

**As a** platform SRE,
**I want** a single `layer_telemetry` table that collects start/end events from all 6 layers on every loop iteration,
**so that** I can build cross-layer dashboards and detect degradation without querying 6 separate log tables.

**Acceptance Criteria:**
- [ ] `layer_telemetry` table exists in `drizzle/schema.ts` with columns: `telemetry_id`, `layer`, `event_type`, `event_id`, `timestamp`, `duration_ms`, `success`, `error_code`, `payload_hash`, `metadata_json`
- [ ] `server/autonomousLoop/telemetry.ts` exports `emitTelemetry(layer, eventType, eventId, durationMs, success, errorCode?)` helper
- [ ] All 5 existing layer handlers (frictionLayer, truthLayer, selfPromptLayer, frontierLayer, metaLayer) call `emitTelemetry` on loop start and loop end
- [ ] Telemetry writes do not block the main event processing path (fire-and-forget with error logging)

### US3 — L2→L3 FrontierDirective Protocol (PRD-MASTER FR-MASTER-04)

**As a** data scientist,
**I want** L3 (Frontier Engine) to only run when L2 (Self-Prompting Engine) publishes a typed `FrontierDirective` event,
**so that** frontier exploration is always traceable to a specific convergence trigger and respects `maxIterations`.

**Acceptance Criteria:**
- [ ] `frontier_directives` table exists in `drizzle/schema.ts` with all required columns
- [ ] `FrontierDirective` event type is added to `EventTypeEnum` and has a Zod-validated payload schema
- [ ] `selfPromptLayer.ts` publishes `FrontierDirective` events when convergence is stalled or confidence is low
- [ ] `frontierLayer.ts` reads the directive's `maxIterations` and halts after that many iterations (hard stop)
- [ ] Every L3 session row in `frontier_sessions` has a non-null `directive_id` FK
- [ ] `FrontierComplete` event is published by L3 when done or when `maxIterations` is reached

### US4 — L5 Dream State Priority Queue (PRD-MASTER FR-MASTER-05)

**As a** platform engineer,
**I want** L5 (Dream State) to operate on a separate low-priority queue with evidence strength thresholding,
**so that** dream consolidation sessions never block main claim processing and only operate on high-confidence evidence.

**Acceptance Criteria:**
- [ ] `dream_sessions` table exists in `drizzle/schema.ts` (already present — verify columns match PRD spec)
- [ ] `dreamLayer.ts` is created at `server/autonomousLoop/layers/dreamLayer.ts`
- [ ] Dream events use a separate queue priority (0.3 vs main queue 1.0) in `event_queue`
- [ ] Evidence strength filter (≥ 0.7) is applied before a dream session begins
- [ ] Dream sessions run on a configurable schedule (default: every 6 hours via heartbeat)
- [ ] `DreamSessionRequest`, `DreamSessionApproved`, `DreamComplete` event types are added to `EventTypeEnum`
- [ ] `loopOrchestrator.ts` routes dream events to `dreamLayer.ts` (replacing the current special-case inline logic)

### US5 — L4 Meta-Agent Foundation (PRD-L4 Phases 1–3)

**As a** platform engineer,
**I want** the L4 Meta-Agent to have typed interfaces, a proper orchestrator skeleton, and a working alert router,
**so that** health scores and drift findings are persisted, deduplicated, and routed to registered handlers.

**Acceptance Criteria:**
- [ ] `server/metaAgent/types.ts` exports all interfaces from PRD-L4 §6 (`CodeGuardianReport`, `MetaFinding`, `StubLedgerReport`, `PipelineGuardianReport`, `AlertHandler`, etc.)
- [ ] `codeGuardian.ts` uses `Promise.allSettled` for sub-check parallelism (graceful partial failure)
- [ ] `alertRouter.ts` supports `register(handler)`, `dispatch(finding)`, severity-tier routing (critical→all, warning→warning+info, info→info only)
- [ ] `meta_agent_checks` table is written on every guardian run (historical persistence)
- [ ] `meta_agent_alerts` table is written for every dispatched alert
- [ ] Test drift exclusion list is configurable via `TEST_DRIFT_EXCLUDE` env var
- [ ] Health grade thresholds are configurable via `HEALTH_GRADE_THRESHOLDS` env var
- [ ] Integration tests TC-G-01 through TC-G-05 pass (see PRD-L4 §11.3)

## Design

The build follows the PRD-MASTER Phase 1 and Phase 2 implementation sequence, plus PRD-L4 Phases 1–3. All changes are backward-compatible with the existing Sprint 40/41 codebase. The event bus retains its current DB-backed queue mechanics; the upgrade adds the typed envelope layer on top without changing storage semantics.

New database tables (`layer_telemetry`, `frontier_directives`, `event_log`) are added via Drizzle schema migration. Existing tables (`dream_sessions`, `meta_agent_checks`) are verified against PRD column specs and patched if needed.

## Out of Scope for build1_foundation

- HMAC-SHA256 event signing (PRD-MASTER NFR-MASTER-06) — deferred to build2_security
- Row-level security enforcement (PRD-MASTER NFR-MASTER-06) — deferred to build2_security
- L0 Friction Engine internal prompt changes — out of scope per PRD-MASTER §1.2
- L1 adapter additions beyond Sprint 41 — covered by separate sprint cadence
- Grafana telemetry dashboard — deferred to build3_observability
- Multi-tenant event routing — deferred (OQ-MASTER-05)
