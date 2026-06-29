/**
 * directivePublisher.ts — CTC-wired directive publication for the autonomous loop.
 *
 * Responsibilities:
 *   1. Publish `frontier_directive` events to the event bus (with HMAC signing).
 *   2. Record each directive as a CTC decision cycle so the MRAgent can reconstruct
 *      "why was this directive issued?" and "what was the outcome?".
 *   3. Provide `recordDirectiveOutcome()` to close the loop when a directive completes.
 *
 * Design:
 *   - CTC writes are fire-and-forget (never block the event bus).
 *   - Directive IDs are UUIDs so they can be correlated across bus events and CTC.
 *   - All errors are caught and logged; no directive publication ever throws.
 *
 * Usage:
 *   const publisher = getDirectivePublisher();
 *   const id = await publisher.publishDirective({ triggerReason: 'gap_detected', ... });
 *   // ... later ...
 *   await publisher.recordDirectiveOutcome(id, 'complete', { iterationsUsed: 3 });
 */

import { randomUUID } from "crypto";
import { publishEvent } from "./autonomousLoop/eventBus";
import { logger } from "./logger";
import { spawn } from "child_process";
import { join } from "path";
import { homedir } from "os";

const log = logger("directivePublisher");

// ── Types ─────────────────────────────────────────────────────────────────────

export type DirectiveTriggerReason =
  | "convergence_stalled"
  | "confidence_low"
  | "gap_detected"
  | "scheduled"
  | "manual";

export interface DirectiveRequest {
  triggerReason: DirectiveTriggerReason;
  targetGapIds?: string[];
  priority?: number;
  maxIterations?: number;
  evidenceStrengthThreshold?: number;
  /** Optional metadata stored in CTC but not sent on the bus. */
  meta?: Record<string, unknown>;
}

export interface DirectiveOutcome {
  status: "complete" | "max_iterations_reached" | "cancelled" | "failed";
  iterationsUsed?: number;
  hypothesesGenerated?: number;
  durationMs?: number;
  errorMessage?: string;
}

// ── CTC sidecar path ──────────────────────────────────────────────────────────

const EVOLVA_MRAGENT_PATH = join(homedir(), "evolva-mragent");
const CTC_SIDECAR_PATH = join(EVOLVA_MRAGENT_PATH, "ctc_sidecar.py");
const CTC_DB_PATH = join(
  homedir(),
  ".codebase-memory",
  "ctc_citation_graph.db"
);
const PYTHON = process.env["PYTHON_BIN"] ?? "python3";

// ── CTC sidecar call (fire-and-forget) ───────────────────────────────────────

async function callCTCSidecar(
  method: string,
  args: Record<string, unknown>
): Promise<void> {
  return new Promise(resolve => {
    try {
      const input = JSON.stringify({ method, args });
      const proc = spawn(
        PYTHON,
        [CTC_SIDECAR_PATH, "--instance", "ttruthdesk", "--db", CTC_DB_PATH, "--port", "7700"],
        { env: { ...process.env, PYTHONPATH: EVOLVA_MRAGENT_PATH } }
      );

      // The HTTP sidecar doesn't read stdin — use the stdin/stdout integration sidecar instead
      // Fallback: call the integration sidecar directly (stdin/stdout protocol)
      const INTEGRATION_SIDECAR = join(
        EVOLVA_MRAGENT_PATH,
        "integrations",
        "ttruthdesk-platform",
        "ctc_citation_sidecar.py"
      );
      proc.kill();

      const proc2 = spawn(PYTHON, [INTEGRATION_SIDECAR], {
        env: { ...process.env, PYTHONPATH: EVOLVA_MRAGENT_PATH },
      });

      let _stdout = "";
      let stderr = "";
      proc2.stdout.on("data", (d: Buffer) => { _stdout += d.toString(); });
      proc2.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });
      proc2.on("close", (code: number) => {
        if (code !== 0) {
          log.warn("[DirectivePublisher] CTC sidecar exited non-zero", {
            code,
            stderr: stderr.slice(0, 200),
          });
        }
        resolve();
      });
      proc2.on("error", () => resolve());
      proc2.stdin.write(input);
      proc2.stdin.end();
    } catch {
      resolve();
    }
  });
}

// ── DirectivePublisher ────────────────────────────────────────────────────────

export class DirectivePublisher {
  /** Publish a frontier_directive event and record it in CTC. Returns the directive UUID. */
  async publishDirective(req: DirectiveRequest): Promise<string> {
    const directiveId = randomUUID();
    const now = new Date().toISOString();

    // 1. Publish to event bus
    try {
      await publishEvent("frontier_directive", {
        directiveId,
        triggerReason: req.triggerReason,
        priority: req.priority ?? 5,
        targetGapIds: req.targetGapIds ?? [],
        maxIterations: req.maxIterations ?? 10,
        evidenceStrengthThreshold: req.evidenceStrengthThreshold ?? 0.6,
      });
    } catch (err) {
      log.error("[DirectivePublisher] Failed to publish frontier_directive event", {
        directiveId,
        err: (err as Error).message,
      });
      // Still record in CTC even if bus publish fails
    }

    // 2. Record in CTC (fire-and-forget)
    callCTCSidecar("ingest_chain", {
      db_path: CTC_DB_PATH,
      episode: {
        source_pmid: `directive:${directiveId}`,
        source_title: `Directive — ${req.triggerReason}`,
        original_claim: JSON.stringify({
          directiveId,
          triggerReason: req.triggerReason,
          priority: req.priority ?? 5,
          targetGapIds: req.targetGapIds ?? [],
          maxIterations: req.maxIterations ?? 10,
          issuedAt: now,
          meta: req.meta ?? {},
        }),
        hops: [],
        max_distortion_score: 0,
        dominant_distortion_type: "directive",
        analyzed_at: now,
      },
    }).catch(e =>
      log.warn("[DirectivePublisher] CTC ingest error", {
        err: (e as Error).message,
      })
    );

    log.info("[DirectivePublisher] Directive published", {
      directiveId,
      triggerReason: req.triggerReason,
      priority: req.priority ?? 5,
    });

    return directiveId;
  }

  /**
   * Record the outcome of a directive in CTC.
   * Call this when a frontier_complete event is received.
   */
  async recordDirectiveOutcome(
    directiveId: string,
    outcome: DirectiveOutcome
  ): Promise<void> {
    const now = new Date().toISOString();

    callCTCSidecar("ingest_chain", {
      db_path: CTC_DB_PATH,
      episode: {
        source_pmid: `directive_outcome:${directiveId}`,
        source_title: `Directive Outcome — ${outcome.status}`,
        original_claim: JSON.stringify({
          directiveId,
          status: outcome.status,
          iterationsUsed: outcome.iterationsUsed ?? 0,
          hypothesesGenerated: outcome.hypothesesGenerated ?? 0,
          durationMs: outcome.durationMs ?? 0,
          errorMessage: outcome.errorMessage,
          recordedAt: now,
        }),
        hops: [],
        max_distortion_score: outcome.status === "failed" ? 1.0 : 0,
        dominant_distortion_type:
          outcome.status === "complete" ? "faithful" : "unknown",
        analyzed_at: now,
      },
    }).catch(e =>
      log.warn("[DirectivePublisher] CTC outcome ingest error", {
        err: (e as Error).message,
      })
    );

    log.info("[DirectivePublisher] Directive outcome recorded", {
      directiveId,
      status: outcome.status,
    });
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

let _instance: DirectivePublisher | null = null;

export function getDirectivePublisher(): DirectivePublisher {
  if (!_instance) _instance = new DirectivePublisher();
  return _instance;
}
