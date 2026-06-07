/**
 * hostingerWebhook.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Inbound signed webhook endpoint for Hostinger-hosted sites.
 *
 * Every Hostinger site (laxey.is, countrydesk, etc.) that embeds the Truth
 * Desk widget or uses the JS SDK fires a signed POST to this endpoint on every
 * user interaction (search, query, claim verify, paper click).  The endpoint:
 *
 *   1. Validates the HMAC-SHA256 signature (X-TruthDesk-Signature header).
 *   2. Rate-limits by source domain (max 120 events / minute per domain).
 *   3. Maps the event type to the correct autonomous loop event.
 *   4. Publishes the event to the event bus so the full loop runs:
 *        search_query     → paper_discovered (if query provided)
 *        claim_verified   → document_submitted (if claimText provided)
 *        paper_clicked    → paper_discovered
 *        page_view        → logged only, no loop event (low signal)
 *   5. Returns { received: true, eventId } so the Hostinger snippet can
 *      confirm delivery.
 *
 * ─── Setup for each Hostinger site ──────────────────────────────────────────
 *
 * 1. Generate a shared secret (openssl rand -hex 32) and store it in the
 *    Hostinger site's environment as TRUTHDESK_WEBHOOK_SECRET.
 * 2. Register the site in the ALLOWED_ORIGINS set below (or via env var
 *    HOSTINGER_ALLOWED_ORIGINS as a comma-separated list).
 * 3. Include hostinger-integration.js on every page (see /embed/hostinger.js).
 * 4. The snippet signs each event with HMAC-SHA256(secret, JSON.stringify(body))
 *    and sends X-TruthDesk-Signature: sha256=<hex>.
 *
 * ─── Signature verification ──────────────────────────────────────────────────
 *
 * The shared secret is the value of HOSTINGER_WEBHOOK_SECRET env var.
 * For multi-site setups, each site can use the same global secret or a
 * per-site secret stored in HOSTINGER_WEBHOOK_SECRET_<SLUG>.
 */

import type { Express, Request, Response } from "express";
import crypto from "crypto";
import { publishEvent } from "./autonomousLoop/eventBus";

// ─── Config ───────────────────────────────────────────────────────────────────

const GLOBAL_SECRET = process.env.HOSTINGER_WEBHOOK_SECRET ?? "";

/** Allowed origin domains. Populated from env or hardcoded defaults. */
function getAllowedOrigins(): Set<string> {
  const envVal = process.env.HOSTINGER_ALLOWED_ORIGINS ?? "";
  const defaults = [
    "laxey.is",
    "www.laxey.is",
    "countrydesk.io",
    "www.countrydesk.io",
    "ttruthdesk.claims",
    "www.ttruthdesk.claims",
    "protein-desk-5r5rzpyg.manus.space",
  ];
  const fromEnv = envVal ? envVal.split(",").map((s) => s.trim()).filter(Boolean) : [];
  return new Set([...defaults, ...fromEnv]);
}

/** Simple in-memory rate limiter: max 120 events / 60s per domain */
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(domain: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(domain);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(domain, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  if (entry.count >= 120) return false;
  entry.count++;
  return true;
}

// ─── Signature verification ───────────────────────────────────────────────────

function verifySignature(rawBody: Buffer, signatureHeader: string, secret: string): boolean {
  if (!secret) return false; // No secret configured → reject
  const expected = "sha256=" + crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signatureHeader));
  } catch {
    return false;
  }
}

// ─── Event types ──────────────────────────────────────────────────────────────

type HostingerEventType =
  | "search_query"
  | "claim_verified"
  | "paper_clicked"
  | "page_view"
  | "widget_opened"
  | "widget_closed";

interface HostingerWebhookBody {
  /** Event type fired by the Hostinger site */
  eventType: HostingerEventType;
  /** Origin domain of the Hostinger site */
  origin: string;
  /** ISO timestamp from the client */
  timestamp: string;
  /** Page URL where the event fired */
  pageUrl?: string;
  /** For search_query: the query string */
  query?: string;
  /** For claim_verified: the claim text */
  claimText?: string;
  /** For claim_verified: the verdict returned by Truth Desk */
  verdict?: string;
  /** For paper_clicked: PubMed ID */
  pmid?: string;
  /** For paper_clicked: paper title */
  paperTitle?: string;
  /** For paper_clicked: abstract snippet */
  abstractSnippet?: string;
  /** For paper_clicked: journal */
  journal?: string | null;
  /** For paper_clicked: year */
  year?: number | null;
  /** Optional: vertical domain context */
  vertical?: string;
  /** Optional: user session ID (hashed, no PII) */
  sessionId?: string;
}

// ─── Loop event publisher ─────────────────────────────────────────────────────

async function publishLoopEventFromHostinger(
  body: HostingerWebhookBody
): Promise<number | null> {
  const source = `hostinger:${body.origin}`;

  switch (body.eventType) {
    case "search_query": {
      if (!body.query) return null;
      // Publish as paper_discovered with the query as the search term
      // The Frontier Layer will generate gap-closing hypotheses from this query
      const eventId = await publishEvent("paper_discovered", {
        pmid: `hostinger_query_${Date.now()}`,
        title: `[Hostinger Search] ${body.query}`,
        abstractSnippet: `User searched for: "${body.query}" on ${body.origin}`,
        searchQuery: body.query,
        journal: null,
        year: null,
        authors: [],
        source,
        pageUrl: body.pageUrl,
        vertical: body.vertical ?? "structural_biology",
      });
      console.log(`[HostingerWebhook] search_query from ${body.origin} → paper_discovered event #${eventId}`);
      return eventId;
    }

    case "claim_verified": {
      if (!body.claimText) return null;
      // Publish as document_submitted so the Truth Layer re-verifies
      const eventId = await publishEvent("document_submitted", {
        claimText: body.claimText,
        verdict: body.verdict,
        source,
        pageUrl: body.pageUrl,
        vertical: body.vertical ?? "structural_biology",
        origin: body.origin,
      });
      console.log(`[HostingerWebhook] claim_verified from ${body.origin} → document_submitted event #${eventId}`);
      return eventId;
    }

    case "paper_clicked": {
      if (!body.pmid) return null;
      const eventId = await publishEvent("paper_discovered", {
        pmid: body.pmid,
        title: body.paperTitle ?? `[Hostinger Paper Click] PMID:${body.pmid}`,
        abstractSnippet: body.abstractSnippet ?? "",
        journal: body.journal ?? null,
        year: body.year ?? null,
        authors: [],
        source,
        pageUrl: body.pageUrl,
        vertical: body.vertical ?? "structural_biology",
      });
      console.log(`[HostingerWebhook] paper_clicked PMID:${body.pmid} from ${body.origin} → paper_discovered event #${eventId}`);
      return eventId;
    }

    case "page_view":
    case "widget_opened":
    case "widget_closed":
      // Low-signal events — log only, no loop event
      console.log(`[HostingerWebhook] ${body.eventType} from ${body.origin} — logged, no loop event`);
      return null;

    default:
      console.warn(`[HostingerWebhook] Unknown eventType: ${(body as { eventType: string }).eventType}`);
      return null;
  }
}

// ─── Route registration ───────────────────────────────────────────────────────

export function registerHostingerWebhookRoute(app: Express): void {
  /**
   * POST /api/webhook/hostinger
   *
   * Accepts raw JSON body (express.raw middleware applied in _core/index.ts
   * before express.json so we can verify the signature).
   *
   * Headers required:
   *   X-TruthDesk-Signature: sha256=<hex>
   *   X-TruthDesk-Event: <eventType>
   *   Content-Type: application/json
   */
  app.post(
    "/api/webhook/hostinger",
    // express.raw is registered globally for /api/webhook/* in _core/index.ts
    async (req: Request, res: Response) => {
      try {
        // ── 1. Extract raw body ──────────────────────────────────────────────
        const rawBody: Buffer = Buffer.isBuffer(req.body)
          ? req.body
          : Buffer.from(JSON.stringify(req.body));

        // ── 2. Verify signature ──────────────────────────────────────────────
        const sigHeader = (req.headers["x-truthdesk-signature"] as string) ?? "";
        if (!verifySignature(rawBody, sigHeader, GLOBAL_SECRET)) {
          console.warn(`[HostingerWebhook] Invalid signature from ${req.ip}`);
          res.status(401).json({ error: "Invalid signature" });
          return;
        }

        // ── 3. Parse body ────────────────────────────────────────────────────
        let body: HostingerWebhookBody;
        try {
          body = JSON.parse(rawBody.toString("utf8")) as HostingerWebhookBody;
        } catch {
          res.status(400).json({ error: "Invalid JSON body" });
          return;
        }

        // ── 4. Validate origin ───────────────────────────────────────────────
        const allowedOrigins = getAllowedOrigins();
        const originDomain = (body.origin ?? "").replace(/^https?:\/\//, "").split("/")[0];
        if (!allowedOrigins.has(originDomain)) {
          console.warn(`[HostingerWebhook] Rejected origin: ${originDomain}`);
          res.status(403).json({ error: "Origin not allowed" });
          return;
        }

        // ── 5. Rate limit ────────────────────────────────────────────────────
        if (!checkRateLimit(originDomain)) {
          res.status(429).json({ error: "Rate limit exceeded" });
          return;
        }

        // ── 6. Validate timestamp (reject events > 5 min old) ────────────────
        const eventTime = new Date(body.timestamp).getTime();
        if (isNaN(eventTime) || Math.abs(Date.now() - eventTime) > 5 * 60 * 1000) {
          res.status(400).json({ error: "Timestamp out of range" });
          return;
        }

        // ── 7. Publish to autonomous loop ────────────────────────────────────
        const eventId = await publishLoopEventFromHostinger(body);

        res.json({
          received: true,
          eventId,
          eventType: body.eventType,
          loopTriggered: eventId !== null,
        });
      } catch (err) {
        console.error("[HostingerWebhook] Unexpected error:", err);
        res.status(500).json({ error: "Internal server error" });
      }
    }
  );

  console.log("[HostingerWebhook] Route registered: POST /api/webhook/hostinger");
}
