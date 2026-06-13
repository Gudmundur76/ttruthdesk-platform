/**
 * tests/integration/stream.test.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Phase 116 — SSE streaming endpoint integration tests.
 *
 * Tests GET /api/public/verify-claim/stream:
 *   - 4-stage event sequence (extraction → evidence → verdict → final)
 *   - final.ok === true, final.verdict is a string
 *   - stage:extraction has primaryClaimText (not claimsFound)
 *   - stage:evidence has pubmedCount (not sourcesQueried)
 *   - error event on missing claim param
 *   - OPTIONS preflight returns 200/204 with CORS headers
 *
 * Actual event shapes from streamVerifyRoute.ts:
 *   stage:extraction: { stage, label, primaryClaimText, primaryClaimType, primaryPdbId,
 *                       primaryProteinName, translatedClaims }
 *   stage:evidence:   { stage, label, pubmedCount, hasStructuralEvidence, pubmedResults }
 *   stage:verdict:    { stage, label, verdict, confidence, rationale }
 *   final:            { ok, claim, vertical, verdict, rationale, evidenceUrl, claimType,
 *                       pdbId, proteinName, signalDensity, pubmedResults, translatedClaims,
 *                       processedAt, apiVersion, streaming }
 */

import {
  collectSseEvents,
  resetRateLimit,
  TEST_API_KEY,
  BASE_URL,
  type TestResult,
} from "./helpers";
import { CLAIM_MOCK, SSE_EVENT_TYPES } from "./fixtures";

// ─── Test runner ──────────────────────────────────────────────────────────────

type TestFn = () => Promise<void>;

async function runTest(suite: string, name: string, fn: TestFn): Promise<TestResult> {
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

const SUITE = "SSE Stream";

/** Collect all events for a single claim — resets rate limit first.
 *  Uses CLAIM_MOCK by default so tests complete in <1s without real LLM calls. */
async function getStreamEvents(claim = CLAIM_MOCK) {
  await resetRateLimit("stream");
  return collectSseEvents(claim, {
    bearerToken: TEST_API_KEY || undefined,
    timeoutMs: 120_000,
  });
}

async function testFiveStageSequence(): Promise<void> {
  const events = await getStreamEvents();
  const types = events.map(e => e.type);
  assert(events.length >= 4, `expected at least 4 SSE events, got ${events.length}: ${JSON.stringify(types)}`);

  for (const expected of SSE_EVENT_TYPES) {
    assert(types.includes(expected), `missing SSE event type: ${expected}. Got: ${JSON.stringify(types)}`);
  }

  // Events must arrive in order: extraction → evidence → verdict → final
  const idxExtraction = types.indexOf("stage:extraction");
  const idxEvidence = types.indexOf("stage:evidence");
  const idxVerdict = types.indexOf("stage:verdict");
  const idxFinal = types.indexOf("final");

  assert(idxExtraction < idxEvidence, "stage:extraction must come before stage:evidence");
  assert(idxEvidence < idxVerdict, "stage:evidence must come before stage:verdict");
  assert(idxVerdict < idxFinal, "stage:verdict must come before final");
}

async function testFinalEventShape(): Promise<void> {
  const events = await getStreamEvents();
  const finalEvent = events.find(e => e.type === "final");
  assert(finalEvent !== undefined, "final event must be present");

  const data = finalEvent!.data;
  assert(typeof data.ok === "boolean", "final.ok must be a boolean");
  assert(data.ok === true, `final.ok must be true, got ${data.ok}`);
  assert(typeof data.verdict === "string", "final.verdict must be a string");
  // final event does not have a confidence field — verdict:stage does
  assert(typeof data.streaming === "boolean", "final.streaming must be a boolean");
  assert(data.streaming === true, "final.streaming must be true");
}

async function testExtractionEventShape(): Promise<void> {
  const events = await getStreamEvents();
  const extractionEvent = events.find(e => e.type === "stage:extraction");
  assert(extractionEvent !== undefined, "stage:extraction event must be present");

  const data = extractionEvent!.data;
  // Actual field: primaryClaimText (not claimsFound)
  assert(typeof data.primaryClaimText === "string", "extraction.primaryClaimText must be a string");
  assert(typeof data.stage === "number", "extraction.stage must be a number");
  assert(data.stage === 1, `extraction.stage must be 1, got ${data.stage}`);
}

async function testEvidenceEventShape(): Promise<void> {
  const events = await getStreamEvents();
  const evidenceEvent = events.find(e => e.type === "stage:evidence");
  assert(evidenceEvent !== undefined, "stage:evidence event must be present");

  const data = evidenceEvent!.data;
  // Actual field: pubmedCount (not sourcesQueried)
  assert(typeof data.pubmedCount === "number", "evidence.pubmedCount must be a number");
  assert((data.pubmedCount as number) >= 0, "evidence.pubmedCount must be >= 0");
  assert(typeof data.stage === "number", "evidence.stage must be a number");
  assert(data.stage === 2, `evidence.stage must be 2, got ${data.stage}`);
}

async function testVerdictEventShape(): Promise<void> {
  const events = await getStreamEvents();
  const verdictEvent = events.find(e => e.type === "stage:verdict");
  assert(verdictEvent !== undefined, "stage:verdict event must be present");

  const data = verdictEvent!.data;
  assert(typeof data.verdict === "string", "verdict.verdict must be a string");
  assert(typeof data.confidence === "number", "verdict.confidence must be a number");
  const conf = data.confidence as number;
  assert(conf >= 0 && conf <= 1, `verdict.confidence must be in [0,1], got ${conf}`);
  assert(typeof data.rationale === "string", "verdict.rationale must be a string");
}

async function testMissingClaimReturnsError(): Promise<void> {
  await resetRateLimit("stream");
  const url = `${BASE_URL}/api/public/verify-claim/stream`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);

  try {
    const res = await fetch(url, {
      headers: { Accept: "text/event-stream" },
      signal: controller.signal,
    });

    // Either a 400 HTTP response or an SSE error event is acceptable
    if (!res.ok) {
      assert(res.status === 400, `expected 400 for missing claim, got ${res.status}`);
      return;
    }

    // If 200, must receive an error SSE event
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let gotErrorEvent = false;

    outer: while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (line.startsWith("event:") && line.includes("error")) {
          gotErrorEvent = true;
          reader.cancel();
          break outer;
        }
      }
    }

    assert(gotErrorEvent, "missing claim param must produce an error SSE event or 400 response");
  } finally {
    clearTimeout(timer);
  }
}

async function testOptionsPreflightCors(): Promise<void> {
  const url = `${BASE_URL}/api/public/verify-claim/stream`;
  const res = await fetch(url, {
    method: "OPTIONS",
    headers: {
      Origin: "https://citation.is",
      "Access-Control-Request-Method": "GET",
    },
  });
  assert(
    res.status === 200 || res.status === 204,
    `OPTIONS preflight must return 200 or 204, got ${res.status}`
  );
  const allowOrigin = res.headers.get("Access-Control-Allow-Origin");
  assert(
    allowOrigin !== null,
    "OPTIONS response must include Access-Control-Allow-Origin header"
  );
}

// ─── Suite export ─────────────────────────────────────────────────────────────

export async function runSuite(): Promise<TestResult[]> {
  // Run sequentially — SSE tests are slow (real pipeline calls)
  const results: TestResult[] = [];
  results.push(await runTest(SUITE, "4-stage event sequence arrives in order", testFiveStageSequence));
  results.push(await runTest(SUITE, "final event has ok=true + verdict + streaming=true", testFinalEventShape));
  results.push(await runTest(SUITE, "stage:extraction event has primaryClaimText + stage=1", testExtractionEventShape));
  results.push(await runTest(SUITE, "stage:evidence event has pubmedCount + stage=2", testEvidenceEventShape));
  results.push(await runTest(SUITE, "stage:verdict event has verdict + confidence in [0,1]", testVerdictEventShape));
  results.push(await runTest(SUITE, "missing claim param → error event or 400", testMissingClaimReturnsError));
  results.push(await runTest(SUITE, "OPTIONS preflight returns CORS headers", testOptionsPreflightCors));
  return results;
}
