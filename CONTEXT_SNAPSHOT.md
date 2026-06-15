# CONTEXT_SNAPSHOT.md — Full Project State

> **Generated:** 2026-06-15T15:58:28.636Z
> **Branch:** main
> **Last commit:** [33m27c3fef[m feat(sprint-21): SPO triple, Crossref retraction, NOAA+FRED adapters
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

**Current phase:** Phase 132: SIA Harness Test Coverage Expansion
**Todo progress:** 1181 done / 0 remaining

**Uncompleted items:**
_none_

_No session audit result found. Run `pnpm session:audit` to check._

⚠️ **HANDOFF.md exists** — previous session was incomplete. Read HANDOFF.md first.

---

## 🗄️ Database Schema

**Tables (64 total):**

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
- `promptHarness`
- `qualityPassFeedback`
- `sourceVersions`
- `supersededClaims`
- `questions`
- `rateLimitBuckets`
- `dreamStagingQueue`
- `claimEmbeddings`
- `pricingLeads`

Schema file: `drizzle/schema.ts`
Migrations: `drizzle/migrations/`
DB helpers: `server/db.ts`

---

## 🔌 tRPC Procedures (175 total)

`me`, `logout`, `list`, `get`, `submitText`, `submitFile`, `fetchFromPubmed`, `preflightScan`, `byDocument`, `override`, `overrideLog`, `determinismMetrics`, `getScoreHistory`, `byDocument`, `regenerate`, `byDocument`, `all`, `submit`, `list`, `ingestMonitoring`, `uploadDocument`, `data`, `corpusGrowthStats`, `entities`, `relations`, `contradictions`, `contradictionDetail`, `resolveContradiction`, `query`, `priorSignals`, `claimSubgraph`, `getPage`, `getPageBySlug`, `listPages`, `search`, `getIndex`, `getLog`, `triggerLint`, `stats`, `globalStats` ... and 135 more

Router file: `server/routers.ts`

---

## 📁 Key Server Files

- `server/academicDomains.ts`
- `server/adminAnalytics.ts`
- `server/agentFeedback.ts`
- `server/agentIngestionEndpoint.ts`
- `server/alertDispatcher.ts`
- `server/analysisPipeline.ts`
- `server/answerRoute.ts`
- `server/apiKeyService.ts`
- `server/apiV2Router.ts`
- `server/autonomousIngest.ts`
- `server/backfillEmbeddingsRoute.ts`
- `server/backfillWikiRoute.ts`
- `server/badgeRoute.ts`
- `server/batchAuditRouter.ts`
- `server/batchVerify.ts`
- `server/batchVerifyRoute.ts`
- `server/billingRouter.ts`
- `server/citationChainAnalyzer.ts`
- `server/claimExtractor.ts`
- `server/claimHistoryRoute.ts`
- `server/claimPageRoute.ts`
- `server/claimProvenanceRoute.ts`
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
- `server/coordRoundTrip.ts`
- `server/cronRunLogger.ts`
- `server/db.ts`
- `server/detailedHealthRoute.ts`
- `server/discoveryAgent.ts`
- `server/discoveryEngine.ts`
- `server/discoveryLoopJob.ts`
- `server/domainIngestScheduler.ts`
- `server/dreamStagingRoute.ts`
- `server/embedRoutes.ts`
- `server/embedWidgetRoute.ts`
- `server/embeddingBackfillJob.ts`
- `server/embeddingCoverageAudit.ts`
- `server/entityCooccurrenceService.ts`
- `server/epistemicProvenance.ts`
- `server/europePmcAdapter.ts`
- `server/exportRouter.ts`
- `server/externalPublicRouter.ts`
- `server/findSimilarRoute.ts`
- `server/frictionEngine.ts`
- `server/graphTraversal.ts`
- `server/heartbeatRegistrar.ts`
- `server/hostingerWebhook.ts`
- `server/ingestionAlertJob.ts`
- `server/jwksKeys.ts`
- `server/jwtSigner.ts`
- `server/knowledgeGapBridge.ts`
- `server/llmProviderQuality.ts`
- `server/llmsRoute.ts`
- `server/logger.ts`
- `server/magicLink.ts`
- `server/manusOrchestrator.ts`
- `server/mcpServer.ts`
- `server/micronDeploy.ts`
- `server/misrepresentationClassifier.ts`
- `server/monitoringJob.ts`
- `server/openCitationsEnricher.ts`
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
- `server/pubmedAbstractFetcher.ts`
- `server/pubmedIngestJob.ts`
- `server/qualityPassJob.ts`
- `server/qualityScorerJob.ts`
- `server/questionRouter.ts`
- `server/reEvaluationEngine.ts`
- `server/reportGenerator.ts`
- `server/routers.ts`
- `server/searchEngine.ts`
- `server/seedKnowledgeGraph.ts`
- `server/siaHarnessRouter.ts`
- `server/sitemapRoute.ts`
- `server/sourceRegistry.ts`
- `server/sourceVersionAgent.ts`
- `server/spoExtractor.ts`
- `server/storage.ts`
- `server/streamVerifyRoute.ts`
- `server/structuredErrors.ts`
- `server/submitClaimRoute.ts`
- `server/swarmTickJob.ts`
- `server/telegramBot.ts`
- `server/temporalVersioning.ts`
- `server/trainingBridge.ts`
- `server/trainingCorpusListener.ts`
- `server/translateAndSearchApi.ts`
- `server/uniprotAdapter.ts`
- `server/vectorStore.ts`
- `server/verdictChangeDispatcher.ts`
- `server/verdictEngine.ts`
- `server/verifyClaimRoute.ts`
- `server/verticalCopilotActions.ts`
- `server/verticalFeedConfig.ts`
- `server/verticalFeedMerger.ts`
- `server/verticalNotificationService.ts`
- `server/webhookDeliveryService.ts`
- `server/wikiClustering.ts`
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
- `client/src/pages/Pricing.tsx`
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
unknown
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
Start at  15:58:30
   Duration  28.25s (transform 5.96s, setup 0ms, collect 32.38s, tests 37.93s, environment 59ms, prepare 22.37s)
```

**Lint:**

```
> protein-truth-desk@1.0.0 lint /home/ubuntu/ttruthdesk-platform
> eslint . --ext .ts,.tsx --max-warnings 0
```

**Coverage thresholds:**

```
lines: 35, // Phase 123: actual 35.01% — target 38% Phase 124
        branches: 48, // actual: 69.61% (branches well covered)
        functions: 47, // Phase 124a: actual 47.98% — target 55% Phase 124b/125
        statements: 35, // Phase 123: actual 35.01% — target 38% Phase 124
```

**Stubs:**

```
unknown
```

---

## 📝 Recent Git History

```
[33m27c3fef[m feat(sprint-21): SPO triple, Crossref retraction, NOAA+FRED adapters
[33mced06a8[m docs(sprint20): File 4 — MCP listing plan + Crossref/Scite integration spec
[33m8864347[m feat(api): Sprint 20 File 3 — entity resolve endpoint + developer asks documentation
[33m7c26356[m feat(pipeline): Sprint 20 File 2 — domain expansion signals for medicine, climate, economics, law
[33m2f23fb7[m feat(sprint20): fix verify_claim pipeline, search_claims, contradictions, corpus-growth
[33mbbd553b[m feat(api): add manually_reviewed filter to claims endpoint
[33m36e381c[m docs(agents): wire AAIF toolchain as mandatory pre-sprint validation
[33m03b7572[m feat(status): add SLM training progress to /api/public/status/domains
[33m63c2fd2[m fix(ci): use runtime string for optional sibling module import
[33mf20b633[m fix(ci): migrate pnpm config to pnpm-workspace.yaml
```

**Uncommitted changes:**

```
[32mM[m[31mM[m CONTEXT_SNAPSHOT.md
[32mA[m  docs/agentstack-integration.md
[32mA[m  docs/perplexity-outreach-email.md
[32mA[m  scripts/export-opencitations.ts
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
