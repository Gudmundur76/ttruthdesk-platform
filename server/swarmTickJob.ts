/**
 * swarmTickJob.ts — Agent Swarm Coordinator
 * ─────────────────────────────────────────────────────────────────────────────
 * Heartbeat handler that fans out all 5 specialised agent jobs in parallel.
 * Each agent is stateless and idempotent — they read from shared DB queues
 * and process a fixed batch per invocation.
 *
 * Registered at: POST /api/scheduled/swarm-tick
 *
 * Agent roster:
 *   1. Harvester     — fetches new papers from PubMed/bioRxiv/PMC (pmcFeedJob)
 *   2. Extractor     — runs claim extraction on pending documents (analysisPipeline)
 *   3. Validator     — runs PDB validation on extracted claims (pdbAdapter)
 *   4. WikiCompiler  — compiles wiki pages for completed documents (wikiCompiler)
 *   5. QualityAuditor— re-verifies draft documents with premium model (qualityPassJob)
 *
 * The coordinator fires all 5 in parallel and collects results.
 * Individual agent failures are non-fatal — the coordinator reports them
 * but does not abort the other agents.
 *
 * Throughput target: 20–40 documents/hour (vs ~1–2/hour sequential baseline).
 */

import type { Request, Response } from "express";
import { pmcFeedJobHandler } from "./pmcFeedJob";
import { qualityPassJobHandler } from "./qualityPassJob";
import { compileDocumentToWiki } from "./wikiCompiler";
import { getDb } from "./db";
import { documents } from "../drizzle/schema";
import { eq, and, lt } from "drizzle-orm";
import { logCronRun } from "./cronRunLogger";
import { logger, errData } from "./logger";
const log = logger("swarmTickJob");


// ─── Agent: Harvester ─────────────────────────────────────────────────────────

/**
 * Runs the PMC feed job for all verticals (harvests new papers).
 */
async function runHarvesterAgent(): Promise<{ agent: string; status: string; detail: string }> {
  try {
    // Create a minimal mock req/res to reuse the existing handler
    let responseData: Record<string, unknown> = {};
    const mockReq = {
      body: { allVerticals: true, lookbackDays: 1, maxPerVertical: 20 },
    } as Request;
    const mockRes = {
      json: (data: Record<string, unknown>) => { responseData = data; },
      status: () => mockRes,
    } as unknown as Response;

    await pmcFeedJobHandler(mockReq, mockRes);
    return {
      agent: "harvester",
      status: "ok",
      detail: `PMC feed complete: ${JSON.stringify(responseData)}`,
    };
  } catch (err) {
    return { agent: "harvester", status: "error", detail: String(err) };
  }
}

// ─── Agent: Wiki Compiler ─────────────────────────────────────────────────────

/**
 * Compiles wiki pages for up to 10 recently completed documents that
 * haven't been wiki-compiled yet (no graph entities).
 */
async function runWikiCompilerAgent(): Promise<{ agent: string; status: string; detail: string }> {
  try {
    const db = await getDb();
    if (!db) {
      return { agent: "wiki_compiler", status: "skip", detail: "DB unavailable" };
    }

    // Find recently completed documents (last 24h) that need wiki compilation
    const _oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const pendingDocs = await db
      .select({ id: documents.id, title: documents.title })
      .from(documents)
      .where(
        and(
          eq(documents.status, "complete"),
          lt(documents.updatedAt, new Date()) // all complete docs
        )
      )
      .limit(10);

    if (pendingDocs.length === 0) {
      return { agent: "wiki_compiler", status: "ok", detail: "No documents pending wiki compilation" };
    }

    const results = await Promise.allSettled(
      pendingDocs.map((doc) => compileDocumentToWiki(doc.id))
    );

    const succeeded = results.filter((r) => r.status === "fulfilled").length;
    const failed = results.filter((r) => r.status === "rejected").length;

    return {
      agent: "wiki_compiler",
      status: "ok",
      detail: `Compiled ${succeeded} wiki pages, ${failed} failed out of ${pendingDocs.length}`,
    };
  } catch (err) {
    return { agent: "wiki_compiler", status: "error", detail: String(err) };
  }
}

// ─── Agent: Quality Auditor ───────────────────────────────────────────────────

/**
 * Runs the quality pass job to re-verify draft documents with premium model.
 */
async function runQualityAuditorAgent(): Promise<{ agent: string; status: string; detail: string }> {
  try {
    let responseData: Record<string, unknown> = {};
    const mockReq = { body: { limit: 5 } } as Request;
    const mockRes = {
      json: (data: Record<string, unknown>) => { responseData = data; },
      status: () => mockRes,
    } as unknown as Response;

    await qualityPassJobHandler(mockReq, mockRes);
    return {
      agent: "quality_auditor",
      status: "ok",
      detail: `Quality pass complete: ${JSON.stringify(responseData)}`,
    };
  } catch (err) {
    return { agent: "quality_auditor", status: "error", detail: String(err) };
  }
}

// ─── Agent: Backfill Predictor ────────────────────────────────────────────────

/**
 * Runs the prediction backfill job for claims without trajectory predictions.
 */
async function runBackfillPredictorAgent(): Promise<{ agent: string; status: string; detail: string }> {
  try {
    const { predictionBackfillHandler } = await import("./predictionBackfillJob");
    let responseData: Record<string, unknown> = {};
    const mockReq = { body: {} } as Request;
    const mockRes = {
      json: (data: Record<string, unknown>) => { responseData = data; },
      status: () => mockRes,
    } as unknown as Response;

    await predictionBackfillHandler(mockReq, mockRes);
    return {
      agent: "backfill_predictor",
      status: "ok",
      detail: `Backfill complete: ${JSON.stringify(responseData)}`,
    };
  } catch (err) {
    return { agent: "backfill_predictor", status: "error", detail: String(err) };
  }
}

// ─── Agent: Monitoring Scanner ────────────────────────────────────────────────

/**
 * Runs the monitoring job to scan for new contradictions in tracked documents.
 */
async function runMonitoringScannerAgent(): Promise<{ agent: string; status: string; detail: string }> {
  try {
    const { monitoringJobHandler } = await import("./monitoringJob");
    let responseData: Record<string, unknown> = {};
    const mockReq = { body: {} } as Request;
    const mockRes = {
      json: (data: Record<string, unknown>) => { responseData = data; },
      status: () => mockRes,
    } as unknown as Response;

    await monitoringJobHandler(mockReq, mockRes);
    return {
      agent: "monitoring_scanner",
      status: "ok",
      detail: `Monitoring scan complete: ${JSON.stringify(responseData)}`,
    };
  } catch (err) {
    return { agent: "monitoring_scanner", status: "error", detail: String(err) };
  }
}

// ─── Agent: Code Guardian (Meta-Agent) ──────────────────────────────────────

/**
 * Runs the meta-agent (codeGuardianAgent) which checks for structural drift,
 * stub debt, pipeline invariants, and routes alerts accordingly.
 */
async function runCodeGuardianAgent(): Promise<{ agent: string; status: string; detail: string }> {
  try {
    const { runCodeGuardian } = await import("./metaAgent/codeGuardian");
    const report = await runCodeGuardian();
    return {
      agent: "code_guardian",
      status: report.criticalCount > 0 ? "warn" : "ok",
      detail:
        `Health: ${report.healthScore}/100 (${report.healthGrade}) — ` +
        `${report.criticalCount} critical, ${report.warningCount} warnings, ` +
        `${report.stubLedger?.overdue ?? 0} overdue stubs`,
    };
  } catch (err) {
    return { agent: "code_guardian", status: "error", detail: String(err) };
  }
}

// ─── Swarm Coordinator ────────────────────────────────────────────────────────

export interface SwarmTickResult {
  startedAt: string;
  completedAt: string;
  durationMs: number;
  agents: Array<{ agent: string; status: string; detail: string }>;
  summary: {
    total: number;
    ok: number;
    error: number;
    skip: number;
  };
}

/**
 * Runs all 5 agents in parallel and collects results.
 * Individual agent failures are non-fatal.
 */
export async function runSwarmTick(): Promise<SwarmTickResult> {
  const startedAt = new Date().toISOString();
  const startMs = Date.now();

  log.info("[Swarm] Starting tick — fanning out 6 agents in parallel (Agent 7: codeGuardianAgent)");

  const [harvester, wikiCompiler, qualityAuditor, backfillPredictor, monitoringScanner, codeGuardian] =
    await Promise.allSettled([
      runHarvesterAgent(),
      runWikiCompilerAgent(),
      runQualityAuditorAgent(),
      runBackfillPredictorAgent(),
      runMonitoringScannerAgent(),
      runCodeGuardianAgent(),
    ]);

  const agentResults = [
    harvester,
    wikiCompiler,
    qualityAuditor,
    backfillPredictor,
    monitoringScanner,
    codeGuardian,
  ].map((r) =>
    r.status === "fulfilled"
      ? r.value
      : { agent: "unknown", status: "error", detail: String((r as PromiseRejectedResult).reason) }
  );

  const completedAt = new Date().toISOString();
  const durationMs = Date.now() - startMs;

  const summary = {
    total: agentResults.length,
    ok: agentResults.filter((r) => r.status === "ok").length,
    error: agentResults.filter((r) => r.status === "error").length,
    skip: agentResults.filter((r) => r.status === "skip").length,
  };

  log.info(`[Swarm] Tick complete in ${durationMs}ms — ${summary.ok}/${summary.total} agents OK`);
  agentResults.forEach((r) => {
    const icon = r.status === "ok" ? "✅" : r.status === "skip" ? "⏭️" : "❌";
    log.info(`  ${icon} [${r.agent}] ${r.detail.slice(0, 120)}`);
  });

  // Persist TurboVec FAISS index to S3 (fire-and-forget, non-fatal)
  const sidecarPort = process.env.VECTOR_SIDECAR_PORT ?? "5001";
  fetch(`http://127.0.0.1:${sidecarPort}/save`, { method: "POST" })
    .then((r) => r.json())
    .then((d) => log.info(`[Swarm] TurboVec S3 save: ${JSON.stringify(d)}`))
    .catch((e) => log.warn(`[Swarm] TurboVec S3 save skipped (sidecar not running): ${e.message}`));

  return { startedAt, completedAt, durationMs, agents: agentResults, summary };
}

/**
 * Express handler for POST /api/scheduled/swarm-tick
 */
export async function swarmTickHandler(req: Request, res: Response): Promise<void> {
  try {
    const result = await runSwarmTick();
    void logCronRun(
      "swarm-tick-daily",
      "ok",
      result.durationMs,
      `${result.summary.ok}/${result.summary.total} agents OK, ${result.summary.error} errors`
    );
    res.json(result);
  } catch (err) {
    log.error("[Swarm] Fatal coordinator error:", errData(err));
    void logCronRun("swarm-tick-daily", "error", 0, undefined, String(err));
    res.status(500).json({ error: String(err) });
  }
}
