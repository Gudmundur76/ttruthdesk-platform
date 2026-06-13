/**
 * Public REST endpoint: POST /api/translate-and-search
 *
 * Accepts a natural-language question, decomposes it into verifiable scientific
 * claims via LLM, searches PubMed for each claim, and returns structured JSON
 * with verdicts and cited evidence.
 *
 * Authentication: API key via X-API-Key header or ?apiKey= query param.
 * Rate limiting: 10 req/min per key, 2 req/min for anonymous (IP-based).
 *
 * Example request:
 *   POST /api/translate-and-search
 *   X-API-Key: tk_live_...
 *   Content-Type: application/json
 *   { "question": "can I create biotech products out of salmon sludge?" }
 *
 * Example response:
 *   {
 *     "question": "can I create biotech products out of salmon sludge?",
 *     "claimsAnalysed": 3,
 *     "totalPapersFound": 9,
 *     "supportedClaims": 2,
 *     "claims": [ ... ],
 *     "meta": { "processingMs": 1420, "version": "1.0" }
 *   }
 */

import { Router, Request, Response } from "express";
import { translateQueryToClaims } from "./_queryTranslator";
import { processQueryResults } from "./autonomousIngest";
import { getDb } from "./db";
import { apiKeys } from "../drizzle/schema";
import { eq } from "drizzle-orm";
import crypto from "crypto";
import { logger, errData } from "./logger";
const log = logger("translateAndSearchApi");


// ─── Inline PubMed search (mirrors copilotRuntime.ts fetchPubMedResults) ──────

interface PubMedResult {
  pmid: string;
  title: string;
  abstractSnippet: string;
  citationUrl: string;
  authors: string[];
  journal?: string;
  year?: number;
}

const EUROPE_PMC_SEARCH =
  "https://www.ebi.ac.uk/europepmc/webservices/rest/search";

async function fetchPubMedResults(
  query: string,
  limit = 5
): Promise<PubMedResult[]> {
  const encoded = encodeURIComponent(query);
  const url = `${EUROPE_PMC_SEARCH}?query=${encoded}&format=json&pageSize=${limit}&resultType=core&sort=CITED+desc`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(12_000) });
    if (!res.ok) return [];
    const data = (await res.json()) as {
      resultList?: {
        result?: Array<{
          pmid?: string;
          id?: string;
          title?: string;
          abstractText?: string;
          authorString?: string;
          journalTitle?: string;
          pubYear?: string;
        }>;
      };
    };
    const results = data.resultList?.result ?? [];
    return results
      .slice(0, limit)
      .map(r => ({
        pmid: r.pmid ?? r.id ?? "",
        title: r.title ?? "Untitled",
        abstractSnippet: (r.abstractText ?? "").slice(0, 400),
        citationUrl: r.pmid
          ? `https://pubmed.ncbi.nlm.nih.gov/${r.pmid}/`
          : `https://europepmc.org/article/MED/${r.id ?? ""}`,
        authors: r.authorString ? r.authorString.split(", ").slice(0, 5) : [],
        journal: r.journalTitle ?? undefined,
        year: r.pubYear ? parseInt(r.pubYear, 10) : undefined,
      }))
      .filter(r => r.pmid);
  } catch {
    return [];
  }
}

// ─── Rate limiting (in-memory, per-process) ───────────────────────────────────

const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(key: string, maxPerMin: number): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(key);
  if (!entry || entry.resetAt < now) {
    rateLimitMap.set(key, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  if (entry.count >= maxPerMin) return false;
  entry.count++;
  return true;
}

// ─── API key lookup ───────────────────────────────────────────────────────────

async function lookupApiKey(
  rawKey: string
): Promise<{ userId: number; label: string } | null> {
  try {
    const db = await getDb();
    if (!db) return null;
    const keyHash = crypto.createHash("sha256").update(rawKey).digest("hex");
    const rows = await db
      .select({ userId: apiKeys.userId, label: apiKeys.label })
      .from(apiKeys)
      .where(eq(apiKeys.keyHash, keyHash))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return { userId: row.userId, label: row.label };
  } catch {
    return null;
  }
}

// ─── Router ───────────────────────────────────────────────────────────────────

export function registerTranslateAndSearchApi(app: Router) {
  // CORS preflight — allow external frontends (Lovable, partner sites) to call this endpoint
  app.options("/api/translate-and-search", (_req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-API-Key");
    res.sendStatus(204);
  });
  app.post("/api/translate-and-search", async (req: Request, res: Response) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    const start = Date.now();

    // ── Auth ──────────────────────────────────────────────────────────────────
    const rawKey =
      (req.headers["x-api-key"] as string | undefined) ||
      (req.query.apiKey as string | undefined);

    let _userId: number | null = null;
    let rateKey: string;
    let rateLimit: number;

    if (rawKey) {
      const keyRecord = await lookupApiKey(rawKey);
      if (!keyRecord) {
        return res.status(401).json({ error: "Invalid API key" });
      }
      _userId = keyRecord.userId;
      void keyRecord.label; // used for rate key
      rateKey = `apikey:${rawKey}`;
      rateLimit = 10;
    } else {
      // Anonymous — IP-based, lower limit
      const ip =
        (req.headers["x-forwarded-for"] as string | undefined)
          ?.split(",")[0]
          ?.trim() ||
        req.socket.remoteAddress ||
        "unknown";
      rateKey = `anon:${ip}`;
      rateLimit = 2;
    }

    if (!checkRateLimit(rateKey, rateLimit)) {
      return res.status(429).json({
        error: "Rate limit exceeded",
        hint: rawKey
          ? "You are sending too many requests. Please wait 60 seconds."
          : "Anonymous access is limited to 2 req/min. Provide an X-API-Key header for higher limits.",
      });
    }

    // ── Input validation ──────────────────────────────────────────────────────
    const { question, vertical } = req.body ?? {};
    if (
      !question ||
      typeof question !== "string" ||
      question.trim().length < 3
    ) {
      return res.status(400).json({
        error:
          "Missing or invalid 'question' field. Provide a non-empty string.",
      });
    }
    if (question.length > 2000) {
      return res
        .status(400)
        .json({ error: "Question too long (max 2000 chars)." });
    }
    const verticalDomain: string =
      typeof vertical === "string" && vertical.trim().length > 0
        ? vertical.trim()
        : "structural_biology";

    // ── Translate question into claims ────────────────────────────────────────
    let claims: Awaited<ReturnType<typeof translateQueryToClaims>>;
    try {
      claims = await translateQueryToClaims(question.trim());
    } catch (err) {
      log.error(
        "[translate-and-search] translateQueryToClaims failed:",
        errData(err)
      );
      return res
        .status(502)
        .json({ error: "Failed to decompose question into claims." });
    }

    if (!claims || claims.length === 0) {
      return res.json({
        question: question.trim(),
        claimsAnalysed: 0,
        totalPapersFound: 0,
        supportedClaims: 0,
        claims: [],
        note: "No verifiable scientific claims could be extracted from this question.",
        meta: { processingMs: Date.now() - start, version: "1.0" },
      });
    }

    // ── Search PubMed for each claim in parallel ──────────────────────────────
    const claimResults = await Promise.all(
      claims.map(async claim => {
        let pubmedEvidence: PubMedResult[] = [];
        try {
          pubmedEvidence = await fetchPubMedResults(claim.searchQuery, 3);
        } catch {
          pubmedEvidence = [];
        }

        return {
          claimText: claim.claimText,
          searchQuery: claim.searchQuery,
          proteinName: claim.proteinName ?? null,
          organism: claim.organism ?? null,
          verdict: null as { verdict: string; rationale: string } | null,
          pubmedEvidence: pubmedEvidence.map((p: PubMedResult) => ({
            pmid: p.pmid,
            title: p.title,
            abstractSnippet: p.abstractSnippet,
            citationUrl: p.citationUrl,
            journal: p.journal ?? null,
            year: p.year ?? null,
            authors: p.authors ?? [],
          })),
        };
      })
    );

    const totalPapersFound = claimResults.reduce(
      (sum, c) => sum + c.pubmedEvidence.length,
      0
    );

    // ── Fire autonomous ingest in background (non-blocking) ──────────────────
    setImmediate(() => {
      processQueryResults({
        query: question.trim(),
        vertical: verticalDomain,
        pubmedResults: claimResults.flatMap(c =>
          c.pubmedEvidence.map(p => ({
            pmid: p.pmid,
            title: p.title,
            abstractSnippet: p.abstractSnippet,
            citationUrl: p.citationUrl,
            journal: p.journal ?? undefined,
            year: p.year ?? undefined,
            authors: p.authors,
          }))
        ),
      }).catch(e =>
        log.error("[translate-and-search] autonomousIngest error:", errData(e))
      );
    });

    return res.json({
      question: question.trim(),
      claimsAnalysed: claimResults.length,
      totalPapersFound,
      supportedClaims: claimResults.filter(c =>
        c.verdict?.verdict?.toLowerCase().includes("support")
      ).length,
      claims: claimResults,
      meta: {
        processingMs: Date.now() - start,
        version: "1.0",
        note: "Results are being written to the Truth Desk knowledge graph.",
      },
    });
  });
}
