#!/usr/bin/env npx tsx
/* eslint-disable no-console */
/**
 * demo-perplexity.ts — Sprint 25
 *
 * End-to-end integration demo for the Perplexity partnership pitch.
 *
 * Demonstrates the full pipeline:
 *   Natural language question
 *     → SPO decomposition (questionDecomposer)
 *     → Parallel PubMed routing (verifyClaimRoute)
 *     → Verdict + sentence-level provenance
 *
 * Usage:
 *   npx tsx demo-perplexity.ts
 *   npx tsx demo-perplexity.ts --question "Does aspirin reduce cardiovascular risk?"
 *   npx tsx demo-perplexity.ts --live   (calls the live ttruthdesk.claims API)
 *   npx tsx demo-perplexity.ts --mcp    (calls via MCP tool protocol)
 *
 * Output format mirrors what Perplexity Computer would receive from the
 * citation.is MCP server verify_claim tool.
 */

// Demo-only: set stub env vars before importing server modules
process.env.JWT_SECRET = process.env.JWT_SECRET ?? "demo-only-not-for-production";
process.env.DATABASE_URL = process.env.DATABASE_URL ?? "";

import { decomposeQuestion, buildPubMedQuery } from "./server/questionDecomposer";

// ─── Configuration ────────────────────────────────────────────────────────────

const LIVE_API = "https://ttruthdesk.claims/api/public/verify-claim";
const MCP_API = "https://ttruthdesk.claims/api/mcp";

const DEMO_QUESTIONS = [
  "Does regular aspirin use reduce the risk of colorectal cancer in adults over 50?",
  "Is metformin effective for weight loss in non-diabetic patients?",
  "Do statins reduce cardiovascular mortality in patients without prior heart disease?",
  "Does vitamin D supplementation prevent COVID-19 infection?",
  "Is ibuprofen safer than naproxen for long-term use in elderly patients?",
];

// ─── CLI argument parsing ─────────────────────────────────────────────────────

const args = process.argv.slice(2);
const useLive = args.includes("--live");
const useMcp = args.includes("--mcp");
const questionIdx = args.indexOf("--question");
const customQuestion = questionIdx !== -1 ? args[questionIdx + 1] : null;

// ─── Types ────────────────────────────────────────────────────────────────────

interface VerifyClaimResponse {
  ok: boolean;
  claim: string;
  verdict: string;
  rationale: string;
  confidenceScore: number | null;
  signalDensity: number;
  spo: {
    subject: string;
    predicate: string;
    object: string;
    confidence: number;
    method: string;
  } | null;
  pubmedResults: Array<{
    pmid: string;
    title: string;
    abstractSnippet: string;
    journal: string | null;
    year: number | null;
    citationUrl: string;
  }>;
  translatedClaims: string[];
  processedAt: string;
  apiVersion: string;
}

interface McpToolResponse {
  content: Array<{ type: string; text: string }>;
}

// ─── Demo runner ──────────────────────────────────────────────────────────────

async function runDemo(question: string): Promise<void> {
  const separator = "─".repeat(72);
  console.log(`\n${separator}`);
  console.log(`QUESTION: ${question}`);
  console.log(separator);

  // Step 1: Local decomposition (always runs — shows the decomposition layer)
  const decompStart = Date.now();
  const decomposed = await decomposeQuestion(question);
  const decompMs = Date.now() - decompStart;

  console.log(`\n[1] DECOMPOSITION (${decompMs}ms)`);
  console.log(`    Method: heuristic${decomposed.usedLlm ? " + LLM" : ""}`);
  decomposed.claims.forEach((c, i) => {
    const query = buildPubMedQuery(c);
    console.log(`    Claim ${i + 1} [${c.method}, confidence=${c.confidence.toFixed(2)}]:`);
    console.log(`      Text:  "${c.text}"`);
    console.log(`      Query: "${query}"`);
  });

  // Step 2: Verification (live API or MCP or local simulation)
  if (useMcp) {
    await runMcpDemo(question);
  } else if (useLive) {
    await runLiveApiDemo(question);
  } else {
    await runLocalSimulation(question, decomposed);
  }
}

async function runLiveApiDemo(question: string): Promise<void> {
  console.log(`\n[2] LIVE API CALL → ${LIVE_API}`);
  const start = Date.now();

  try {
    const response = await fetch(LIVE_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ claim: question }),
      signal: AbortSignal.timeout(15_000),
    });

    const latencyMs = Date.now() - start;
    const data = (await response.json()) as VerifyClaimResponse;

    console.log(`    Status: ${response.status} | Latency: ${latencyMs}ms`);
    printVerdict(data, latencyMs);
  } catch (err) {
    console.log(`    ERROR: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function runMcpDemo(question: string): Promise<void> {
  console.log(`\n[2] MCP TOOL CALL → ${MCP_API}`);
  console.log(`    Tool: verify_claim`);
  const start = Date.now();

  try {
    const response = await fetch(MCP_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "verify_claim",
          arguments: { claim: question },
        },
      }),
      signal: AbortSignal.timeout(15_000),
    });

    const latencyMs = Date.now() - start;
    const mcpResponse = (await response.json()) as {
      result?: McpToolResponse;
      error?: { message: string };
    };

    console.log(`    Status: ${response.status} | Latency: ${latencyMs}ms`);

    if (mcpResponse.error) {
      console.log(`    MCP ERROR: ${mcpResponse.error.message}`);
      return;
    }

    const textContent = mcpResponse.result?.content?.find(c => c.type === "text");
    if (textContent?.text) {
      try {
        const data = JSON.parse(textContent.text) as VerifyClaimResponse;
        printVerdict(data, latencyMs);
      } catch {
        console.log(`    RAW RESPONSE:\n${textContent.text.slice(0, 500)}`);
      }
    }
  } catch (err) {
    console.log(`    ERROR: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function runLocalSimulation(
  question: string,
  decomposed: Awaited<ReturnType<typeof decomposeQuestion>>
): Promise<void> {
  console.log(`\n[2] LOCAL SIMULATION (no live API call)`);
  console.log(`    Pipeline: questionDecomposer → PubMed query construction`);
  console.log(`    To run against live API: npx tsx demo-perplexity.ts --live`);
  console.log(`    To run via MCP:          npx tsx demo-perplexity.ts --mcp`);

  // Show what the PubMed queries would be
  console.log(`\n[3] PUBMED QUERIES (would be fired in parallel):`);
  decomposed.claims.forEach((c, i) => {
    const query = buildPubMedQuery(c);
    console.log(`    Query ${i + 1}: "${query}"`);
    console.log(`      → https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${encodeURIComponent(query)}&format=json&pageSize=4&resultType=core&sort=CITED+desc`);
  });

  // Show the expected response shape
  console.log(`\n[4] EXPECTED RESPONSE SHAPE (what Perplexity Computer receives):`);
  const exampleResponse = {
    ok: true,
    claim: question,
    verdict: "Supported | Partially Supported | Insufficient Evidence",
    confidenceScore: "0.0–1.0 (real float, not null)",
    spo: {
      subject: "[extracted subject]",
      predicate: "[extracted predicate]",
      object: "[extracted object]",
      confidence: 0.92,
      method: "llm | heuristic",
    },
    pubmedResults: [
      {
        pmid: "PMID",
        title: "Paper title",
        abstractSnippet: "First 400 chars of abstract",
        citationUrl: "https://pubmed.ncbi.nlm.nih.gov/PMID/",
      },
    ],
    apiVersion: "1.2",
  };
  console.log(JSON.stringify(exampleResponse, null, 2));
}

function printVerdict(data: VerifyClaimResponse, latencyMs: number): void {
  const verdictEmoji = {
    Supported: "✅",
    "Partially Supported": "⚠️",
    Ambiguous: "🔶",
    "Needs Expert Review": "🔍",
    "Insufficient Evidence": "❌",
    Contradicted: "🚫",
    "Out of Scope": "⬜",
  }[data.verdict] ?? "❓";

  console.log(`\n[3] VERDICT: ${verdictEmoji} ${data.verdict}`);
    const confDisplay = data.confidenceScore != null
      ? (data.confidenceScore as number).toFixed(2)
      : "null (republish pending)";
    console.log(`    Confidence: ${confDisplay}`);
    console.log(`    Rationale: ${data.rationale.slice(0, 200)}`);

  if (data.spo) {
    console.log(`\n[4] SPO TRIPLE:`);
    console.log(`    Subject:   ${data.spo.subject}`);
    console.log(`    Predicate: ${data.spo.predicate}`);
    console.log(`    Object:    ${data.spo.object}`);
    console.log(`    Confidence: ${data.spo.confidence.toFixed(2)} (${data.spo.method})`);
  }

  if (data.pubmedResults.length > 0) {
    console.log(`\n[5] PROVENANCE CHAIN (${data.pubmedResults.length} papers):`);
    data.pubmedResults.slice(0, 3).forEach((p, i) => {
      console.log(`    [${i + 1}] PMID:${p.pmid} — ${p.title.slice(0, 80)}`);
      console.log(`        ${p.citationUrl}`);
      if (p.abstractSnippet) {
        console.log(`        "${p.abstractSnippet.slice(0, 120)}..."`);
      }
    });
  }

  console.log(`\n[6] METADATA:`);
  console.log(`    Signal density: ${data.signalDensity}`);
  console.log(`    Processed at:   ${data.processedAt}`);
  console.log(`    API version:    ${data.apiVersion}`);
  console.log(`    Total latency:  ${latencyMs}ms`);

  if (data.translatedClaims.length > 0) {
    console.log(`\n[7] TRANSLATED CLAIMS:`);
    data.translatedClaims.forEach((c, i) => console.log(`    ${i + 1}. ${c}`));
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("╔══════════════════════════════════════════════════════════════════════╗");
  console.log("║  citation.is — Stateless Verification Oracle                        ║");
  console.log("║  Sprint 25 Demo — Perplexity Computer Integration                   ║");
  console.log("║  ttruthdesk.claims | MCP Server: citation.is                        ║");
  console.log("╚══════════════════════════════════════════════════════════════════════╝");

  const mode = useLive ? "LIVE API" : useMcp ? "MCP PROTOCOL" : "LOCAL SIMULATION";
  console.log(`\nMode: ${mode}`);
  console.log(`Endpoint: ${useMcp ? MCP_API : useLive ? LIVE_API : "local"}`);

  const questions = customQuestion
    ? [customQuestion]
    : DEMO_QUESTIONS.slice(0, 3); // Run first 3 by default

  for (const question of questions) {
    await runDemo(question);
  }

  console.log(`\n${"─".repeat(72)}`);
  console.log("DEMO COMPLETE");
  console.log(`\nTo integrate with Perplexity Computer:`);
  console.log(`  1. Add citation.is to your MCP server list`);
  console.log(`  2. Call verify_claim before surfacing any scientific claim`);
  console.log(`  3. Attach the provenance chain to the answer`);
  console.log(`\nMCP discovery: https://ttruthdesk.claims/.well-known/mcp.json`);
  console.log(`API docs:       https://ttruthdesk.claims/docs/api`);
}

main().catch(err => {
  console.error("Demo failed:", err);
  process.exit(1);
});
