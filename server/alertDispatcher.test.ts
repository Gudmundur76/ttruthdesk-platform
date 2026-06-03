/**
 * alertDispatcher.test.ts
 *
 * Tests for the contradiction alert dispatcher:
 * - HMAC-SHA256 signature generation
 * - Telegram alert (skipped when no token)
 * - Webhook POST with signature header
 * - dispatchHighRiskAlert orchestration
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import crypto from "crypto";

// ─── Mock ENV ────────────────────────────────────────────────────────────────
vi.mock("./_core/env", () => ({
  ENV: {
    telegramBotToken: "",
    telegramChannelId: "",
  },
}));

// ─── Mock DB ─────────────────────────────────────────────────────────────────
vi.mock("./db", () => ({
  getActiveWebhookAlerts: vi.fn().mockResolvedValue([]),
  updateWebhookAlertLastFired: vi.fn().mockResolvedValue(undefined),
}));

import {
  buildHmacSignature,
  dispatchHighRiskAlert,
  type HighRiskClaimPayload,
} from "./alertDispatcher";
import * as db from "./db";
import * as envModule from "./_core/env";

const samplePayload: HighRiskClaimPayload = {
  claimId: 42,
  claimText: "The crystal structure was solved at 1.8 Å resolution",
  documentId: 7,
  documentTitle: "Structural analysis of EGFR",
  verdict: "Contradicted",
  contradictionProbability: 0.82,
  confidenceScore: 0.71,
  reportUrl: "https://truthdesk.is/reports/7",
};

// ─── HMAC signature ───────────────────────────────────────────────────────────

describe("buildHmacSignature", () => {
  it("produces a 64-char hex string", () => {
    const sig = buildHmacSignature("mysecret", "hello world");
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic for the same inputs", () => {
    const sig1 = buildHmacSignature("mysecret", "hello world");
    const sig2 = buildHmacSignature("mysecret", "hello world");
    expect(sig1).toBe(sig2);
  });

  it("differs for different secrets", () => {
    const sig1 = buildHmacSignature("secret1", "hello world");
    const sig2 = buildHmacSignature("secret2", "hello world");
    expect(sig1).not.toBe(sig2);
  });

  it("differs for different bodies", () => {
    const sig1 = buildHmacSignature("mysecret", "body1");
    const sig2 = buildHmacSignature("mysecret", "body2");
    expect(sig1).not.toBe(sig2);
  });

  it("matches manual crypto.createHmac calculation", () => {
    const secret = "test-secret-abc";
    const body = JSON.stringify({ event: "high_risk_claim" });
    const expected = crypto.createHmac("sha256", secret).update(body, "utf8").digest("hex");
    expect(buildHmacSignature(secret, body)).toBe(expected);
  });
});

// ─── dispatchHighRiskAlert ────────────────────────────────────────────────────

describe("dispatchHighRiskAlert", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => "" });
    vi.stubGlobal("fetch", fetchMock);
    vi.mocked(db.getActiveWebhookAlerts).mockResolvedValue([]);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("does not call fetch when no Telegram token and no webhooks", async () => {
    await dispatchHighRiskAlert(samplePayload);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("calls Telegram API when token and channelId are set", async () => {
    vi.mocked(envModule.ENV as Record<string, unknown>).telegramBotToken = "bot123:token";
    vi.mocked(envModule.ENV as Record<string, unknown>).telegramChannelId = "-100123456";

    await dispatchHighRiskAlert(samplePayload);

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("api.telegram.org/botbot123:token/sendMessage");
    const body = JSON.parse(opts.body as string);
    expect(body.chat_id).toBe("-100123456");
    expect(body.text).toContain("High-Risk Claim Detected");
    expect(body.parse_mode).toBe("Markdown");

    // Restore
    vi.mocked(envModule.ENV as Record<string, unknown>).telegramBotToken = "";
    vi.mocked(envModule.ENV as Record<string, unknown>).telegramChannelId = "";
  });

  it("fires webhook POST with correct HMAC signature when webhooks are registered", async () => {
    const secret = "webhook-secret-xyz";
    vi.mocked(db.getActiveWebhookAlerts).mockResolvedValue([
      {
        id: 1,
        userId: 1,
        url: "https://example.com/webhook",
        secret,
        label: "Test",
        eventTypes: ["high_risk_claim"],
        active: true,
        lastFiredAt: null,
        createdAt: new Date(),
      } as never,
    ]);

    await dispatchHighRiskAlert(samplePayload);

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://example.com/webhook");
    expect((opts.headers as Record<string, string>)["X-TruthDesk-Event"]).toBe("high_risk_claim");

    // Verify signature
    const body = opts.body as string;
    const expectedSig = `sha256=${buildHmacSignature(secret, body)}`;
    expect((opts.headers as Record<string, string>)["X-TruthDesk-Signature"]).toBe(expectedSig);

    // Verify payload structure
    const parsed = JSON.parse(body);
    expect(parsed.event).toBe("high_risk_claim");
    expect(parsed.data.claimId).toBe(42);
    expect(parsed.data.contradictionProbability).toBe(0.82);
    expect(parsed.data.verdict).toBe("Contradicted");
  });

  it("skips webhook when event type does not match", async () => {
    vi.mocked(db.getActiveWebhookAlerts).mockResolvedValue([
      {
        id: 2,
        userId: 1,
        url: "https://example.com/webhook2",
        secret: "s",
        label: null,
        eventTypes: ["other_event"],
        active: true,
        lastFiredAt: null,
        createdAt: new Date(),
      } as never,
    ]);

    await dispatchHighRiskAlert(samplePayload);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fires webhook when eventTypes is empty (means all events)", async () => {
    vi.mocked(db.getActiveWebhookAlerts).mockResolvedValue([
      {
        id: 3,
        userId: 1,
        url: "https://example.com/webhook3",
        secret: "s",
        label: null,
        eventTypes: [],
        active: true,
        lastFiredAt: null,
        createdAt: new Date(),
      } as never,
    ]);

    await dispatchHighRiskAlert(samplePayload);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("calls updateWebhookAlertLastFired on successful webhook delivery", async () => {
    vi.mocked(db.getActiveWebhookAlerts).mockResolvedValue([
      {
        id: 5,
        userId: 1,
        url: "https://example.com/wh5",
        secret: "s",
        label: null,
        eventTypes: [],
        active: true,
        lastFiredAt: null,
        createdAt: new Date(),
      } as never,
    ]);

    await dispatchHighRiskAlert(samplePayload);
    expect(db.updateWebhookAlertLastFired).toHaveBeenCalledWith(5);
  });

  it("does NOT call updateWebhookAlertLastFired when fetch returns non-ok", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500 });
    vi.mocked(db.getActiveWebhookAlerts).mockResolvedValue([
      {
        id: 6,
        userId: 1,
        url: "https://example.com/wh6",
        secret: "s",
        label: null,
        eventTypes: [],
        active: true,
        lastFiredAt: null,
        createdAt: new Date(),
      } as never,
    ]);

    await dispatchHighRiskAlert(samplePayload);
    expect(db.updateWebhookAlertLastFired).not.toHaveBeenCalled();
  });

  it("does not throw when fetch rejects (network error)", async () => {
    fetchMock.mockRejectedValue(new Error("Network error"));
    vi.mocked(db.getActiveWebhookAlerts).mockResolvedValue([
      {
        id: 7,
        userId: 1,
        url: "https://example.com/wh7",
        secret: "s",
        label: null,
        eventTypes: [],
        active: true,
        lastFiredAt: null,
        createdAt: new Date(),
      } as never,
    ]);

    await expect(dispatchHighRiskAlert(samplePayload)).resolves.not.toThrow();
  });
});
