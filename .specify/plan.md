# Implementation Plan: build1_foundation

## Tech Stack & Architecture

**Runtime:** Node.js 22, TypeScript 5, tRPC 11, Drizzle ORM, MySQL/TiDB  
**Validation:** Zod (already installed) — used for event payload schemas  
**Testing:** Vitest (existing test harness, 3,095 tests passing)  
**Queue:** DB-backed `event_queue` table (existing) — priority column added  
**Telemetry:** New `layer_telemetry` table, fire-and-forget writes  

## Approach

The build is additive: no existing interfaces are broken, all new code sits alongside the current implementation. The upgrade path for each component is:

1. **Event Bus** — Add typed envelope (`eventId`, `correlationId`, `ttl`, `sourceLayer`, `timestamp`) as a new `TypedEvent<T>` wrapper. Existing `LoopEvent` rows continue to work; new events carry the full envelope. Zod schemas are defined per `EventTypeEnum` value in `server/autonomousLoop/eventSchemas.ts`.

2. **Telemetry** — New `layer_telemetry` table + `emitTelemetry()` helper. Each layer handler wraps its main logic in `const t0 = Date.now(); try { ... } finally { emitTelemetry(..., Date.now()-t0, success) }`.

3. **FrontierDirective** — New `frontier_directives` table. `selfPromptLayer.ts` gains a `publishFrontierDirective()` call when `convergenceState === 'stalled'`. `frontierLayer.ts` gains a `maxIterations` guard.

4. **Dream Layer** — New `dreamLayer.ts` extracted from the inline `dream_session_complete` branch in `loopOrchestrator.ts`. `event_queue` gains a `priority` column (DECIMAL, default 1.0; dream events use 0.3).

5. **L4 Meta-Agent** — `types.ts` consolidates all interfaces. `codeGuardian.ts` refactored to use `Promise.allSettled`. `alertRouter.ts` gains `register()` and severity-tier dispatch. `meta_agent_alerts` table added.

## Steps

### Phase 1 — Database Schema (Day 1)

Add 3 new tables to `drizzle/schema.ts`: `layer_telemetry`, `frontier_directives`, `meta_agent_alerts`. Verify `dream_sessions` and `meta_agent_checks` column sets match PRD specs. Generate migration SQL via `pnpm drizzle-kit generate` and apply via `webdev_execute_sql`.

### Phase 2 — Event Schemas & Typed Envelope (Day 1–2)

Create `server/autonomousLoop/eventSchemas.ts` with Zod schemas for all 15 `EventTypeEnum` values. Update `publishEvent()` in `eventBus.ts` to accept and validate the typed envelope. Add `correlationId` propagation to `loopOrchestrator.ts` dispatch calls.

### Phase 3 — Telemetry Helper & Layer Instrumentation (Day 2)

Create `server/autonomousLoop/telemetry.ts`. Instrument all 5 existing layer handlers with start/end telemetry calls.

### Phase 4 — FrontierDirective Protocol (Day 3)

Update `selfPromptLayer.ts` to publish `FrontierDirective` events. Update `frontierLayer.ts` to consume directives and enforce `maxIterations`. Add `directive_id` FK to `frontier_sessions` schema.

### Phase 5 — Dream Layer Extraction (Day 3–4)

Create `server/autonomousLoop/layers/dreamLayer.ts`. Move inline dream logic from `loopOrchestrator.ts` into the new layer. Add `priority` column to `event_queue`. Add `DreamSessionRequest`, `DreamSessionApproved`, `DreamComplete` to `EventTypeEnum`.

### Phase 6 — L4 Meta-Agent Foundation (Day 4–5)

Create `server/metaAgent/types.ts` with all PRD-L4 interfaces. Refactor `codeGuardian.ts` to use `Promise.allSettled`. Refactor `alertRouter.ts` to support `register()` and severity-tier dispatch. Add `meta_agent_alerts` table writes. Add `TEST_DRIFT_EXCLUDE` and `HEALTH_GRADE_THRESHOLDS` env var support.

### Phase 7 — Tests & Validation (Day 5)

Write/update Vitest tests for: event schema validation, telemetry emission, FrontierDirective lifecycle, dream layer routing, L4 integration tests TC-G-01 through TC-G-05. Run full suite. Save checkpoint. Push to GitHub.

## Dependencies

- Zod (already in `package.json`)
- `uuid` package for `eventId` generation (already available via Node.js `crypto.randomUUID()`)
- No new npm packages required

## Risks

| Risk | Mitigation |
|---|---|
| Schema migration breaks existing event_queue rows | Add columns with DEFAULT values; no destructive changes |
| correlationId propagation misses some dispatch paths | Static grep for all `publishEvent` call sites before shipping |
| L4 `Promise.allSettled` refactor changes error semantics | Existing TC-G-01 through TC-G-05 tests catch regressions |
| Dream layer extraction breaks existing dream_session_complete handling | Keep existing loopOrchestrator branch as a fallback until dreamLayer tests pass |
