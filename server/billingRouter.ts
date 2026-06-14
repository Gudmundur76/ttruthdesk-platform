/**
 * billingRouter.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Phase 133 — Pricing page "Request Access" tRPC router.
 *
 * Provides one public procedure:
 *   requestAccess — validates the form submission, persists the lead to the
 *                   pricing_leads table, and dispatches a Telegram notification
 *                   (or Forge email if ADMIN_NOTIFY_EMAIL is set).
 *
 * Design constraints: max 200 lines, max 20 lines/function, max 3 params.
 * No authentication required — this is a public lead-capture form.
 */
import { z } from "zod";
import { publicProcedure, router } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import { ENV } from "./_core/env";
import { logger, errData } from "./logger";
import { getDb } from "./db";
import { pricingLeads } from "../drizzle/schema";

const log = logger("billingRouter");

// ─── Tier metadata ────────────────────────────────────────────────────────────
const TIER_LABELS: Record<string, string> = {
  starter: "Starter — $1,500 / audit",
  diligence: "Diligence — $5,000 / audit",
  platform_pilot: "Platform Pilot — $12,000 / year",
};

// ─── Input schema ─────────────────────────────────────────────────────────────
const RequestAccessInput = z.object({
  name: z.string().min(2).max(255).trim(),
  email: z.string().email().max(255).trim().toLowerCase(),
  organisation: z.string().min(2).max(255).trim(),
  tier: z.enum(["starter", "diligence", "platform_pilot"]),
  useCase: z.string().max(2000).trim().optional(),
});

// ─── Telegram notification ────────────────────────────────────────────────────
async function sendTelegramLead(
  name: string,
  email: string,
  organisation: string,
  tier: string,
  useCase: string | undefined
): Promise<void> {
  const token = ENV.telegramBotToken;
  const chatId = ENV.telegramChannelId;
  if (!token || !chatId) return;
  const escape = (s: string) => s.replace(/[_*[\]()~`>#+=|{}.!-]/g, "\\$&");
  const tierLabel = TIER_LABELS[tier] ?? tier;
  const text =
    `🎯 *New Pricing Lead*\n\n` +
    `*Name:* ${escape(name)}\n` +
    `*Email:* ${escape(email)}\n` +
    `*Organisation:* ${escape(organisation)}\n` +
    `*Tier:* ${escape(tierLabel)}\n` +
    (useCase ? `*Use Case:* ${escape(useCase.slice(0, 300))}\n` : "");
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "Markdown" }),
  });
  if (!res.ok) {
    const body = await res.text();
    log.warn("[BillingRouter] Telegram notification failed:", { status: String(res.status), body });
  }
}

// ─── Forge email notification ─────────────────────────────────────────────────
async function sendForgeLeadEmail(
  name: string,
  email: string,
  organisation: string,
  tier: string,
  useCase: string | undefined
): Promise<void> {
  const adminEmail = ENV.adminNotifyEmail;
  const forgeUrl = ENV.forgeApiUrl;
  const forgeKey = ENV.forgeApiKey;
  if (!adminEmail || !forgeUrl || !forgeKey) return;
  const tierLabel = TIER_LABELS[tier] ?? tier;
  const body = {
    to: adminEmail,
    subject: `New Pricing Lead: ${name} — ${tierLabel}`,
    html: `<p><strong>Name:</strong> ${name}</p>` +
      `<p><strong>Email:</strong> ${email}</p>` +
      `<p><strong>Organisation:</strong> ${organisation}</p>` +
      `<p><strong>Tier:</strong> ${tierLabel}</p>` +
      (useCase ? `<p><strong>Use Case:</strong> ${useCase}</p>` : ""),
  };
  const res = await fetch(`${forgeUrl}/email/send`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${forgeKey}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const bodyText = await res.text();
    log.warn("[BillingRouter] Forge email failed:", { status: String(res.status), body: bodyText });
  }
}

// ─── Persist lead to DB ───────────────────────────────────────────────────────
async function persistLead(
  name: string,
  email: string,
  organisation: string,
  tier: "starter" | "diligence" | "platform_pilot",
  useCase: string | undefined
): Promise<number | null> {
  const db = await getDb();
  if (!db) return null;
  const result = await db.insert(pricingLeads).values({
    name,
    email,
    organisation,
    tier,
    useCase: useCase ?? null,
    status: "new",
  });
  // result is a ResultSetHeader for MySQL — insertId is the new row id
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (result as any)?.[0]?.insertId ?? null;
}

// ─── tRPC router ──────────────────────────────────────────────────────────────
export const billingRouter = router({
  /**
   * requestAccess — submit a pricing access request.
   *
   * Persists the lead and dispatches notifications (Telegram + Forge email).
   * Public procedure: no authentication required.
   * Rate-limiting is handled upstream by the Express rate-limiter middleware.
   */
  requestAccess: publicProcedure
    .input(RequestAccessInput)
    .mutation(async ({ input }) => {
      const { name, email, organisation, tier, useCase } = input;

      // Persist lead (fail-open — notification still fires even if DB is down)
      let leadId: number | null = null;
      try {
        leadId = await persistLead(name, email, organisation, tier, useCase);
      } catch (err) {
        log.error("[BillingRouter] persistLead failed:", errData(err));
      }

      // Dispatch notifications (fire-and-forget)
      void sendTelegramLead(name, email, organisation, tier, useCase).catch(
        err => log.warn("[BillingRouter] Telegram error:", errData(err))
      );
      void sendForgeLeadEmail(name, email, organisation, tier, useCase).catch(
        err => log.warn("[BillingRouter] Forge email error:", errData(err))
      );

      if (leadId === null && !(ENV.telegramBotToken || ENV.adminNotifyEmail)) {
        // DB is down AND no notification channel is configured — surface an error
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Unable to record your request. Please email us directly.",
        });
      }

      return {
        success: true,
        leadId,
        message: "Your request has been received. We will be in touch within 1 business day.",
      };
    }),
});
