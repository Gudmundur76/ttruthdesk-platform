/**
 * answerRoute.ts — Phase 110
 *
 * POST /api/public/answer
 *
 * Public, unauthenticated endpoint for the Question-to-Claim Interface.
 * Converts a natural language question to a verifiable claim and returns
 * a structured verdict with confidence and source citations.
 *
 * Rate limiting:
 *   - Anonymous (IP-based): 10 requests per hour
 *   - API key holders: unlimited
 *
 * Request body:
 *   { "question": string }
 *
 * Response:
 *   {
 *     "ok": true,
 *     "questionId": number | null,
 *     "questionText": string,
 *     "derivedClaim": string,
 *     "verdict": string,
 *     "confidence": number,
 *     "rationale": string,
 *     "sources": SourceCitation[],
 *     "loopTriggered": boolean,
 *     "processedAt": string (ISO 8601),
 *     "apiVersion": "1.0"
 *   }
 */

import type { Request, Response, Express } from "express";
import { processQuestion } from "./questionRouter";
import { insertQuestion } from "./db";
import { validateApiKey } from "./apiKeyService";
import { logger, errData } from "./logger";
const log = logger("answerRoute");


// ─── Rate limiting ────────────────────────────────────────────────────────────

/** Anonymous rate limit: 10 requests per hour per IP. */
const ANON_RATE_LIMIT = 10;
const ANON_WINDOW_MS = 60 * 60 * 1000; // 1 hour

const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function checkAnonRateLimit(ip: string): {
  allowed: boolean;
  remaining: number;
  resetAt: number;
} {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now > entry.resetAt) {
    const resetAt = now + ANON_WINDOW_MS;
    rateLimitMap.set(ip, { count: 1, resetAt });
    return { allowed: true, remaining: ANON_RATE_LIMIT - 1, resetAt };
  }
  if (entry.count >= ANON_RATE_LIMIT) {
    return { allowed: false, remaining: 0, resetAt: entry.resetAt };
  }
  entry.count++;
  return {
    allowed: true,
    remaining: ANON_RATE_LIMIT - entry.count,
    resetAt: entry.resetAt,
  };
}

// Prune stale entries every 30 minutes
setInterval(
  () => {
    const now = Date.now();
    for (const [ip, entry] of Array.from(rateLimitMap.entries())) {
      if (now > entry.resetAt) rateLimitMap.delete(ip);
    }
  },
  30 * 60 * 1000
);

// ─── Handler ──────────────────────────────────────────────────────────────────

async function handleAnswer(req: Request, res: Response): Promise<void> {
  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Test-Reset-RateLimit");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  // Test-only: clear the IP's rate limit bucket when X-Test-Reset-RateLimit header is present
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (process.env.NODE_ENV === "test" && req.headers["x-test-reset-ratelimit"] === "1") {
    const resetIp =
      (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ??
      req.ip ??
      "unknown";
    rateLimitMap.delete(resetIp);
    res.status(200).json({ ok: true, reset: true });
    return;
  }

  const ip =
    (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ??
    req.ip ??
    "unknown";

  // Check for API key in Authorization header (Bearer token)
  const authHeader = req.headers.authorization ?? "";
  let isApiKeyHolder = false;

  if (authHeader.startsWith("Bearer ")) {
    const rawKey = authHeader.slice(7).trim();
    if (rawKey.length === 64) {
      const validation = await validateApiKey(rawKey, ip);
      isApiKeyHolder = validation.valid;
    }
  }

  // Apply rate limiting for anonymous callers only
  let rl = { allowed: true, remaining: 999, resetAt: Date.now() + ANON_WINDOW_MS };
  if (!isApiKeyHolder) {
    rl = checkAnonRateLimit(ip);
    res.setHeader("X-RateLimit-Limit", String(ANON_RATE_LIMIT));
    res.setHeader("X-RateLimit-Remaining", String(rl.remaining));
    res.setHeader(
      "X-RateLimit-Reset",
      String(Math.ceil(rl.resetAt / 1000))
    );
  } else {
    res.setHeader("X-RateLimit-Limit", "unlimited");
    res.setHeader("X-RateLimit-Remaining", "unlimited");
  }

  res.setHeader("X-Plan-Tier", isApiKeyHolder ? "api" : "free");

  if (!rl.allowed) {
    res.status(429).json({
      ok: false,
      error:
        "Rate limit exceeded. Maximum 10 requests per hour for anonymous callers. Use an API key for unlimited access.",
      retryAfterMs: rl.resetAt - Date.now(),
    });
    return;
  }

  // Validate request body
  const { question } = (req.body ?? {}) as { question?: unknown };
  if (typeof question !== "string" || question.trim().length < 3) {
    res.status(400).json({
      ok: false,
      error:
        "Request body must include a 'question' string of at least 3 characters.",
    });
    return;
  }
  if (question.length > 1000) {
    res.status(400).json({
      ok: false,
      error: "Question must be at most 1000 characters.",
    });
    return;
  }

  try {
    const result = await processQuestion(question.trim());

    // Persist to questions table
    let questionId: number | null = null;
    try {
      const askedAt = Math.floor(Date.now() / 1000);
      questionId = await insertQuestion({
        questionText: result.questionText,
        derivedClaim: result.derivedClaim,
        verdict: result.verdict,
        confidence: result.confidence,
        sources: result.sources,
        loopTriggered: result.loopTriggered,
        askedAt,
      });
    } catch (dbErr) {
      log.error("[AnswerRoute] insertQuestion failed:", errData(dbErr));
    }

    // Emit coverage_gap event if loop should be triggered (fire-and-forget)
    if (result.loopTriggered) {
      import("./autonomousLoop/eventBus")
        .then(({ publishEvent }) =>
          publishEvent("coverage_gap", {
            questionText: result.questionText,
            derivedClaim: result.derivedClaim,
            verdict: result.verdict,
            confidence: result.confidence,
            detectedAt: Math.floor(Date.now() / 1000),
          })
        )
        .catch(err =>
          log.warn("[AnswerRoute] coverage_gap event publish failed:", errData(err))
        );
    }

    res.status(200).json({
      ok: true,
      questionId,
      questionText: result.questionText,
      derivedClaim: result.derivedClaim,
      verdict: result.verdict,
      confidence: result.confidence,
      rationale: result.rationale,
      sources: result.sources,
      loopTriggered: result.loopTriggered,
      processedAt: result.processedAt,
      apiVersion: "1.0",
    });
  } catch (err) {
    log.error("[AnswerRoute] Unexpected error:", errData(err));
    res.status(500).json({
      ok: false,
      error: "Internal server error. Please try again later.",
    });
  }
}

// ─── Registration ─────────────────────────────────────────────────────────────

export function registerAnswerRoute(app: Express): void {
  app.options("/api/public/answer", (_req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.status(204).end();
  });
  app.post("/api/public/answer", handleAnswer);
}

// ─── Exported for testing ─────────────────────────────────────────────────────

export { checkAnonRateLimit, ANON_RATE_LIMIT, ANON_WINDOW_MS };
