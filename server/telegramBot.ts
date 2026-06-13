/**
 * Protein Truth Desk — Telegram Bot
 *
 * Commands:
 *   /audit <PMID>   — fetch paper, run pipeline, return verdict summary
 *   /monitor <PMID> — add PMID to auto-ingested papers monitoring list
 *   /status         — corpus stats (docs, claims, contradictions)
 *
 * Daily channel posts are triggered by the heartbeat scheduler
 * via POST /api/scheduled/telegram-daily-post.
 */

import { Bot, type Context } from "grammy";
import { ENV } from "./_core/env";
import * as db from "./db";

import { runAnalysisPipeline } from "./analysisPipeline";
import { logger, errData } from "./logger";
const log = logger("telegramBot");


const APP_URL = () => ENV.appUrl || "https://truthdesk.claims";

// ─── Singleton bot instance ───────────────────────────────────────────────────
let botInstance: Bot | null = null;

function getBot(): Bot | null {
  if (!ENV.telegramBotToken) return null;
  if (!botInstance) {
    botInstance = new Bot(ENV.telegramBotToken);
    registerHandlers(botInstance);
  }
  return botInstance;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function escapeMarkdown(text: string): string {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, "\\$&");
}

// ─── Command handlers ─────────────────────────────────────────────────────────
function registerHandlers(bot: Bot) {
  // /start
  bot.command("start", async (ctx: Context) => {
    await ctx.reply(
      "🧬 *Protein Truth Desk Bot*\n\n" +
        "Verify molecular claims from PubMed papers in real time\\.\n\n" +
        "*Commands:*\n" +
        "/audit \\<PMID\\> — Run full audit on a PubMed paper\n" +
        "/monitor \\<PMID\\> — Add paper to monitoring feed\n" +
        "/status — Corpus statistics\n",
      { parse_mode: "MarkdownV2" }
    );
  });

  // /status
  bot.command("status", async (ctx: Context) => {
    try {
      const recentClaims = await db.getRecentVerifiedClaims(200);
      const papers = await db.getCompletedPublicPapers();
      const contradictions = recentClaims.filter(
        (r) => r.claim.verdict === "Contradicted"
      ).length;

      const msg =
        `📊 *Corpus Status*\n\n` +
        `• Completed papers: ${papers.length}\n` +
        `• Recent claims verified: ${recentClaims.length}\n` +
        `• Contradictions detected: ${contradictions}\n\n` +
        `[View full registry](${APP_URL().replace(/\./g, '\\.')}/registry)`;
      await ctx.reply(msg, { parse_mode: "MarkdownV2" });
    } catch (err) {
      log.error("[TelegramBot] /status error:", errData(err));
      await ctx.reply("⚠️ Failed to fetch corpus stats. Please try again.");
    }
  });

  // /audit <PMID>
  bot.command("audit", async (ctx: Context) => {
    const args = ctx.message?.text?.split(/\s+/).slice(1) ?? [];
    const pmid = args[0]?.trim();

    if (!pmid || !/^\d+$/.test(pmid)) {
      await ctx.reply("Usage: /audit <PMID>\nExample: /audit 37234567");
      return;
    }

    await ctx.reply(`🔬 Starting audit for PMID ${pmid}…`);

    try {
      // Check if already in auto-ingested papers
      const existing = await db.getAutoIngestedPaperByPmid(pmid);

      if (existing?.documentId) {
        const docId = existing.documentId;
        const claims = await db.getClaimsByDocument(docId);

        if (!claims.length) {
          await ctx.reply(
            `📋 Paper found \\(doc \\#${docId}\\) but no claims extracted yet\\. Check back soon\\.`,
            { parse_mode: "MarkdownV2" }
          );
          return;
        }

        const verdictCounts: Record<string, number> = {};
        for (const c of claims) {
          const v = c.overriddenVerdict ?? c.verdict ?? "Insufficient Evidence";
          verdictCounts[v] = (verdictCounts[v] ?? 0) + 1;
        }

        const verdictLines = Object.entries(verdictCounts)
          .sort((a, b) => b[1] - a[1])
          .map(([v, n]) => `  • ${escapeMarkdown(v)}: ${n}`)
          .join("\n");

        const msg =
          `🧬 *Audit Report — Doc \\#${docId}*\n\n` +
          `📊 *${claims.length} claims* extracted\n\n` +
          `*Verdict breakdown:*\n${verdictLines}\n\n` +
          `[View full report](${APP_URL().replace(/\./g, '\\.')}/audit/${docId})`;

        await ctx.reply(msg, { parse_mode: "MarkdownV2" });
        return;
      }

      // Create a new document entry for this PMID
      const SYSTEM_USER_ID = 1;
      const rawText = `PubMed PMID: ${pmid}\n\nThis paper has been queued for analysis via the Telegram bot.`;
      const docId = await db.createDocument({
        userId: SYSTEM_USER_ID,
        title: `PubMed PMID:${pmid}`,
        rawText,
        sourceType: "paste",
        verticalDomain: "structural_biology",
      });

      // Register in auto-ingested papers for tracking
      await db.upsertAutoIngestedPaper({
        pmid,
        title: `PubMed PMID:${pmid}`,
        searchQuery: `pmid:${pmid}`,
        documentId: docId,
        status: "submitted",
        verticalDomain: "structural_biology",
      });

      // Run pipeline asynchronously
      runAnalysisPipeline(docId, rawText, SYSTEM_USER_ID).catch((e) =>
        log.error("[TelegramBot] Pipeline error:", errData(e))
      );

      await ctx.reply(
        `✅ Paper queued for analysis \\(doc \\#${docId}\\)\\.\n` +
          `Results will be available in 1\\-2 minutes at:\n` +
          `${APP_URL().replace(/\./g, '\\.')}/audit/${docId}`,
        { parse_mode: "MarkdownV2" }
      );
    } catch (err) {
      log.error("[TelegramBot] /audit error:", errData(err));
      await ctx.reply("⚠️ Audit failed. Please try again.");
    }
  });

  // /monitor <PMID>
  bot.command("monitor", async (ctx: Context) => {
    const args = ctx.message?.text?.split(/\s+/).slice(1) ?? [];
    const pmid = args[0]?.trim();

    if (!pmid || !/^\d+$/.test(pmid)) {
      await ctx.reply("Usage: /monitor <PMID>\nExample: /monitor 37234567");
      return;
    }

    try {
      // Upsert into auto_ingested_papers for monitoring
      await db.upsertAutoIngestedPaper({
        pmid,
        title: `PubMed PMID:${pmid}`,
        searchQuery: `pmid:${pmid}`,
        documentId: null,
        status: "fetched",
        verticalDomain: "structural_biology",
      });

      await ctx.reply(
        `✅ PMID ${escapeMarkdown(pmid)} added to monitoring feed\\.\n` +
          `The paper will be analysed on the next ingestion cycle\\.`,
        { parse_mode: "MarkdownV2" }
      );
    } catch (err) {
      log.error("[TelegramBot] /monitor error:", errData(err));
      await ctx.reply("⚠️ Failed to add to monitoring feed. Please try again.");
    }
  });

  // Fallback
  bot.on("message", async (ctx: Context) => {
    await ctx.reply(
      "Unknown command\\. Use /start to see available commands\\.",
      { parse_mode: "MarkdownV2" }
    );
  });
}

// ─── Daily digest post ────────────────────────────────────────────────────────
export async function postDailyDigest(channelId: string): Promise<void> {
  const bot = getBot();
  if (!bot) {
    log.warn("[TelegramBot] Bot not configured — skipping daily digest");
    return;
  }

  const recentClaims = await db.getRecentVerifiedClaims(20);
  const contradictions = recentClaims.filter(
    (r) => r.claim.verdict === "Contradicted"
  );
  const supported = recentClaims.filter((r) => r.claim.verdict === "Supported");

  const lines: string[] = [
    `🧬 *Protein Truth Desk — Daily Digest*`,
    ``,
    `📊 *${recentClaims.length} claims* verified in the last 24h`,
    ``,
  ];

  if (contradictions.length > 0) {
    lines.push(`⚠️ *${contradictions.length} contradiction\\(s\\) detected:*`);
    for (const r of contradictions.slice(0, 3)) {
      const text = r.claim.claimText.slice(0, 80);
      const ellipsis = r.claim.claimText.length > 80 ? "…" : "";
      lines.push(`  • ${escapeMarkdown(text)}${ellipsis}`);
    }
    lines.push(``);
  }

  if (supported.length > 0) {
    lines.push(`✅ *${supported.length} claim\\(s\\) supported by evidence*`);
    lines.push(``);
  }

  lines.push(
    `[View full registry](${APP_URL().replace(/\./g, '\\.')}/registry)`
  );

  try {
    await bot.api.sendMessage(channelId, lines.join("\n"), {
      parse_mode: "MarkdownV2",
    });
  } catch (err) {
    log.error("[TelegramBot] Daily digest send failed:", errData(err));
  }
}

// ─── Contradiction alert ────────────────────────────────────────────────────────

/**
 * Post a real-time contradiction alert to the Telegram channel.
 * Called by wikiLinter when a new 'contradicts' edge is written to graph_relations.
 */
export async function postContradictionAlert(params: {
  entityName: string;
  entityType: string;
  claimText: string;
  verdict: string;
  rationale: string;
  claimId: number;
  documentTitle?: string;
  pdbId?: string;
  baseUrl?: string;
}): Promise<void> {
  const bot = getBot();
  const channelId = ENV.telegramChannelId;
  if (!bot || !channelId) return;

  const origin = params.baseUrl ?? APP_URL();
  const claimUrl = `${origin}/claim/${params.claimId}`;
  const wikiUrl = `${origin}/wiki/${params.entityType}/${params.entityName.toLowerCase().replace(/\s+/g, "_")}`;

  const claimSnippet = params.claimText.slice(0, 120);
  const rationaleSnippet = params.rationale.slice(0, 180);

  const lines = [
    `🔴 *NEW CONTRADICTION DETECTED*`,
    ``,
    `🧬 *Entity:* ${escapeMarkdown(params.entityName)} \(${escapeMarkdown(params.entityType)}\)`,
    params.documentTitle ? `📄 *Paper:* ${escapeMarkdown(params.documentTitle)}` : null,
    params.pdbId ? `🔬 *PDB:* ${escapeMarkdown(params.pdbId)}` : null,
    ``,
    `*Claim:* _${escapeMarkdown(claimSnippet)}${params.claimText.length > 120 ? "…" : ""}_`,
    `*Verdict:* ${escapeMarkdown(params.verdict)}`,
    `*Rationale:* ${escapeMarkdown(rationaleSnippet)}${params.rationale.length > 180 ? "…" : ""}`,
    ``,
    `[View Claim](${escapeMarkdown(claimUrl)}) · [Entity Wiki](${escapeMarkdown(wikiUrl)})`,
  ].filter(Boolean) as string[];

  try {
    await bot.api.sendMessage(channelId, lines.join("\n"), {
      parse_mode: "MarkdownV2",
    });
    log.info(`[TelegramBot] Contradiction alert sent for claim #${params.claimId}`);
  } catch (err) {
    log.error("[TelegramBot] Contradiction alert send failed:", errData(err));
  }
}

// ─── Start polling (development / long-running) ───────────────────────────────
export async function startTelegramBot(): Promise<void> {
  const bot = getBot();
  if (!bot) {
    log.info("[TelegramBot] TELEGRAM_BOT_TOKEN not set — bot disabled");
    return;
  }

  try {
    await bot.start({
      onStart: (info) =>
        log.info(`[TelegramBot] @${info.username} started (long-polling)`),
    });
  } catch (err) {
    log.error("[TelegramBot] Failed to start:", errData(err));
  }
}

export { getBot };
