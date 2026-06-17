/**
 * citationSearchRoute.ts — Sprint 29
 *
 * GET /api/citation-search/stream?q=<query>
 *
 * Perplexity-style citation search engine.
 * Decomposes a natural-language question into atomic verifiable claims,
 * classifies each claim to the relevant authoritative source adapters,
 * queries all relevant adapters in parallel, synthesises a composite verdict,
 * and streams SSE progress events so frontends can show live progress.
 *
 * Pipeline stages (SSE events in order):
 *   stage:decompose  — question decomposed into atomic claims
 *   stage:evidence   — adapters queried, evidence collected
 *   stage:answer     — composite verdict computed
 *   final            — full structured result
 *   error            — unrecoverable error
 *
 * Side effect: calls triggerAutonomousIngest() in background so every
 * search grows the verified claims corpus.
 *
 * Auth: anonymous (rate-limited) or Bearer API key (unlimited).
 * Rate limit: 20 req/hr per IP for anonymous users.
 */
import type { Express, Request, Response } from "express";
import { logger, errData } from "./logger";
import { decomposeQuestion } from "./questionDecomposer";
import { classifyClaims, getAllSourceIds } from "./domainClassifier";
import { listVerticals } from "./verticalAdapters/types";
import type { EvidenceResult } from "./verticalAdapters/types";
import "./verticalAdapters"; // ensure all adapters are registered
import { invokeLLM } from "./_core/llm";
import { triggerAutonomousIngest } from "./autonomousIngest";
import { validateApiKey } from "./apiKeyService";

const log = logger("citationSearchRoute");

// ─── Rate limiting ─────────────────────────────────────────────────────────────
const RATE_LIMIT = 20;
const WINDOW_MS = 60 * 60 * 1000; // 1 hour
interface RateBucket {
  count: number;
  windowStart: number;
}
const rateBuckets = new Map<string, RateBucket>();

// Purge expired rate-limit entries every 10 minutes to prevent unbounded memory growth.
// Entries older than WINDOW_MS are logically expired and safe to delete.
setInterval(() => {
  const now = Date.now();
  for (const [ip, bucket] of Array.from(rateBuckets.entries())) {
    if (now - bucket.windowStart > WINDOW_MS) rateBuckets.delete(ip);
  }
}, 10 * 60 * 1000);

function checkRateLimit(
  ip: string,
  isApiKey: boolean
): { allowed: boolean; remaining: number } {
  if (isApiKey) return { allowed: true, remaining: 999999 };
  const now = Date.now();
  const bucket = rateBuckets.get(ip);
  if (!bucket || now - bucket.windowStart > WINDOW_MS) {
    rateBuckets.set(ip, { count: 1, windowStart: now });
    return { allowed: true, remaining: RATE_LIMIT - 1 };
  }
  if (bucket.count >= RATE_LIMIT) return { allowed: false, remaining: 0 };
  bucket.count += 1;
  return { allowed: true, remaining: RATE_LIMIT - bucket.count };
}

// ─── SSE helpers ──────────────────────────────────────────────────────────────
function sseWrite(res: Response, event: string, data: unknown): void {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function sseError(res: Response, message: string, code = 500): void {
  sseWrite(res, "error", { ok: false, error: message, code });
  res.end();
}

// ─── Verdict helpers ──────────────────────────────────────────────────────────
type VerdictLabel =
  | "Supported"
  | "Partially Supported"
  | "Ambiguous"
  | "Insufficient Evidence"
  | "Needs Expert Review";

const VERDICT_RANK: Record<string, number> = {
  Supported: 6,
  "Partially Supported": 5,
  Ambiguous: 4,
  "Needs Expert Review": 3,
  "Insufficient Evidence": 2,
};

function verdictToConfidence(verdict: string): number {
  const map: Record<string, number> = {
    Supported: 0.92,
    "Partially Supported": 0.65,
    Ambiguous: 0.45,
    "Needs Expert Review": 0.3,
    "Insufficient Evidence": 0.15,
  };
  return map[verdict] ?? 0.15;
}

function evidenceToVerdict(
  evidence: EvidenceResult,
  adapterKey: string
): { verdict: VerdictLabel; rationale: string } {
  if (!evidence.found) {
    return {
      verdict: "Insufficient Evidence",
      rationale: `No evidence found in ${adapterKey}`,
    };
  }
  let verdict: VerdictLabel;
  if (evidence.confidenceScore >= 0.85) verdict = "Supported";
  else if (evidence.confidenceScore >= 0.6) verdict = "Partially Supported";
  else if (evidence.confidenceScore >= 0.3) verdict = "Ambiguous";
  else verdict = "Needs Expert Review";
  const flags =
    evidence.confidenceFlags.length > 0
      ? ` Flags: ${evidence.confidenceFlags.join("; ")}`
      : "";
  return {
    verdict,
    rationale: `${adapterKey} (confidence ${(evidence.confidenceScore * 100).toFixed(0)}%).${flags}`,
  };
}

function bestVerdict(
  a: { verdict: VerdictLabel; rationale: string },
  b: { verdict: VerdictLabel; rationale: string }
): { verdict: VerdictLabel; rationale: string } {
  return (VERDICT_RANK[a.verdict] ?? 0) >= (VERDICT_RANK[b.verdict] ?? 0)
    ? a
    : b;
}

// ─── LLM answer synthesis ─────────────────────────────────────────────────────
interface SourceSummary {
  adapterKey: string;
  sourceId: string | null;
  sourceUrl: string | null;
  title?: string;
  journal?: string;
  year?: number;
  snippet?: string;
  confidence: number;
}

async function synthesiseAnswer(
  question: string,
  primaryClaim: string,
  verdict: VerdictLabel,
  sources: SourceSummary[]
): Promise<string> {
  if (sources.length === 0) {
    return `No peer-reviewed evidence was found for: "${primaryClaim}". The claim could not be verified against available authoritative sources.`;
  }
  const sourceList = sources
    .slice(0, 5)
    .map(
      (s, i) =>
        `[${i + 1}] ${s.adapterKey}${s.title ? `: ${s.title}` : ""}${s.journal ? ` (${s.journal}${s.year ? `, ${s.year}` : ""})` : ""}${s.snippet ? ` — ${s.snippet.slice(0, 200)}` : ""}`
    )
    .join("\n");
  try {
    const result = await invokeLLM({
      messages: [
        {
          role: "system",
          content:
            "You are a scientific evidence synthesiser. Given a claim, a verdict, and a list of sources, write a concise 2-3 sentence answer that explains what the evidence shows. Be precise, cite the sources by number, and do not add information not present in the sources. Do not use markdown.",
        },
        {
          role: "user",
          content: `Question: ${question}\nPrimary claim: ${primaryClaim}\nVerdict: ${verdict}\n\nSources:\n${sourceList}\n\nWrite a 2-3 sentence answer.`,
        },
      ],
    });
    const content = result?.choices?.[0]?.message?.content;
    return typeof content === "string"
      ? content.trim()
      : `Verdict: ${verdict}. Based on ${sources.length} source(s) across authoritative databases.`;
  } catch {
    return `Verdict: ${verdict}. Based on ${sources.length} source(s) across authoritative databases.`;
  }
}

// ─── Pipeline stage helpers ───────────────────────────────────────────────────

/** Stage 1: decompose the question into atomic claims. */
async function runDecomposeStage(
  q: string,
  res: Response,
  clientGone: boolean
): Promise<{ primaryClaim: string; claims: Awaited<ReturnType<typeof decomposeQuestion>>["claims"] }> {
  const decomposition = await decomposeQuestion(q);
  const { claims } = decomposition;
  const primaryClaim = claims[0]?.text ?? q;
  if (!clientGone) {
    sseWrite(res, "stage:decompose", {
      stage: 1,
      label: "decompose",
      question: q,
      primaryClaim,
      claims: claims.map(c => ({
        text: c.text,
        confidence: c.confidence,
        method: c.method,
      })),
      claimCount: claims.length,
    });
  }
  return { primaryClaim, claims };
}

type AdapterEntry = ReturnType<typeof listVerticals>[number];
interface EvidenceEntry {
  adapter: AdapterEntry;
  evidence: EvidenceResult;
}

/** Stage 2: classify claims, query all relevant adapters in parallel, emit evidence event. */
async function runEvidenceStage(
  q: string,
  primaryClaim: string,
  claims: Awaited<ReturnType<typeof decomposeQuestion>>["claims"],
  res: Response,
  clientGone: boolean
): Promise<{
  foundSources: SourceSummary[];
  successfulResults: EvidenceEntry[];
  adaptersToQuery: AdapterEntry[];
  classifications: ReturnType<typeof classifyClaims>;
}> {
  const classifications = classifyClaims(claims);
  const allSourceIds = getAllSourceIds(classifications);
  const allAdapters = listVerticals();

  const GENERAL_ADAPTERS = ["openalex", "semantic_scholar", "crossref"];
  const targetKeys = new Set<string>([...allSourceIds, ...GENERAL_ADAPTERS]);
  const EXCLUDED_KEYS = new Set(["unknown", "generic_source"]);
  const adaptersToQuery = allAdapters.filter(
    a => targetKeys.has(a.domainKey) && !EXCLUDED_KEYS.has(a.domainKey)
  );

  const adapterResults = await Promise.allSettled(
    adaptersToQuery.map(async adapter => {
      const evidence = await adapter.lookupEvidence({
        claimText: primaryClaim,
        extractedValue: null,
      });
      return { adapter, evidence };
    })
  );

  const successfulResults: EvidenceEntry[] = [];
  let failedAdapters = 0;
  for (const result of adapterResults) {
    if (result.status === "fulfilled") {
      successfulResults.push(result.value);
    } else {
      failedAdapters++;
      log.debug("Adapter failed", { reason: String(result.reason) });
    }
  }

  const foundSources: SourceSummary[] = successfulResults
    .filter(r => r.evidence.found)
    .map(r => ({
      adapterKey: r.adapter.domainKey,
      sourceId: r.evidence.sourceId,
      sourceUrl: r.evidence.sourceUrl,
      confidence: r.evidence.confidenceScore,
      snippet:
        typeof r.evidence.evidenceRaw?.abstractSnippet === "string"
          ? r.evidence.evidenceRaw.abstractSnippet
          : typeof r.evidence.evidenceRaw?.abstract === "string"
            ? r.evidence.evidenceRaw.abstract
            : undefined,
      title:
        typeof r.evidence.evidenceRaw?.title === "string"
          ? r.evidence.evidenceRaw.title
          : undefined,
      journal:
        typeof r.evidence.evidenceRaw?.journal === "string"
          ? r.evidence.evidenceRaw.journal
          : undefined,
      year:
        typeof r.evidence.evidenceRaw?.year === "number"
          ? r.evidence.evidenceRaw.year
          : undefined,
    }))
    .sort((a, b) => b.confidence - a.confidence);

  if (!clientGone) {
    sseWrite(res, "stage:evidence", {
      stage: 2,
      label: "evidence",
      totalAdapters: adaptersToQuery.length,
      sourcesFound: foundSources.length,
      failedAdapters,
      sources: foundSources.slice(0, 8).map(s => ({
        adapterKey: s.adapterKey,
        sourceId: s.sourceId,
        sourceUrl: s.sourceUrl,
        title: s.title ?? null,
        journal: s.journal ?? null,
        year: s.year ?? null,
        confidence: s.confidence,
      })),
    });
  }

  return { foundSources, successfulResults, adaptersToQuery, classifications };
}

/** Stage 3: compute composite verdict and synthesise LLM answer. */
async function runAnswerStage(
  q: string,
  primaryClaim: string,
  successfulResults: EvidenceEntry[],
  foundSources: SourceSummary[],
  res: Response,
  clientGone: boolean
): Promise<{ compositeVerdict: { verdict: VerdictLabel; rationale: string }; confidence: number; answerText: string }> {
  let compositeVerdict: { verdict: VerdictLabel; rationale: string } = {
    verdict: "Insufficient Evidence",
    rationale: "No authoritative sources found",
  };
  for (const r of successfulResults) {
    const v = evidenceToVerdict(r.evidence, r.adapter.domainKey);
    compositeVerdict = bestVerdict(compositeVerdict, v);
  }

  const confidence = verdictToConfidence(compositeVerdict.verdict);
  const answerText = await synthesiseAnswer(q, primaryClaim, compositeVerdict.verdict, foundSources);

  if (!clientGone) {
    sseWrite(res, "stage:answer", {
      stage: 3,
      label: "answer",
      verdict: compositeVerdict.verdict,
      confidence,
      answerLength: answerText.length,
    });
  }

  return { compositeVerdict, confidence, answerText };
}

// ─── Auth helper ────────────────────────────────────────────────────────────
async function resolveIsApiKey(authHeader: string): Promise<boolean> {
  if (!authHeader.startsWith("Bearer ")) return false;
  const token = authHeader.slice(7).trim();
  const keyRecord = await validateApiKey(token);
  return keyRecord?.valid === true;
}

// ─── Main handler ─────────────────────────────────────────────────────────────
async function handleCitationSearch(
  req: Request,
  res: Response
): Promise<void> {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  // Auth
  const authHeader = (req.headers["authorization"] as string) ?? "";
  const isApiKey = await resolveIsApiKey(authHeader);

  // Input validation (before SSE headers)
  const q = typeof req.query["q"] === "string" ? req.query["q"].trim() : "";
  if (!q || q.length < 3) {
    res.status(400).json({ ok: false, error: "Query parameter 'q' is required (min 3 chars)" });
    return;
  }
  if (q.length > 2000) {
    res.status(400).json({ ok: false, error: "Query too long (max 2000 chars)" });
    return;
  }

  // Rate limit (before SSE headers)
  const ip =
    (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ??
    req.socket.remoteAddress ??
    "unknown";
  const { allowed, remaining } = checkRateLimit(ip, isApiKey);
  if (!allowed) {
    res.status(429).json({ ok: false, error: "Rate limit exceeded. 20 requests per hour for anonymous users." });
    return;
  }

  // Commit to SSE
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.setHeader("X-RateLimit-Remaining", String(remaining));
  res.flushHeaders();

  let clientGone = false;
  req.on("close", () => { clientGone = true; });
  res.write(": ping\n\n");

  const heartbeat = setInterval(() => {
    if (!clientGone) res.write(": heartbeat\n\n");
  }, 15_000);

  const processedAt = new Date().toISOString();

  try {
    const { primaryClaim, claims } = await runDecomposeStage(q, res, clientGone);
    const { foundSources, successfulResults, adaptersToQuery, classifications } =
      await runEvidenceStage(q, primaryClaim, claims, res, clientGone);
    const { compositeVerdict, confidence, answerText } =
      await runAnswerStage(q, primaryClaim, successfulResults, foundSources, res, clientGone);

    // Background: autonomous ingest
    if (foundSources.length > 0) {
      triggerAutonomousIngest({
        query: q,
        pubmedResults: foundSources
          .filter(s => s.sourceId && s.sourceUrl)
          .slice(0, 10)
          .map(s => ({
            pmid: s.sourceId ?? "",
            title: s.title ?? primaryClaim,
            abstractSnippet: s.snippet ?? "",
            citationUrl: s.sourceUrl ?? "",
            authors: [],
            journal: s.journal,
            year: s.year,
          })),
        uniprotEntries: [],
        vertical: classifications[0]?.domain ?? "unknown",
      });
    }

    // Final event
    if (!clientGone) {
      sseWrite(res, "final", {
        ok: true,
        question: q,
        primaryClaim,
        answer: answerText,
        verdict: compositeVerdict.verdict,
        confidence,
        rationale: compositeVerdict.rationale,
        sources: foundSources.slice(0, 10).map(s => ({
          adapterKey: s.adapterKey,
          sourceId: s.sourceId,
          sourceUrl: s.sourceUrl,
          title: s.title ?? null,
          journal: s.journal ?? null,
          year: s.year ?? null,
          confidence: s.confidence,
        })),
        claimsAnalysed: claims.length,
        adaptersQueried: adaptersToQuery.length,
        sourcesFound: foundSources.length,
        processedAt,
        apiVersion: "2.0",
        streaming: true,
      });
    }

    clearInterval(heartbeat);
    res.end();
  } catch (err) {
    clearInterval(heartbeat);
    log.error("Citation search error:", errData(err));
    if (!clientGone) {
      sseError(res, "Citation search failed due to an internal error. Please try again.");
    } else {
      res.end();
    }
  }
}

// ─── Registration ─────────────────────────────────────────────────────────────
export function registerCitationSearchRoute(app: Express): void {
  app.options("/api/citation-search/stream", (_req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.status(204).end();
  });
  app.get("/api/citation-search/stream", handleCitationSearch);
}
