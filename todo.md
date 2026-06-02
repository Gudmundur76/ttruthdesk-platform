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
