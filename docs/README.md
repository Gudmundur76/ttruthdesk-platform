# ttruthdesk-platform — Documentation

## PRD Hierarchy

| Document | File | Status | Scope |
|---|---|---|---|
| PRD-MASTER-001 | `build1_foundation.docx` | Draft | 6-layer autonomous coordination, event bus, convergence gate, telemetry |
| PRD-L1 | `build1_foundation.docx` (Part 2) | Draft | L1 Truth Engine — 15-stage verification pipeline |
| PRD-L4 | `build1_foundation.docx` (Part 3) | Draft | L4 Meta-Agent — code health monitoring, drift detection |

## Spec-Kit Artifacts

The `.specify/` directory contains the Spec-Driven Development artifacts for each build:

| File | Description |
|---|---|
| `.specify/constitution.md` | Project governing principles (non-negotiable constraints) |
| `.specify/spec.md` | Feature specification for `build1_foundation` (user stories, acceptance criteria) |
| `.specify/plan.md` | Technical implementation plan (approach, steps, risks) |
| `.specify/tasks.md` | Actionable task list with IDs, story labels, and file paths |

## Build Sequence

| Build | Focus | PRD Reference | Status |
|---|---|---|---|
| build1_foundation | Unified orchestration, telemetry, FrontierDirective, Dream Layer, L4 Meta-Agent foundation | PRD-MASTER Phase 1–2, PRD-L4 Phase 1–3 | In Progress |
| build2_security | HMAC event signing, row-level security, auth hardening | PRD-MASTER NFR-MASTER-06 | Planned |
| build3_observability | Grafana telemetry dashboard, cross-layer tracing, alerting integrations | PRD-MASTER FR-MASTER-06 | Planned |

## Architecture Reference

See `server/autonomousLoop/` for the event bus, loop orchestrator, convergence gate, and layer handlers. See `server/metaAgent/` for the L4 Meta-Agent implementation. See `drizzle/schema.ts` for the full database schema.
