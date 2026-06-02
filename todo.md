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
- [ ] Wire PayPal checkout on Pricing page — DEFERRED (PayPal connector OAuth needs to be authorized in Manus UI first)
- [ ] Add PayPal order confirmation page/modal — DEFERRED
- [x] Save checkpoint

## Phase 13: Truth Desk Branding + Verticals Page

- [x] Update site title to "Truth Desk" (working name) in index.html, VITE_APP_TITLE, and TopNav logo
- [x] Update landing page hero copy to reflect multi-vertical platform vision
- [x] Update meta description and OG tags in index.html; add Space Grotesk + Inter fonts
- [x] Build /verticals page: two vertical cards (Structural Biology, Salmon Biotech) with live claim/doc counts, status badges, and "Request a new vertical" CTA; upcoming verticals section
- [x] Add tRPC procedure verticals.stats returning per-domain document and claim counts
- [x] Register /verticals route in App.tsx and add nav link to TopNav (first public nav item)
- [x] Save checkpoint (58 tests passing, TypeScript clean)
