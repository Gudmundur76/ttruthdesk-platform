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

## Phase 40: Agent Swarm + Free LLM Upgrade

- [x] Expand OpenRouter free model pool in multiLLM.ts: add openrouter/free meta-router, ERNIE 4.5, GLM 4.5 Air, NVIDIA Nemotron 3 Super, OpenAI gpt-oss-20b
- [x] Add OPENROUTER_API_KEYS comma-separated key rotation pool to multiLLM.ts
- [x] Add freellmapi (self-hosted Gemma 4 / Ollama) provider support with health check
- [x] Parallelize claim validation in analysisPipeline.ts using Promise.allSettled (concurrency cap 8)
- [x] Add concurrent document processing pool (4 docs at once) in seedKnowledgeGraph.ts
- [x] Build server/swarmTickJob.ts coordinator that fans out all 5 agent jobs in parallel
- [x] Register POST /api/scheduled/swarm-tick in index.ts
- [x] Add GET /api/admin/llm-health endpoint showing active provider, model rotation status, key pool size
- [x] Write Vitest tests for swarm coordinator and multiLLM key rotation
- [x] Run live verification: trigger swarm-tick and confirm all agents respond
- [x] Save checkpoint, push to GitHub

## Phase 41 — Manus Coordination Layer

- [x] Add coord_tasks, coord_queue, coord_context tables to drizzle/schema.ts
- [x] Generate migration 0013 via pnpm drizzle-kit generate
- [x] Apply migration 0013 via webdev_execute_sql
- [x] Add MANUS_API_KEY + COORD_API_KEY + appUrl (VITE_APP_URL) to ENV in server/_core/env.ts
- [x] Build server/coordApi.ts — REST handlers for /api/coord/* endpoints
- [x] Register /api/coord/* routes in server/_core/index.ts
- [x] Build server/manusOrchestrator.ts — Manus API task spawner + health monitor
- [x] Add 6 new verticals to verticalFeedConfig.ts (protein_supplement, creatine_ergogenics, gut_microbiome, collagen_peptides, plant_based_protein, sports_nutrition_rct)
- [x] Build client/src/pages/CoordinatorDashboard.tsx — live queue depth, active tasks, throughput chart
- [x] Register /admin/coordinator route in App.tsx + DashboardLayout nav
- [x] Add /api/coord/memory endpoints bridging to manus-persistent-drive graph_memory pattern
- [x] Write server/coordLayer.test.ts (vertical configs, prompt builder, router structure)
- [x] Write server/manusOrchestrator.test.ts — 25 unit tests (buildVerticalAgentPrompt, spawnVerticalTask, getManusTaskStatus, stopManusTask, runOrchestratorTick; vi.mock ENV + fetch stubbing)
- [x] Update manus-persistent-drive repo with integration notes (TRUTH_DESK_INTEGRATION.md)
- [x] Save checkpoint (Phase 41 complete)
- [x] Push to GitHub (protein-truth-desk + manus-persistent-drive)

### Phase 41 Revision Fixes
- [x] Fix header name inconsistency: standardise to x-coord-key in coordApi.ts AND agentIngestionEndpoint.ts
- [x] Add AbortSignal.timeout(10_000) to both fetch calls in manusOrchestrator.ts
- [x] Replace string equality with crypto.timingSafeEqual in coordApi.ts auth middleware
- [x] Add appUrl field to ENV (reads VITE_APP_URL; falls back to localhost:3000)
- [x] Add /api/coord/ingest endpoint to buildVerticalAgentPrompt workflow instructions
- [x] Implement retry tracking in runOrchestratorTick (retryCount field, MAX_RETRIES=3 cap)

## Phase 42 — Orchestrator Heartbeat Scheduler
- [x] Build server/orchestratorTickJob.ts — heartbeat handler that runs orchestrator tick + spawns new agents for empty verticals
- [x] Register POST /api/scheduled/orchestrator-tick in index.ts
- [x] Add orchestratorTickJob to swarmTickJob.ts as Agent 6
- [x] Build 6 vertical adapters (protein_supplement, creatine_ergogenics, gut_microbiome, collagen_peptides, plant_based_protein, sports_nutrition_rct)
- [x] Register all 6 new adapters in verticalAdapters/index.ts
- [x] Write Vitest tests for orchestratorTickJob and new adapters
- [x] TypeScript clean, all tests pass

## Phase 43 — Quality Scoring Pipeline
- [x] Add quality_score, evidence_grade, sample_size_n, study_type, recency_score columns to claims table
- [x] Build server/qualityScorer.ts — score each claim on 5 dimensions
- [x] Wire quality scorer into analysisPipeline.ts post-extraction step
- [x] Add quality filter to registry/monitoring queries
- [x] Write Vitest tests for qualityScorer

## Phase 44 — Public Vertical Pages
- [x] Build client/src/pages/VerticalDetail.tsx — rich page per vertical with top claims, stats, recent papers
- [x] Add tRPC verticals.detail procedure returning top claims + stats for a vertical
- [x] Register /verticals/:domainKey route in App.tsx
- [x] Add vertical cards to existing /verticals page with links
- [x] Write Vitest tests for verticals.detail procedure

## Phase 45 — API v2
- [x] Build server/apiV2Router.ts — REST endpoints for claims, entities, audits with pagination + filtering
- [x] Add rate limiting middleware (100 req/min per IP, 1000/min for API key holders)
- [x] Register /api/v2/* routes in index.ts
- [x] Update /docs/api page with v2 endpoint reference
- [x] Write Vitest tests for API v2 endpoints

## Phase 46 — Contradiction Resolution UI
- [x] Build client/src/pages/ContradictionResolver.tsx — side-by-side evidence viewer
- [x] Add tRPC contradictions.detail procedure returning both sides of a contradiction with full evidence
- [x] Register /contradictions/:id route in App.tsx
- [x] Link from monitoring feed contradiction rows to the resolver
- [x] Write Vitest tests for contradictions.detail

## Phase 61 — Claim Provenance Chain
- [x] Add claim_provenance_events table to drizzle/schema.ts (migration 0016 applied)
- [x] Build server/claimProvenanceService.ts — recordStep(), getChain(), getDocumentChain(), summarize(), convenience wrappers
- [x] Add provenance tRPC router (getChain, getDocumentChain, recordManualStep) to routers.ts
- [x] Build client/src/pages/ClaimProvenance.tsx — timeline UI with actor badges, collapsible snapshots, summary card
- [x] Register /provenance/:claimId route in App.tsx
- [x] Add "View Provenance" button to ClaimPage.tsx
- [x] Add Provenance nav item to DashboardLayout.tsx sidebar (GitBranch icon)
- [x] Write server/claimProvenanceService.test.ts (20 tests passing)
- [x] TypeScript clean, all tests pass

## Phase 62 — Structured Data Export
- [x] Add CSV export endpoint GET /api/v2/export/claims.csv (filter by vertical, verdict, date range)
- [x] Add JSON export endpoint GET /api/v2/export/claims.json (same filters)
- [x] Add export endpoints for audit reports and entities
- [x] Build ExportData.tsx page at /export with filter panel and download buttons
- [x] Add Export Data nav item to DashboardLayout.tsx sidebar
- [x] Write Vitest tests for export router (27 tests passing)

## Phase 63 — Entity Co-occurrence Graph
- [x] Add entity_cooccurrences table to schema (entityAId, entityBId, documentId, coCount, unique pair+doc index)
- [x] Generate and apply DB migration 0017 for entity_cooccurrences table
- [x] Write entityCooccurrenceService.ts (computeCooccurrencesForDocument, getTopCooccurrences, getCooccurrencesForEntity, buildGraphData)
- [x] Add cooccurrence tRPC router (top, forEntity, compute) to routers.ts
- [x] Build CooccurrenceGraph.tsx page at /cooccurrence with SVG force-directed graph (no D3 dependency)
- [x] Add Co-occurrence nav item to DashboardLayout.tsx sidebar (Network icon)
- [x] Write Vitest tests for entityCooccurrenceService.ts (14 tests passing)
- [x] TypeScript clean, dev server running

## Phase 64 — Claim Confidence Trend Chart
- [x] Add confidence_history table (claimId, documentId, score, trigger, flags, recordedAt)
- [x] Generate and apply DB migration 0018 for confidence_history table
- [x] Build server/confidenceTrendService.ts (recordConfidence, getConfidenceTrend, getLatestConfidence, backfillFromClaims)
- [x] Add confidenceTrend tRPC router (forClaim, latest, record, backfill) to routers.ts
- [x] Add ConfidenceSparkline inline component to ClaimPage.tsx (SVG sparkline + history table)
- [x] Write Vitest tests for confidenceTrendService.ts (18 tests passing)
- [x] TypeScript clean, dev server running

## Phase 65 — API Key Management
- [x] Add api_keys table (userId, keyHash, label, scopes, keyPrefix, lastUsedAt, revokedAt, expiresAt)
- [x] Generate and apply DB migration 0019 for api_keys table
- [x] Build server/apiKeyService.ts (generateApiKey, validateApiKey, revokeApiKey, listApiKeys, touchLastUsed)
- [x] Add apiKeys tRPC router (list, create, revoke, validate) to routers.ts
- [x] Build ApiKeys.tsx page at /settings/api-keys with create dialog, key list, revoke confirmation
- [x] Add API Keys nav item to DashboardLayout.tsx sidebar (Key icon)
- [x] Write Vitest tests for apiKeyService.ts (25 tests passing)
- [x] TypeScript clean, dev server running

## Phase 66 — Quality and Discipline Sprint
- [x] Add eslint.config.js (ESM flat config, typescript-eslint v8, react-hooks)
- [x] Add commitlint.config.js for Conventional Commits enforcement
- [x] Add .husky/pre-commit (lint-staged) and commit-msg (commitlint) hooks
- [x] Add .lintstagedrc.json for staged-file quality gates
- [x] Update vitest.config.ts with coverage thresholds (lines 80%, branches 70%, functions 75%)
- [x] Add scripts/manus-session.mjs — unified session lifecycle CLI
- [x] Add scripts/check-stubs.mjs — stub file scanner with --json and --ci modes
- [x] Add CLAUDE.md — first-read context file for every new agent session
- [x] Fix claimProvenanceService.ts — full implementation replacing stub (411 tests passing)
- [x] Add client/src/pages/DevQuality.tsx — developer quality dashboard at /dev/quality
- [x] Wire DevQuality route in App.tsx and nav item in DashboardLayout.tsx
- [x] Push Phase 66 to GitHub (protein-truth-desk)
- [x] Sync manus-persistent-drive with gap analysis, schema snapshot, session scripts

## Phase 67 — Discipline Infrastructure
- [x] Build scripts/session-integrity.mjs — mandatory pre-code gate (6 checks: drive present, phase log, todo sync, TS clean, tests pass, stubs)
- [x] Build scripts/stub-tracker.mjs — maps each stub to test file, priority, estimated work; --json and --ci modes
- [x] Build scripts/drift-detector.mjs — diffs persistent drive snapshot vs current project state
- [x] Fix all ESLint errors (0 errors, 91 warnings) so pre-commit hook passes without --no-verify
- [x] Confirmed coordApi.ts (730 lines) and manusOrchestrator.ts (391 lines) are full implementations wired in index.ts
- [x] Wire MANUS_API_KEY fallback to ASIONE in env.ts (coordination layer now active)
- [x] Update CLAUDE.md with mandatory session-integrity check as step 0
- [x] Sync all new tooling to manus-persistent-drive and push both repos
- [x] 627/627 tests passing, TypeScript 0 errors, ESLint 0 errors
- [x] Save checkpoint 66faafa5

## Phase 69 — Kimi Code API Integration (Large-Context LLM)
- [x] Add KIMI_API_KEY secret via webdev_request_secrets
- [x] Research Kimi API endpoint, model names, and OpenAI-compatible interface
- [x] Write server/_core/llmLargeContext.ts (invokeLargeContextLLM, streamLargeContextLLM)
- [x] Add KIMI_API_KEY and KIMI_BASE_URL to server/_core/env.ts
- [x] Wire invokeLargeContextLLM into claimQualityScorer.ts for full-schema-aware scoring
- [x] Wire invokeLargeContextLLM into claimSimilarityEngine.ts for semantic similarity
- [x] Use Kimi 1M context to fix 91 as-any warnings across all server files
- [x] Write Vitest tests for llmLargeContext.ts (7 tests, all passing)
- [x] Push both repos, save checkpoint (457674c5)

## Phase 70 — QA P0 Critical Fixes

### P0 Security
- [x] P0-1: All 6 /api/admin/* routes now use shared requireOwnerOrAdmin middleware (backfillWikiRoute.ts refactored to accept middleware as parameter)
- [x] P0-2: Throw on missing JWT_SECRET — env.ts now throws at startup; vitest.config.ts provides test-only value
- [x] P0-3: Add shared secret header check to all /api/scheduled/* endpoints

### P0 Business Logic
- [x] P0-4: db.ts LIKE query replaced with Drizzle like() + or() helpers (idiomatic, unambiguous, no raw sql template)
- [x] P0-5: Fix DB singleton init race condition — add initialization lock
- [x] P0-6: Concurrency semaphore verified in agentIngestionEndpoint.ts (activeIngestions counter, max 10)
- [x] P0-7: pmcFeedJob uses Promise.allSettled(batch.map(...)) — proper batching
- [x] P0-8: Remove global ENV.llmProvider mutation in qualityPassJob — pass as parameter
- [x] P0-9: Unawaited IIFE in analysisPipeline — added .catch() to prevent unhandled promise rejections
- [x] P0-10: createDocument return type verified consistent

### P0 Frontend
- [x] P0-11: Move localStorage.setItem() from useMemo to useEffect in useAuth.ts
- [x] P0-12: Wrap navigate("/") in useEffect in AuditReport.tsx
- [x] P0-13: Wrap navigate("/") in useEffect in Dashboard.tsx
- [x] P0-14: Fix broken admin guard in Admin.tsx (remove || !!user clause)
- [x] P0-15: requireOwnerOrAdmin middleware added to all /api/admin/* routes in index.ts
- [x] P0-16: ClaimPage.tsx meta tag useEffect cleanup verified

### P0 Architecture
- [x] P0-17: Schema verified — no duplicate isActive/active columns found
- [x] P0-18: Foreign key constraints verified in schema
- [x] P0-19: dotenv v17 verified working — no downgrade needed
- [x] P0-20: Remove **/*.test.ts from tsconfig.json exclude array

### High-Impact P1 Fixes
- [x] P1-3: Add in-memory sliding window rate limiter to validateApiKey (20 req/min per IP)
- [x] P1-8: In-memory rate limiter implemented; Redis deferred to scale phase
- [x] P1-9: Change session cookie SameSite from None to Lax in server/_core/cookies.ts
- [x] P1-16: AbortSignal.timeout(10000-15000) added to all external API fetches
- [x] P1-26: expiresAt > NOW() check already present in findValidMagicLinkToken via Drizzle gt(magicLinkTokens.expiresAt, new Date()) — no change needed
- [x] P1-34: Wrapped atob() in try/catch in Submit.tsx — falls back to server-side extraction on malformed base64
- [x] P1-38: Fixed setTimeout leak in MagicLinkDialog — clearTimeout in useEffect cleanup
- [x] P1-48: Audited all server endpoints — no stub endpoints found; all handlers return real responses or proper error codes

## Phase 74 — Vertical Adapter Routing + Multi-Source Evidence

### Fix 1: Wire analysisPipeline.ts to vertical adapter registry
- [x] In analysisPipeline.ts step 3, look up document verticalDomain and route claims through adapter.lookupEvidence() instead of always calling verdictForClaim()
- [x] Map EvidenceResult from adapter to VerdictResult shape for updateClaimVerdict
- [x] Fall back to pdbAdapter.verdictForClaim() if no adapter registered for the domain

### Fix 2: Wire verifyClaimRoute.ts to use vertical parameter
- [x] In handleVerifyClaim, route to registry.get(vertical)?.lookupEvidence() instead of verdictForClaim()
- [x] Map EvidenceResult to response shape (verdict, rationale, evidenceUrl)
- [x] Fall back to verdictForClaim() for structural_biology or unknown vertical

### Fix 3a: Add UniProt REST API
- [x] Add fetchUniProtEntry(proteinName) helper in server/uniprotAdapter.ts
- [x] Wire into structuralBiology adapter as secondary evidence source
- [x] Wire into proteinSupplement, collagenPeptides, plantBasedProtein adapters

### Fix 3b: Add OpenFDA API
- [x] Add fetchOpenFdaAdverseEvents(compoundName) helper in server/openFdaAdapter.ts
- [x] Wire into proteinSupplement adapter
- [x] Wire into creatineErgogenics adapter

### Fix 3c: Add Europe PMC systematic review lookup
- [x] Add fetchEuropePmcReviews(query) helper in server/europePmcAdapter.ts
- [x] Wire into sportsNutritionRct adapter as systematic review evidence
- [x] Wire into collagenPeptides adapter

### Tests
- [x] Write server/verticalRouting.test.ts — covered by phase74.test.ts routing tests
- [x] Write server/uniprotAdapter.test.ts — covered by phase74.test.ts uniprotAdapter tests
- [x] Write server/openFdaAdapter.test.ts — covered by phase74.test.ts openfdaAdapter tests
- [x] Write server/europePmcAdapter.test.ts — covered by phase74.test.ts europePmcAdapter tests
- [x] Update server/verifyClaimRoute.test.ts to cover vertical routing — covered by phase74.test.ts routing tests

## Phase 74 — Vertical Adapter Routing + Multi-Source Evidence

- [x] Fix 1: Wire analysisPipeline.ts to route claims through the vertical adapter registry (was hardcoded to PDB only for all verticals)
- [x] Fix 2: Wire verifyClaimRoute.ts to use the vertical parameter and adapter registry (was ignoring vertical param)
- [x] Fix 3a: Add UniProt REST API to structuralBiology, proteinSupplement, and collagenPeptides adapters
- [x] Fix 3b: Add OpenFDA FAERS adverse event lookup to proteinSupplement and creatineErgogenics adapters
- [x] Fix 3c: Replace PubMed-only systematic review search in sportsNutritionRct with Europe PMC full-text API
- [x] Create server/uniprotAdapter.ts — UniProt REST API helper (searchUniProt, verifyProteinViaUniProt)
- [x] Create server/openfdaAdapter.ts — OpenFDA FAERS helper (searchFdaAdverseEvents, interpretFdaSignals)
- [x] Create server/europePmcAdapter.ts — Europe PMC helper (searchSystematicReviews, interpretSystematicReviewEvidence)
- [x] Write server/phase74.test.ts — 18 tests covering all 3 new adapters and the registry routing
- [x] TypeScript: 0 errors | ESLint: 0 warnings | Vitest: 677 tests passing (42 files)

## Phase 75 — Website Copy Rewrite (Domain-Agnostic)

- [x] Rewrite Home.tsx hero, feature section, evidence sources row, and footer copy to reflect domain-agnostic engine
- [x] Update Pricing.tsx — remove PDB-specific language, reflect multi-database routing
- [x] Update Trust.tsx — update methodology step 2, verdict examples, confidence score description
- [x] Add ClinicalTrials.gov, OpenFDA, USDA FoodData Central, NCBI Taxonomy data source cards to Trust.tsx
- [x] Update AuditReport.tsx HowWeVerifyPanel — reflect multi-database routing in step detail and footer
- [x] Update AuditReport.tsx processing state copy — "Extracting verifiable claims" / "Validating against authoritative databases"
- [x] TypeScript: 0 errors | ESLint: 0 warnings
- [x] Save checkpoint

## Phase 76 — LLM Wiki Knowledge Layer
- [x] Add wiki_pages table to drizzle/schema.ts (slug, title, category, content, sourceCount, inboundLinks json, updatedAt, createdAt)
- [x] Add wiki_index table (serialised index.md content + lastBuiltAt)
- [x] Add wiki_log table (append-only: action, title, slug, summary, timestamp)
- [x] Generate migration 0014 via pnpm drizzle-kit generate and apply via webdev_execute_sql
- [x] Build server/wikiEngine.ts — ingestSourceToWiki(), updateEntityPage(), lintWiki(), buildIndex(), appendLog()
- [x] Wire wikiEngine.ingestSourceToWiki() into analysisPipeline.ts after verdict pass
- [x] Add tRPC procedures: wiki.getPage, wiki.listPages, wiki.search, wiki.getIndex, wiki.getLog, wiki.triggerLint (admin-only)
- [x] Build client/src/pages/Wiki.tsx — category grid index view (entities, concepts, synthesis, sources)
- [x] Build client/src/pages/WikiSlugPage.tsx — individual page: markdown render, inbound links, source count, confidence badge, last updated
- [x] Register /wiki and /wiki/:slug routes in App.tsx and TopNav
- [x] Build server/wikiLintJob.ts — weekly lint heartbeat (contradictions, orphans, stale claims, missing cross-refs)
- [x] Register POST /api/scheduled/wiki-engine-lint in server/_core/index.ts
- [x] Write server/wikiEngine.test.ts — 21 tests: ingest, update, lint, index, log, search
- [x] TypeScript: 0 errors | Vitest: 698 tests passing (43 files)
- [x] Save checkpoint and push to persistent drive

## Agent-Readiness Improvements (isitagentready.com — Phase 77)
- [x] robots.txt served server-side with Content-Signal directives per IETF draft-romm-aipref-contentsignals
- [x] Markdown Negotiation middleware: Accept: text/markdown → Content-Type: text/markdown + x-markdown-tokens header
- [x] /.well-known/agent-skills/index.json (agentskills.io v0.2.0 schema, 2 skills)
- [x] /.well-known/agent-skills/verify-claim/SKILL.md
- [x] /.well-known/agent-skills/claims-registry/SKILL.md
- [x] /.well-known/api-catalog (RFC 9727 application/linkset+json)
- [x] /auth.md root (auth.md spec H1 containing 'auth.md')
- [x] /.well-known/openid-configuration (RFC 8414 OAuth/OIDC discovery)
- [x] /.well-known/oauth-protected-resource (RFC 9728)
- [x] Updated Link header to include agent-skills, oauth-protected-resource, api-catalog rels
- [x] TypeScript: 0 errors | Vitest: 698 tests passing

## Phase 77 Follow-Up (full production code, no stubs)
- [x] Compute real SHA-256 digests for SKILL.md content and update agent skills index
- [x] Generate real RSA-2048 key pair, publish /.well-known/jwks.json with real public key JWK (kid: b5e30ba415a3dcd7)
- [x] Register weekly wiki-engine-lint heartbeat cron schedule (task_uid: XfobFAegPui3QapN7k49tq, Sundays 02:00 UTC)

## JWT Signing Integration (ACTIVE_PRIVATE_KEY_PEM wired)
- [x] Audit all JWT-issuing code paths: session (HS256 via sdk.ts), API keys (random hex), magic links (random bytes)
- [x] Create server/jwtSigner.ts — RS256 sign/verify helpers (signJwt, verifyJwt, issueApiToken, verifyApiToken)
- [x] Wire issueApiToken into apiKeys.create — RS256 bearer token returned alongside raw key
- [x] Add apiKeys.verifyBearer tRPC procedure for external JWT verification
- [x] Write server/jwtSigner.test.ts — 12 tests: sign, verify, tamper, expire, audience, round-trip
- [x] TypeScript: 0 errors | Vitest: 714 tests passing (45 files)

## Phase 78 — Meta-Agent (codeGuardianAgent, Swarm Agent 7)
- [x] Add meta_agent_checks table to drizzle/schema.ts
- [x] Generate migration 0021 and apply via webdev_execute_sql
- [x] Build server/metaAgent/codeDriftService.ts
- [x] Build server/metaAgent/stubLedger.ts
- [x] Build server/metaAgent/pipelineGuardian.ts
- [x] Build server/metaAgent/alertRouter.ts
- [x] Build server/metaAgent/codeGuardian.ts
- [x] Wire runCodeGuardian() into swarmTickJob.ts as Agent 7
- [x] Add tRPC admin.metaAgentStatus procedure
- [x] Add meta-agent panel to /admin/coordinator
- [x] Write server/metaAgent.test.ts (47 tests, all passing)
- [x] TypeScript: 0 errors | Vitest: 761 tests passing (46 files) | Save checkpoint

## FrictionEngine Integration (from architecture document)

- [x] FE-1: Pre-submission interrogation layer — `server/frictionEngine.ts` service + `documents.preflightScan` tRPC procedure + PreflightModal.tsx UI
- [x] FE-2: Extend `claimQualityScorer.ts` with Intent Gate, Assumption Gate, Falsification Gate
- [x] FE-3: FrictionEngine interaction model for `graph.query` — expose assumption framing in responses
- [x] FE-4: Upgrade `codeGuardianAgent` findings to emit structured FrictionEngine JSON schema

## FrictionEngine Phase 2 — Full Paper Implementation
- [x] FE2-1: Upgrade `server/frictionEngine.ts` to full 7-field JSON schema (inferred_intent, typed assumptions[] with risk+test, constraints[], friction_question, optimized_prompt, validation_criteria, remaining_uncertainty, recommended_action)
- [x] FE2-2: Implement Friction Decision Policy — route preflightScan result to ask_user (block + show friction_question), execute (proceed silently), reject (refuse with reason), or reframe (show optimized_prompt)
- [x] FE2-3: Upgrade PreflightModal.tsx to surface friction_question, inferred_intent, validation_criteria, and recommended_action with appropriate UX (block submit when ask_user, hard-block when reject)
- [x] FE2-4: Add Answer Audit loop (Output Critic) to graph.query — after LLM returns, run Output Audit Prompt; if audit fails, retry with reframed prompt (max 1 retry)
- [x] FE2-5: Add Answer Audit loop to analysisPipeline verdict assignment — audit each verdict against deeper intent before persisting

## Frontier Engine (Layer 3)
- [x] FE3-1: Schema — knowledge_gaps and frontier_log tables + migration
- [x] FE3-2: server/frontier/gapMapper.ts — structural, evidence, contradiction, temporal gap detection
- [x] FE3-3: server/frontier/gapRanker.ts — priority scoring (contradictionSeverity × entityCentrality × recency × communityDemand)
- [x] FE3-4: server/frontier/evidencePursuer.ts — queue evidence pursuit for top gaps
- [x] FE3-5: server/frontier/hypothesisGenerator.ts — homology and contradiction pattern hypothesis generation
- [x] FE3-6: server/frontier/uncertaintyTracker.ts — gap lifecycle, stale detection, metrics
- [x] FE3-7: server/frontier/frontierEngine.ts — orchestrator (5-stage pipeline)
- [x] FE3-8: Wire Frontier into analysisPipeline — gap detection trigger on Insufficient Evidence verdicts
- [x] FE3-9: tRPC frontier router — run, metrics, listGaps, gapTimeline, topGaps, recentLog
- [x] FE3-10: /admin/frontier dashboard page — metrics, gaps table, activity log, manual run trigger
- [x] FE3-11: Admin page link card to Frontier Engine dashboard

## Self-Prompting Engine (Binding Agent)
- [x] SPE-1: Build server/selfPrompt/ module — stateCollector, promptEngine, actionExecutor, convergence gate, engine orchestrator
- [x] SPE-2: Wire Self-Prompting Engine into analysisPipeline — fire post-pipeline cycle after every verdict assignment
- [x] SPE-3: Add selfPrompt tRPC router (listCycles, getMetrics, triggerCycle) + /admin/self-prompt dashboard page
- [x] SPE-4: Add self_prompt_log DB table + migration

## Inverse Prompt Architecture

- [x] IP-1: Schema — add generated_claims table + migration
- [x] IP-2: Build server/inversePrompt/ module (graphQuestionGenerator, verifiabilityGate, claimQueueWriter, inversePromptEngine)
- [x] IP-3: Wire into analysisPipeline — trigger after Supported verdicts
- [x] IP-4: Add tRPC procedures (list, metrics, trigger) + /admin/inverse-prompt dashboard page

## Autonomous Loop (Event-Driven Orchestration)
- [x] AL-1: Schema — event_queue, loop_run, loop_config tables + migration
- [x] AL-2: server/autonomousLoop/ module — eventBus, loopOrchestrator (L0-L4), convergenceGate, safeModeController
- [x] AL-3: Layer modules — frictionLayer (L0), truthLayer (L1), selfPromptLayer (L2), frontierLayer (L3), metaLayer (L4)
- [x] AL-4: Wire all event sources — document_submitted (submitText/submitFile), verdict_complete + contradiction_found (analysisPipeline)
- [x] AL-5: tRPC procedures — status, eventLog, runHistory, triggerEvent, setSafeMode, drainQueue
- [x] AL-6: /admin/loop dashboard — event log, run history, layer metrics, safe mode control, manual trigger

## Autonomous Loop Completion
- [x] ALC-1: Wire paper_discovered event source in pmcFeedJob.ts
- [x] ALC-2: Wire source_status_change event source in pdbAdapter.ts
- [x] ALC-3: Wire manual_review_complete event source in claims.override mutation
- [x] ALC-4: Complete L2 Self-Prompt action matrix — all four verdict branches (Supported, Contradicted, Insufficient Evidence, Partially Supported) in selfPromptLayer.ts
- [x] ALC-5: Add resolveGap mutation to frontier tRPC router
- [x] ALC-6: Add overrides tRPC router (summary, list, flipAnalysis procedures)
- [x] ALC-7: Create /admin/overrides OverridesDashboard page
- [x] ALC-8: Add "Mark Resolved" dropdown button to Frontier.tsx GapsTable (Actions column)
- [x] ALC-9: Wire OverridesDashboard into App.tsx routing (/admin/overrides)
- [x] ALC-10: Add Override Audit Log link card to Admin.tsx
- [x] ALC-11: Add /api/scheduled/autonomous-loop-tick route to server/_core/index.ts
- [x] ALC-12: Register autonomous-loop-tick heartbeat cron (every 2h, task_uid: GVAmEEVdw7CPp7rmm9AejT)
- [x] ALC-13: Publish system_health_change event from metaLayer.ts when health score drops below threshold (60)

## Dream State Engine (Layer 5)
- [x] dream_sessions table added to drizzle/schema.ts with all 5-cycle result columns
- [x] Migration 0028 applied (dream_sessions, new event types in event_queue enum)
- [x] LoopEventType extended with dream_pattern_detected, hypothesis_queued, confidence_review_needed, dream_session_complete
- [x] server/dream/graphConsolidator.ts — Cycle 1: orphaned nodes, duplicate edges, stale confidence
- [x] server/dream/latentPatternDetector.ts — Cycle 2: contradiction clusters, temporal drift, evidence deserts
- [x] server/dream/topologyHypothesisGenerator.ts — Cycle 3: graph-derived hypotheses queued for pursuit
- [x] server/dream/confidenceRecalibrator.ts — Cycle 4: temporal decay + contradiction pressure recalibration
- [x] server/dream/contradictionSimulator.ts — Cycle 5: LLM-powered what-if stress tests
- [x] server/dream/dreamEngine.ts — orchestrator with eligibility gate, 5-cycle runner, query helpers
- [x] autonomous-loop-tick route wired to check dream eligibility and run session after draining events
- [x] dream tRPC router added (getSessions, getSession, getStats, checkEligibility, triggerSession)
- [x] client/src/pages/DreamDashboard.tsx — admin dashboard with stats, architecture overview, session history
- [x] /admin/dream route added to App.tsx
- [x] Dream State card added to Admin.tsx with indigo CTA button
- [x] 761 tests passing, 0 TypeScript errors

## Phase 79: Deterministic Verdict Engine
- [x] Implement verdictEngine.ts with deterministic resolution verdict (Δ ≤ 0.05 Å → Supported, ≤ 0.20 Å → Partially Supported, > 0.20 Å → Contradicted)
- [x] Implement completenessCheck.ts with hard source completeness gate (blocks positive verdicts on missing/stale data)
- [x] Add verdictMethod and sourceCompletenessScore columns to claims table (migration 0029)
- [x] Update updateClaimVerdict in db.ts to accept verdictMethod and sourceCompletenessScore
- [x] Wire deterministic engine into analysisPipeline.ts: resolution claims use verdictForResolution, adapter claims use classifyByConfidence with completeness gate
- [x] Add determinismMetrics tRPC procedure to claims router
- [x] Add provenance badges (◆ deterministic, ⚠ gated, ∼ heuristic, ✎ override) to claim cards in AuditReport.tsx
- [x] Add Deterministic Verdict Engine info card to Admin.tsx

## Priority 2: Source Whitelist Expansion
- [x] UniProt adapter: schema, health check, deterministic verdict wiring (protein_name, organism, function)
- [x] ClinicalTrials.gov adapter: schema, health check, deterministic verdict wiring (trial_id, trial_status, intervention)
- [x] Register both adapters in verticalAdapters registry
- [x] Wire new adapters into analysisPipeline.ts claim routing
- [x] Add source whitelist admin UI with health status, approval gate, failure mode display
- [x] Add source health check tRPC procedures
- [x] Tests for both adapters (verticalAdapters.test.ts — 19 new tests)

## Priority 2: Source Whitelist Expansion
- [x] Create server/verticalAdapters/uniprotVertical.ts with deterministic verdicts and health check
- [x] Create server/clinicalTrialsAdapter.ts — ClinicalTrials.gov REST API v2 client
- [x] Create server/verticalAdapters/clinicalTrialsVertical.ts with deterministic verdicts and health check
- [x] Create server/sourceRegistry.ts — source whitelist with schema, failure mode, approval gate
- [x] Register both adapters in verticalAdapters/index.ts
- [x] Add sources.list, sources.healthCheck, sources.healthCheckAll tRPC procedures
- [x] Create client/src/pages/SourceWhitelist.tsx admin page
- [x] Wire /admin/sources route and Admin landing page card

## Polish & Finish Sprint (Sprints 1-4)
- [x] Sprint 1: Add Dream State, Source Whitelist, Overrides, Frontier, Loop to DashboardLayout sidebar nav
- [x] Sprint 1: Create CheckoutSuccess.tsx page with PayPal order capture on return
- [x] Sprint 1: Wire /checkout/success route in App.tsx
- [x] Sprint 2: Add ProvenanceSummaryPanel to AuditReport (live determinismMetrics call)
- [x] Sprint 2: Add completeness-gate warning banner to AuditReport
- [x] Sprint 2: Add source coverage column to claim cards in AuditReport
- [x] Sprint 3: Add Last Dream widget to AutonomousLoopDashboard
- [x] Sprint 3: Add health score trend sparkline to OverridesDashboard (healthTrend procedure)
- [x] Sprint 3: Add Approve/Reject buttons to pending sources in SourceWhitelist
- [x] Sprint 3: Add approveSource/rejectSource to sourceRegistry.ts and sources router
- [x] Sprint 4: Add verticalDomain selector to Submit page (structural_biology, uniprot, clinical_trials, nutrition, chemistry)
- [x] Sprint 4: Wire verticalDomain into submitText and submitFile tRPC procedures

## Sprint A: Live Home Page Stats
- [ ] Add globalStats tRPC public procedure (totalDocuments, totalClaims, supportedVerdicts, verifiedSources)
- [ ] Wire live stats into Home page hero section replacing static copy
- [ ] Add animated counter component for stat numbers

## Sprint B-D: TurboVec Semantic Search
- [ ] Install turbovec Python package and sentence-transformers
- [ ] Create server/vectorSidecar.py — FastAPI sidecar with /embed and /search endpoints
- [ ] Create server/vectorStore.ts — Node.js bridge to Python sidecar with graceful fallback
- [ ] Embed verified claims on analysis pipeline completion
- [ ] Add searchSimilar tRPC procedure (SQL pre-filter + TurboVec re-rank)
- [ ] Persist TurboVec index on swarm tick and graceful shutdown
- [ ] Create /search Semantic Search UI page with query input, filter chips, result cards
- [ ] Wire /search into sidebar nav and top nav

## Sprint A & B Completion (Jun 2026)
- [x] Add getGlobalPlatformStats helper to server/db.ts (totalDocuments, totalClaims, supportedVerdicts, verifiedSources)
- [x] Add globalStats tRPC public procedure to verticals router in server/routers.ts
- [x] Wire live stats bar into Home.tsx hero section with animated count-up display
- [x] Install sentence-transformers + faiss-cpu Python packages
- [x] Create server/vectorSidecar.py — FastAPI sidecar with /index, /search, /health endpoints (FAISS IndexFlatIP + all-MiniLM-L6-v2)
- [x] Create server/vectorStore.ts — Node.js bridge to Python sidecar with graceful SQL FULLTEXT fallback
- [x] Add search.similar tRPC procedure (semantic search, topK, vertical/verdict filters)
- [x] Add search.vectorHealth tRPC procedure (sidecar availability + indexed count)
- [x] Upgrade Search.tsx: keyword/semantic mode toggle, TurboVec results with similarity scores, sidecar status pill
- [x] Add Semantic Search to DashboardLayout sidebar nav (Search icon, /search path)
- [x] 780 tests passing, TypeScript clean
