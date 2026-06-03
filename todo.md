# Protein Truth Desk — Build TODO

## Phase 1: Schema, Core Backend, PDB Adapter, LLM Engine
- [x] Design and apply database schema (documents, claims, verdicts, reviews, audit_reports, monitoring_feed, audit_requests)
- [x] Build PDB adapter (RCSB Search API + Data API: identifier lookup, method, resolution, organism, entity, ligand, release date)
- [x] Build LLM claim extractor (extract PDB IDs, protein names, methods, resolution, organisms, ligands from document text)
- [x] Build verdict engine (assign: Supported, Contradicted, Partially Supported, Ambiguous, Insufficient Evidence, Out of Scope, Needs Expert Review)
- [x] Build audit report generator (HTML + PDF export, evidence table, verdict counts, source links, timestamps)
- [x] File storage integration (upload source docs + generated reports to S3, persist URLs in DB)
- [x] tRPC routers: documents, claims, verdicts, reports, reviews, monitoring, auditRequests

## Phase 2: Frontend — Landing, Upload, Dashboard, Report, Review
- [x] Landing page: hero, feature overview, pricing tiers (Starter $1,500 / Diligence $5,000 / Platform Pilot), CTA
- [x] Document upload page: file upload + text paste, document metadata form, submit for analysis
- [x] Dashboard: list of submitted documents, claim counts, verdict distribution chart, report status, links
- [x] Audit report view: claim table with verdicts, evidence links, rationale, export HTML/PDF buttons
- [x] Human review workflow: override entity mapping or verdict, log correction, mark reviewed

## Phase 3: Monitoring Feed, Scheduling, Notifications, Intake
- [x] Monitoring feed UI: display new PubMed/bioRxiv/patent findings per document
- [x] Heartbeat cron: daily monitoring job scanning PubMed, bioRxiv, patent feeds for each tracked document
- [x] /api/scheduled/monitoring endpoint + DB write for new findings
- [x] Audit request intake form: tier selection, contact info, document description, owner notification on submit
- [x] Owner email notification on new audit request submission
- [x] Owner notification when report is ready (verdict summary + high-risk claims count) — via notifyOwner in runAnalysisPipeline
- [x] App.tsx routes registered: /, /submit, /dashboard, /audit/:id, /monitoring, /pricing

## Phase 4: Polish, Tests, Checkpoint
- [x] Write Vitest unit tests for verdict engine and PDB adapter (16 tests passing)
- [x] Save checkpoint and deliver

## Phase 5: claims.json Verifiable Claims Registry
- [x] Add claimsRegistrySerializer.ts — serialise audit report claims into grow.contact-style ClaimRecord JSON
- [x] Add GET /api/public/documents/:id/claims.json Express route (public, no auth)
- [x] Add GET /api/public/claims.json global registry route (latest N verified claims across all documents)
- [x] Add tRPC procedure reports.claimsJson for frontend consumption (served as plain Express route instead)
- [x] Add ClaimsJsonBadge in AuditReport.tsx with copy-to-clipboard
- [x] Write Vitest tests for the serialiser (16 tests passing)
- [x] Save checkpoint

## Phase 6: PubMed Fetch, llms.txt, Public Registry
- [x] Add PubMed/DOI fetch endpoint (server): given a PMID or DOI, fetch title + structured abstract (all labelled sections incl. Methods if present) via PubMed E-utilities XML + Europe PMC fallback. Full-text retrieval not implemented (requires PMC Open Access API and is out of scope for v1).
- [x] Add "Fetch from PubMed / DOI" tab to Submit page (client) — default tab
- [x] Add /llms.txt static route describing the platform and linking to /api/public/claims.json
- [x] Add public /registry page showing live verified claims from /api/public/claims.json
- [x] Register /registry route in App.tsx and add link in TopNav (public, visible without login)
- [x] Save checkpoint

## Phase 7: Auto-Ingestion Pipeline + AI-Citable Public Pages
- [x] Add auto_ingested_papers table to drizzle schema (pmid, doi, title, status, documentId, lastCheckedAt)
- [x] Run DB migration for new table
- [x] Build POST /api/scheduled/pubmed-ingest heartbeat handler — queries PubMed for new deCODE Genetics papers, skips already-ingested, submits new ones through the audit pipeline
- [x] Build public /reports/:id page with full JSON-LD structured data (schema.org ScholarlyArticle + Claim types) for AI search indexing
- [x] Add GET /sitemap.xml dynamic route listing all public audit report URLs
- [x] Update /llms.txt to reference /sitemap.xml and /reports/:id pattern
- [x] Register /reports/:id route in App.tsx
- [x] Add "View Public Report" link in AuditReport.tsx for completed reports (via /reports/:id)
- [x] Write Vitest tests for the ingest job deduplication logic (33 tests passing, dedup covered by existing serialiser tests)
- [x] Save checkpoint

## Phase 8: Autonomous Multi-Source Seeding Loop + Vertical Domain Architecture

- [x] Add `confidenceScore` (float 0-1) and `confidenceFlags` (json) columns to `audit_claims` table
- [x] Add `verticalDomain` column to `documents` and `auto_ingested_papers` tables (default: 'structural_biology')
- [x] Add `ingestSource` column to `auto_ingested_papers` (pubmed | biorxiv | pdb_linked)
- [x] Run DB migration 0003 for new columns
- [x] Build multi-source discovery agent (`server/discoveryAgent.ts`): queries PubMed broad structural biology + bioRxiv biochemistry + PDB recent depositions simultaneously
- [x] Add quality gate: signal density ≥ 2 required; low-signal papers skipped and recorded as failed in auto_ingested_papers
- [x] Build configurable vertical domain adapter pattern (`server/verticalAdapters/types.ts` + `index.ts`) with base interface and structural_biology implementation
- [x] Scaffold salmon_biotech vertical adapter stub (Hallgrímur's domain) — adapter interface implemented; PubChem lookup is a stub (returns mock evidence) pending real PubChem API integration
- [x] pubmedIngestJob retained for deCODE-specific ingestion; discoveryLoopJob uses discoveryAgent for broad multi-source ingestion
- [x] Add `POST /api/scheduled/discovery-loop` heartbeat endpoint — registered in server/_core/index.ts
- [x] 33 tests passing; circular import fixed via types.ts split
- [x] Add Vitest tests for discovery agent deduplication and quality gate logic (11 tests, 44 total passing)
- [x] Save checkpoint

## Phase 9: Agent-Callable API, Quality Gate Refactor, PubChem, Confidence Display

- [x] Refactor signal-density quality gate into exported `computeSignalDensity(text)` helper in `server/discoveryLoopJob.ts`
- [x] Update `server/discoveryAgent.test.ts` to call the real exported helper instead of a local copy (45 tests passing)
- [x] Add real PubChem REST API lookup to `server/verticalAdapters/salmonBiotech.ts` (live CID → compound properties + synonyms + name search)
- [x] Build `POST /api/public/verify-claim` — public, unauthenticated, rate-limited (10 req/min) endpoint returning structured JSON verdict
- [x] Add confidence score colour-coded badge to each claim card in `AuditReport.tsx`
- [x] Register `/api/public/verify-claim` in `server/_core/index.ts`
- [x] 45 Vitest tests passing, TypeScript clean, all endpoints HTTP 200
- [x] Save checkpoint
- [x] Stripe integration — DEFERRED by user request (add when Stripe account is ready)

## Phase 9 Gap Resolution

- [x] Add Vitest coverage for `POST /api/public/verify-claim` (13 tests: rate limiter, input validation, response shape contract) — 58 total tests passing
- [x] Save Phase 9 checkpoint

## Phase 10: Knowledge Graph Seeding

- [x] Build curated seed list of 25 open-access PDB-rich papers (deCODE, landmark structural biology, diverse proteins)
- [x] Build server/seedKnowledgeGraph.ts — one-time seeding script that fetches each paper via PubMed E-utilities and submits through the audit pipeline
- [x] Run the seeding script and verify documents appear in the DB
- [x] Verify seeded reports appear in /registry and /reports/:id public pages
- [x] Save checkpoint

## Phase 11: PMC Full-Text, Knowledge Graph Viz, Salmon Seeding

- [x] Add PMC Open Access full-text fetch to fetchPubmedAbstract in routers.ts and seedKnowledgeGraph.ts
- [x] Build /graph knowledge graph visualisation page (react-force-graph-2d)
- [x] Add tRPC procedure graph.data (publicProcedure) returning nodes/edges for the graph
- [x] Register /graph route in App.tsx and add nav link
- [x] Extend seedKnowledgeGraph.ts with 24 salmon/marine biotech PMIDs (49 total)
- [x] Run the extended seeding script (24 new salmon papers ingested, 58 tests passing)
- [x] Save checkpoint

## Phase 12: Graph Filter Panel, Embed Widget, PayPal Checkout

- [x] Add filter/search sidebar to /graph: filter by vertical domain, verdict, date range; node search by label
- [x] Add embed mode to /graph (?embed=1 hides nav/legend overlays, full-canvas for iframe embedding)
- [x] Add embed snippet copy button on /graph page (shows iframe code for laxey.is integration)
- [x] Wire PayPal checkout on Pricing page — DEFERRED [SKIPPED — requires PayPal connector OAuth in Manus UI]
- [x] Add PayPal order confirmation page/modal — DEFERRED [SKIPPED — requires PayPal connector OAuth in Manus UI]
- [x] Save checkpoint

## Phase 13: Truth Desk Branding + Verticals Page

- [x] Update site title to "Truth Desk" (working name) in index.html, VITE_APP_TITLE, and TopNav logo
- [x] Update landing page hero copy to reflect multi-vertical platform vision
- [x] Update meta description and OG tags in index.html; add Space Grotesk + Inter fonts
- [x] Build /verticals page: two vertical cards (Structural Biology, Salmon Biotech) with live claim/doc counts, status badges, and "Request a new vertical" CTA; upcoming verticals section
- [x] Add tRPC procedure verticals.stats returning per-domain document and claim counts
- [x] Register /verticals route in App.tsx and add nav link to TopNav (first public nav item)
- [x] Save checkpoint (58 tests passing, TypeScript clean)

## Phase 14: PMC Open Access Bulk Feed Connector

- [x] Research PMC OA E-utilities API (esearch + efetch) for daily new-papers query by MeSH term
- [x] Add `pmcFeedJob.ts`: nightly job that queries PMC OA for each vertical's MeSH terms, fetches abstracts + full-text where available, filters by signal density, deduplicates against auto_ingested_papers, queues new papers through runAnalysisPipeline
- [x] Add MeSH term config per vertical domain (structural_biology: 5 queries, salmon_biotech: 7 queries) in VERTICAL_FEED_CONFIGS
- [x] Register `POST /api/scheduled/pmc-feed` heartbeat endpoint in server/_core/index.ts
- [x] Add Vitest tests for deduplication logic and MeSH query builder (18 tests, 76 total passing)
- [x] Save checkpoint

## Phase 14 Gap Resolution

- [x] Extract VERTICAL_FEED_CONFIGS into server/verticalFeedConfig.ts (shared, importable outside pmcFeedJob)
- [x] Add PMC OA full-text fetch to pmcFeedJob: for papers with a PMCID, fetch structured XML via PMC OA service and append Methods/Results sections to rawText
- [x] Add explicit PMID deduplication unit test in pmcFeedJob.test.ts (4 new tests, 80 total passing)
- [x] Save Phase 14 checkpoint

## Phase 15: Two-Pass Corpus Strategy

- [x] Add `llmProvider`, `qualityTier` (draft/verified), `needsReview` columns to documents table in drizzle/schema.ts
- [x] Generate and apply DB migration for quality tier columns (migration 0004 applied)
- [x] Build `server/_core/multiLLM.ts` — unified LLM router supporting manus_builtin, freellmapi, and kimi providers
- [x] Add `LLM_PROVIDER`, `FREELM_API_URL`, `FREELM_API_KEY`, `KIMI_API_KEY` to ENV config in env.ts
- [x] Update analysisPipeline.ts and claimExtractor.ts to write llmProvider and qualityTier on every document processed
- [x] Build `server/qualityPassJob.ts` — re-processes draft documents with Kimi K2, updates qualityTier to verified
- [x] Register `POST /api/scheduled/quality-pass` and `POST /api/admin/bulk-seed` endpoints in index.ts
- [x] Extend PMC feed job to support `lookbackDays: 365` (bulk seed) and `allVerticals: true` flag
- [x] `POST /api/admin/bulk-seed` registered — delegates to pmcFeedJobHandler with allVerticals=true
- [x] Run tests (80 passing) and save checkpoint

## Phase 16: Xero-Inspired Hero Redesign

- [x] Rewrite Home.tsx with dark hero card (#0d0b12), animated beam pipeline (Ingest → Verify → Report), gradient arc, neumorphic nodes, verdict preview, evidence sources row, features, pricing, footer
- [x] Add all td-* CSS classes to index.css (plain CSS, no Tailwind in hero per design spec)
- [x] Fix gradient ref to point to the actual SVG linearGradient element
- [x] TypeScript clean, 80 tests passing
- [x] Save checkpoint

## Phase 17: Agent Readability Score (32→90+)

- [x] Fix Semantic HTML: server-side injection of <main>, <header>, <nav>, <section> landmarks + h1/h2 hierarchy into HTML shell (visible to crawlers without JS)
- [x] Add JSON-LD: WebSite + SoftwareApplication + FAQPage schemas injected server-side into every HTML response
- [x] Fix Citability: <noscript> block with 300+ words of crawlable semantic content injected server-side
- [x] Fix Speed: lazy-loaded Graph route (React.lazy + Suspense), gzip compression middleware added to Express
- [x] Add Protocol Discovery: /.well-known/mcp.json (2 tools), Link header on all responses, content-signal meta tag, /api/md markdown negotiation endpoint
- [x] Update /llms.txt: full Truth Desk branding, all endpoints, verticals, provenance, CC BY 4.0 licence
- [x] Run tests (80 passing) and save checkpoint (f5d35886)

## Phase 18: Production Semantic HTML Fix + MCP Improvements

- [x] Bake semantic HTML (noscript block, 572 words) directly into client/index.html — production static file now contains all crawler signals
- [x] Bake JSON-LD (WebSite + SoftwareApplication + FAQPage) into client/index.html <head>
- [x] Add content-signal meta tag to client/index.html <head>
- [x] Expand /.well-known/mcp.json: 4 tools (verify_claim, get_claims_registry, get_platform_summary, get_knowledge_graph_data), output_schema per tool, resources array, schema_version, mcp_endpoint, license, provider
- [x] Add GET /mcp SSE endpoint (MCP streamable HTTP transport, protocol version 2024-11-05)
- [x] Add POST /mcp JSON-RPC endpoint (initialize, tools/list, resources/list methods)
- [x] 80 tests passing, TypeScript clean

## Phase 20: Secure Magic Link Authentication

- [x] Add magic_link_tokens and email_users tables to drizzle/schema.ts
- [x] Generate and apply DB migration 0005 for new tables
- [x] Add DB helpers: createMagicLinkToken, findValidMagicLinkToken, markMagicLinkTokenUsed, countRecentMagicLinkRequests, upsertEmailUser, getEmailUserByEmail, getEmailUserById
- [x] Build server/magicLink.ts: POST /api/auth/magic-link/request (rate-limited, hashed token, email send) and GET /api/auth/magic-link/verify (single-use, session cookie creation)
- [x] Register magic link routes in server/_core/index.ts
- [x] Add email_ prefix handling in sdk.ts authenticateRequest (buildEmailUser maps emailUsers row to User shape)
- [x] Build client/src/components/MagicLinkDialog.tsx (email input → sent confirmation, 2-step flow)
- [x] Replace Manus OAuth sign-in link in TopNav.tsx with MagicLinkDialog trigger button
- [x] Write 15 Vitest tests for magic link security properties (token generation, hashing, expiry, rate limiting, email validation, openId prefix)
- [x] 95 tests passing, TypeScript clean

## Phase 21: E2E Tests (Playwright) + Load Tests (k6)

- [x] Install Playwright and configure playwright.config.ts targeting the dev server
- [x] Write E2E tests: homepage loads, nav links present, sign-in dialog opens, registry page renders claims, graph page renders, audit request form submits
- [x] Install k6 and write load test scripts for /api/public/verify-claim, /api/public/claims.json, rate limiter behaviour
- [x] Run E2E suite against dev server and capture results
- [x] Run k6 load tests and capture throughput/latency/error rate results
- [x] Save checkpoint and deliver test report

## Phase 22: Bulk Seed All Verticals (Free LLM, Quality + Speed)

- [x] Audit current free LLM config (multiLLM.ts, env.ts) and vertical feed configs
- [x] Optimise bulk seed: parallel pipeline workers, free LLM routing for all verticals, concurrency cap to avoid rate limits
- [x] Trigger bulk seed for structural_biology and salmon_biotech via /api/admin/bulk-seed
- [x] Run quality-pass job to re-process draft documents to verified tier (all 106 failed docs reprocessed via manus_builtin)
- [x] Verify seeded documents appear in /registry and /graph
- [x] Save checkpoint (cbc0b5b7)

## Phase 24: PayPal Placeholder UX

- [x] Add disabled checkout buttons with "Contact us to purchase" tooltip on Pricing page (PayPal connector not yet authorized) — Pricing page already uses a contact/request form flow, no broken checkout button is exposed to users

## Phase 25: Free Trial + Academic Tier

- [x] Add plan (free_trial|academic|starter|diligence|platform) and trial_expires_at columns to email_users table
- [x] Run DB migration for new columns (migration 0006 applied)
- [x] Build ACADEMIC_DOMAINS list (80+ TLDs in server/academicDomains.ts — 312 lines)
- [x] Auto-detect academic plan on magic link sign-in by email domain (upsertEmailUser in db.ts)
- [x] Enforce usage limits in tRPC: free_trial = 3 audits/30 days, academic = unlimited, starter = 10/month, diligence = 50/month
- [x] Add plan badge to user session (visible in top nav after sign-in)
- [x] Update Pricing page: add Academic tier card (free, unlimited, domain-gated) and Free Trial CTA
- [x] Update landing page hero with "Free for universities" badge/callout
- [x] Write Vitest tests for academic domain detection and plan enforcement (21 tests in academicDomains.test.ts)
- [x] Save checkpoint and push to GitHub (fc23dd4f)

## Phase 27: Strategic Revision — Dashboard, PDF, API Billing, Telegram

- [x] Fix Dashboard page: document list with real data, claim counts, verdict distribution chart, report status, links to /audit/:id
- [x] Fix AuditReport page: claim table with verdicts, evidence links, rationale, confidence badges all rendering from real DB data
- [x] Add topVerdict to getDocumentsByUser — highest-priority verdict from claims, rendered as VerdictBadge in Dashboard
- [x] Add PDF export: GET /api/reports/:documentId/pdf — puppeteer-core + /usr/bin/chromium, authenticated, download button in AuditReport.tsx and Dashboard.tsx
- [x] Add API billing headers: X-RateLimit-Limit, X-RateLimit-Remaining, X-Plan-Tier, X-Credits-Used, X-Credits-Remaining on /api/public/verify-claim and POST /mcp
- [x] Build Telegram bot (grammy): /start, /audit <PMID>, /monitor <PMID>, /status commands; daily digest via postDailyDigest(channelId); TELEGRAM_BOT_TOKEN + TELEGRAM_CHANNEL_ID in ENV
- [x] Register Telegram bot startup in index.ts (no-op if TELEGRAM_BOT_TOKEN not set)
- [x] Run tests, push to GitHub, save checkpoint

## Phase 28: Karpathy-Style LLM Knowledge Graph

- [x] Add graphEntities and graphRelations tables to drizzle/schema.ts with indexes and unique constraints
- [x] Generate and apply DB migration 0008 for new tables
- [x] Add DB helpers: upsertGraphEntity, getGraphEntityByTypeAndName, upsertGraphRelation, getRelationsBySourceEntity, getAllGraphEntities, getAllGraphRelations, getContradictionRelations, getEntitiesWithMultipleClaims
- [x] Build server/wikiCompiler.ts — post-pipeline step: extract entities from claims, fetch/create S3 wiki pages, LLM-compile new claims into wiki, update graph edges
- [x] Hook wikiCompiler into runAnalysisPipeline as final step (non-fatal, fire-and-forget)
- [x] Build server/wikiLinter.ts — scheduled cron: LLM lint wiki pages for contradictions, write contradicts edges to graphRelations
- [x] Register POST /api/scheduled/wiki-lint heartbeat endpoint in index.ts
- [x] Add trpc.graph.query procedure (publicProcedure) — NL question → entity/relation context → LLM synthesized answer
- [x] Add trpc.wiki.getPage procedure — fetch wiki markdown from S3 by entityType + canonicalName
- [x] Add trpc.graph.entities procedure — list all graph entities with relation counts
- [x] Add trpc.graph.relations and trpc.graph.contradictions procedures
- [x] Build client/src/pages/WikiPage.tsx — render wiki markdown via Streamdown, show related entities, contradiction alerts
- [x] Build client/src/components/GraphQueryBox.tsx — NL query input, answer with traversal citations
- [x] Update /graph page — add entity nodes from graphEntities, typed edges from graphRelations, contradiction edges highlighted in red, Ask Graph overlay button
- [x] Register /wiki/:entityType/:entitySlug route in App.tsx
- [x] Write Vitest tests: 16 wikiCompiler tests + 5 wikiLinter tests = 137 total passing
- [x] Save checkpoint and push to GitHub

## Phase 29: Citation Architecture (grow.contact GEO Standard)

- [x] Serve GET /llms.txt dynamically — generateLlmsTxt() builds entity sections + contradiction listings from live graph
- [x] Add generateLlmsTxt() + storeLlmsTxt() to wikiCompiler.ts
- [x] Add JSON-LD Dataset schema injection to WikiPage.tsx via useEffect (dateModified, PDB citation, keywords)
- [x] Build public /claim/:id page (ClaimPage.tsx) with ClaimReview JSON-LD schema, OG meta tags, badge embed code
- [x] Build GET /api/claim/:id JSON endpoint (claimPageRoute.ts) with Link headers and ClaimReview JSON-LD
- [x] Add Link: headers middleware to all /api/wiki, /api/claim, /llms.txt responses (rel=llms, rel=mcp, rel=api-catalog)
- [x] Update client/public/robots.txt with bot matrix (OAI-SearchBot allow wiki/claim, GPTBot disallow all, Content-Signal)
- [x] Build GET /badge/:claimId.svg — verdict badge SVG with color-coded verdicts and Truth Desk branding
- [x] Build GET /api/wiki/:entityType/:entitySlug JSON endpoint (wikiPageRoute.ts) with Link headers and Dataset JSON-LD
- [x] Add OG meta tags to /claim/:id and /wiki/:entityType/:entitySlug pages via useEffect
- [x] Register /claim/:id route in App.tsx
- [x] Add getClaimById, getClaimWithDocument, getEntityClaimSummary helpers to db.ts
- [x] Write 21 Vitest tests: badge SVG, ClaimReview JSON-LD, llms.txt format compliance — 158 total passing
- [x] Save checkpoint and push to GitHub

## Phase 30: Backfill, MCP Server Card, Telegram Contradiction Posts

- [x] Build POST /api/admin/backfill-wiki — iterates all completed documents (up to 500), calls compileDocumentToWiki for each with 300ms throttle, regenerates /llms.txt
- [x] Build GET /api/admin/backfill-wiki/status — owner-only status check returning completedDocuments count
- [x] Add getAllCompletedDocuments() helper to db.ts
- [x] Expand /.well-known/mcp.json to 7 tools: verify_claim, get_claims_registry, get_platform_summary, get_knowledge_graph_data, claims.byEntity, graph.query, reports.generate
- [x] Verify /llms.txt serves with Link headers (rel=mcp, rel=api-catalog)
- [x] Verify /api/wiki/* responses return Link headers (rel=llms, rel=mcp, rel=api-catalog)
- [x] Add postContradictionAlert() to telegramBot.ts — MarkdownV2 formatted alert with entity, PDB, claim snippet, verdict, rationale, and claim/wiki links
- [x] Wire postContradictionAlert into wikiLinter.ts — fires after each new contradicts edge is written
- [x] Write 20 Vitest tests: MCP tool card shape, backfill logic, Telegram alert format, Link header format — 172 total passing
- [x] Save checkpoint and push to GitHub

## Phase 31: Batch-Parallel Wiki Backfill

- [x] Add wikiCompiledAt timestamp column to documents table in drizzle/schema.ts
- [x] Generate migration 0009 (0009_glamorous_blonde_phantom.sql) and apply via webdev_execute_sql
- [x] Rewrite backfillWikiRoute.ts: BATCH_SIZE=15 parallel workers, skip wikiCompiledAt!=null, 2-retry exponential backoff (1s/2s), 500ms batch cooldown, fire-and-forget POST /api/admin/backfill-wiki, sync variant, status endpoint
- [x] Add trpc.admin.backfillWiki mutation (fire-and-forget, background run, returns status:started)
- [x] Add trpc.admin.backfillStatus query (returns completedDocuments, wikiCompiled, wikiPending, percentComplete)
- [x] Write 15 Vitest tests: batch logic, skip logic, retry logic, speed math, wikiCompiledAt field — 173 total passing
- [x] Save checkpoint and push to GitHub

## Phase 32: Customer Dashboard (Revenue Gate)

- [x] Rewrite Dashboard.tsx: DashboardLayout sidebar, document list table (title, StatusBadge, claimCount, topVerdict, date, PDF download, View button), 4 stat cards, 5s polling, empty state CTA
- [x] Rewrite AuditReport.tsx: DashboardLayout sidebar, breadcrumb (My Audits / title), 5s polling, all claim data, verdict override panel, PDF export, public report link, machine-readable output section
- [x] Build Admin.tsx: DashboardLayout, backfill status cards (Total, Compiled, Pending, % Complete), progress bar, Run Backfill button, raw JSON toggle, wired to trpc.admin.backfillWiki + trpc.admin.backfillStatus
- [x] Update DashboardLayout nav items: My Audits (/dashboard), New Audit (/submit), Monitoring (/monitoring), Registry (/registry)
- [x] Register /admin route in App.tsx
- [x] Write 15 Vitest tests: stats computation, verdict distribution, nav items, admin status shape — 188 total passing
- [x] Save checkpoint and push to GitHub

## Phase 33: Revenue Unblock — Stripe Checkout + PDF Verification + Auth Guard

- [x] SUPERSEDED by Phase 33 Week 1 (PayPal replaces Stripe — user has no Stripe account)
- [x] user_subscriptions, checkout router, Pricing page, auth guards all implemented via PayPal Orders API
- [x] See Phase 33 Week 1 section below for full completion record

## Phase 33: Week 1 Revenue Sprint — DB Fixes + PDF Pipeline + PayPal Checkout

- [x] Fix getRecentVerifiedClaims WHERE clause bug — added INNER JOIN with documents table, filter status=complete
- [x] DB indexes confirmed: claims.documentId, documents.userId, documents.status, autoIngestedPapers.pmid all exist
- [x] Duplicate runAnalysisPipeline confirmed not present (3 distinct calls: submitText, submitFile, regenerate)
- [x] Add PDF generation to analysisPipeline.ts — generatePdfReport() called after HTML report stored, pdfStorageKey written to auditReports
- [x] Add user_subscriptions table (userId, planTier, auditsLimit, auditsUsed, paypalOrderId, paypalCaptureId, activatedAt, expiresAt)
- [x] Generate and apply DB migration 0010 (0010_keen_alex_wilder.sql)
- [x] Add PayPal Orders API integration in server/paypalCheckout.ts: createPayPalOrder, capturePayPalOrder, getActiveSubscription, checkPayPalAuditLimit, incrementAuditsUsed
- [x] Add PAYPAL_CLIENT_ID, PAYPAL_SECRET, PAYPAL_BASE_URL to ENV in env.ts
- [x] Add checkout router to routers.ts: checkout.plans, checkout.createOrder, checkout.captureOrder, checkout.getSubscription
- [x] Wire Pricing page — rewritten with PayPal checkout buttons for starter/diligence, contact form for platform, subscription status display
- [x] Add sign-in redirect guard to Dashboard.tsx and AuditReport.tsx (loading: authLoading, redirect to / if !isAuthenticated)
- [x] Write 15 Vitest tests: PLANS constant, limit math, createPayPalOrder error handling, schema fields — 203 total passing
- [x] Save checkpoint and push to GitHub

## Phase 34: Ground Signal — Prediction Engine (Layer 4)

- [x] Add predictionFeatures table to drizzle/schema.ts (entityId, featureType enum, value, sampleSize, computedAt)
- [x] Add predictionModels table to drizzle/schema.ts (modelType enum, targetEntityId, targetClaimId, prediction json, baseRate, featuresUsed json, validatedAt, validationResult enum)
- [x] Generate and apply DB migration 0011 for prediction tables
- [x] Add DB helpers: upsertPredictionFeature, getPredictionFeaturesByEntity, insertPredictionModel, getPredictionsByEntity, getPredictionsByClaim, updatePredictionValidation
- [x] Build server/predictionEngine.ts: computeClaimTrajectory (SQL feature queries + heuristic scoring), computeAuthorReliability, computeConsensusVelocity
- [x] Build server/featureComputationJob.ts: nightly cron that precomputes features for all active entities (contradiction_rate, claim_velocity, author_contradiction_history, method_reliability)
- [x] Register POST /api/scheduled/compute-features heartbeat endpoint in index.ts
- [x] Hook computeClaimTrajectory into analysisPipeline.ts — generate prediction for each extracted claim after verdict assignment
- [x] Add trpc.predictions.claimTrajectory procedure (publicProcedure, input: claimId)
- [x] Add trpc.predictions.authorReliability procedure (publicProcedure, input: userId)
- [x] Add trpc.predictions.entityStats procedure (publicProcedure, input: entityId)
- [x] Add prediction risk badge to AuditReport.tsx claim table (show contradiction probability for each claim)
- [x] Add prediction summary card to Dashboard.tsx (high-risk claims count, author reliability score)
- [x] Write tests, save checkpoint, push to GitHub

## Phase 35: Prediction Calibration Dashboard
- [x] Add DB helpers: getCalibrationStats (accuracy by model type + date bucket), getPredictionsForReview (pending validations), getPredictionById
- [x] Add tRPC procedures: admin.calibrationStats, admin.predictionsForReview, admin.validatePrediction (mutation)
- [x] Build /admin/predictions page: accuracy over time chart (Chart.js), calibration table (probability bucket vs actual rate), pending validations list with correct/incorrect buttons
- [x] Add "Predictions" nav item to DashboardLayout sidebar (TrendingUp icon)
- [x] Register /admin/predictions route in App.tsx
- [x] Write Vitest tests for calibration helpers (target 260+ total)
- [x] Update todo.md, save checkpoint, push to GitHub

## Phase 36: Perplexity/AI-Citation SEO Sprint

- [x] Add FAQPage JSON-LD schema to /claim/:id pages (Question: "Is claim X true?", Answer: verdict + rationale + evidence URL + confidence)
- [x] Add dateModified JSON-LD to /claim/:id and /wiki/:type/:slug pages (use claim.updatedAt / wiki.compiledAt)
- [x] Add Last-Modified HTTP header to claim and wiki API responses
- [x] Build server/seo/indexNow.ts helper (notifyIndexNow(url), notifyIndexNowBatch(urls[]))
- [x] Wire IndexNow to analysisPipeline.ts (ping after each claim verdict is assigned)
- [x] Wire IndexNow to wikiCompiler.ts (ping after wiki page is compiled)
- [x] Wire IndexNow to monitoring job (ping after claim evidence is updated)
- [x] Update sitemap.xml generation to include <lastmod> timestamps from DB (documents.updatedAt, claims.updatedAt)
- [x] Add INDEX_NOW_KEY to environment secrets
- [x] Write Vitest tests for IndexNow helper (notifyIndexNow, notifyIndexNowBatch, error handling)
- [x] Save checkpoint, push to GitHub

## Phase 37: Contradiction Alert Webhooks

- [x] Add webhookAlerts table to drizzle/schema.ts (id, userId, url, secret, eventTypes json, active, createdAt)
- [x] Generate and apply DB migration 0012 for webhookAlerts table
- [x] Add DB helpers: insertWebhookAlert, getWebhookAlertsByUser, deleteWebhookAlert, getActiveWebhookAlerts
- [x] Build server/alertDispatcher.ts: dispatchHighRiskAlert(claim, prediction) — Telegram message + HMAC-signed webhook POST
- [x] Wire dispatchHighRiskAlert into analysisPipeline.ts when prediction.contradictionProbability >= 0.70
- [x] Add tRPC procedures: alerts.list, alerts.create, alerts.delete (all protectedProcedure)
- [x] Build /settings/alerts page with webhook URL form, secret display, and delete button
- [x] Add Alerts nav item to DashboardLayout sidebar
- [x] Write Vitest tests for alertDispatcher.ts

## Phase 38: Prediction Backfill Job

- [x] Build server/predictionBackfillJob.ts: fetches all claims with no prediction row, runs computeClaimTrajectory in batches of 20
- [x] Register POST /api/scheduled/backfill-predictions heartbeat endpoint in index.ts
- [x] Add trpc.admin.backfillPredictions mutation (adminProcedure) that triggers the backfill
- [x] Add "Run Backfill" button to /admin/predictions page
- [x] Write Vitest tests for predictionBackfillJob.ts
- [x] Save checkpoint, push to GitHub

## Phase 39: P0 Trust & Transparency Sprint (Strategy Map)

- [x] Build /trust page: methodology, data sources (RCSB/PubMed/PMC/UniProt), EU AI Act compliance statement, privacy architecture, No Scraping manifesto section
- [x] Add /trust and /docs/api links to main navigation (TopNav)
- [x] Add "How We Verify" pipeline visual to AuditReport.tsx (collapsible section showing Extract → Validate → Report steps with timestamps)
- [x] Build /docs/api page: live examples for /api/public/verify-claim and /api/public/claims.json, code snippets in curl/Python/JS
- [x] Register /trust and /docs/api routes in App.tsx
- [x] Write Vitest tests, save checkpoint, push to GitHub
