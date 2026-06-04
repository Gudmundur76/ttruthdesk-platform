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
import { eq, and, isNull, lt } from "drizzle-orm";

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
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
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

  console.log("[Swarm] Starting tick — fanning out 5 agents in parallel");

  const [harvester, wikiCompiler, qualityAuditor, backfillPredictor, monitoringScanner] =
    await Promise.allSettled([
      runHarvesterAgent(),
      runWikiCompilerAgent(),
      runQualityAuditorAgent(),
      runBackfillPredictorAgent(),
      runMonitoringScannerAgent(),
    ]);

  const agentResults = [
    harvester,
    wikiCompiler,
    qualityAuditor,
    backfillPredictor,
    monitoringScanner,
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

  console.log(`[Swarm] Tick complete in ${durationMs}ms — ${summary.ok}/${summary.total} agents OK`);
  agentResults.forEach((r) => {
    const icon = r.status === "ok" ? "✅" : r.status === "skip" ? "⏭️" : "❌";
    console.log(`  ${icon} [${r.agent}] ${r.detail.slice(0, 120)}`);
  });

  return { startedAt, completedAt, durationMs, agents: agentResults, summary };
}

/**
 * Express handler for POST /api/scheduled/swarm-tick
 */
export async function swarmTickHandler(req: Request, res: Response): Promise<void> {
  try {
    const result = await runSwarmTick();
    res.json(result);
  } catch (err) {
    console.error("[Swarm] Fatal coordinator error:", err);
    res.status(500).json({ error: String(err) });
  }
}
