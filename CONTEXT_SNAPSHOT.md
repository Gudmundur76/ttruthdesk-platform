# CONTEXT_SNAPSHOT.md — Full Project State

> **Generated:** 2026-06-10T14:24:40.264Z
> **Branch:** main
> **Last commit:** d0cfa08 feat(ci): restore ci.yml with Drive Staleness job (Phase 94)
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

**Current phase:** Phase 94: Drive catch-up sync + meta-agent
**Todo progress:** 890 done / 0 remaining

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

## 🔌 tRPC Procedures (163 total)

`me`, `logout`, `list`, `get`, `submitText`, `submitFile`, `fetchFromPubmed`, `preflightScan`, `byDocument`, `override`, `overrideLog`, `determinismMetrics`, `byDocument`, `regenerate`, `byDocument`, `all`, `submit`, `list`, `ingestMonitoring`, `uploadDocument`, `data`, `corpusGrowthStats`, `entities`, `relations`, `contradictions`, `contradictionDetail`, `resolveContradiction`, `query`, `getPage`, `getPageBySlug`, `listPages`, `search`, `getIndex`, `getLog`, `triggerLint`, `stats`, `globalStats`, `listAll`, `detail`, `list` ... and 123 more

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

| Layer            | File                 | Purpose                                                                             |
| ---------------- | -------------------- | ----------------------------------------------------------------------------------- |
| L1 — Friction    | `frictionLayer.ts`   | Handles document_submitted, manual_review_complete                                  |
| L2 — Self-Prompt | `selfPromptLayer.ts` | LLM decides next action (drain_queue, reverify_stale, recalibrate_confidence, etc.) |
| L3 — Frontier    | `frontierLayer.ts`   | Gap detection, hypothesis generation, evidence pursuit                              |
| L3 — Truth       | `truthLayer.ts`      | PDB re-verification, source_data_changed, paper_discovered                          |
| L4 — Meta        | `metaLayer.ts`       | Code guardian, pipeline guardian (7 invariants), alert routing                      |

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
Start at  14:24:41
   Duration  9.30s (transform 2.50s, setup 0ms, collect 9.54s, tests 18.97s, environment 15ms, prepare 5.07s)
```

**Lint:**

```
✖ 44 problems (0 errors, 44 warnings)
  0 errors and 1 warning potentially fixable with the `--fix` option.
```

**Coverage thresholds:**

```
lines: 27, // actual: 27.51% (Phase 93 +1.1%) — target 35% Phase 94
        branches: 48, // actual: 70%+ (branches well covered)
        functions: 42, // actual: 42.62% (Phase 93 +6%) — target 50% Phase 94
        statements: 27, // actual: 27.51% — target 35% Phase 94
```

**Stubs:**

```
unknown
```

---

## 📝 Recent Git History

```
d0cfa08 feat(ci): restore ci.yml with Drive Staleness job (Phase 94)
ce1ef58 temp: remove ci.yml for push
0d28b9c feat(meta-agent): session governance script + drive staleness CI check
d6a07ba feat(coverage): Phase 93 - coverage tests +58, thresholds 27/42, feature:sync in pre-commit
405d5ec feat(phase-92): feature_list.json contract + agent_tools.ts API wrappers
da3bf8e fix(test): inject placeholder OPENROUTER_API_KEY in swarm.test.ts for CI
526ae50 fix(ci): let packageManager field own pnpm version, remove explicit version: 9
d3ce6c3 fix(ci): move pnpm install before setup-node, add Node 24 opt-in
381a21f chore: restore ci.yml locally (push requires GitHub workflows permission)
c5e4878 chore: temporarily remove ci.yml for push
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
