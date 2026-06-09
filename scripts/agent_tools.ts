/**
 * scripts/agent_tools.ts
 *
 * Pre-loaded API wrappers for Manus coding sessions.
 * Import this at the top of any server-side script to get typed access
 * to all internal services without re-discovering the API surface each session.
 *
 * Usage (in a tRPC procedure or server script):
 *   import { truthdeskVerify, swarmTick, invokeLLM } from "../scripts/agent_tools";
 *
 * All functions are async and return typed results.
 * All errors are caught and re-thrown with context.
 */

import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface VerifyResult {
  verdict:
    | "Supported"
    | "Contradicted"
    | "Partially Supported"
    | "Ambiguous"
    | "Insufficient Evidence"
    | "Out of Scope"
    | "Needs Expert Review";
  confidence: number;
  evidence: string[];
  pdbIds: string[];
  rationale: string;
}

export interface SwarmTickResult {
  agents: {
    name: string;
    status: "ok" | "error" | "skipped";
    itemsProcessed: number;
    durationMs: number;
    error?: string;
  }[];
  totalDurationMs: number;
}

export interface HarnessStatus {
  contextSnapshot: {
    exists: boolean;
    ageMinutes: number;
    lineCount: number;
    healthy: boolean;
  };
  handoff: {
    exists: boolean;
    hasPendingItems: boolean;
    preview: string;
  };
  sessionAudit: {
    exists: boolean;
    passed: boolean;
    issues: string[];
    timestamp: string | null;
  };
  todoProgress: {
    total: number;
    done: number;
    pending: number;
    percentComplete: number;
  };
}

export interface FeatureListMeta {
  source: string;
  total: number;
  done: number;
  pending: number;
  percent_complete: number;
}

export interface Feature {
  id: string;
  category: string;
  phase: string;
  description: string;
  passes: boolean;
  notes: string;
}

export interface FeatureList {
  meta: FeatureListMeta;
  features: Feature[];
}

export interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LLMResult {
  content: string;
  model: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface StoragePutResult {
  key: string;
  url: string;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

const ROOT = resolve(import.meta.dirname ?? process.cwd(), "..");

function getEnv(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`[agent_tools] Missing env var: ${key}`);
  return val;
}

// ─── 1. truthdeskVerify ───────────────────────────────────────────────────────

/**
 * Submit a scientific claim for verification against the PDB + LLM pipeline.
 * Calls the internal /api/trpc/claims.verify endpoint.
 */
export async function truthdeskVerify(
  claim: string,
  documentId?: number
): Promise<VerifyResult> {
  const baseUrl = process.env.VITE_APP_URL ?? "http://localhost:3000";
  const url = `${baseUrl}/api/trpc/claims.verify`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ json: { claim, documentId } }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `[agent_tools] truthdeskVerify failed (${res.status}): ${text}`
    );
  }

  const data = (await res.json()) as {
    result: { data: { json: VerifyResult } };
  };
  return data.result.data.json;
}

// ─── 2. swarmTick ────────────────────────────────────────────────────────────

/**
 * Trigger one swarm tick — runs all 5 agents (harvester, wiki-compiler,
 * quality-auditor, backfill-predictor, monitoring-scanner) in parallel.
 * Returns per-agent results.
 */
export async function swarmTick(): Promise<SwarmTickResult> {
  const baseUrl = process.env.VITE_APP_URL ?? "http://localhost:3000";
  const res = await fetch(`${baseUrl}/api/swarm/tick`, { method: "POST" });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`[agent_tools] swarmTick failed (${res.status}): ${text}`);
  }

  return res.json() as Promise<SwarmTickResult>;
}

// ─── 3. harnessStatus ────────────────────────────────────────────────────────

/**
 * Read the current harness health from local files.
 * Does NOT make a network call — reads CONTEXT_SNAPSHOT.md, HANDOFF.md,
 * .session-audit.json, and todo.md directly.
 */
export function harnessStatus(): HarnessStatus {
  // Context snapshot
  const snapshotPath = resolve(ROOT, "CONTEXT_SNAPSHOT.md");
  let contextSnapshot: HarnessStatus["contextSnapshot"] = {
    exists: false,
    ageMinutes: Infinity,
    lineCount: 0,
    healthy: false,
  };
  if (existsSync(snapshotPath)) {
    const stat = require("fs").statSync(snapshotPath);
    const ageMinutes = (Date.now() - stat.mtimeMs) / 60_000;
    const lines = readFileSync(snapshotPath, "utf8").split("\n").length;
    contextSnapshot = {
      exists: true,
      ageMinutes,
      lineCount: lines,
      healthy: ageMinutes < 120,
    };
  }

  // Handoff
  const handoffPath = resolve(ROOT, "HANDOFF.md");
  let handoff: HarnessStatus["handoff"] = {
    exists: false,
    hasPendingItems: false,
    preview: "",
  };
  if (existsSync(handoffPath)) {
    const content = readFileSync(handoffPath, "utf8");
    handoff = {
      exists: true,
      hasPendingItems:
        content.includes("PENDING") ||
        content.includes("BLOCKED") ||
        content.includes("NEXT"),
      preview: content.split("\n").slice(0, 10).join("\n"),
    };
  }

  // Session audit
  const auditPath = resolve(ROOT, ".session-audit.json");
  let sessionAudit: HarnessStatus["sessionAudit"] = {
    exists: false,
    passed: false,
    issues: [],
    timestamp: null,
  };
  if (existsSync(auditPath)) {
    try {
      const raw = JSON.parse(readFileSync(auditPath, "utf8")) as {
        passed?: boolean;
        issues?: string[];
        timestamp?: string;
      };
      sessionAudit = {
        exists: true,
        passed: raw.passed ?? false,
        issues: raw.issues ?? [],
        timestamp: raw.timestamp ?? null,
      };
    } catch {
      /* malformed — leave defaults */
    }
  }

  // Todo progress
  const todoPath = resolve(ROOT, "todo.md");
  let todoProgress: HarnessStatus["todoProgress"] = {
    total: 0,
    done: 0,
    pending: 0,
    percentComplete: 0,
  };
  if (existsSync(todoPath)) {
    const lines = readFileSync(todoPath, "utf8").split("\n");
    const done = lines.filter(l => /^- \[x\]/i.test(l)).length;
    const pending = lines.filter(l => /^- \[ \]/.test(l)).length;
    const total = done + pending;
    todoProgress = {
      total,
      done,
      pending,
      percentComplete: total ? Math.round((done / total) * 100) : 0,
    };
  }

  return { contextSnapshot, handoff, sessionAudit, todoProgress };
}

// ─── 4. featureList ──────────────────────────────────────────────────────────

/**
 * Read feature_list.json from disk.
 * Returns the full contract with meta + features array.
 */
export function featureList(): FeatureList {
  const path = resolve(ROOT, "feature_list.json");
  if (!existsSync(path)) {
    throw new Error(
      "[agent_tools] feature_list.json not found — run pnpm feature:sync first"
    );
  }
  return JSON.parse(readFileSync(path, "utf8")) as FeatureList;
}

/**
 * Get only the pending (passes=false) features.
 * Useful at session start to pick the next task.
 */
export function pendingFeatures(): Feature[] {
  return featureList().features.filter(f => !f.passes);
}

// ─── 5. invokeLLM ────────────────────────────────────────────────────────────

/**
 * Call the internal LLM via the Manus Forge API.
 * Uses the same credentials as server/_core/llm.ts.
 * Always call from server-side code only.
 */
export async function invokeLLM(
  messages: LLMMessage[],
  options?: { model?: string; maxTokens?: number }
): Promise<LLMResult> {
  const apiUrl = getEnv("BUILT_IN_FORGE_API_URL");
  const apiKey = getEnv("BUILT_IN_FORGE_API_KEY");
  const model = options?.model ?? "claude-3-5-sonnet-20241022";

  const res = await fetch(`${apiUrl}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      max_tokens: options?.maxTokens ?? 2048,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`[agent_tools] invokeLLM failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as {
    choices: [{ message: { content: string } }];
    model: string;
    usage: {
      prompt_tokens: number;
      completion_tokens: number;
      total_tokens: number;
    };
  };

  return {
    content: data.choices[0].message.content,
    model: data.model,
    usage: {
      promptTokens: data.usage.prompt_tokens,
      completionTokens: data.usage.completion_tokens,
      totalTokens: data.usage.total_tokens,
    },
  };
}

// ─── 6. storagePut ───────────────────────────────────────────────────────────

/**
 * Upload a buffer to S3 storage.
 * Thin wrapper around server/storage.ts storagePut.
 * Returns { key, url } — save the key in DB, use url in frontend.
 */
export async function storagePut(
  relKey: string,
  data: Buffer | Uint8Array | string,
  contentType = "application/octet-stream"
): Promise<StoragePutResult> {
  // Dynamic import to avoid loading S3 SDK in scripts that don't need it
  const { storagePut: _put } = await import("../server/storage.js");
  return _put(relKey, data, contentType);
}

// ─── 7. notifyOwner ──────────────────────────────────────────────────────────

/**
 * Send a notification to the project owner.
 * Wraps server/_core/notification.ts notifyOwner.
 * Returns true on success, false if the upstream service is unavailable.
 */
export async function notifyOwner(
  title: string,
  content: string
): Promise<boolean> {
  const { notifyOwner: _notify } = await import(
    "../server/_core/notification.js"
  );
  return _notify({ title, content });
}

// ─── Quick-reference summary ──────────────────────────────────────────────────

/**
 * Print a quick summary of available tools to stdout.
 * Run: npx tsx scripts/agent_tools.ts
 */
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(`
agent_tools.ts — Available wrappers
────────────────────────────────────────────────────────────────────────────────
truthdeskVerify(claim, documentId?)  → VerifyResult
  Submit a claim for PDB + LLM verification

swarmTick()                          → SwarmTickResult
  Trigger one full swarm tick (5 agents in parallel)

harnessStatus()                      → HarnessStatus  [sync, no network]
  Read CONTEXT_SNAPSHOT.md, HANDOFF.md, .session-audit.json, todo.md

featureList()                        → FeatureList     [sync, no network]
  Read feature_list.json (run pnpm feature:sync to regenerate)

pendingFeatures()                    → Feature[]       [sync, no network]
  Return only features where passes=false

invokeLLM(messages, options?)        → LLMResult
  Call Manus Forge LLM (server-side only)

storagePut(relKey, data, mimeType?)  → StoragePutResult
  Upload bytes to S3, returns { key, url }

notifyOwner(title, content)          → boolean
  Send owner notification via Manus notification API
────────────────────────────────────────────────────────────────────────────────
`);
}
