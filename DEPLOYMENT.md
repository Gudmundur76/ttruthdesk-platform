# DEPLOYMENT.md — Truth Desk Platform

> **Last updated:** Phase 130 (2026-06-13)  
> **Stack:** Node.js 22 · TypeScript · Express · tRPC · Drizzle ORM · MySQL/TiDB · React 19

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Environment Variables](#2-environment-variables)
3. [Database Setup](#3-database-setup)
4. [Build & Start](#4-build--start)
5. [CI / GitHub Actions](#5-ci--github-actions)
6. [Manus Hosted Deployment](#6-manus-hosted-deployment)
7. [Health Checks](#7-health-checks)
8. [Scheduled Jobs (Heartbeat)](#8-scheduled-jobs-heartbeat)
9. [Rollback Procedure](#9-rollback-procedure)
10. [Secrets Rotation](#10-secrets-rotation)

---

## 1. Prerequisites

| Tool | Minimum version | Notes |
|------|-----------------|-------|
| Node.js | 22.x | LTS recommended |
| pnpm | 10.4.x | `npm i -g pnpm@10.4.1` |
| MySQL / TiDB | 8.x / TiDB 7.x | Serverless TiDB Cloud supported |

---

## 2. Environment Variables

All variables are read from `server/_core/env.ts`. The server **hard-fails at startup** if `JWT_SECRET` is missing.

### Required (server will not start without these)

| Variable | Description |
|----------|-------------|
| `JWT_SECRET` | Session cookie signing secret (≥ 32 random bytes) |
| `DATABASE_URL` | MySQL connection string, e.g. `mysql://user:pass@host:4000/db?ssl={"rejectUnauthorized":true}` |

### Manus Platform (auto-injected in Manus deployments)

| Variable | Description |
|----------|-------------|
| `VITE_APP_ID` | Manus OAuth application ID |
| `OAUTH_SERVER_URL` | Manus OAuth backend base URL |
| `VITE_OAUTH_PORTAL_URL` | Manus login portal URL (frontend) |
| `OWNER_OPEN_ID` | Owner's Manus Open ID |
| `BUILT_IN_FORGE_API_URL` | Manus built-in API base URL |
| `BUILT_IN_FORGE_API_KEY` | Bearer token for server-side Manus APIs |
| `VITE_FRONTEND_FORGE_API_KEY` | Bearer token for frontend Manus APIs |

### LLM Provider (choose one)

| Variable | Description |
|----------|-------------|
| `LLM_PROVIDER` | `manus_builtin` (default) \| `freellmapi` \| `kimi` \| `openrouter` |
| `OPENROUTER_API_KEY` | Required when `LLM_PROVIDER=openrouter` |
| `OPENROUTER_API_KEYS` | Comma-separated pool for round-robin rotation |
| `KIMI_API_KEY` | Required when `LLM_PROVIDER=kimi` |
| `KIMI_BASE_URL` | Default: `https://api.kimi.com/coding/v1` |
| `KIMI_MODEL` | Default: `kimi-for-coding` |
| `FREELM_API_URL` | Required when `LLM_PROVIDER=freellmapi` |
| `FREELM_API_KEY` | Optional API key for self-hosted proxy |
| `FREELM_MODEL` | Model name for freellmapi provider |

### Optional Integrations

| Variable | Description |
|----------|-------------|
| `TELEGRAM_BOT_TOKEN` | Telegram bot token for notifications |
| `TELEGRAM_CHANNEL_ID` | Telegram channel ID for alerts |
| `PAYPAL_CLIENT_ID` | PayPal client ID for checkout |
| `PAYPAL_SECRET` | PayPal client secret |
| `PAYPAL_MODE` | `sandbox` (default) \| `live` |
| `INDEX_NOW_KEY` | IndexNow key for Bing/Perplexity re-indexing |
| `COORD_API_KEY` | Shared secret for `/api/coord/*` endpoints |
| `MANUS_API_KEY` | Manus platform API key (task spawning) |
| `VITE_APP_URL` | Public base URL, e.g. `https://truthdesk.claims` |
| `JWKS_PRIVATE_KEY` | RSA-2048 PKCS#8 PEM for JWT signing (JWKS endpoint) |
| `MR_AGENT_ENABLED` | `true` to enable evolva-mragent memory server (episodic pre-flight context) |
| `MR_AGENT_URL` | evolva-mragent base URL (default: `http://localhost:8002`) |

---

## 3. Database Setup

```bash
# 1. Generate migration SQL from schema changes
pnpm drizzle-kit generate

# 2. Apply migrations (reads DATABASE_URL from env)
pnpm drizzle-kit migrate

# Or apply manually via the Manus Database UI (Settings → Database)
```

The schema lives in `drizzle/schema.ts`. Never edit migration files directly — always regenerate from the schema.

---

## 4. Build & Start

```bash
# Install dependencies
pnpm install

# Development (hot-reload)
pnpm dev

# Production build
pnpm build

# Production start
pnpm start

# Type-check only (no emit)
pnpm check

# Lint (zero warnings enforced)
pnpm lint

# Run all tests
pnpm test
```

The production build compiles the React frontend with Vite and bundles the Express server with esbuild into `dist/index.js`.

---

## 5. CI / GitHub Actions

The CI workflow (`.github/workflows/ci.yml`) runs on:

- `push` to `main` or `develop`
- `pull_request` targeting `main` or `develop`
- `workflow_dispatch` (manual trigger with optional `reason` input)

### Jobs

| Job | Steps |
|-----|-------|
| **Quality Gate** | Install → TypeScript check → Lint (`--max-warnings 0`) → Test |
| **Build** | Install → Vite build + esbuild bundle |
| **Integration** | Install → Integration test harness |

### Manual trigger

```bash
# Via GitHub CLI
gh workflow run ci.yml --field reason="post-hotfix verification"

# Via GitHub UI: Actions → CI → Run workflow
```

---

## 6. Manus Hosted Deployment

1. Ensure a checkpoint exists: click **Checkpoint** in the Manus Management UI or run `webdev_save_checkpoint`.
2. Click **Publish** in the Management UI header.
3. The platform builds and deploys automatically (Cloud Run, Node-only runtime, 512 MiB RAM, 180s request timeout).

> **Note:** The deployed runtime is Node.js only. No Python, Go, or native binaries beyond what npm ships. Do not rely on `tsx`, `drizzle-kit`, or other dev-only tools at runtime.

### Domain

The default domain is `<project-name>.manus.space`. Custom domains can be configured in **Settings → Domains**.

---

## 7. Health Checks

### Simple ping

```
GET /api/trpc/system.ping
```

Returns `200 OK` with `{"result":{"data":"pong"}}`.

### Detailed subsystem health (Phase 129)

```
GET /api/v2/health/detailed
```

Returns a JSON report with per-subsystem status:

```json
{
  "overall": "ok",
  "timestamp": "2026-06-13T23:00:00.000Z",
  "subsystems": {
    "db":          { "status": "ok",       "latencyMs": 12 },
    "vectorStore": { "status": "ok",       "latencyMs": 3  },
    "ingestion":   { "status": "ok",       "latencyMs": 8  },
    "mcp":         { "status": "ok",       "latencyMs": 1  }
  }
}
```

| `overall` | HTTP status | Meaning |
|-----------|-------------|---------|
| `ok` | 200 | All subsystems healthy |
| `degraded` | 200 | One or more subsystems slow or unavailable |
| `down` | 503 | Database is unreachable |

---

## 8. Scheduled Jobs (Heartbeat)

Heartbeat jobs are registered in `server/_core/heartbeat.ts` and triggered by the Manus scheduler.

| Endpoint | Schedule | Description |
|----------|----------|-------------|
| `POST /api/scheduled/pubmed-ingest` | Every 6h | Fetch new PubMed papers |
| `POST /api/scheduled/pmc-feed` | Every 12h | PMC Open Access feed |
| `POST /api/scheduled/monitoring` | Every 1h | Claim monitoring alerts |
| `POST /api/scheduled/discovery-loop` | Every 4h | Autonomous discovery loop |
| `POST /api/scheduled/quality-pass` | Every 24h | Quality re-pass on low-confidence claims |
| `POST /api/scheduled/swarm-tick` | Every 30min | Swarm agent tick |
| `POST /api/scheduled/orchestrator-tick` | Every 15min | Orchestrator tick |
| `POST /api/scheduled/ingestion-alerts` | Every 1h | Push alerts for stall / high failure rate |

All heartbeat endpoints return `{ ok: true, ... }` on success. Failures are logged and surfaced via `notifyOwner()`.

---

## 9. Rollback Procedure

### Via Manus Management UI (recommended)

1. Open **Management UI → More (⋯) → Version history**
2. Find the last stable checkpoint
3. Click **Rollback**

### Via CLI

```bash
# List recent commits
git log --oneline -10

# Rollback to a specific commit (use webdev_rollback_checkpoint instead of git reset --hard)
# Contact Manus support or use the Management UI rollback for production rollbacks
```

> **Warning:** Never use `git reset --hard` on a deployed project. Always use the Management UI rollback or `webdev_rollback_checkpoint`.

---

## 10. Secrets Rotation

1. Generate new secret value (use `openssl rand -base64 32` for `JWT_SECRET`).
2. In Manus Management UI: **Settings → Secrets → Edit** the relevant key.
3. Click **Save** — the platform injects the new value on next deploy.
4. For `JWT_SECRET` rotation: all existing session cookies will be invalidated. Users will need to log in again.
5. For database credentials: update `DATABASE_URL` and verify connectivity with `GET /api/v2/health/detailed`.

---

*Generated by Phase 130 — Production Hardening Sprint*
