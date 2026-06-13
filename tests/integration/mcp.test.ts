/**
 * tests/integration/mcp.test.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Phase 116 — MCP tool integration tests.
 *
 * Tests all 5 tools exposed at POST /api/mcp:
 *   verify_claim, search_claims, get_claim, get_source_version, ask_question
 *
 * Also tests protocol-level methods: initialize, tools/list.
 *
 * Design:
 *   - Each test is a standalone async function returning TestResult
 *   - No shared mutable state between tests
 *   - Tests assert response SHAPE, not specific DB content
 *     (DB may be empty in CI — pipeline degrades gracefully)
 *   - parseMcpToolResult() unwraps the MCP content envelope before assertions
 */

import {
  callMcp,
  callMcpTool,
  parseMcpToolResult,
  resetRateLimit,
  TEST_API_KEY,
  BASE_URL,
  type TestResult,
} from "./helpers";
import {
  CLAIM_PDB,
  CLAIM_ID_NONEXISTENT,
  SOURCE_ID_KNOWN,
  MCP_TOOLS,
  MCP_ERROR_CODES,
} from "./fixtures";

// ─── Test runner ──────────────────────────────────────────────────────────────

type TestFn = () => Promise<void>;

async function runTest(
  suite: string,
  name: string,
  fn: TestFn
): Promise<TestResult> {
  const start = Date.now();
  try {
    await fn();
    return { suite, name, passed: true, durationMs: Date.now() - start };
  } catch (err) {
    return {
      suite,
      name,
      passed: false,
      durationMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

const SUITE = "MCP Tools";

async function testInitialize(): Promise<void> {
  const res = await callMcp({ method: "initialize", params: {} });
  assert(res.jsonrpc === "2.0", "jsonrpc must be 2.0");
  assert(res.error === undefined, `unexpected error: ${JSON.stringify(res.error)}`);
  const result = res.result as Record<string, unknown>;
  assert(typeof result === "object" && result !== null, "result must be an object");
  assert("capabilities" in result, "result must have capabilities");
  const caps = result.capabilities as Record<string, unknown>;
  assert(caps.streaming === true, "capabilities.streaming must be true");
}

async function testToolsList(): Promise<void> {
  const res = await callMcp({ method: "tools/list", params: {} });
  assert(res.error === undefined, `unexpected error: ${JSON.stringify(res.error)}`);
  const result = res.result as Record<string, unknown>;
  const tools = result.tools as Array<{ name: string }>;
  assert(Array.isArray(tools), "tools must be an array");
  const names = tools.map(t => t.name);
  for (const expected of Object.values(MCP_TOOLS)) {
    assert(names.includes(expected), `tools/list must include ${expected}`);
  }
}

async function testVerifyClaimShape(): Promise<void> {
  // Reset rate limit before this test
  await resetRateLimit("mcp");
  const res = await callMcpTool(MCP_TOOLS.VERIFY_CLAIM, { claim: CLAIM_PDB }, TEST_API_KEY || undefined);
  assert(res.error === undefined, `unexpected error: ${JSON.stringify(res.error)}`);
  const result = parseMcpToolResult(res);
  assert(result !== null, "result content must be parseable");
  assert(typeof result!.verdict === "string", "result.verdict must be a string");
  // confidence may be null when DB is empty (no stored confidenceScore)
  const conf = result!.confidence;
  assert(
    conf === null || (typeof conf === "number" && conf >= 0 && conf <= 1),
    `confidence must be null or in [0,1], got ${JSON.stringify(conf)}`
  );
  // buildVerifyResult returns 'summary' (not 'rationale') for the human-readable explanation
  assert(typeof result!.summary === "string", "result.summary must be a string");
  // buildVerifyResult returns 'evidence' (mapped from pubmedResults)
  assert(Array.isArray(result!.evidence), "result.evidence must be an array");
}

async function testVerifyClaimMissingParam(): Promise<void> {
  const res = await callMcpTool(MCP_TOOLS.VERIFY_CLAIM, {}, TEST_API_KEY || undefined);
  assert(res.error !== undefined, "missing claim param must return an error");
  assert(
    res.error!.code === MCP_ERROR_CODES.INVALID_PARAMS,
    `error code must be INVALID_PARAMS (${MCP_ERROR_CODES.INVALID_PARAMS}), got ${res.error!.code}`
  );
}

async function testVerifyClaimTooLong(): Promise<void> {
  const res = await callMcpTool(
    MCP_TOOLS.VERIFY_CLAIM,
    { claim: "X".repeat(1001) },
    TEST_API_KEY || undefined
  );
  assert(res.error !== undefined, "claim > 1000 chars must return an error");
  assert(
    res.error!.code === MCP_ERROR_CODES.INVALID_PARAMS,
    `error code must be INVALID_PARAMS, got ${res.error!.code}`
  );
}

async function testSearchClaimsShape(): Promise<void> {
  // Reset rate limit before this test
  await resetRateLimit("mcp");
  const res = await callMcpTool(MCP_TOOLS.SEARCH_CLAIMS, { query: "protein resolution" }, TEST_API_KEY || undefined);
  assert(res.error === undefined, `unexpected error: ${JSON.stringify(res.error)}`);
  const result = parseMcpToolResult(res);
  assert(result !== null, "result content must be parseable");
  assert(typeof result!.total === "number", "result.total must be a number");
  assert(Array.isArray(result!.claims), "result.claims must be an array");
}

async function testSearchClaimsMissingQuery(): Promise<void> {
  const res = await callMcpTool(MCP_TOOLS.SEARCH_CLAIMS, {}, TEST_API_KEY || undefined);
  assert(res.error !== undefined, "missing query must return an error");
  assert(
    res.error!.code === MCP_ERROR_CODES.INVALID_PARAMS,
    `error code must be INVALID_PARAMS, got ${res.error!.code}`
  );
}

async function testGetClaimNotFound(): Promise<void> {
  // Reset rate limit before this test
  await resetRateLimit("mcp");
  // claim_id must be a positive integer (snake_case param name)
  const res = await callMcpTool(
    MCP_TOOLS.GET_CLAIM,
    { claim_id: CLAIM_ID_NONEXISTENT },
    TEST_API_KEY || undefined
  );
  assert(res.error !== undefined, "nonexistent claim_id must return an error");
  assert(
    res.error!.code === MCP_ERROR_CODES.NOT_FOUND,
    `error code must be NOT_FOUND (${MCP_ERROR_CODES.NOT_FOUND}), got ${res.error!.code}`
  );
}

async function testGetClaimMissingId(): Promise<void> {
  const res = await callMcpTool(MCP_TOOLS.GET_CLAIM, {}, TEST_API_KEY || undefined);
  assert(res.error !== undefined, "missing claim_id must return an error");
  assert(
    res.error!.code === MCP_ERROR_CODES.INVALID_PARAMS,
    `error code must be INVALID_PARAMS, got ${res.error!.code}`
  );
}

async function testGetSourceVersionShape(): Promise<void> {
  // Reset rate limit before this test
  await resetRateLimit("mcp");
  // source_id is snake_case
  const res = await callMcpTool(
    MCP_TOOLS.GET_SOURCE_VERSION,
    { source_id: SOURCE_ID_KNOWN },
    TEST_API_KEY || undefined
  );
  // Either returns a version object or NOT_FOUND — both are valid shapes
  if (res.error) {
    assert(
      res.error.code === MCP_ERROR_CODES.NOT_FOUND,
      `unexpected error code: ${res.error.code} — ${res.error.message}`
    );
  } else {
    const result = parseMcpToolResult(res);
    assert(result !== null, "result content must be parseable");
    assert(typeof result!.sourceId === "string", "result.sourceId must be a string");
  }
}

async function testAskQuestionShape(): Promise<void> {
  // Reset rate limit before this test
  await resetRateLimit("mcp");
  const res = await callMcpTool(
    MCP_TOOLS.ASK_QUESTION,
    { question: "What is the resolution of PDB entry 1HHO?" },
    TEST_API_KEY || undefined
  );
  assert(res.error === undefined, `unexpected error: ${JSON.stringify(res.error)}`);
  const result = parseMcpToolResult(res);
  assert(result !== null, "result content must be parseable");
  assert(typeof result!.verdict === "string", "result.verdict must be a string");
  assert(typeof result!.loopTriggered === "boolean", "result.loopTriggered must be a boolean");
}

async function testAskQuestionMissingParam(): Promise<void> {
  const res = await callMcpTool(MCP_TOOLS.ASK_QUESTION, {}, TEST_API_KEY || undefined);
  assert(res.error !== undefined, "missing question must return an error");
  assert(
    res.error!.code === MCP_ERROR_CODES.INVALID_PARAMS,
    `error code must be INVALID_PARAMS, got ${res.error!.code}`
  );
}

async function testUnknownTool(): Promise<void> {
  const res = await callMcpTool("nonexistent_tool_xyz", {}, TEST_API_KEY || undefined);
  assert(res.error !== undefined, "unknown tool must return an error");
  assert(
    res.error!.code === MCP_ERROR_CODES.METHOD_NOT_FOUND,
    `error code must be METHOD_NOT_FOUND (${MCP_ERROR_CODES.METHOD_NOT_FOUND}), got ${res.error!.code}`
  );
}

async function testUnknownMethod(): Promise<void> {
  const res = await callMcp({ method: "unknown/method", params: {} });
  assert(res.error !== undefined, "unknown method must return an error");
  assert(
    res.error!.code === MCP_ERROR_CODES.METHOD_NOT_FOUND,
    `error code must be METHOD_NOT_FOUND, got ${res.error!.code}`
  );
}

async function testJsonRpcIdReflected(): Promise<void> {
  const res = await callMcp({ method: "initialize", params: {}, id: 42 });
  assert(res.id === 42, `response id must reflect request id (42), got ${res.id}`);
}

async function testMcpJsonEndpoint(): Promise<void> {
  // The well-known discovery endpoint is /.well-known/mcp.json (not agent.json)
  const res = await fetch(`${BASE_URL}/.well-known/mcp.json`);
  assert(res.ok, `/.well-known/mcp.json must return 200, got ${res.status}`);
  const body = await res.json() as Record<string, unknown>;
  assert(
    typeof body.mcp_endpoint === "string" || typeof body.endpoint === "string",
    "mcp.json must have mcp_endpoint or endpoint field"
  );
}

// ─── Suite export ─────────────────────────────────────────────────────────────

export async function runSuite(): Promise<TestResult[]> {
  // Run sequentially to avoid rate limit interference between tests
  const tests: Array<[string, TestFn]> = [
    ["initialize — response shape + streaming capability", testInitialize],
    ["tools/list — all 5 tools present", testToolsList],
    ["verify_claim — valid claim returns verdict shape", testVerifyClaimShape],
    ["verify_claim — missing claim param → INVALID_PARAMS", testVerifyClaimMissingParam],
    ["verify_claim — claim > 1000 chars → INVALID_PARAMS", testVerifyClaimTooLong],
    ["search_claims — valid query returns total + array", testSearchClaimsShape],
    ["search_claims — missing query → INVALID_PARAMS", testSearchClaimsMissingQuery],
    ["get_claim — nonexistent ID → NOT_FOUND", testGetClaimNotFound],
    ["get_claim — missing claimId → INVALID_PARAMS", testGetClaimMissingId],
    ["get_source_version — known sourceId returns shape or NOT_FOUND", testGetSourceVersionShape],
    ["ask_question — valid question returns verdict shape", testAskQuestionShape],
    ["ask_question — missing question → INVALID_PARAMS", testAskQuestionMissingParam],
    ["unknown tool name → METHOD_NOT_FOUND", testUnknownTool],
    ["unknown JSON-RPC method → METHOD_NOT_FOUND", testUnknownMethod],
    ["JSON-RPC id is reflected in response", testJsonRpcIdReflected],
    ["/.well-known/mcp.json returns endpoint field", testMcpJsonEndpoint],
  ];

  const results: TestResult[] = [];
  for (const [name, fn] of tests) {
    results.push(await runTest(SUITE, name, fn));
  }
  return results;
}
