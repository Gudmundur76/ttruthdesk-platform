/**
 * heartbeatRegistrar.ts — Phase 106
 *
 * Canonical registry of all project-level heartbeat cron jobs.
 *
 * This file documents every cron job that has been registered on the Manus
 * platform via `manus-heartbeat create`. It serves as:
 *
 *   1. A single source of truth for all scheduled jobs — task_uid, cron
 *      expression, path, and description in one place.
 *   2. A reference for `manus-heartbeat update/pause/delete` operations.
 *   3. A startup check that can verify all expected jobs are still registered.
 *
 * IMPORTANT: These crons live on the Manus platform, NOT in this process.
 * They survive sandbox hibernation and keep firing as long as the deployed
 * site is reachable. Do NOT use setInterval/node-cron — Cloud Run terminates
 * idle instances.
 *
 * To register a new job:
 *   manus-heartbeat create --name <name> --cron "<6-field>" --path /api/scheduled/<name> --description "<desc>"
 *
 * To pause a job:
 *   manus-heartbeat update --task-uid <uid> --enable=false
 *
 * To resume a job:
 *   manus-heartbeat update --task-uid <uid> --enable=true
 */

export interface RegisteredCronJob {
  /** Unique name within (project, owner) */
  name: string;
  /** Manus platform task UID — use for update/pause/delete */
  taskUid: string;
  /** 6-field UTC cron expression (sec min hour dom mon dow) */
  cron: string;
  /** Express route path — must start with /api/scheduled/ */
  path: string;
  /** Human-readable description */
  description: string;
  /** When this job was registered */
  registeredAt: string;
}

/**
 * All project-level heartbeat cron jobs registered on the Manus platform.
 *
 * Ordered by next_execution_at cadence (most frequent first).
 */
export const REGISTERED_CRON_JOBS: RegisteredCronJob[] = [
  // ── Every 2 hours ──────────────────────────────────────────────────────────
  {
    name: "autonomous-loop-tick",
    taskUid: "GVAmEEVdw7CPp7rmm9AejT",
    cron: "0 0 */2 * * *",
    path: "/api/scheduled/autonomous-loop-tick",
    description:
      "Autonomous Loop tick: publishes scheduled_tick event and drains up to 20 pending events every 2 hours",
    registeredAt: "2026-06-07T01:11:02Z",
  },

  // ── Every 6 hours ──────────────────────────────────────────────────────────
  {
    name: "frontier-engine",
    taskUid: "LLrxuMhvukaVvJUyPQqpJZ",
    cron: "0 0 */6 * * *",
    path: "/api/scheduled/frontier-engine",
    description:
      "Frontier Engine: gap detection, ranking, evidence pursuit, hypothesis generation — runs every 6 hours",
    registeredAt: "2026-06-06T23:54:52Z",
  },
  {
    name: "re-evaluate-composite-truth",
    taskUid: "XYxgKr9QgnAZBhAvuCbnQR",
    cron: "0 0 */6 * * *",
    path: "/api/scheduled/re-evaluate",
    description:
      "Autonomous re-evaluation loop (Phase 105): discovers claims whose composite truth signals are stale due to new citation edges, re-scores them deterministically via compositeTruthEngine, writes updated labels back. Runs every 6 hours, idempotent.",
    registeredAt: "2026-06-11T17:06:00Z",
  },
  {
    name: "domain-ingest-6h",
    taskUid: "UwL3QmYbjsPo7FcGvLdvEX",
    cron: "0 0 */6 * * *",
    path: "/api/scheduled/domain-ingest",
    description:
      "Sprint 14 domain ingest: autonomous PubMed ingest for 5 scientific domains " +
      "(biology, medicine, chemistry, physics, climate). 3 targeted queries per domain, " +
      "400ms rate-limiting. Grows claim density toward 50-pair SLM training threshold.",
    registeredAt: "2026-06-21T20:21:04Z",
  },
  // ── Weekly ─────────────────────────────────────────────────────────────────
  {
    name: "contradiction-scan",
    taskUid: "cabGs6AYFdmJkWbcCoLZY8",
    cron: "0 0 0 * * 1",
    path: "/api/scheduled/contradiction-scan",
    description:
      "Weekly contradiction detection (Phase 107): traverses semantic_similar edges in graph_claim_edges and flags claim pairs with opposing composite truth labels. Persists findings to contradiction_alerts idempotently.",
    registeredAt: "2026-06-21T20:22:04Z",
  },

  // ── Daily ──────────────────────────────────────────────────────────────────
  {
    name: "discovery-loop-daily",
    taskUid: "8zutBb7ALstaRneURCfQUq",
    cron: "0 0 8 * * *",
    path: "/api/scheduled/discovery-loop",
    description: "Daily multi-source structural biology discovery",
    registeredAt: "2026-06-21T20:21:54Z",
  },
  {
    name: "pmc-feed-nightly",
    taskUid: "8KZcJgzfnDoLMUx2hGzUEv",
    cron: "0 0 1 * * *",
    path: "/api/scheduled/pmc-feed",
    description:
      "Nightly PMC OA bulk feed: queries PubMed for each vertical's MeSH terms, fetches abstracts + full-text, filters by signal density, deduplicates, queues new papers through the audit pipeline",
    registeredAt: "2026-06-21T20:21:26Z",
  },
  {
    name: "quality-pass-nightly",
    taskUid: "c4Bc6DsqoM94zshwQCJLSm",
    cron: "0 0 2 * * *",
    path: "/api/scheduled/quality-pass",
    description:
      "Nightly quality pass: re-processes draft-tier documents with Kimi K2, upgrades qualityTier to verified. Runs after pmc-feed-nightly (01:00 UTC) to catch newly ingested papers.",
    registeredAt: "2026-06-21T20:21:36Z",
  },
  {
    name: "swarm-tick-daily",
    taskUid: "aDwUNqnMUu5K2TMABusY4H",
    cron: "0 0 3 * * *",
    path: "/api/scheduled/swarm-tick",
    description:
      "Daily meta-agent swarm tick: Agent 7 (codeGuardianAgent) runs code drift, stub ledger, pipeline invariants, and health score; all agents persist findings to meta_agent_checks",
    registeredAt: "2026-06-21T20:21:46Z",
  },

  // ── Phase 109: Source Version Agent (daily 03:30 UTC) ───────────────
  {
    name: "source-version-agent",
    taskUid: "V8Fb9vuAs77ZQJumPpQ5DK",
    cron: "0 30 3 * * *",
    path: "/api/scheduled/source-version-agent",
    description:
      "Daily source version tracking (Phase 109): polls approved sources, computes hash, detects changes, queues affected claims for re-evaluation. Runs at 03:30 UTC.",
    registeredAt: "2026-06-21T20:21:54Z",
  },

  // ── Weekly ─────────────────────────────────────────────────────────────────
  {
    name: "pubmed-decode-weekly",
    taskUid: "JZfnUdnBk6Ax5B8hmpxKrb",
    cron: "0 0 6 * * 1",
    path: "/api/scheduled/pubmed-ingest",
    description: "Weekly deCODE Genetics PubMed scan",
    registeredAt: "2026-06-21T20:22:04Z",
  },
  {
    name: "wiki-engine-lint-weekly",
    taskUid: "HisG4paUtsy8Nk2zrhkJoh",
    cron: "0 0 2 * * 0",
    path: "/api/scheduled/wiki-engine-lint",
    description:
      "Weekly wiki knowledge-layer lint: detect contradictions, orphan pages, stale claims, missing cross-refs, then rebuild the index",
    registeredAt: "2026-06-21T20:22:07Z",
  },
];

/**
 * Look up a registered job by name.
 * Returns undefined if the job is not found (not yet registered or removed).
 */
export function getRegisteredJob(name: string): RegisteredCronJob | undefined {
  return REGISTERED_CRON_JOBS.find(j => j.name === name);
}

/**
 * Returns the task_uid for a registered job by name.
 * Throws if the job is not registered — this is intentional: callers that
 * need a task_uid should fail loudly if the job was never registered.
 */
export function requireJobTaskUid(name: string): string {
  const job = getRegisteredJob(name);
  if (!job) {
    throw new Error(
      `Heartbeat job "${name}" is not registered. ` +
        `Run: manus-heartbeat create --name ${name} --cron "..." --path /api/scheduled/...`
    );
  }
  return job.taskUid;
}
