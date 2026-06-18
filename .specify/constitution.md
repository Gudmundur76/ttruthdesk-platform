# ttruthdesk-platform Constitution

## I. Deterministic Verdicts (NON-NEGOTIABLE)

Every verdict emitted by the L1 Truth Engine MUST be rule-based, reproducible, and auditable. LLM involvement is restricted to upstream stages (claim extraction, misrepresentation classification, distortion scoring). The verdict assignment stage uses no probabilistic inference — the same inputs always produce the same verdict.

## II. Event-Driven Architecture

All cross-layer communication flows exclusively through the event bus (`server/autonomousLoop/eventBus.ts`). No layer may communicate directly with another layer outside the event bus. The loop orchestrator (`server/autonomousLoop/loopOrchestrator.ts`) is the sole dispatcher of work to layer handlers. Hidden channels are a critical defect.

## III. Layer Authority Boundaries (NON-NEGOTIABLE)

Each layer has a documented read set and write set. A layer may never write outside its write set. Authority violations are logged to `layer_telemetry` and treated as critical defects. The authority matrix is machine-readable (JSON schema) and validated in CI.

## IV. Test-First (NON-NEGOTIABLE)

TDD is mandatory for all new code. Tests are written before implementation. The Red-Green-Refactor cycle is strictly enforced. Target coverage: >90% for Production maturity layers, >70% for Beta, >50% for Alpha. Every new adapter, layer handler, and orchestrator change requires corresponding Vitest tests.

## V. Typed Contracts

All inter-layer events conform to a typed schema with: `eventId` (UUID v4), `eventType` (enum), `payload` (Zod-validated JSON), `sourceLayer` (L0–L5 | ORCHESTRATOR), `timestamp` (ISO 8601), `correlationId` (UUID), `ttl` (epoch ms). Schema changes require a version bump and 14-day backward-compat window.

## VI. Spec-Driven Development

All features begin as a specification before implementation. The PRD hierarchy (PRD-MASTER → PRD-L0 through PRD-L5) is the authoritative source of truth. Implementation deviates from spec only when a documented ADR justifies the deviation. Specs live in `.specify/` and are committed alongside code.

## VII. Observability

Every layer handler emits telemetry on every loop iteration (start + end) to the `layer_telemetry` table. All events are traceable via `correlationId`. The system supports 30-day telemetry retention. No silent failures — every error is a typed `LayerError` event.

## VIII. Simplicity and Scope Discipline

One build at a time. No tangential development. Each sprint has a defined goal, acceptance criteria, and exit gate. Code that does not serve a current sprint goal is deferred. YAGNI applies to all infrastructure decisions.

## Governance

This constitution supersedes all other practices. Amendments require a documented ADR, engineering lead approval, and a migration plan. All PRs must verify compliance with these principles. Complexity must be justified by a specific PRD requirement.

**Version**: 1.0.0 | **Ratified**: 2026-06-18 | **Last Amended**: 2026-06-18
