/**
 * tests/integration/helpers.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Shared helpers for Phase 116 integration tests.
 *
 * Design constraints:
 *   - Pure fetch() — no supertest, no express test utilities
 *   - All helpers are async and return typed results
 *   - SSE collector closes the connection after receiving the "final" event
 *     or after a timeout, whichever comes first
 *   - No global state — each helper is stateless
 */

import { RPC_ID } from "./fixtures";

// ─── Environment ──────────────────────────────────────────────────────────────

export const TEST_PORT = parseInt(process.env.TEST_PORT ?? "3001", 10);
export const BASE_URL = process.env.TEST_BASE_URL ?? `http://localhost:${TEST_PORT}`;
export const TEST_API_KEY = process.env.TEST_API_KEY ?? "";

// ─── JSON-RPC helpers ─────────────────────────────────────────────────────────

export interface RpcRequest {
  method: string;
  params?: Record<string, unknown>;
  id?: number;
  bearerToken?: string;
}

export interface RpcResponse {
  jsonrpc: string;
  id: number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

/**
 * Call POST /api/mcp with a JSON-RPC 2.0 payload.
 * Returns the parsed response body.
 */
export async function callMcp(req: RpcRequest): Promise<RpcResponse> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (req.bearerToken) {
    headers["Authorization"] = `Bearer ${req.bearerToken}`;
  }
  const body = JSON.stringify({
    jsonrpc: "2.0",
    id: req.id ?? RPC_ID,
    method: req.method,
    params: req.params ?? {},
  });
  const res = await fetch(`${BASE_URL}/api/mcp`, {
    method: "POST",
    headers,
    body,
  });
  return res.json() as Promise<RpcResponse>;
}

/**
 * Call POST /api/mcp with a tools/call payload.
 */
export async function callMcpTool(
  toolName: string,
  args: Record<string, unknown>,
  bearerToken?: string
): Promise<RpcResponse> {
  return callMcp({
    method: "tools/call",
    params: { name: toolName, arguments: args },
    bearerToken,
  });
}

// ─── Answer endpoint helpers ──────────────────────────────────────────────────

export interface AnswerResponse {
  ok: boolean;
  verdict?: string;
  confidence?: number;
  rationale?: string;
  loopTriggered?: boolean;
  error?: string;
}

/**
 * Call POST /api/public/answer.
 * Returns { status, body } so tests can assert on HTTP status codes too.
 */
export async function callAnswer(
  question: string,
  bearerToken?: string,
  extraHeaders?: Record<string, string>
): Promise<{ status: number; body: AnswerResponse }> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...extraHeaders,
  };
  if (bearerToken) {
    headers["Authorization"] = `Bearer ${bearerToken}`;
  }
  const res = await fetch(`${BASE_URL}/api/public/answer`, {
    method: "POST",
    headers,
    body: JSON.stringify({ question }),
  });
  const body = (await res.json()) as AnswerResponse;
  return { status: res.status, body };
}

// ─── SSE stream helpers ───────────────────────────────────────────────────────

export interface SseEvent {
  type: string;
  data: Record<string, unknown>;
}

/**
 * Collect all SSE events from GET /api/public/verify-claim/stream.
 * Closes the connection after receiving a "final" or "error" event,
 * or after `timeoutMs` milliseconds.
 */
export async function collectSseEvents(
  claim: string,
  options: { bearerToken?: string; timeoutMs?: number } = {}
): Promise<SseEvent[]> {
  const { bearerToken, timeoutMs = 30_000 } = options;
  const url = `${BASE_URL}/api/public/verify-claim/stream?claim=${encodeURIComponent(claim)}`;
  const headers: Record<string, string> = { Accept: "text/event-stream" };
  if (bearerToken) headers["Authorization"] = `Bearer ${bearerToken}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const events: SseEvent[] = [];

  try {
    const res = await fetch(url, { headers, signal: controller.signal });
    if (!res.body) throw new Error("No response body");

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      let currentEventType = "";
      for (const line of lines) {
        if (line.startsWith("event:")) {
          currentEventType = line.slice(6).trim();
        } else if (line.startsWith("data:")) {
          const rawData = line.slice(5).trim();
          try {
            const parsed = JSON.parse(rawData) as Record<string, unknown>;
            events.push({ type: currentEventType, data: parsed });
          } catch {
            // non-JSON data line — skip
          }
          // Stop collecting after final or error event
          if (currentEventType === "final" || currentEventType === "error") {
            reader.cancel();
            return events;
          }
        }
      }
    }
  } finally {
    clearTimeout(timer);
  }

  return events;
}

// ─── Rate limit reset helper ──────────────────────────────────────────────────

/**
 * Send the test-only X-Test-Reset-RateLimit header to clear the IP's
 * rate limit bucket. Only honoured when NODE_ENV === "test".
 *
 * Call this before any test that needs a clean rate limit slate.
 */
export async function resetRateLimit(endpoint: "answer" | "mcp" | "stream"): Promise<void> {
  const path =
    endpoint === "answer" ? "/api/public/answer" :
    endpoint === "stream" ? "/api/public/verify-claim/stream" :
    "/api/mcp";
  const method = endpoint === "stream" ? "GET" : "POST";
  await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-Test-Reset-RateLimit": "1",
    },
    ...(method !== "GET" ? { body: JSON.stringify({}) } : {}),
  }).catch(() => {
    // Ignore errors — the endpoint may return 400 on empty body, that's fine
  });
}

// ─── MCP tool result unwrapper ───────────────────────────────────────────────

/**
 * MCP tools wrap their return value in:
 *   { content: [{ type: "text", text: "...JSON..." }] }
 * This helper unwraps that envelope and parses the inner JSON.
 * Returns null if the response has an error or the content is missing.
 */
export function parseMcpToolResult(res: RpcResponse): Record<string, unknown> | null {
  if (res.error) return null;
  const result = res.result as Record<string, unknown> | undefined;
  if (!result) return null;
  const content = result.content as Array<{ type: string; text: string }> | undefined;
  if (!Array.isArray(content) || content.length === 0) return null;
  const first = content[0];
  if (first.type !== "text" || typeof first.text !== "string") return null;
  try {
    return JSON.parse(first.text) as Record<string, unknown>;
  } catch {
    return null;
  }
}

// ─── Agent.json helper ────────────────────────────────────────────────────────

export async function fetchMcpJson(): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${BASE_URL}/.well-known/mcp.json`);
  const body = await res.json() as Record<string, unknown>;
  return { status: res.status, body };
}

// ─── Report writer ────────────────────────────────────────────────────────────

export interface TestResult {
  suite: string;
  name: string;
  passed: boolean;
  durationMs: number;
  error?: string;
}

export function buildReport(results: TestResult[]): string {
  const total = results.length;
  const passed = results.filter(r => r.passed).length;
  const failed = total - passed;
  const date = new Date().toISOString();

  const rows = results
    .map(r => {
      const status = r.passed ? "✅ PASS" : "❌ FAIL";
      const err = r.error ? ` — ${r.error}` : "";
      return `| ${status} | ${r.suite} | ${r.name} | ${r.durationMs}ms${err} |`;
    })
    .join("\n");

  return `# Phase 116 Integration Test Report

**Generated:** ${date}
**Result:** ${passed}/${total} passed${failed > 0 ? ` — ⚠ ${failed} FAILED` : " — ✅ ALL GREEN"}

## Results

| Status | Suite | Test | Duration |
|---|---|---|---|
${rows}

${failed > 0 ? `## Failed Tests\n\n${results.filter(r => !r.passed).map(r => `- **${r.suite} / ${r.name}**: ${r.error ?? "unknown error"}`).join("\n")}` : ""}
`;
}
