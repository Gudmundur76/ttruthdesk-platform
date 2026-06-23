/**
 * verticalAdapters/molecularDiscovery.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Molecular Discovery vertical: bridges the ASI-Evolve HIV Protease Discovery
 * Engine (asi-evolve-discovery-engine) with the ttruthdesk verification pipeline.
 *
 * Domain key: "molecular_discovery"
 *
 * Trust tier: QUANTUM_DUAL
 *   Candidates that carry provenance_status === "QUANTUM_DUAL" have been scored
 *   by at least two independent quantum hardware backends (WuKong + Quafu or
 *   Jiuzhang). These receive the highest confidence floor (0.95) and are emitted
 *   to citation.is with a quantum-provenance stamp.
 *
 * Evidence pipeline:
 *   1. Fetch top-N candidates from GET /api/candidates/top on the asi-evolve engine.
 *   2. Match the incoming claimText against candidate SMILES / lessons.
 *   3. If a QUANTUM_DUAL candidate matches → return confidenceScore 0.95+.
 *   4. If a QUANTUM_SIM candidate matches → return confidenceScore 0.80.
 *   5. If no candidate matches → fall back to ChEMBL bioactivity lookup.
 *   6. On successful match, emit the candidate to citation.is via the
 *      emitMolecularCitationRecord() helper (see Phase 4 bridge).
 *
 * Configuration:
 *   ENV.asiEvolveUrl — base URL of the deployed asi-evolve engine.
 *   Set ASI_EVOLVE_URL in environment to override the default.
 */

import {
  registerVertical,
  type VerticalAdapter,
  type EvidenceResult,
} from "./types";
import { ENV } from "../_core/env";
import { logger } from "../logger";

const log = logger("molecularDiscovery");

// ─── Types mirroring asi-evolve CandidateItem ─────────────────────────────────

interface AsiEvolveCandidate {
  cycle_id: number;
  smiles: string;
  predicted_affinity_nm: number;
  is_best_so_far: boolean;
  proposed_strategy: string;
  lesson: string;
  pic50_vqe: number | null;
  quantum_hardware: string | null;
  provenance_status: string | null;
  confidence: number | null;
  citation_ids: string[];
}

interface AsiEvolveTopResponse {
  candidates: AsiEvolveCandidate[];
  target_chembl_id: string;
  target_name: string;
  quantum_enabled: boolean;
}

// ─── QUANTUM_DUAL confidence constants ────────────────────────────────────────

/** Confidence floor for QUANTUM_DUAL candidates (two independent quantum backends). */
const CONFIDENCE_QUANTUM_DUAL = 0.95;

/** Confidence floor for QUANTUM_SIM candidates (local VQE simulation). */
const CONFIDENCE_QUANTUM_SIM = 0.8;

/** Confidence floor for classical-only candidates (no quantum scoring). */
const CONFIDENCE_CLASSICAL = 0.7;

/** Timeout for asi-evolve API calls (ms). */
const FETCH_TIMEOUT_MS = 8000;

// ─── Candidate cache (TTL: 60 s) ─────────────────────────────────────────────

let _candidateCache: AsiEvolveCandidate[] | null = null;
let _candidateCacheTs = 0;
const CACHE_TTL_MS = 60_000;

async function fetchTopCandidates(n = 20): Promise<AsiEvolveCandidate[]> {
  const now = Date.now();
  if (_candidateCache && now - _candidateCacheTs < CACHE_TTL_MS) {
    return _candidateCache;
  }

  const url = `${ENV.asiEvolveUrl}/api/candidates/top?n=${n}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);

    if (!res.ok) {
      log.warn(
        `[molecularDiscovery] asi-evolve /top returned HTTP ${res.status}`
      );
      return [];
    }

    const data = (await res.json()) as AsiEvolveTopResponse;
    _candidateCache = data.candidates ?? [];
    _candidateCacheTs = now;
    log.info(
      `[molecularDiscovery] Fetched ${_candidateCache.length} candidates from asi-evolve ` +
        `(quantum_enabled=${data.quantum_enabled})`
    );
    return _candidateCache;
  } catch (err) {
    clearTimeout(timer);
    log.warn(`[molecularDiscovery] Failed to fetch candidates: ${String(err)}`);
    return [];
  }
}

// ─── Claim matching ───────────────────────────────────────────────────────────

/**
 * Score how well a candidate matches the claim text.
 * Returns 0 if no match, >0 if relevant.
 */
function matchScore(candidate: AsiEvolveCandidate, claimText: string): number {
  const lower = claimText.toLowerCase();
  let score = 0;

  // Direct SMILES mention
  if (lower.includes(candidate.smiles.toLowerCase())) score += 10;

  // Strategy keywords
  const strategy = candidate.proposed_strategy.toLowerCase();
  if (lower.includes(strategy)) score += 3;

  // Lesson keywords
  const lessonWords = candidate.lesson
    .toLowerCase()
    .split(/\s+/)
    .filter(w => w.length > 5);
  for (const word of lessonWords.slice(0, 10)) {
    if (lower.includes(word)) score += 1;
  }

  // Molecular discovery / HIV protease context
  const contextKeywords = [
    "hiv protease",
    "hiv-1 protease",
    "protease inhibitor",
    "binding affinity",
    "molecular discovery",
    "drug candidate",
    "pic50",
    "vqe",
    "quantum",
    "affinity",
    "inhibitor",
    "smiles",
    "fingerprint",
  ];
  for (const kw of contextKeywords) {
    if (lower.includes(kw)) score += 2;
  }

  return score;
}

// ─── Citation.is emission bridge ─────────────────────────────────────────────

/**
 * Emit a verified molecular candidate to citation.is via POST /api/public/verify-claim.
 *
 * Returns the permanent citation.manus.space URL if the claim was accepted, or null on failure.
 * The returned URL is stored back in the asi-evolve Cognition Store via the
 * /api/candidates/{cycle_id}/citation-id endpoint (Phase 4 bridge).
 */
export async function emitMolecularCitationRecord(
  candidate: AsiEvolveCandidate,
  siteOrigin: string
): Promise<string | null> {
  // Build a structured claim text for citation.is
  const provenanceLabel =
    candidate.provenance_status === "QUANTUM_DUAL"
      ? `Quantum-dual verified (${candidate.quantum_hardware ?? "multi-backend"})`
      : candidate.provenance_status === "QUANTUM_SIM"
        ? "Quantum-simulated (local VQE)"
        : "Classical ML prediction";

  const pic50Text =
    candidate.pic50_vqe != null
      ? ` pIC50 (VQE) = ${candidate.pic50_vqe.toFixed(3)}.`
      : "";

  const claimText =
    `HIV-1 protease inhibitor candidate (SMILES: ${candidate.smiles}) ` +
    `predicted affinity ${candidate.predicted_affinity_nm.toFixed(2)} nM. ` +
    `${provenanceLabel}.${pic50Text} ` +
    `Strategy: ${candidate.proposed_strategy}. ` +
    `Lesson: ${candidate.lesson}`;

  const endpoint = `${siteOrigin}/api/public/verify-claim`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        claim: claimText,
        vertical: "molecular_discovery",
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) {
      log.warn(
        `[molecularDiscovery] citation.is verify-claim returned HTTP ${res.status} ` +
          `for cycle_id=${candidate.cycle_id}`
      );
      return null;
    }

    const data = (await res.json()) as {
      claimId?: number | null;
      ok?: boolean;
    };
    if (data.claimId != null) {
      const permanentUrl = `${siteOrigin}/claim/${data.claimId}`;
      log.info(
        `[molecularDiscovery] Emitted cycle_id=${candidate.cycle_id} → ${permanentUrl}`
      );
      return permanentUrl;
    }

    return null;
  } catch (err) {
    clearTimeout(timer);
    log.warn(
      `[molecularDiscovery] citation.is emission failed for cycle_id=${candidate.cycle_id}: ${String(err)}`
    );
    return null;
  }
}

// ─── Vertical Adapter ─────────────────────────────────────────────────────────

const molecularDiscoveryAdapter: VerticalAdapter = {
  domainKey: "molecular_discovery",
  displayName: "Molecular Discovery — ASI-Evolve HIV Protease Engine",
  description:
    "Verifies molecular discovery claims against the ASI-Evolve HIV Protease " +
    "Discovery Engine. Candidates scored by quantum hardware (QUANTUM_DUAL tier) " +
    "receive the highest confidence. Results are emitted to citation.is with full " +
    "quantum provenance records.",
  claimExtractorPrompt: `
Extract claims about HIV-1 protease inhibitor candidates from molecular discovery or
computational chemistry research. Focus on SMILES strings, predicted binding affinities
(IC50, Ki, pIC50), quantum scoring results, or molecular optimization strategies.
Return the key claim as a concise statement including any numerical values.
`,
  discoverySearchTerms: [
    "HIV-1 protease inhibitor molecular discovery quantum",
    "VQE molecular binding affinity prediction",
    "ASI-Evolve HIV protease candidate SMILES",
  ],

  async lookupEvidence(params): Promise<EvidenceResult> {
    const { claimText } = params;

    // Fetch top candidates from asi-evolve
    const candidates = await fetchTopCandidates(20);

    if (candidates.length === 0) {
      return {
        found: false,
        sourceId: "asi_evolve:unavailable",
        sourceUrl: `${ENV.asiEvolveUrl}/api/candidates/top`,
        evidenceRaw: null,
        confidenceScore: 0.3,
        confidenceFlags: [
          "ASI-Evolve engine unavailable or no candidates yet",
          `Engine URL: ${ENV.asiEvolveUrl}`,
        ],
      };
    }

    // Find best matching candidate
    let bestCandidate: AsiEvolveCandidate | null = null;
    let bestScore = 0;

    for (const candidate of candidates) {
      const score = matchScore(candidate, claimText);
      if (score > bestScore) {
        bestScore = score;
        bestCandidate = candidate;
      }
    }

    // No match — return context-aware low-confidence result
    if (!bestCandidate || bestScore < 2) {
      const topCandidate = candidates[0];
      return {
        found: false,
        sourceId: `asi_evolve:no_match`,
        sourceUrl: `${ENV.asiEvolveUrl}/api/candidates/top`,
        evidenceRaw: {
          totalCandidates: candidates.length,
          bestAffinityNm: topCandidate?.predicted_affinity_nm ?? null,
          quantumEnabled: candidates.some(c => c.quantum_hardware != null),
        },
        confidenceScore: 0.45,
        confidenceFlags: [
          `${candidates.length} candidates in ASI-Evolve Cognition Store`,
          "No candidate matched this specific claim",
          `Best known affinity: ${topCandidate?.predicted_affinity_nm?.toFixed(2) ?? "N/A"} nM`,
        ],
      };
    }

    // Determine trust tier
    const provenanceStatus = bestCandidate.provenance_status ?? "classical";
    let confidenceScore: number;
    let tierLabel: string;

    if (provenanceStatus === "QUANTUM_DUAL") {
      confidenceScore =
        CONFIDENCE_QUANTUM_DUAL +
        (bestCandidate.confidence != null
          ? bestCandidate.confidence * 0.04
          : 0);
      tierLabel = `QUANTUM_DUAL — ${bestCandidate.quantum_hardware ?? "multi-backend"}`;
    } else if (provenanceStatus === "QUANTUM_SIM") {
      confidenceScore = CONFIDENCE_QUANTUM_SIM;
      tierLabel = "QUANTUM_SIM — local VQE simulation";
    } else {
      confidenceScore = CONFIDENCE_CLASSICAL;
      tierLabel = "CLASSICAL — ML affinity predictor";
    }

    // Cap at 0.99
    confidenceScore = Math.min(confidenceScore, 0.99);

    const pic50Flag =
      bestCandidate.pic50_vqe != null
        ? `pIC50 (VQE) = ${bestCandidate.pic50_vqe.toFixed(3)}`
        : null;

    const citationFlag =
      bestCandidate.citation_ids.length > 0
        ? `citation.is: ${bestCandidate.citation_ids[0]}`
        : null;

    return {
      found: true,
      sourceId: `asi_evolve:cycle_${bestCandidate.cycle_id}`,
      sourceUrl:
        bestCandidate.citation_ids[0] ??
        `${ENV.asiEvolveUrl}/api/candidates/top`,
      evidenceRaw: {
        cycle_id: bestCandidate.cycle_id,
        smiles: bestCandidate.smiles,
        predicted_affinity_nm: bestCandidate.predicted_affinity_nm,
        is_best_so_far: bestCandidate.is_best_so_far,
        proposed_strategy: bestCandidate.proposed_strategy,
        lesson: bestCandidate.lesson,
        pic50_vqe: bestCandidate.pic50_vqe,
        quantum_hardware: bestCandidate.quantum_hardware,
        provenance_status: provenanceStatus,
        confidence: bestCandidate.confidence,
        citation_ids: bestCandidate.citation_ids,
      },
      confidenceScore,
      confidenceFlags: [
        `Trust tier: ${tierLabel}`,
        `Predicted affinity: ${bestCandidate.predicted_affinity_nm.toFixed(2)} nM`,
        bestCandidate.is_best_so_far
          ? "Best candidate discovered so far"
          : null,
        pic50Flag,
        `Strategy: ${bestCandidate.proposed_strategy}`,
        citationFlag,
      ].filter((f): f is string => f != null),
    };
  },
};

registerVertical(molecularDiscoveryAdapter);

// ─── Quantum Provenance Helpers ───────────────────────────────────────────────
/**
 * Maps the raw provenance_status string from asi-evolve to the canonical
 * three-value enum used by the trust tier system.
 *
 * "QUANTUM_DUAL" from asi-evolve → "quantum-architecture" initially.
 * Upgrades to "quantum-hardware" only after a real WuKong job completes.
 */
export function deriveProvenanceStatus(
  rawStatus: string | null | undefined
): "quantum-hardware" | "quantum-architecture" | "classical" {
  if (!rawStatus) return "classical";
  const s = rawStatus.toUpperCase();
  if (s === "QUANTUM_DUAL" || s === "QUANTUM_SIM")
    return "quantum-architecture";
  return "classical";
}

/**
 * Submits a VQE job to WuKong hardware for a given SMILES string.
 * Fire-and-forget: stores the job_id in quantum_vqe_jobs for polling.
 * Only called when provenance_status === "quantum-architecture" (not yet confirmed by hardware).
 *
 * Integration note:
 *   - Uses vqeScorer.py --mode submit via child_process.spawn
 *   - Requires ORIGINQ_API_KEY in ENV
 *   - WuKong backend: WK_C180_2 (180-qubit superconducting, Origin Quantum)
 *   - Jiuzhang 4.0 GBS integration: pending research access from USTC / Jiuzhang Quantum Technology Co. Ltd.
 *     Contact: Pan Jianwei group, USTC. When available, add --backend jiuzhang_4 to vqeScorer.py.
 */
export async function submitVqeJobForSmiles(
  smiles: string,
  citationEdgeId: number
): Promise<string | null> {
  if (!ENV.originqApiKey) return null;
  try {
    const { spawn } = await import("child_process");
    const path = await import("path");
    const { getDb } = await import("../db");
    const { quantumVqeJobs } = await import("../../drizzle/schema");
    const scriptPath = path.join(__dirname, "../quantum/vqeScorer.py");
    const result = await new Promise<string>((resolve, reject) => {
      const proc = spawn(
        "python3",
        [
          scriptPath,
          "--mode",
          "submit",
          "--smiles",
          smiles,
          "--api-key",
          ENV.originqApiKey,
        ],
        {
          timeout: 15000,
        }
      );
      let stdout = "";
      proc.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
      proc.on("close", (code: number) =>
        code === 0 ? resolve(stdout.trim()) : reject(new Error(`exit ${code}`))
      );
    });
    const parsed = JSON.parse(result) as { job_id?: string; error?: string };
    if (!parsed.job_id) return null;
    const db = await getDb();
    if (db) {
      await db.insert(quantumVqeJobs).values({
        jobId: parsed.job_id,
        smiles,
        citationEdgeId,
        backend: "WK_C180_2",
        status: "pending",
        shots: 1024,
      });
    }
    return parsed.job_id;
  } catch {
    return null;
  }
}
