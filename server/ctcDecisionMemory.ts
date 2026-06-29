/**
 * ctcDecisionMemory.ts — MRAgent Cue-Tag-Content memory layer for self-direct
 *
 * Gives the self-direction system long-horizon episodic memory so it can:
 *   - Reconstruct "what directives have been issued for gap X?"
 *   - Answer "which directive types have led to convergence?"
 *   - Trace "what was the reasoning chain that led to this decision?"
 *   - Learn "what patterns of directives resolve confidence_low states?"
 *
 * Architecture:
 *   - Each frontier directive issued is ingested as a CTC episode
 *   - Cues: directive type, gap IDs, entity IDs, cycle IDs
 *   - Tags: temporal (when issued), topic (directive type), personal (issuing cycle)
 *   - Content: the reason text, confidence, outcome (if known)
 *
 * This is the long-horizon memory layer — it persists across restarts and
 * allows the system to reason about its own decision history.
 *
 * Paper: "Memory is Reconstructed, Not Retrieved" (Ji, Li, Hooi — ICML 2026)
 */

import { spawn } from "child_process";
import { join } from "path";
import { homedir } from "os";
import { existsSync } from "fs";

// ── Types ─────────────────────────────────────────────────────────────────────

export type DirectiveType =
  | "focus_gap"
  | "skip_mapping"
  | "prioritize_hypotheses"
  | "deep_dive_entity"
  | "manual";

export type DirectiveOutcome =
  | "converged"
  | "stalled"
  | "expired"
  | "superseded"
  | "unknown";

export interface DirectiveEpisode {
  directive_id: string;
  directive_type: DirectiveType;
  reason: string;
  confidence: number;
  target_gap_id?: number | string;
  target_entity_id?: number | string;
  issued_by_cycle_id?: string;
  issued_at: string;
  expires_at: string;
  ttl_minutes: number;
  /** Outcome recorded when the directive is resolved (optional — filled in later) */
  outcome?: DirectiveOutcome;
  outcome_notes?: string;
  outcome_recorded_at?: string;
}

export interface DecisionReconstructionResult {
  question: string;
  answer: string;
  supports: string[];
  confidence: "high" | "medium" | "low";
  reasoning: string;
  tool_calls_made: number;
  rounds: number;
  evidence_texts: string[];
}

export interface DirectivePatternResult {
  directive_type: DirectiveType;
  total_issued: number;
  converged: number;
  stalled: number;
  expired: number;
  convergence_rate: number;
  avg_confidence: number;
  most_common_reason_keywords: string[];
}

// ── Paths ─────────────────────────────────────────────────────────────────────

const EVOLVA_MRAGENT_PATH = join(homedir(), "evolva-mragent");
const CTC_DB_PATH = join(
  homedir(),
  ".codebase-memory",
  "ctc_decision_graph.db"
);
const SIDECAR_PATH = join(
  EVOLVA_MRAGENT_PATH,
  "integrations",
  "ttruthdesk-platform",
  "ctc_decision_sidecar.py"
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
      reject(new Error("CTC decision sidecar timeout (60s)"));
    }, 60_000);

    proc.on("close", (code: number) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(
          new Error(
            `CTC decision sidecar exited ${code}: ${stderr.slice(0, 500)}`
          )
        );
        return;
      }
      try {
        resolve(JSON.parse(stdout.trim()) as T);
      } catch {
        reject(
          new Error(
            `CTC decision sidecar JSON parse error: ${stdout.slice(0, 200)}`
          )
        );
      }
    });

    proc.on("error", reject);
  });
}

// ── CTCDecisionMemory class ───────────────────────────────────────────────────

export class CTCDecisionMemory {
  private readonly dbPath: string;
  private readonly enabled: boolean;

  constructor(dbPath = CTC_DB_PATH) {
    this.dbPath = dbPath;
    this.enabled = existsSync(EVOLVA_MRAGENT_PATH) && existsSync(SIDECAR_PATH);
    if (!this.enabled) {
      console.warn(
        "[CTCDecisionMemory] evolva-mragent not found — CTC decision memory disabled"
      );
    }
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Ingest a frontier directive into the CTC graph.
   * Called automatically from publishFrontierDirective() after each directive is issued.
   * Non-blocking — errors are logged but do not throw.
   */
  async ingestDirective(episode: DirectiveEpisode): Promise<void> {
    if (!this.enabled) return;
    try {
      await callSidecar<{ ok: boolean }>("ingest_directive", {
        episode,
        db_path: this.dbPath,
      });
    } catch (e) {
      console.error(
        "[CTCDecisionMemory] ingestDirective error:",
        (e as Error).message
      );
    }
  }

  /**
   * Record the outcome of a directive (converged, stalled, expired, etc.).
   * Should be called when the directive's TTL expires or when the system
   * detects that the directive's goal has been achieved or abandoned.
   */
  async recordOutcome(
    directiveId: string,
    outcome: DirectiveOutcome,
    notes?: string
  ): Promise<void> {
    if (!this.enabled) return;
    try {
      await callSidecar<{ ok: boolean }>("record_outcome", {
        directive_id: directiveId,
        outcome,
        notes: notes ?? "",
        recorded_at: new Date().toISOString(),
        db_path: this.dbPath,
      });
    } catch (e) {
      console.error(
        "[CTCDecisionMemory] recordOutcome error:",
        (e as Error).message
      );
    }
  }

  /**
   * Run MRAgent active reconstruction to answer a question about the decision history.
   *
   * Examples:
   *   "What directives have been issued for gap 42?"
   *   "Which focus_gap directives led to convergence?"
   *   "What was the reasoning behind the directive issued on June 20?"
   *   "What patterns of directives resolve confidence_low states?"
   *   "Has the system ever successfully resolved a deep_dive_entity directive?"
   */
  async reconstruct(question: string): Promise<DecisionReconstructionResult> {
    if (!this.enabled) {
      return {
        question,
        answer: "CTC decision memory not available.",
        supports: [],
        confidence: "low",
        reasoning: "evolva-mragent not installed",
        tool_calls_made: 0,
        rounds: 0,
        evidence_texts: [],
      };
    }
    try {
      return await callSidecar<DecisionReconstructionResult>("reconstruct", {
        question,
        domain: "self_direct",
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
   * Get convergence statistics for each directive type.
   * Answers "which directive types actually work?"
   */
  async getDirectivePatterns(): Promise<DirectivePatternResult[]> {
    if (!this.enabled) return [];
    try {
      const result = await callSidecar<{ patterns: DirectivePatternResult[] }>(
        "directive_patterns",
        { db_path: this.dbPath }
      );
      return result.patterns ?? [];
    } catch {
      return [];
    }
  }

  /**
   * Get the full decision history for a specific gap.
   * Returns all directives ever issued for that gap, with outcomes.
   */
  async getGapHistory(gapId: number | string): Promise<
    Array<{
      directive_id: string;
      directive_type: DirectiveType;
      reason: string;
      confidence: number;
      issued_at: string;
      outcome: DirectiveOutcome;
      outcome_notes?: string;
    }>
  > {
    if (!this.enabled) return [];
    try {
      const result = await callSidecar<{
        history: Array<{
          directive_id: string;
          directive_type: DirectiveType;
          reason: string;
          confidence: number;
          issued_at: string;
          outcome: DirectiveOutcome;
          outcome_notes?: string;
        }>;
      }>("gap_history", {
        gap_id: String(gapId),
        db_path: this.dbPath,
      });
      return result.history ?? [];
    } catch {
      return [];
    }
  }

  /**
   * Get the most recent N directives across all types.
   * Useful for building a "recent decisions" feed.
   */
  async getRecentDirectives(limit = 20): Promise<DirectiveEpisode[]> {
    if (!this.enabled) return [];
    try {
      const result = await callSidecar<{ directives: DirectiveEpisode[] }>(
        "recent_directives",
        { limit, db_path: this.dbPath }
      );
      return result.directives ?? [];
    } catch {
      return [];
    }
  }
}

// ── Singleton export ──────────────────────────────────────────────────────────

let _instance: CTCDecisionMemory | null = null;

export function getCTCDecisionMemory(): CTCDecisionMemory {
  if (!_instance) {
    _instance = new CTCDecisionMemory();
  }
  return _instance;
}
