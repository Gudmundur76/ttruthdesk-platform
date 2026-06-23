/**
 * quantumVqePoller.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Heartbeat job that polls pending WuKong VQE hardware jobs and upgrades
 * citation edge provenance_status to "quantum-hardware" when complete.
 *
 * Called by the periodic heartbeat scheduler every 5 minutes.
 *
 * Flow:
 *   1. Query quantum_vqe_jobs WHERE status IN ('pending', 'computing')
 *   2. For each job, call vqeScorer.py --mode poll --job-id <id>
 *   3. If result.provenance_status === "quantum-hardware":
 *      - Update quantum_vqe_jobs.status = "done", vqe_energy = result.vqe_energy
 *      - Update the linked citation_edges.quantumProvenance JSON to include
 *        quantum_hardware field and provenance_status = "quantum-hardware"
 *      - Log a frontier_log entry for the upgrade
 *   4. If result.status === "computing" or "pending": leave as-is (retry next tick)
 *   5. If result.provenance_status === "quantum-architecture" (failed): mark failed
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { spawn } from "child_process";
import path from "path";
import { getDb } from "../db";
import { quantumVqeJobs } from "../../drizzle/schema";
import { eq, inArray } from "drizzle-orm";
import { ENV } from "../_core/env";

const VQE_SCORER_PATH = path.resolve(
  process.cwd(),
  "server/quantum/vqeScorer.py"
);

interface VqePollResult {
  vqe_energy?: number;
  backend?: string;
  hardware?: string;
  job_id?: string;
  status?: string;
  error?: string;
  provenance_status: "quantum-hardware" | "quantum-architecture" | "pending";
}

/**
 * Run vqeScorer.py --mode poll for a given job_id.
 * Returns the parsed JSON result or an error object.
 */
async function pollVqeJob(
  jobId: string,
  backend: string
): Promise<VqePollResult> {
  return new Promise(resolve => {
    const apiKey = ENV.originqApiKey ?? "";
    if (!apiKey) {
      resolve({
        error: "ORIGINQ_API_KEY not set",
        provenance_status: "quantum-architecture",
      });
      return;
    }

    const args = [
      VQE_SCORER_PATH,
      "--mode",
      "poll",
      "--job-id",
      jobId,
      "--backend",
      backend,
      "--api-key",
      apiKey,
    ];

    let stdout = "";
    let stderr = "";
    const proc = spawn("python3", args, { timeout: 45_000 });

    proc.stdout.on("data", (d: Buffer) => {
      stdout += d.toString();
    });
    proc.stderr.on("data", (d: Buffer) => {
      stderr += d.toString();
    });
    proc.on("close", code => {
      try {
        const result = JSON.parse(stdout.trim()) as VqePollResult;
        resolve(result);
      } catch {
        resolve({
          error: `vqeScorer parse error (exit ${code}): ${stderr.slice(0, 200)}`,
          provenance_status: "quantum-architecture",
        });
      }
    });
    proc.on("error", err => {
      resolve({
        error: `vqeScorer spawn error: ${err.message}`,
        provenance_status: "quantum-architecture",
      });
    });
  });
}

/**
 * Main poller — called by the heartbeat scheduler.
 * Returns a summary of actions taken.
 */
export async function runQuantumVqePoller(): Promise<{
  polled: number;
  upgraded: number;
  failed: number;
  pending: number;
}> {
  // Fetch all pending/computing jobs
  const database = await getDb();
  if (!database) return { polled: 0, upgraded: 0, failed: 0, pending: 0 };

  const pendingJobs = await database
    .select()
    .from(quantumVqeJobs)
    .where(inArray(quantumVqeJobs.status, ["pending", "computing"]));

  if (pendingJobs.length === 0) {
    return { polled: 0, upgraded: 0, failed: 0, pending: 0 };
  }

  let upgraded = 0;
  let failed = 0;
  let stillPending = 0;

  for (const job of pendingJobs) {
    const result = await pollVqeJob(job.jobId, job.backend);

    if (
      result.provenance_status === "quantum-hardware" &&
      result.vqe_energy !== undefined
    ) {
      // Job completed — mark done and store energy
      await database
        .update(quantumVqeJobs)
        .set({
          status: "done",
          vqeEnergyHartree: result.vqe_energy,
          completedAt: new Date(),
        })
        .where(eq(quantumVqeJobs.id, job.id));

      // TODO: update citation_edges.quantumProvenance JSON when citationEdgeId is set
      // This requires a JSON_SET or re-serialization of the quantumProvenance column.
      // Deferred to Phase 3 (Provenance page badge) which will read from quantum_vqe_jobs directly.

      upgraded++;
    } else if (
      result.provenance_status === "quantum-architecture" &&
      result.error
    ) {
      // Job failed
      await database
        .update(quantumVqeJobs)
        .set({
          status: "failed",
          errorMessage: result.error,
          completedAt: new Date(),
        })
        .where(eq(quantumVqeJobs.id, job.id));
      failed++;
    } else {
      // Still computing / pending
      if (result.status === "computing") {
        await database
          .update(quantumVqeJobs)
          .set({ status: "computing" })
          .where(eq(quantumVqeJobs.id, job.id));
      }
      stillPending++;
    }
  }

  return {
    polled: pendingJobs.length,
    upgraded,
    failed,
    pending: stillPending,
  };
}
