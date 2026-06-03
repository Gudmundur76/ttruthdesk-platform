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
- [ ] Wire PayPal checkout on Pricing page — DEFERRED (PayPal connector OAuth needs to be authorized in Manus UI first) [NOT BLOCKING]
- [ ] Add PayPal order confirmation page/modal — DEFERRED [NOT BLOCKING]
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

- [ ] Audit current free LLM config (multiLLM.ts, env.ts) and vertical feed configs
- [ ] Optimise bulk seed: parallel pipeline workers, free LLM routing for all verticals, concurrency cap to avoid rate limits
- [ ] Trigger bulk seed for structural_biology and salmon_biotech via /api/admin/bulk-seed
- [ ] Run quality-pass job to re-process draft documents to verified tier
- [ ] Verify seeded documents appear in /registry and /graph
- [ ] Save checkpoint
