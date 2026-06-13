/**
 * tests/integration/answer.test.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Phase 116 — POST /api/public/answer integration tests.
 *
 * Tests:
 *   - Valid question returns verdict shape
 *   - Question at exactly 1000 chars succeeds
 *   - Question at 1001 chars returns 400
 *   - Empty question returns 400
 *   - Missing question field returns 400
 *   - Response includes loopTriggered boolean
 */

import { callAnswer, resetRateLimit, TEST_API_KEY, type TestResult } from "./helpers";
import { QUESTION_VALID, QUESTION_MAX_LENGTH, QUESTION_OVER_LIMIT } from "./fixtures";

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

const SUITE = "Answer Endpoint";

async function testValidQuestionShape(): Promise<void> {
  await resetRateLimit("answer");
  const { status, body } = await callAnswer(QUESTION_VALID, TEST_API_KEY || undefined);
  assert(status === 200, `expected 200, got ${status}`);
  assert(body.ok === true, `body.ok must be true, got ${body.ok}`);
  assert(typeof body.verdict === "string", "body.verdict must be a string");
  assert(typeof body.confidence === "number", "body.confidence must be a number");
  assert(body.confidence! >= 0 && body.confidence! <= 1, "confidence must be in [0,1]");
  assert(typeof body.rationale === "string", "body.rationale must be a string");
  assert(typeof body.loopTriggered === "boolean", "body.loopTriggered must be a boolean");
}

async function testMaxLengthQuestionSucceeds(): Promise<void> {
  await resetRateLimit("answer");
  const { status } = await callAnswer(QUESTION_MAX_LENGTH, TEST_API_KEY || undefined);
  assert(status === 200, `question at exactly 1000 chars must succeed (200), got ${status}`);
}

async function testOverLimitQuestionReturns400(): Promise<void> {
  const { status } = await callAnswer(QUESTION_OVER_LIMIT, TEST_API_KEY || undefined);
  assert(status === 400, `question > 1000 chars must return 400, got ${status}`);
}

async function testEmptyQuestionReturns400(): Promise<void> {
  const { status } = await callAnswer("", TEST_API_KEY || undefined);
  assert(status === 400, `empty question must return 400, got ${status}`);
}

async function testMissingQuestionFieldReturns400(): Promise<void> {
  const res = await fetch(`${(await import("./helpers")).BASE_URL}/api/public/answer`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  assert(res.status === 400, `missing question field must return 400, got ${res.status}`);
}

async function testNonJsonBodyReturns400(): Promise<void> {
  const res = await fetch(`${(await import("./helpers")).BASE_URL}/api/public/answer`, {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: "this is not json",
  });
  assert(
    res.status === 400 || res.status === 415,
    `non-JSON body must return 400 or 415, got ${res.status}`
  );
}

async function testLoopTriggeredField(): Promise<void> {
  await resetRateLimit("answer");
  const { status, body } = await callAnswer(QUESTION_VALID, TEST_API_KEY || undefined);
  assert(status === 200, `expected 200, got ${status}`);
  assert(
    "loopTriggered" in body,
    "response must include loopTriggered field"
  );
  assert(
    typeof body.loopTriggered === "boolean",
    `loopTriggered must be boolean, got ${typeof body.loopTriggered}`
  );
}

// ─── Suite export ─────────────────────────────────────────────────────────────

export async function runSuite(): Promise<TestResult[]> {
  // Run sequentially — rate limit state must be predictable
  const results: TestResult[] = [];
  results.push(await runTest(SUITE, "valid question returns verdict shape", testValidQuestionShape));
  results.push(await runTest(SUITE, "question at 1000 chars succeeds (boundary)", testMaxLengthQuestionSucceeds));
  results.push(await runTest(SUITE, "question > 1000 chars → 400", testOverLimitQuestionReturns400));
  results.push(await runTest(SUITE, "empty question → 400", testEmptyQuestionReturns400));
  results.push(await runTest(SUITE, "missing question field → 400", testMissingQuestionFieldReturns400));
  results.push(await runTest(SUITE, "non-JSON body → 400 or 415", testNonJsonBodyReturns400));
  results.push(await runTest(SUITE, "response includes loopTriggered boolean", testLoopTriggeredField));
  return results;
}
