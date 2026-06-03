/**
 * Truth Desk — k6 Load Test Suite
 *
 * Tests five scenarios:
 * 1. Smoke test  — 1 VU, 10 iterations (sanity check)
 * 2. Ramp-up     — 0→20 VUs over 30s, hold 30s, ramp down
 * 3. Spike       — sudden burst to 50 VUs for 10s
 * 4. Rate limiter — verify /api/public/verify-claim enforces 429 under burst
 * 5. Agent discovery — /.well-known/mcp.json, /llms.txt, /openapi.json under load
 *
 * Run:
 *   k6 run load-tests/api-load.js
 *   k6 run --env SCENARIO=smoke load-tests/api-load.js
 *   k6 run --env SCENARIO=ramp  load-tests/api-load.js
 *   k6 run --env SCENARIO=spike load-tests/api-load.js
 *   k6 run --env SCENARIO=ratelimit load-tests/api-load.js
 *   k6 run --env SCENARIO=agent load-tests/api-load.js
 */

import http from "k6/http";
import { check, sleep, group } from "k6";
import { Rate, Trend, Counter } from "k6/metrics";

// ─── Custom metrics ────────────────────────────────────────────────────────────
const errorRate = new Rate("error_rate");
const claimsJsonLatency = new Trend("claims_json_latency_ms", true);
const verifyClaimLatency = new Trend("verify_claim_latency_ms", true);
const agentDiscoveryLatency = new Trend("agent_discovery_latency_ms", true);
const rateLimitHits = new Counter("rate_limit_hits");

// ─── Scenario config ───────────────────────────────────────────────────────────
const SCENARIO = __ENV.SCENARIO || "smoke";
const BASE_URL = __ENV.BASE_URL || "http://localhost:3000";

const scenarios = {
  smoke: {
    vus: 1,
    iterations: 10,
    thresholds: {
      http_req_duration: ["p(95)<2000"],
      error_rate: ["rate<0.05"],
    },
  },
  ramp: {
    stages: [
      { duration: "15s", target: 5 },
      { duration: "30s", target: 20 },
      { duration: "15s", target: 0 },
    ],
    thresholds: {
      http_req_duration: ["p(95)<3000", "p(99)<5000"],
      error_rate: ["rate<0.10"],
      claims_json_latency_ms: ["p(95)<2000"],
    },
  },
  spike: {
    stages: [
      { duration: "5s", target: 50 },
      { duration: "10s", target: 50 },
      { duration: "5s", target: 0 },
    ],
    thresholds: {
      http_req_duration: ["p(95)<5000"],
      error_rate: ["rate<0.20"], // some errors expected under spike
    },
  },
  ratelimit: {
    vus: 15,
    duration: "20s",
    thresholds: {
      rate_limit_hits: ["count>0"], // we EXPECT rate limits to fire
    },
  },
  agent: {
    vus: 5,
    duration: "20s",
    thresholds: {
      agent_discovery_latency_ms: ["p(95)<2000"],
      error_rate: ["rate<0.05"],
    },
  },
};

const selected = scenarios[SCENARIO];

export const options = {
  vus: selected.vus,
  iterations: selected.iterations,
  duration: selected.duration,
  stages: selected.stages,
  thresholds: selected.thresholds || {},
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function recordError(res) {
  const ok = res.status >= 200 && res.status < 500;
  errorRate.add(!ok);
  return ok;
}

// ─── Main test function ────────────────────────────────────────────────────────
export default function () {
  if (SCENARIO === "ratelimit") {
    runRateLimitScenario();
  } else if (SCENARIO === "agent") {
    runAgentDiscoveryScenario();
  } else {
    runGeneralScenario();
  }
}

// ─── General scenario (smoke / ramp / spike) ──────────────────────────────────
function runGeneralScenario() {
  group("GET /api/public/claims.json", () => {
    const start = Date.now();
    const res = http.get(`${BASE_URL}/api/public/claims.json`);
    claimsJsonLatency.add(Date.now() - start);

    const ok = check(res, {
      "claims.json status 200": (r) => r.status === 200,
      "claims.json content-type json": (r) =>
        (r.headers["Content-Type"] || "").includes("application/json"),
      "claims.json body is object": (r) => {
        try {
          const b = JSON.parse(r.body);
          return typeof b === "object" && b !== null;
        } catch {
          return false;
        }
      },
    });
    recordError(res);
    if (!ok) console.warn(`claims.json failed: ${res.status} ${res.body?.slice(0, 100)}`);
  });

  sleep(0.2);

  group("GET /llms.txt", () => {
    const res = http.get(`${BASE_URL}/llms.txt`);
    check(res, {
      "llms.txt status 200": (r) => r.status === 200,
      "llms.txt contains Truth Desk": (r) => r.body.includes("Truth Desk"),
    });
    recordError(res);
  });

  sleep(0.2);

  group("GET /.well-known/mcp.json", () => {
    const start = Date.now();
    const res = http.get(`${BASE_URL}/.well-known/mcp.json`);
    agentDiscoveryLatency.add(Date.now() - start);

    check(res, {
      "mcp.json status 200": (r) => r.status === 200,
      "mcp.json has tools array": (r) => {
        try {
          const b = JSON.parse(r.body);
          return Array.isArray(b.tools) && b.tools.length > 0;
        } catch {
          return false;
        }
      },
    });
    recordError(res);
  });

  sleep(0.2);

  group("GET /api/md", () => {
    const res = http.get(`${BASE_URL}/api/md`);
    check(res, {
      "api/md status 200": (r) => r.status === 200,
      "api/md has content": (r) => r.body.length > 50,
    });
    recordError(res);
  });

  sleep(0.3);
}

// ─── Rate limiter scenario ─────────────────────────────────────────────────────
function runRateLimitScenario() {
  group("POST /api/public/verify-claim (rate limit probe)", () => {
    const start = Date.now();
    const res = http.post(
      `${BASE_URL}/api/public/verify-claim`,
      JSON.stringify({
        claim: "The crystal structure of lysozyme was solved at 1.8 Å resolution.",
      }),
      { headers: { "Content-Type": "application/json" } }
    );
    verifyClaimLatency.add(Date.now() - start);

    if (res.status === 429) {
      rateLimitHits.add(1);
      check(res, {
        "rate limit response has retry-after or message": (r) => {
          try {
            const b = JSON.parse(r.body);
            return b.error !== undefined || r.headers["Retry-After"] !== undefined;
          } catch {
            return r.headers["Retry-After"] !== undefined;
          }
        },
      });
    } else {
      check(res, {
        "verify-claim 200 or 500": (r) => r.status === 200 || r.status === 500,
        "verify-claim has response body": (r) => {
          try {
            const b = JSON.parse(r.body);
            return typeof b === "object";
          } catch {
            return false;
          }
        },
      });
      recordError(res);
    }
  });
  // No sleep — we want to saturate the rate limiter
}

// ─── Agent discovery scenario ──────────────────────────────────────────────────
function runAgentDiscoveryScenario() {
  const endpoints = [
    { url: `${BASE_URL}/.well-known/mcp.json`, name: "mcp.json" },
    { url: `${BASE_URL}/.well-known/auth.md`, name: "auth.md" },
    { url: `${BASE_URL}/openapi.json`, name: "openapi.json" },
    { url: `${BASE_URL}/llms.txt`, name: "llms.txt" },
    { url: `${BASE_URL}/sitemap.xml`, name: "sitemap.xml" },
  ];

  for (const ep of endpoints) {
    group(`GET ${ep.name}`, () => {
      const start = Date.now();
      const res = http.get(ep.url);
      agentDiscoveryLatency.add(Date.now() - start);

      check(res, {
        [`${ep.name} status 200`]: (r) => r.status === 200,
        [`${ep.name} has content`]: (r) => r.body.length > 10,
      });
      recordError(res);
    });
    sleep(0.1);
  }
}
