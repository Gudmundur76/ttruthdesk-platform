/**
 * Magic Link Authentication
 *
 * Security properties:
 * - Tokens are 32 cryptographically random bytes (URL-safe base64)
 * - Only the SHA-256 hash is stored in the DB — raw token never persisted
 * - Single-use: usedAt is set on first consumption; subsequent uses are rejected
 * - 15-minute expiry
 * - Rate-limited: max 3 requests per email per 10 minutes
 * - Email enumeration protection: always returns the same response
 * - Token is delivered only via email, never in a redirect or log
 */

import crypto from "crypto";
import type { Express, Request, Response } from "express";
import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import * as db from "./db";
import { getSessionCookieOptions } from "./_core/cookies";
import { sdk } from "./_core/sdk";
import { ENV } from "./_core/env";

const MAGIC_LINK_EXPIRY_MS = 15 * 60 * 1000; // 15 minutes
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const RATE_LIMIT_MAX = 3; // max requests per window

/** Generate a cryptographically random URL-safe token and its SHA-256 hash */
function generateToken(): { raw: string; hash: string } {
  const raw = crypto.randomBytes(32).toString("base64url");
  const hash = crypto.createHash("sha256").update(raw).digest("hex");
  return { raw, hash };
}

/** Send the magic link email via the Manus built-in LLM/notification API */
async function sendMagicLinkEmail(email: string, magicUrl: string): Promise<void> {
  const forgeApiUrl = ENV.forgeApiUrl;
  const forgeApiKey = ENV.forgeApiKey;

  if (!forgeApiUrl || !forgeApiKey) {
    console.warn("[MagicLink] Forge API not configured — cannot send email");
    return;
  }

  // Use the Manus built-in email endpoint
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
      console.warn(`[MagicLink] Email send failed (${response.status}): ${detail}`);
    }
  } catch (err) {
    console.warn("[MagicLink] Email send error:", err);
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

      const { raw, hash } = generateToken();
      const expiresAt = new Date(Date.now() + MAGIC_LINK_EXPIRY_MS);

      await db.createMagicLinkToken({ email, tokenHash: hash, expiresAt });

      // Build the magic link URL
      const origin = req.headers["x-forwarded-host"]
        ? `${req.headers["x-forwarded-proto"] ?? "https"}://${req.headers["x-forwarded-host"]}`
        : `${req.protocol}://${req.get("host")}`;
      const magicUrl = `${origin}/api/auth/magic-link/verify?token=${raw}`;

      await sendMagicLinkEmail(email, magicUrl);

      console.log(`[MagicLink] Link generated for ${email} (expires ${expiresAt.toISOString()})`);
    } catch (err) {
      console.error("[MagicLink] Request error:", err);
      // Still return 200 — don't leak errors to the client
    }

    return res.json({ ok: true });
  });

  // ── GET /api/auth/magic-link/verify ────────────────────────────────────────
  // Query: ?token=<raw_token>
  // On success: creates session cookie and redirects to /
  app.get("/api/auth/magic-link/verify", async (req: Request, res: Response) => {
    const rawToken = (req.query.token ?? "").toString().trim();

    if (!rawToken) {
      return res.redirect("/?auth_error=missing_token");
    }

    try {
      const hash = crypto.createHash("sha256").update(rawToken).digest("hex");
      const record = await db.findValidMagicLinkToken(hash);

      if (!record) {
        return res.redirect("/?auth_error=invalid_or_expired");
      }

      // Mark token as used immediately (single-use)
      await db.markMagicLinkTokenUsed(record.id);

      // Upsert the email user
      const emailUser = await db.upsertEmailUser(record.email);
      if (!emailUser) {
        return res.redirect("/?auth_error=user_create_failed");
      }

      // Create a JWT session using the email as the openId (prefixed to avoid collisions)
      const openId = `email_${emailUser.id}`;
      const sessionToken = await sdk.createSessionToken(openId, {
        name: emailUser.email,
        expiresInMs: ONE_YEAR_MS,
      });

      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });

      console.log(`[MagicLink] User ${emailUser.email} signed in via magic link`);
      return res.redirect("/");
    } catch (err) {
      console.error("[MagicLink] Verify error:", err);
      return res.redirect("/?auth_error=server_error");
    }
  });
}
