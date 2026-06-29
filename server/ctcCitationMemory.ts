/**
 * ctcCitationMemory.ts — MRAgent Cue-Tag-Content memory layer for citation-desk
 *
 * Augments the citation chain analyzer with episodic memory so the system can:
 *   - Reconstruct "how has this claim been distorted across the literature?"
 *   - Answer "what papers cite PMID X and how faithfully?"
 *   - Trace multi-hop distortion paths via active reconstruction
 *   - Identify recurring distortion patterns across domains
 *
 * Architecture:
 *   - Each citation chain analysis result is ingested as a CTC episode
 *   - Cues: PMIDs, DOIs, claim keywords, distortion types
 *   - Tags: temporal (year), domain (journal/field), personal (author), topic (claim type)
 *   - Content: the actual hop text, distortion rationale, citing claim text
 *
 * Paper: "Memory is Reconstructed, Not Retrieved" (Ji, Li, Hooi — ICML 2026)
 */

import { spawn } from "child_process";
import { join } from "path";
import { homedir } from "os";
import { existsSync } from "fs";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CitationEpisode {
  /** Source paper PMID */
  source_pmid: string;
  /** Source paper title */
  source_title?: string;
  /** The original claim being traced */
  original_claim: string;
  /** Each hop in the citation chain */
  hops: Array<{
    pmid: string;
    title: string;
    doi?: string;
    hop_number: number;
    distortion_score: number;
    distortion_type: string;
    distortion_rationale?: string;
    citing_claim_text?: string;
  }>;
  /** Overall max distortion score */
  max_distortion_score: number;
  /** Dominant distortion type */
  dominant_distortion_type: string;
  /** ISO timestamp when this analysis was run */
  analyzed_at: string;
}

export interface CitationReconstructionResult {
  question: string;
  answer: string;
  supports: string[];
  confidence: "high" | "medium" | "low";
  reasoning: string;
  tool_calls_made: number;
  rounds: number;
  evidence_texts: string[];
}

export interface DistortionPatternResult {
  distortion_type: string;
  count: number;
  example_pmids: string[];
  avg_score: number;
  description: string;
}

// ── Paths ─────────────────────────────────────────────────────────────────────

const EVOLVA_MRAGENT_PATH = join(homedir(), "evolva-mragent");
const CTC_DB_PATH = join(
  homedir(),
  ".codebase-memory",
  "ctc_citation_graph.db"
);
const SIDECAR_PATH = join(
  EVOLVA_MRAGENT_PATH,
  "integrations",
  "ttruthdesk-platform",
  "ctc_citation_sidecar.py"
);
const PYTHON = process.env["PYTHON_BIN"] ?? "python3";

// ── Sidecar communication ─────────────────────────────────────────────────────

async function callSidecar<T>(
  method: string,
  args: Record<string, unknown>
): Promise<T> {
  return new Promise((resolve, reject) => {
    const input = JSON.stringify({ method, args });
    const proc = spawn(PYTHON, [SIDECAR_PATH], {
      env: { ...process.env, PYTHONPATH: EVOLVA_MRAGENT_PATH },
    });

    let stdout = "";
    let stderr = "";

    proc.stdin.write(input + "\n");
    proc.stdin.end();
    proc.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    proc.stderr.on("data", (d: Buffer) => (stderr += d.toString()));

    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error("CTC citation sidecar timeout (90s)"));
    }, 90_000);

    proc.on("close", (code: number) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(
          new Error(
            `CTC citation sidecar exited ${code}: ${stderr.slice(0, 500)}`
          )
        );
        return;
      }
      try {
        resolve(JSON.parse(stdout.trim()) as T);
      } catch {
        reject(
          new Error(
            `CTC citation sidecar JSON parse error: ${stdout.slice(0, 200)}`
          )
        );
      }
    });

    proc.on("error", reject);
  });
}

// ── CTCCitationMemory class ───────────────────────────────────────────────────

export class CTCCitationMemory {
  private readonly dbPath: string;
  private readonly enabled: boolean;

  constructor(dbPath = CTC_DB_PATH) {
    this.dbPath = dbPath;
    this.enabled = existsSync(EVOLVA_MRAGENT_PATH) && existsSync(SIDECAR_PATH);
    if (!this.enabled) {
      console.warn(
        "[CTCCitationMemory] evolva-mragent not found — CTC citation memory disabled"
      );
    }
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Ingest a citation chain analysis result into the CTC graph.
   * Called automatically from analyzeCitationChain() after each successful analysis.
   * Non-blocking — errors are logged but do not throw.
   */
  async ingestChain(episode: CitationEpisode): Promise<void> {
    if (!this.enabled) return;
    try {
      await callSidecar<{ ok: boolean }>("ingest_chain", {
        episode,
        db_path: this.dbPath,
      });
    } catch (e) {
      console.error(
        "[CTCCitationMemory] ingestChain error:",
        (e as Error).message
      );
    }
  }

  /**
   * Run MRAgent active reconstruction to answer a question about the citation graph.
   *
   * Examples:
   *   "How has the claim that protein X causes disease Y been distorted in the literature?"
   *   "Which papers citing PMID 12345678 show the highest distortion?"
   *   "What is the dominant distortion pattern for claims about mRNA vaccines?"
   *   "Has any paper reversed the original finding from PMID 98765432?"
   */
  async reconstruct(question: string): Promise<CitationReconstructionResult> {
    if (!this.enabled) {
      return {
        question,
        answer: "CTC citation memory not available.",
        supports: [],
        confidence: "low",
        reasoning: "evolva-mragent not installed",
        tool_calls_made: 0,
        rounds: 0,
        evidence_texts: [],
      };
    }
    try {
      return await callSidecar<CitationReconstructionResult>("reconstruct", {
        question,
        domain: "citation",
        db_path: this.dbPath,
      });
    } catch (e) {
      return {
        question,
        answer: `Reconstruction failed: ${(e as Error).message}`,
        supports: [],
        confidence: "low",
        reasoning: (e as Error).message,
        tool_calls_made: 0,
        rounds: 0,
        evidence_texts: [],
      };
    }
  }

  /**
   * Get all distortion patterns observed for a specific source PMID.
   * Returns a ranked list of distortion types with examples.
   */
  async getDistortionPatterns(
    sourcePmid: string
  ): Promise<DistortionPatternResult[]> {
    if (!this.enabled) return [];
    try {
      const result = await callSidecar<{ patterns: DistortionPatternResult[] }>(
        "distortion_patterns",
        { source_pmid: sourcePmid, db_path: this.dbPath }
      );
      return result.patterns ?? [];
    } catch {
      return [];
    }
  }

  /**
   * Trace the full distortion path from a source PMID through all known hops.
   * Returns an ordered chain of episodes with distortion scores.
   */
  async traceDistortionPath(sourcePmid: string): Promise<{
    source_pmid: string;
    chain: Array<{
      hop: number;
      pmid: string;
      title: string;
      distortion_score: number;
      distortion_type: string;
      citing_claim: string;
    }>;
    max_distortion: number;
  }> {
    if (!this.enabled) {
      return { source_pmid: sourcePmid, chain: [], max_distortion: 0 };
    }
    try {
      return await callSidecar("trace_distortion_path", {
        source_pmid: sourcePmid,
        db_path: this.dbPath,
      });
    } catch {
      return { source_pmid: sourcePmid, chain: [], max_distortion: 0 };
    }
  }

  /**
   * Find papers that have been cited with high distortion (score > threshold).
   * Useful for identifying "telephone game" claims in the literature.
   */
  async findHighDistortionClaims(
    threshold = 0.7,
    limit = 20
  ): Promise<
    Array<{
      source_pmid: string;
      original_claim: string;
      max_distortion: number;
      hop_count: number;
      dominant_type: string;
    }>
  > {
    if (!this.enabled) return [];
    try {
      const result = await callSidecar<{
        claims: Array<{
          source_pmid: string;
          original_claim: string;
          max_distortion: number;
          hop_count: number;
          dominant_type: string;
        }>;
      }>("high_distortion_claims", {
        threshold,
        limit,
        db_path: this.dbPath,
      });
      return result.claims ?? [];
    } catch {
      return [];
    }
  }
}

// ── Singleton export ──────────────────────────────────────────────────────────

let _instance: CTCCitationMemory | null = null;

export function getCTCCitationMemory(): CTCCitationMemory {
  if (!_instance) {
    _instance = new CTCCitationMemory();
  }
  return _instance;
}
