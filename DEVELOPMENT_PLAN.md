# Development Plan — citation.is + ttruthdesk.claims

**Prepared:** June 11, 2026  
**Author:** Manus AI  
**Repositories:** [citation-desk](https://github.com/Gudmundur76/citation-desk) (frontend) · [protein-truth-desk](https://github.com/Gudmundur76/protein-truth-desk) (backend engine)  
**Current State:** Backend Phase 108 complete · 1,119 tests passing · Frontend 7 pages live with CopilotKit AI assistant

---

## 1. Architecture Overview

The product is a two-repository system with a clean separation of concerns.

| Layer | Repository | Domain | Technology |
|---|---|---|---|
| **Public Frontend** | `citation-desk` | `citation.is` | React 19 + Vite + Tailwind v4 + CopilotKit + TanStack Query |
| **Backend Engine** | `protein-truth-desk` | `ttruthdesk.claims` | Express + tRPC + Drizzle ORM + MySQL + 14 heartbeat cron jobs |

The frontend calls the backend exclusively through the public tRPC API at `https://ttruthdesk.claims/api/trpc`. No auth is required for public procedures. The backend handles all claim extraction, database validation, composite truth scoring, knowledge graph maintenance, and the autonomous re-evaluation loop. The frontend's role is to make that engine's output visible, searchable, and commercially accessible to the world.

The CopilotKit AI assistant is already wired: `CitationCopilot.tsx` feeds live stats, vertical data, and leaderboard rankings into the assistant's context via `useCopilotReadable`, and `server.ts` runs a `ManusLLMAgent` on port 3001 that proxies to the LLM. The assistant answers questions about the knowledge base in real time.

---

## 2. What Is Already Built

### 2.1 Backend Engine (ttruthdesk.claims) — Phase 108 Complete

The engine is production-quality. The 8-stage analysis pipeline, 14 autonomous heartbeat cron jobs, 55-table knowledge graph, contradiction detection engine, composite truth scoring, citation chain analysis, and the full admin intelligence layer are all complete and tested.

**Core engine capabilities:**

| Capability | Status |
|---|---|
| 8-stage analysis pipeline (extract → entity resolve → DB validate → friction → completeness gate → citation chain → composite truth → graph edges) | ✅ Complete |
| Primary database validation (RCSB PDB, UniProt, PubChem, PubMed) | ✅ Complete |
| Citation chain distortion scoring | ✅ Complete |
| Composite truth signal (`compositeTruthScore` + `compositeTruthLabel`) | ✅ Complete |
| Knowledge graph with `claim_graph_edges` and `semantic_similar` edges | ✅ Complete |
| Contradiction detection engine with weekly scan cron | ✅ Complete |
| Claim score history (sparkline data for truth signal evolution) | ✅ Complete |
| Autonomous re-evaluation loop (every 6h, re-scores stale claims) | ✅ Complete |
| 14 heartbeat cron jobs (daily ingestion, quality pass, frontier engine, etc.) | ✅ Complete |
| Full admin intelligence dashboard (14 sub-dashboards) | ✅ Complete |
| Public tRPC API (verticals, search, leaderboard, graph, timeline, provenance, similarity, cooccurrence, audit requests) | ✅ Complete |
| PayPal Orders v2 backend (3 tiers: $1,500 / $5,000 / $15,000) | ✅ Backend built, no frontend |
| Magic link authentication | ✅ Complete |

**55 database tables** covering every aspect of the system: claims, documents, audit reports, graph entities, graph relations, citation edges, graph claim edges, contradiction alerts, claim score history, wiki pages, knowledge gaps, frontier log, self-prompt log, dream sessions, prediction models, vertical configs, monitoring jobs, and more.

### 2.2 Frontend (citation.is) — 7 Pages Live

The frontend is clean, fast, and well-structured. It has a minimal light theme with Syne + DM Sans typography, a CopilotKit AI sidebar wired to live data, and a working audit request form that submits to the backend.

| Page | Route | Status |
|---|---|---|
| Landing page | `/` | ✅ Live stats, search bar, vertical cards, CTA |
| Search | `/search` | ✅ Query input, verdict/domain filters, claim cards |
| Verticals list | `/verticals` | ✅ Stats cards with progress bars |
| Vertical detail | `/verticals/:domain` | ✅ Per-domain stats, search within vertical |
| Leaderboard | `/leaderboard` | ✅ Entity table with rank, trend, delta |
| Audit request | `/audit` | ✅ Tier selection, contact form, success state |
| About | `/about` | ✅ How it works, features, backend info |
| Claim detail | `/claim/:id` | ❌ Missing |
| Knowledge graph | `/graph` | ❌ Missing |
| Pricing | `/pricing` | ❌ Missing |
| Onboarding | `/welcome` | ❌ Missing |

---

## 3. What Remains to Finish the Product

The remaining work falls into three categories: **Frontend Depth** (pages that make the product feel complete), **Commercial Surface** (features that convert visitors to paying customers), and **Backend Hardening** (the final backend gaps).

### 3.1 Frontend Depth — citation.is

**Phase C1 — Claim Detail Page** (`/claim/:id`) — 2–3 days  
The most important missing page. When a user finds a claim in search results or the leaderboard, they need to be able to click through to a full detail page showing: the claim text, verdict badge, composite truth score, evidence links (PDB IDs, PMIDs, UniProt accessions), citation chain provenance, the composite truth timeline sparkline, and related claims. The backend already exposes `claims.getById`, `provenance.getChain`, `timeline.forClaim`, `claims.getScoreHistory`, and `similarity.findSimilar` — this is purely frontend work.

**Phase C2 — Knowledge Graph Visualisation** (`/graph`) — 3–4 days  
An interactive force-directed graph page showing the `claim_graph_edges` data. The backend exposes `graph.data` and `graph.corpusGrowthStats`. The backend admin already has a full D3 graph at `/graph` — the citation.is version should be a public-facing, read-only version with the same node colouring (by composite truth label) and edge weighting. This is one of the most visually compelling features of the platform and will drive organic sharing.

**Phase C3 — Dark Mode Toggle** — 1 day  
The todo.md already lists this. Tailwind v4 makes it straightforward. The existing minimal light theme will invert cleanly to a dark slate palette.

**Phase C4 — SEO Meta Tags Per Page** — 1 day  
Every page needs `og:title`, `og:description`, `og:image`, and JSON-LD structured data. The claim detail page in particular should have `SchemaOrg/ClaimReview` structured data so that Google and AI search engines can index individual claims. This is a prerequisite for organic discovery.

**Phase C5 — Pagination for Search Results** — 1 day  
Currently capped at 50 results. The backend `search.claims` procedure supports `limit` and `offset`. Add a simple "Load more" button or page controls.

### 3.2 Commercial Surface — Both Repos

**Phase C6 — Pricing Page** (`/pricing`) — 2 days  
A dedicated pricing page showing the three tiers (Starter $1,500 / Diligence $5,000 / Platform Pilot $15,000) with a feature comparison table, turnaround times, and a direct link to the audit request form. This page is the conversion point for anyone who arrives via organic search or AI citation.

**Phase C7 — PayPal Checkout Frontend** — 3–4 days  
Wire the existing `paypalCheckout.ts` backend to tRPC procedures (`payment.createOrder`, `payment.captureOrder`, `payment.getSubscription`) and build a checkout flow in citation.is: plan selection → PayPal redirect → capture → subscription activation → confirmation. The `userSubscriptions` table and `checkAuditLimitPayPal` enforcement are already in place on the backend. The PayPal MCP server (`paypal-for-business`) is already configured in the environment.

**Phase C8 — Onboarding Flow** (`/welcome`) — 2–3 days  
After a user submits their first audit request, redirect them to a three-step onboarding: (1) what happens next (pipeline explanation with timeline), (2) how to read the report when it arrives, (3) how to explore the knowledge graph. This reduces time-to-value and sets expectations correctly.

### 3.3 Backend Hardening — ttruthdesk.claims

**Phase 109 — Score History Backfill Job** — 1–2 days  
A one-time scheduled job that backfills `claim_score_history` from existing `claims.compositeTruthScore` values so the composite truth timeline sparkline is populated for all claims verified before Phase 108 was deployed.

**Phase 110 — Contradiction Resolution Workflow** — 2–3 days  
When a contradiction alert is raised, automatically notify the original document submitter. Add a "Resolve" workflow to `ContradictionViewer.tsx` that lets a reviewer add resolution notes, mark the alert resolved, and optionally trigger a re-evaluation of both claims.

**Phase 111 — API Key Management UI** — 1–2 days  
The `apiKeys` table exists. The `ApiKeys.tsx` page exists. Wire it to tRPC procedures for create, list, revoke, and rotate. This is a prerequisite for the Platform Pilot tier, which includes API access.

**Phase 112 — Micron Deployment Pipeline** — 3–4 days  
Generate and deploy static mini-sites for each vertical (e.g., `structural-biology.citation.is`). Each micron publishes the top 20 verified claims for that domain with JSON-LD structured data and a "Verify your document" CTA. This is the platform's self-marketing engine — free publications that drive traffic back to the main product.

**Phase 113 — E2E Test Suite Completion** — 2–3 days  
Run the full Playwright e2e suite against the live backend. Fix any failures. Add e2e tests for the checkout flow and onboarding.

**Phase 114 — PayPal Live Mode** — 1 day  
Configure `PAYPAL_CLIENT_ID`, `PAYPAL_SECRET`, and `PAYPAL_MODE=live` via `webdev_request_secrets`. Test end-to-end with a real PayPal sandbox account. Switch to live mode after KYC verification.

---

## 4. Timeline to Finished Product

"Finished product" is defined as: all 7 frontend pages complete, a working pricing page, a functional checkout flow, SEO meta tags on all pages, and the e2e test suite passing. This is the minimum viable commercial product (MVCP).

| Week | Phases | Deliverable |
|---|---|---|
| **Week 1** (Jun 12–18) | C1, C4 | Claim detail page live · SEO meta tags on all pages |
| **Week 2** (Jun 19–25) | C2, C3, C5 | Graph visualisation · Dark mode · Pagination |
| **Week 3** (Jun 26 – Jul 2) | C6, C7 | Pricing page · PayPal checkout frontend |
| **Week 4** (Jul 3–9) | C8, 109, 110 | Onboarding flow · Score backfill · Contradiction resolution |
| **Week 5** (Jul 10–16) | 111, 112, 113, 114 | API keys · Micron pipeline · E2E suite · PayPal live |
| **Week 6+** (Jul 17+) | Microns per vertical | Vertical microns deployed · Ongoing corpus growth |

**MVCP is 5 weeks away.** The engine is done. The remaining work is the public surface and the commercial layer.

---

## 5. What "Finished" Looks Like — End-to-End User Journey

A finished product has the following user journey working without any manual steps:

A researcher finds `citation.is` via an AI search engine (ChatGPT, Perplexity, Google AI) citing a public claim page or a vertical micron. They land on the homepage, see live stats (documents processed, claims verified, support rate), and search for a topic in their domain. They find a relevant claim, click through to the claim detail page, and see the full evidence chain — PDB IDs, PMIDs, UniProt accessions, citation provenance, and a sparkline showing how the composite truth score has evolved over time. They are impressed. They click "Request an Audit" and are taken to the pricing page. They choose the Starter tier ($1,500), complete payment via PayPal, and submit their document. The 8-stage pipeline runs autonomously and produces a full audit report within 2–5 minutes. The onboarding flow explains what they are looking at. Every 6 hours, the re-evaluation loop re-scores their claims as new evidence arrives. Every Monday, the contradiction scan checks whether any of their claims conflict with newly validated claims from other documents. The knowledge graph grows. The microns publish new verified claims. The platform markets itself.

---

## 6. Recommended Phase Order

| Priority | Phase | Effort | Repo | Dependency |
|---|---|---|---|---|
| P0 | C1 — Claim Detail Page | 2–3 days | citation-desk | None |
| P0 | C4 — SEO Meta Tags | 1 day | citation-desk | C1 |
| P0 | C6 — Pricing Page | 2 days | citation-desk | None |
| P0 | C7 — PayPal Checkout Frontend | 3–4 days | both | C6 |
| P1 | C2 — Graph Visualisation | 3–4 days | citation-desk | None |
| P1 | C3 — Dark Mode | 1 day | citation-desk | None |
| P1 | C5 — Search Pagination | 1 day | citation-desk | None |
| P1 | C8 — Onboarding Flow | 2–3 days | citation-desk | C7 |
| P1 | 109 — Score History Backfill | 1–2 days | protein-truth-desk | None |
| P1 | 110 — Contradiction Resolution | 2–3 days | protein-truth-desk | Phase 107 |
| P2 | 111 — API Key Management UI | 1–2 days | protein-truth-desk | None |
| P2 | 112 — Micron Pipeline | 3–4 days | protein-truth-desk | None |
| P2 | 113 — E2E Suite Completion | 2–3 days | both | C1, C6 |
| P2 | 114 — PayPal Live Mode | 1 day | protein-truth-desk | C7 |

---

## 7. Strategic Context

The platform's long-term moat is the knowledge graph. Every document submitted adds nodes and edges. Every re-evaluation run deepens the signal. Every contradiction detected and resolved improves the graph's integrity. The micron strategy compounds this: each vertical micron is a free publication that markets the platform to domain-specific audiences, generates backlinks and AI search citations, and validates the platform's coverage of each vertical.

The citation.is frontend is the commercial face of this engine. Its job is to make the engine's output visible, searchable, and commercially accessible. The CopilotKit AI assistant is already wired and feeding live data — this is a significant differentiator. A visitor can ask "What claims about lysozyme are supported in the structural biology vertical?" and get a precise, data-backed answer in real time.

The graded citation model described in the research documents (`verified`, `contested`, `implied but untested`, `beyond current evidence`) maps directly onto the platform's existing verdict engine. The next strategic step — after MVCP — is to expose this graded citation model explicitly in the citation.is UI, so that every claim page shows not just a verdict but an epistemic status with a clear explanation of what evidence exists, what is contested, and where the boundary of current knowledge lies.

---

*This document reflects the state of both repositories as of June 11, 2026 (backend Phase 108, frontend 7 pages live). It should be updated after each completed phase.*
