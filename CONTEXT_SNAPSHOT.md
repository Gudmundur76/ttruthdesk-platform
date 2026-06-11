# CONTEXT_SNAPSHOT.md — Full Project State

> **Generated:** 2026-06-11T20:23:43.231Z
> **Branch:** main
> **Last commit:** [33m1450b58[m chore: restore ci.yml — GitHub Actions Drive Staleness workflow
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

**Current phase:** Phase 108: Claim Confidence Timeline
**Todo progress:** 1008 done / 0 remaining

**Uncompleted items:**
_none_

_No session audit result found. Run `pnpm session:audit` to check._

---

## 🗄️ Database Schema

**Tables (55 total):**

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
- `siaGenerations`
- `siaImprovementProposals`
- `citationEdges`
- `graphClaimEdges`
- `contradictionAlerts`
- `claimScoreHistory`
- `citations`

Schema file: `drizzle/schema.ts`
Migrations: `drizzle/migrations/`
DB helpers: `server/db.ts`

---

## 🔌 tRPC Procedures (172 total)

`me`, `logout`, `list`, `get`, `submitText`, `submitFile`, `fetchFromPubmed`, `preflightScan`, `byDocument`, `override`, `overrideLog`, `determinismMetrics`, `getScoreHistory`, `byDocument`, `regenerate`, `byDocument`, `all`, `submit`, `list`, `ingestMonitoring`, `uploadDocument`, `data`, `corpusGrowthStats`, `entities`, `relations`, `contradictions`, `contradictionDetail`, `resolveContradiction`, `query`, `priorSignals`, `claimSubgraph`, `getPage`, `getPageBySlug`, `listPages`, `search`, `getIndex`, `getLog`, `triggerLint`, `stats`, `globalStats` ... and 132 more

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
- `server/citationChainAnalyzer.ts`
- `server/claimExtractor.ts`
- `server/claimPageRoute.ts`
- `server/claimProvenanceService.ts`
- `server/claimQualityScorer.ts`
- `server/claimSimilarityEngine.ts`
- `server/claimsRegistrySerializer.ts`
- `server/claimsRoutes.ts`
- `server/clinicalTrialsAdapter.ts`
- `server/completenessCheck.ts`
- `server/compositeTruthEngine.ts`
- `server/confidenceTrendService.ts`
- `server/contradictionDetector.ts`
- `server/coordApi.ts`
- `server/coordQueueDrainer.ts`
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
- `server/graphTraversal.ts`
- `server/heartbeatRegistrar.ts`
- `server/hostingerWebhook.ts`
- `server/jwksKeys.ts`
- `server/jwtSigner.ts`
- `server/llmProviderQuality.ts`
- `server/llmsRoute.ts`
- `server/magicLink.ts`
- `server/manusOrchestrator.ts`
- `server/micronDeploy.ts`
- `server/misrepresentationClassifier.ts`
- `server/monitoringJob.ts`
- `server/openfdaAdapter.ts`
- `server/orchestratorTickJob.ts`
- `server/passageExtractor.ts`
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
- `server/reEvaluationEngine.ts`
- `server/reportGenerator.ts`
- `server/routers.ts`
- `server/searchEngine.ts`
- `server/seedKnowledgeGraph.ts`
- `server/siaHarnessRouter.ts`
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
- `client/src/pages/ChatPage.tsx`
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
"name": "citation-is-warmup",
      "name": "claim-digest-hourly",
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
Start at  20:23:44
   Duration  9.47s (transform 2.65s, setup 0ms, collect 10.81s, tests 16.71s, environment 16ms, prepare 5.64s)
```

**Lint:**

```
✖ 49 problems (0 errors, 49 warnings)
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
[33m1450b58[m chore: restore ci.yml — GitHub Actions Drive Staleness workflow
[33m6b88c58[m chore: remove ci.yml for GitHub push (no workflows permission)
[33meaed2be[m fix: remove unused drizzle-orm imports in graphTraversal.ts
[33m4ea9087[m feat: Phase 105-108 — re-evaluation loop, contradiction detection, score history, heartbeat registration
[33mb82351a[m feat: Phase 97 CopilotKit removal and native chat.query tRPC procedure
[33m25d7be1[m chore: update context snapshot — force new publish checkpoint
[33md0cfa08[m feat(ci): restore ci.yml with Drive Staleness job (Phase 94)
[33mce1ef58[m temp: remove ci.yml for push
[33m0d28b9c[m feat(meta-agent): session governance script + drive staleness CI check
[33md6a07ba[m feat(coverage): Phase 93 - coverage tests +58, thresholds 27/42, feature:sync in pre-commit
```

**Uncommitted changes:**

```
[32mM[m  drizzle/schema.ts
[32mM[m  server/db.ts
[32mM[m  server/routers.ts
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

# Phase C1 sync — 2026-06-11T20:41:02Z
