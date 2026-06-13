/**
 * tests/integration/harness.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Phase 116 integration test runner.
 *
 * Usage:
 *   pnpm test:integration
 *
 * What it does:
 *   1. Starts a test server on TEST_PORT (default 3001) with NODE_ENV=test
 *      if the port is not already occupied. Kills it on exit.
 *   2. Runs all test suites sequentially.
 *   3. Writes tests/integration/REPORT.md with pass/fail per test.
 *   4. Exits 0 if all tests pass, 1 if any fail.
 *
 * Architecture:
 *   - Pure fetch() — no supertest, no express test utilities
 *   - Each test suite exports a `runSuite()` function
 *   - Rate limit state is reset via X-Test-Reset-RateLimit header (NODE_ENV=test only)
 *
 * Ralph Wiggum loop exit condition:
 *   When all tests pass, this process exits 0 and prints:
 *   PHASE 116 COMPLETE — ALL INTEGRATION TESTS GREEN
 */

import { writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { spawn, type ChildProcess } from "child_process";
import net from "net";
import { BASE_URL, TEST_PORT, buildReport, type TestResult } from "./helpers";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, "../..");

// ─── Port probe ───────────────────────────────────────────────────────────────

function isPortOpen(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const s = net.createConnection({ port, host: "127.0.0.1" });
    s.once("connect", () => { s.destroy(); resolve(true); });
    s.once("error", () => resolve(false));
  });
}

// ─── Test server lifecycle ────────────────────────────────────────────────────

let testServerProc: ChildProcess | null = null;

async function startTestServer(): Promise<void> {
  const alreadyRunning = await isPortOpen(TEST_PORT);
  if (alreadyRunning) {
    console.info(`✅ Port ${TEST_PORT} already open — using existing server`);
    return;
  }

  console.info(`⚙  Starting test server on port ${TEST_PORT}…`);

  const tsxBin = join(PROJECT_ROOT, "node_modules/.bin/tsx");
  testServerProc = spawn(
    tsxBin,
    ["server/_core/index.ts"],
    {
      cwd: PROJECT_ROOT,
      env: { ...process.env, NODE_ENV: "test", PORT: String(TEST_PORT) },
      stdio: ["ignore", "pipe", "pipe"],
      detached: false,
    }
  );

  testServerProc.stdout?.on("data", (d: Buffer) => {
    const line = d.toString().trim();
    if (line) process.stdout.write(`  [server] ${line}\n`);
  });
  testServerProc.stderr?.on("data", (d: Buffer) => {
    const line = d.toString().trim();
    if (line) process.stderr.write(`  [server:err] ${line}\n`);
  });

  // Wait up to 30 s for the port to open
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 500));
    if (await isPortOpen(TEST_PORT)) {
      console.info(`✅ Test server ready on port ${TEST_PORT}`);
      return;
    }
  }
  throw new Error(`Test server did not start on port ${TEST_PORT} within 30 s`);
}

function stopTestServer(): void {
  if (testServerProc && !testServerProc.killed) {
    testServerProc.kill("SIGTERM");
    testServerProc = null;
  }
}

// ─── Server health check ──────────────────────────────────────────────────────

async function waitForServer(maxAttempts = 15): Promise<void> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const res = await fetch(`${BASE_URL}/api/health`);
      if (res.ok || res.status === 404) return;
    } catch {
      // not yet reachable
    }
    await new Promise(r => setTimeout(r, 1000));
  }
  throw new Error(`Server not reachable at ${BASE_URL} after ${maxAttempts} attempts`);
}

// ─── Suite runner ─────────────────────────────────────────────────────────────

interface Suite {
  name: string;
  runSuite: () => Promise<TestResult[]>;
}

async function runAllSuites(suites: Suite[]): Promise<TestResult[]> {
  const allResults: TestResult[] = [];
  for (const suite of suites) {
    console.info(`\n▶ Running suite: ${suite.name}`);
    try {
      const results = await suite.runSuite();
      for (const r of results) {
        const icon = r.passed ? "  ✅" : "  ❌";
        console.info(`${icon} ${r.name} (${r.durationMs}ms)${r.error ? ` — ${r.error}` : ""}`);
      }
      allResults.push(...results);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`  ❌ Suite "${suite.name}" threw: ${message}`);
      allResults.push({
        suite: suite.name,
        name: "(suite error)",
        passed: false,
        durationMs: 0,
        error: message,
      });
    }
  }
  return allResults;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.info(`\n🔍 Phase 116 — Agent Integration Test Harness`);
  console.info(`   Base URL: ${BASE_URL}`);
  console.info(`   Auth: ${process.env.TEST_API_KEY ? "Bearer token set" : "anonymous (rate limits apply)"}`);

  // Register cleanup on exit so the test server is always killed
  process.on("exit", stopTestServer);
  process.on("SIGINT", () => { stopTestServer(); process.exit(130); });
  process.on("SIGTERM", () => { stopTestServer(); process.exit(143); });

  // 1. Start test server if needed
  try {
    await startTestServer();
    await waitForServer();
  } catch (err) {
    console.error(`\n🛑 LOOP BLOCKED — server failed to start`);
    console.error(`   ${err instanceof Error ? err.message : String(err)}`);
    stopTestServer();
    process.exit(1);
  }

  // 2. Import and run all suites
  const { runSuite: runMcpSuite } = await import("./mcp.test");
  const { runSuite: runStreamSuite } = await import("./stream.test");
  const { runSuite: runAnswerSuite } = await import("./answer.test");
  const { runSuite: runRateLimitSuite } = await import("./rateLimit.test");

  // Order: fast suites first, slow SSE suite last
  const suites: Suite[] = [
    { name: "MCP Tools", runSuite: runMcpSuite },
    { name: "Answer Endpoint", runSuite: runAnswerSuite },
    { name: "Rate Limiting", runSuite: runRateLimitSuite },
    { name: "SSE Stream", runSuite: runStreamSuite },
  ];

  const results = await runAllSuites(suites);

  // 3. Write report
  const report = buildReport(results);
  const reportPath = join(__dirname, "REPORT.md");
  writeFileSync(reportPath, report, "utf8");
  console.info(`\n📄 Report written to ${reportPath}`);

  // 4. Summary
  const passed = results.filter(r => r.passed).length;
  const total = results.length;
  const failed = total - passed;

  console.info(`\n${"─".repeat(60)}`);
  console.info(`Results: ${passed}/${total} passed`);

  stopTestServer();

  if (failed > 0) {
    console.info(`\n❌ ${failed} test(s) failed. See REPORT.md for details.`);
    process.exit(1);
  } else {
    console.info(`\n✅ All ${total} integration tests passed.`);
    console.info(`\nPHASE 116 COMPLETE — ALL INTEGRATION TESTS GREEN`);
    process.exit(0);
  }
}

main().catch(err => {
  console.error("Harness fatal error:", err);
  stopTestServer();
  process.exit(1);
});
