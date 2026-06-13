/**
 * Magic Link Authentication
 *
 * Security properties:
 * - Tokens are short-lived RS256 JWTs (exp: 15 minutes, purpose: magic-link)
 * - Self-describing: email, purpose, jti (unique ID) encoded in payload
 * - Only the SHA-256 hash of the JWT is stored in the DB — raw token never persisted
 * - Single-use: usedAt is set on first consumption; subsequent uses are rejected
 * - 15-minute expiry enforced both by JWT exp claim and DB expiresAt column
 * - Rate-limited: max 3 requests per email per 10 minutes
 * - Email enumeration protection: always returns the same response
 * - Token is delivered only via email, never in a redirect or log
 * - Verifiable offline via /.well-known/jwks.json (RS256, kid matches active key)
 */

import crypto from "crypto";
import type { Express, Request, Response } from "express";
import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import * as db from "./db";
import { getSessionCookieOptions } from "./_core/cookies";
import { sdk } from "./_core/sdk";
import { ENV } from "./_core/env";
import { signJwt, verifyJwt } from "./jwtSigner";
import { logger, errData } from "./logger";
const log = logger("magicLink");


const MAGIC_LINK_EXPIRY_MS = 15 * 60 * 1000; // 15 minutes
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const RATE_LIMIT_MAX = 3; // max requests per window

/**
 * Generate a short-lived RS256 JWT for magic link authentication.
 *
 * Payload:
 *   sub     — the email address
 *   purpose — "magic-link" (distinguishes from API tokens)
 *   jti     — 16 random bytes (URL-safe base64) for uniqueness
 *
 * Returns:
 *   raw  — the signed JWT string (sent in the email link)
 *   hash — SHA-256 hex of the JWT (stored in DB for single-use enforcement)
 */
async function generateToken(email: string): Promise<{ raw: string; hash: string }> {
  const jti = crypto.randomBytes(16).toString("base64url");
  const raw = await signJwt(
    { sub: email, purpose: "magic-link", jti },
    { expiresIn: "15m", audience: "truthdesk.claims/magic-link" }
  );
  const hash = crypto.createHash("sha256").update(raw).digest("hex");
  return { raw, hash };
}

/**
 * Verify a magic link JWT.
 * Checks RS256 signature, expiry, audience, and purpose claim.
 * Returns the email (sub) on success, throws on failure.
 */
export async function verifyMagicLinkToken(raw: string): Promise<{ email: string; jti: string }> {
  const payload = await verifyJwt(raw, { audience: "truthdesk.claims/magic-link" });
  if (payload.purpose !== "magic-link") {
    throw new Error("Invalid token purpose");
  }
  if (typeof payload.sub !== "string" || !payload.sub.includes("@")) {
    throw new Error("Invalid token subject");
  }
  return { email: payload.sub, jti: String(payload.jti ?? "") };
}

/** Send the magic link email via the Manus built-in LLM/notification API */
async function sendMagicLinkEmail(email: string, magicUrl: string): Promise<void> {
  const forgeApiUrl = ENV.forgeApiUrl;
  const forgeApiKey = ENV.forgeApiKey;

  if (!forgeApiUrl || !forgeApiKey) {
    log.warn("[MagicLink] Forge API not configured — cannot send email");
    return;
  }

  const endpoint = `${forgeApiUrl.replace(/\/$/, "")}/webdevtoken.v1.WebDevService/SendEmail`;

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${forgeApiKey}`,
        "content-type": "application/json",
        "connect-protocol-version": "1",
      },
      body: JSON.stringify({
        to: email,
        subject: "Your Truth Desk sign-in link",
        html: `
          <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px">
            <h2 style="margin:0 0 8px;font-size:20px;color:#0d0b12">Sign in to Truth Desk</h2>
            <p style="margin:0 0 24px;color:#555;font-size:15px;line-height:1.5">
              Click the button below to sign in. This link expires in 15 minutes and can only be used once.
            </p>
            <a href="${magicUrl}"
               style="display:inline-block;padding:12px 28px;background:#7c3aed;color:#fff;border-radius:8px;text-decoration:none;font-size:15px;font-weight:600">
              Sign in to Truth Desk
            </a>
            <p style="margin:24px 0 0;color:#999;font-size:13px">
              If you did not request this, you can safely ignore this email.
            </p>
          </div>
        `,
        text: `Sign in to Truth Desk\n\nClick this link to sign in (expires in 15 minutes, single use):\n\n${magicUrl}\n\nIf you did not request this, ignore this email.`,
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      log.warn(`[MagicLink] Email send failed (${response.status}): ${detail}`);
    }
  } catch (err) {
    log.warn("[MagicLink] Email send error:", errData(err));
  }
}

export function registerMagicLinkRoutes(app: Express) {
  // ── POST /api/auth/magic-link/request ──────────────────────────────────────
  // Body: { email: string }
  // Always returns 200 to prevent email enumeration
  app.post("/api/auth/magic-link/request", async (req: Request, res: Response) => {
    const email = (req.body?.email ?? "").toString().trim().toLowerCase();

    // Basic email format check
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: "Invalid email address" });
    }

    try {
      // Rate limit: max 3 requests per 10 minutes per email
      const recentCount = await db.countRecentMagicLinkRequests(email, RATE_LIMIT_WINDOW_MS);
      if (recentCount >= RATE_LIMIT_MAX) {
        // Return 200 to avoid enumeration — client shows same "check your email" message
        return res.json({ ok: true });
      }

      // Generate RS256 JWT magic link token
      const { raw, hash } = await generateToken(email);
      const expiresAt = new Date(Date.now() + MAGIC_LINK_EXPIRY_MS);

      // Store only the hash — raw JWT is never persisted
      await db.createMagicLinkToken({ email, tokenHash: hash, expiresAt });

      // Build the magic link URL — token is the full JWT
      const origin = req.headers["x-forwarded-host"]
        ? `${req.headers["x-forwarded-proto"] ?? "https"}://${req.headers["x-forwarded-host"]}`
        : `${req.protocol}://${req.get("host")}`;
      const magicUrl = `${origin}/api/auth/magic-link/verify?token=${encodeURIComponent(raw)}`;

      await sendMagicLinkEmail(email, magicUrl);

      log.info(`[MagicLink] RS256 JWT link generated for ${email} (expires ${expiresAt.toISOString()})`);
    } catch (err) {
      log.error("[MagicLink] Request error:", errData(err));
      // Still return 200 — don't leak errors to the client
    }

    return res.json({ ok: true });
  });

  // ── GET /api/auth/magic-link/verify ────────────────────────────────────────
  // Query: ?token=<jwt>
  // On success: creates session cookie and redirects to /
  app.get("/api/auth/magic-link/verify", async (req: Request, res: Response) => {
    const rawToken = decodeURIComponent((req.query.token ?? "").toString().trim());

    if (!rawToken) {
      return res.redirect("/?auth_error=missing_token");
    }

    try {
      // Step 1: Verify RS256 signature, expiry, audience, and purpose
      let email: string;
      try {
        const verified = await verifyMagicLinkToken(rawToken);
        email = verified.email;
      } catch {
        return res.redirect("/?auth_error=invalid_or_expired");
      }

      // Step 2: Look up the DB record by hash (single-use enforcement)
      const hash = crypto.createHash("sha256").update(rawToken).digest("hex");
      const record = await db.findValidMagicLinkToken(hash);

      if (!record) {
        // Token may have been used already or was never issued by this server
        return res.redirect("/?auth_error=invalid_or_expired");
      }

      // Step 3: Mark token as used immediately (single-use)
      await db.markMagicLinkTokenUsed(record.id);

      // Step 4: Upsert the email user
      const emailUser = await db.upsertEmailUser(email);
      if (!emailUser) {
        return res.redirect("/?auth_error=user_create_failed");
      }

      // Step 5: Create a session cookie
      const openId = `email_${emailUser.id}`;
      const sessionToken = await sdk.createSessionToken(openId, {
        name: emailUser.email,
        expiresInMs: ONE_YEAR_MS,
      });

      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });

      log.info(`[MagicLink] User ${emailUser.email} signed in via RS256 JWT magic link`);
      return res.redirect("/");
    } catch (err) {
      log.error("[MagicLink] Verify error:", errData(err));
      return res.redirect("/?auth_error=server_error");
    }
  });
}
