/**
 * server/embeddingCoverageAudit.ts
 * Phase 124a — Report what % of eligible claims are indexed in TurboVec.
 *
 * "Eligible" = verdict IN ('Supported', 'Partially Supported').
 * "Indexed"  = the count reported by the sidecar's /health endpoint.
 *
 * Note: the sidecar count is an approximation — it counts all items ever
 * indexed (including those from deleted claims). A future phase can add a
 * /count?ids=[...] endpoint to the sidecar for exact coverage. For now,
 * the approximation is sufficient for operational monitoring.
 */
import { getDb } from "./db";
import { isSidecarAvailable } from "./vectorStore";
import { logger, errData } from "./logger";
import { claims } from "../drizzle/schema";
import { inArray, count } from "drizzle-orm";

const log = logger("embeddingCoverageAudit");

const SIDECAR_URL = process.env.TURBOVEC_SIDECAR_URL ?? "http://localhost:8765";
const SIDECAR_TIMEOUT_MS = 5_000;

const ELIGIBLE_VERDICTS = ["Supported", "Partially Supported"] as const;

export interface EmbeddingCoverageReport {
  /** Number of claims with an eligible verdict in the DB. */
  eligible: number;
  /** Number of items currently indexed in the sidecar (approximation). */
  indexed: number;
  /** Coverage percentage (0–100). 0 when sidecar is unavailable. */
  pct: number;
  /** Whether the sidecar responded to the health check. */
  sidecarAvailable: boolean;
  /** ISO timestamp of the audit. */
  auditedAt: string;
}

export async function getEmbeddingCoverage(): Promise<EmbeddingCoverageReport> {
  const auditedAt = new Date().toISOString();

  const sidecarAvailable = await isSidecarAvailable();

  // Count eligible claims in DB
  let eligible = 0;
  const db = await getDb();
  if (db) {
    try {
      const rows = await db
        .select({ count: count() })
        .from(claims)
        .where(inArray(claims.verdict, [...ELIGIBLE_VERDICTS]));
      eligible = rows[0]?.count ?? 0;
    } catch (err) {
      log.warn("[embeddingCoverageAudit] DB count failed:", errData(err));
    }
  }

  if (!sidecarAvailable) {
    return { eligible, indexed: 0, pct: 0, sidecarAvailable: false, auditedAt };
  }

  // Get indexed count from sidecar /health
  let indexed = 0;
  try {
    const res = await fetch(`${SIDECAR_URL}/health`, {
      signal: AbortSignal.timeout(SIDECAR_TIMEOUT_MS),
    });
    if (res.ok) {
      const data = (await res.json()) as { indexed?: number };
      indexed = data.indexed ?? 0;
    }
  } catch (err) {
    log.warn(
      "[embeddingCoverageAudit] Sidecar health check failed:",
      errData(err)
    );
    return { eligible, indexed: 0, pct: 0, sidecarAvailable: false, auditedAt };
  }

  const pct =
    eligible === 0
      ? 100
      : Math.min(100, Math.round((indexed / eligible) * 100));

  log.info(
    `[embeddingCoverageAudit] eligible=${eligible} indexed=${indexed} pct=${pct}%`
  );

  return { eligible, indexed, pct, sidecarAvailable: true, auditedAt };
}
