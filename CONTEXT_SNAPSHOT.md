# CONTEXT_SNAPSHOT.md — Full Project State

> **Generated:** 2026-06-09T10:21:35.456Z
> **Branch:** main
> **Last commit:** 51cc47a feat(admin): Phase 91 — /admin/harness dashboard + harnessStatus/refreshSnapshot tRPC procedures
> **READ THIS FIRST** at the start of every session.

---

## 🎯 What This Project Is

**Protein Truth Desk** — a scientific claim verification platform that:
- Ingests research papers (PubMed, PMC, bioRxiv, manual upload)
- Extracts protein/structural biology claims using LLM
- Verifies claims against PDB (Protein Data Bank) and other evidence sources
- Produces audit reports with verdicts (Supported / Contradicted / Insufficient Evidence / etc.)
- Exposes a public claims registry and knowledge graph
- Runs an autonomous loop (5 layers: Friction → Self-Prompt → Frontier → Truth → Meta)

**Stack:** React 19 + Tailwind 4 + Express 4 + tRPC 11 + Drizzle ORM + MySQL/TiDB

---

## 📋 Current Work Status

**Current phase:** Phase 91: GitHub CI + Harness Dashboard + Session Habit
**Todo progress:** 865 done / 0 remaining

**Uncompleted items:**
_none_

_No session audit result found. Run `pnpm session:audit` to check._



---

## 🗄️ Database Schema

**Tables (48 total):**
- `users`
- `documents`
- `claims`
- `auditReports`
- `monitoringFeed`
- `auditRequests`
- `monitoringJobs`
- `autoIngestedPapers`
- `magicLinkTokens`
- `emailUsers`
- `graphEntities`
- `graphRelations`
- `userSubscriptions`
- `predictionFeatures`
- `predictionModels`
- `webhookAlerts`
- `coordTasks`
- `coordQueue`
- `coordContext`
- `verticalAlerts`
- `notificationLog`
- `webhookDeliveryLog`
- `claimProvenanceEvents`
- `entityCooccurrences`
- `confidenceHistory`
- `apiKeys`
- `wikiPages`
- `wikiIndex`
- `wikiLog`
- `metaAgentChecks`
- `predictionCalibration`
- `overrideAuditLog`
- `llmProviderQuality`
- `knowledgeGaps`
- `frontierLog`
- `selfPromptLog`
- `generatedClaims`
- `dreamSessions`
- `eventQueue`
- `loopRun`
- `loopConfig`
- `verticalConfigs`
- `cronRunLog`
- `micronDeployments`
- `discoveryRuns`
- `sourceRegistryEntries`
- `savedResearch`
- `publicSubmissions`

Schema file: `drizzle/schema.ts`
Migrations: `drizzle/migrations/`
DB helpers: `server/db.ts`

---

## 🔌 tRPC Procedures (161 total)

`me`, `logout`, `list`, `get`, `submitText`, `submitFile`, `fetchFromPubmed`, `preflightScan`, `byDocument`, `override`, `overrideLog`, `determinismMetrics`, `byDocument`, `regenerate`, `byDocument`, `all`, `submit`, `list`, `ingestMonitoring`, `uploadDocument`, `data`, `corpusGrowthStats`, `entities`, `relations`, `contradictions`, `contradictionDetail`, `resolveContradiction`, `query`, `getPage`, `getPageBySlug`, `listPages`, `search`, `getIndex`, `getLog`, `triggerLint`, `stats`, `globalStats`, `listAll`, `detail`, `list` ... and 121 more

Router file: `server/routers.ts`

---

## 📁 Key Server Files

- `server/academicDomains.ts`
- `server/adminAnalytics.ts`
- `server/agentIngestionEndpoint.ts`
- `server/alertDispatcher.ts`
- `server/analysisPipeline.ts`
- `server/apiKeyService.ts`
- `server/apiV2Router.ts`
- `server/autonomousIngest.ts`
- `server/backfillWikiRoute.ts`
- `server/badgeRoute.ts`
- `server/batchAuditRouter.ts`
- `server/claimExtractor.ts`
- `server/claimPageRoute.ts`
- `server/claimProvenanceService.ts`
- `server/claimQualityScorer.ts`
- `server/claimSimilarityEngine.ts`
- `server/claimsRegistrySerializer.ts`
- `server/claimsRoutes.ts`
- `server/clinicalTrialsAdapter.ts`
- `server/completenessCheck.ts`
- `server/confidenceTrendService.ts`
- `server/coordApi.ts`
- `server/coordQueueDrainer.ts`
- `server/copilotRuntime.ts`
- `server/cronRunLogger.ts`
- `server/db.ts`
- `server/discoveryAgent.ts`
- `server/discoveryEngine.ts`
- `server/discoveryLoopJob.ts`
- `server/embedRoutes.ts`
- `server/embedWidgetRoute.ts`
- `server/entityCooccurrenceService.ts`
- `server/europePmcAdapter.ts`
- `server/exportRouter.ts`
- `server/frictionEngine.ts`
- `server/hostingerWebhook.ts`
- `server/jwksKeys.ts`
- `server/jwtSigner.ts`
- `server/llmProviderQuality.ts`
- `server/llmsRoute.ts`
- `server/magicLink.ts`
- `server/manusOrchestrator.ts`
- `server/micronDeploy.ts`
- `server/monitoringJob.ts`
- `server/openfdaAdapter.ts`
- `server/orchestratorTickJob.ts`
- `server/paypalCheckout.ts`
- `server/pdbAdapter.ts`
- `server/pdfReportGenerator.ts`
- `server/plattCalibration.ts`
- `server/pmcFeedJob.ts`
- `server/predictionBackfillJob.ts`
- `server/predictionEngine.ts`
- `server/privateMode.ts`
- `server/pubmedIngestJob.ts`
- `server/qualityPassJob.ts`
- `server/qualityScorerJob.ts`
- `server/reportGenerator.ts`
- `server/routers.ts`
- `server/searchEngine.ts`
- `server/seedKnowledgeGraph.ts`
- `server/sitemapRoute.ts`
- `server/sourceRegistry.ts`
- `server/storage.ts`
- `server/submitClaimRoute.ts`
- `server/swarmTickJob.ts`
- `server/telegramBot.ts`
- `server/translateAndSearchApi.ts`
- `server/uniprotAdapter.ts`
- `server/vectorStore.ts`
- `server/verdictEngine.ts`
- `server/verifyClaimRoute.ts`
- `server/verticalCopilotActions.ts`
- `server/verticalFeedConfig.ts`
- `server/verticalFeedMerger.ts`
- `server/verticalNotificationService.ts`
- `server/webhookDeliveryService.ts`
- `server/wikiCompiler.ts`
- `server/wikiEngine.ts`
- `server/wikiLintJob.ts`
- `server/wikiLinter.ts`
- `server/wikiPageRoute.ts`

---

## 📄 Client Pages

- `client/src/pages/Admin.tsx`
- `client/src/pages/AdminAnalytics.tsx`
- `client/src/pages/AdminCrons.tsx`
- `client/src/pages/AdminHarness.tsx`
- `client/src/pages/AdminVerticals.tsx`
- `client/src/pages/AlertSettings.tsx`
- `client/src/pages/ApiDocs.tsx`
- `client/src/pages/ApiKeys.tsx`
- `client/src/pages/AuditComparison.tsx`
- `client/src/pages/AuditReport.tsx`
- `client/src/pages/AutonomousLoopDashboard.tsx`
- `client/src/pages/ClaimPage.tsx`
- `client/src/pages/ClaimProvenance.tsx`
- `client/src/pages/ComponentShowcase.tsx`
- `client/src/pages/ContradictionViewer.tsx`
- `client/src/pages/CooccurrenceGraph.tsx`
- `client/src/pages/CoordinatorDashboard.tsx`
- `client/src/pages/Dashboard.tsx`
- `client/src/pages/DreamDashboard.tsx`
- `client/src/pages/EvidenceTimeline.tsx`
- `client/src/pages/ExportData.tsx`
- `client/src/pages/Frontier.tsx`
- `client/src/pages/Graph.tsx`
- `client/src/pages/Home.tsx`
- `client/src/pages/InversePromptDashboard.tsx`
- `client/src/pages/MonitoringFeed.tsx`
- `client/src/pages/NotFound.tsx`
- `client/src/pages/NotificationSettings.tsx`
- `client/src/pages/OverridesDashboard.tsx`
- `client/src/pages/PredictionCalibration.tsx`
- `client/src/pages/PublicReport.tsx`
- `client/src/pages/Registry.tsx`
- `client/src/pages/SavedResearch.tsx`
- `client/src/pages/Search.tsx`
- `client/src/pages/SelfPromptDashboard.tsx`
- `client/src/pages/SourceWhitelist.tsx`
- `client/src/pages/Submit.tsx`
- `client/src/pages/Trust.tsx`
- `client/src/pages/VerticalDetail.tsx`
- `client/src/pages/VerticalLeaderboard.tsx`
- `client/src/pages/Verticals.tsx`
- `client/src/pages/WebhookDeliveryLog.tsx`
- `client/src/pages/Wiki.tsx`
- `client/src/pages/WikiPage.tsx`
- `client/src/pages/WikiSlugPage.tsx`

Routes registered in: `client/src/App.tsx`

---

## ⏱️ Heartbeat Jobs (Scheduled)

```
"name": "self-prompt-2h",
      "name": "meta-agent-daily",
      "name": "inverse-prompt-daily",
      "name": "quality-scorer-6h",
      "name": "quality-pass-nightly",
      "name": "pmc-feed-nightly",
      "name": "autonomous-loop-tick",
      "name": "frontier-engine",
      "name": "swarm-tick-daily",
      "name": "wiki-engine-lint-weekly",
      "name": "discovery-loop-daily",
      "name": "pubmed-decode-weekly",
```

Scheduled endpoints in: `server/_core/index.ts` (search for `/api/scheduled/`)

---

## 🤖 Autonomous Loop Architecture

The platform has a 5-layer autonomous loop (`server/autonomousLoop/`):

| Layer | File | Purpose |
|-------|------|---------|
| L1 — Friction | `frictionLayer.ts` | Handles document_submitted, manual_review_complete |
| L2 — Self-Prompt | `selfPromptLayer.ts` | LLM decides next action (drain_queue, reverify_stale, recalibrate_confidence, etc.) |
| L3 — Frontier | `frontierLayer.ts` | Gap detection, hypothesis generation, evidence pursuit |
| L3 — Truth | `truthLayer.ts` | PDB re-verification, source_data_changed, paper_discovered |
| L4 — Meta | `metaLayer.ts` | Code guardian, pipeline guardian (7 invariants), alert routing |

Event bus: `server/autonomousLoop/eventBus.ts`
Orchestrator: `server/autonomousLoop/loopOrchestrator.ts`

---

## 🔧 Available Environment Variables



Env config: `server/_core/env.ts`

---

## ✅ Quality Gates

**TypeScript:**
```
clean
```

**Tests:**
```
Start at  10:21:36
   Duration  8.47s (transform 2.41s, setup 0ms, collect 8.79s, tests 16.89s, environment 19ms, prepare 4.32s)
```

**Lint:**
```
✖ 44 problems (0 errors, 44 warnings)
  0 errors and 1 warning potentially fixable with the `--fix` option.
```

**Coverage thresholds:**
```
lines: 26, // actual: 26.51% — raise to 35% next phase
        branches: 48, // actual: 65%+ (branches well covered)
        functions: 36, // actual: 36.64% — raise to 45% next phase
        statements: 26, // actual: 26.51% — raise to 35% next phase
```

**Stubs:**
```
unknown
```

---

## 📝 Recent Git History

```
51cc47a feat(admin): Phase 91 — /admin/harness dashboard + harnessStatus/refreshSnapshot tRPC procedures
c902d84 feat(quality): add session completion guarantee system and context window management
42b9ed2 feat(quality): Phase 89 task completion guarantee system
45353a4 feat: Phase 88 — code quality enforcement layer
4b83829 Checkpoint: Phase 87: Full agent architecture improvements — expanded self-prompt action vocabulary (drain_queue, reverify_stale, recalibrate_confidence), coordQueueDrainer engine, dream events wired into loop orchestrator, strengthened truthLayer with real PDB re-verification, 2 new pipeline guardian invariants (stalePdbEvidence + lowConfidenceClaims, 7 total). 915 tests passing, TypeScript: 0 errors.
19b97b0 Checkpoint: Phase 86 complete: Infrastructure Harness Completion. Fixed 4 TypeScript errors (CodeGuardianReport properties + LoopEventType). Added POST /api/scheduled/inverse-prompt, /meta-agent, /self-prompt endpoints. Registered 3 new heartbeat jobs (inverse-prompt-daily 03:00 UTC, meta-agent-daily 04:00 UTC, self-prompt-2h). Strengthened CopilotKit queryGraph tool with getPaginatedPublicClaims for real DB-backed claim search alongside entity name-match. 9 new Vitest tests in scheduledEngines.test.ts. 915 total tests passing. TypeScript: 0 errors. Now 11 heartbeat schedules total on the Manus platform.
facbc74 Checkpoint: Phase 85: Meta-Agent Completion. MANUS_API_KEY set to real key (HTTP 200 verified). All 8 heartbeat schedules confirmed active on Manus platform. Added POST /api/public/submit-claim (rate-limited 10 req/IP/hour, fires full autonomous pipeline, returns documentId + polling URL) and GET /api/public/submit-claim/status/:id. New public_submissions table added to schema and migrated. submit_claim MCP tool registered. 6 new Vitest tests. 906 total passing. TypeScript clean. Server running cleanly.
8f8412e Checkpoint: Removed Pricing.tsx, CheckoutSuccess.tsx, /pricing and /checkout/success routes, PayPal checkout router and imports from routers.ts, and the "Request Audit" nav link. Replaced all pricing CTAs with /submit links. Replaced the pricing section on Home.tsx with a "Free to use. Open by design." section. Renamed ttruthdesk.claims → truthdesk.claims across all 15 files (92 occurrences). 900 tests passing, TypeScript clean.
7d76255 Checkpoint: Phase 83: Three improvements shipped together. (1) Server-side ?q= text search added to GET /api/public/claims — the paginated endpoint now accepts a q= param that filters across claim text, verdict rationale, PDB ID, and claim type via SQL LIKE, and the q value is included in pagination Link headers and the filters object. (2) New GET /api/public/claims/search?q=... dedicated endpoint for external integrations — returns up to 200 matching claims from the full corpus in a single response with no pagination needed; each claim includes a timeline_url deep-link; registered before /api/public/claims/:id to avoid Express routing conflicts. (3) Registry page upgraded to use server-side search — when ?q= is active it debounces a fetch to /api/public/claims/search (400ms), shows a spinner while searching, displays total_matches count, and renders a "View timeline ↗" button in the result count bar and on each claim card. MCP_TOOLS array updated with search_claims tool; llms.txt updated to recommend the new endpoint to agents. 12 new Vitest tests added; all 900 tests pass, TypeScript clean.
d8393df Checkpoint: Fix: /registry?q=... and /search?q=... now correctly pre-populate their search inputs from the URL on mount. Root cause: both pages initialised their search state to empty string, silently ignoring the ?q= URL param. Fix: (1) Registry.tsx now reads ?q= on mount via useState lazy initialiser, adds a live text search input with client-side filtering (by claim value, rationale, claim type, PDB ID), keeps URL in sync via replaceState, shows match count, and offers a "Full search ↗" button to /search?q=... for semantic search. (2) Search.tsx now reads ?q= on mount so navigating to /search?q=Piscirickettsia+salmonis... immediately fires the keyword search. All 888 tests pass, TypeScript clean.
```

**Uncommitted changes:**
```
M  CONTEXT_SNAPSHOT.md
```

---

## 🚀 Key Commands

```bash
pnpm check          # TypeScript type check
pnpm lint           # ESLint (must be 0 errors)
pnpm test           # Run all tests
pnpm test:coverage  # Run tests with coverage
pnpm task:done      # Full mechanical quality gate (run before ending session)
pnpm session:audit  # LLM semantic completeness check
pnpm handoff        # Generate HANDOFF.md if session is incomplete
pnpm handoff --clear # Delete HANDOFF.md when session is complete
pnpm context:snapshot # Regenerate this file
pnpm drift          # Run drift detector
pnpm stubs          # Run stub tracker
```

---

## 📐 Architecture Decisions

- **tRPC-first**: all backend calls go through tRPC procedures, no raw fetch/axios
- **Drizzle ORM**: schema-first, migrations via `pnpm drizzle-kit generate` + `webdev_execute_sql`
- **S3 storage**: all files via `storagePut`/`storageGet` helpers, never local disk
- **UTC timestamps**: all DB timestamps as Unix ms, convert to local time in UI
- **Server-side LLM**: all LLM calls in tRPC procedures via `invokeLLM`, never client-side
- **Autonomous loop**: events published to `eventBus.publish()`, processed by `loopOrchestrator.processEvent()`

---

_This file is auto-generated by `pnpm context:snapshot`. Regenerate after major changes._
