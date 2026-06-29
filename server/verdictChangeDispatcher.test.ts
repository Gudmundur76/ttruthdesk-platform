/**
 * verdictChangeDispatcher.test.ts
 * Full coverage of dispatchVerdictChanged() — webhook fan-out, publishEvent,
 * error resilience, and edge cases.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { VerdictChangedPayload } from "./verdictChangeDispatcher";

// ── Mocks ─────────────────────────────────────────────────────────────────────
vi.mock("./db", () => ({
  getActiveWebhookAlerts: vi.fn(),
  updateWebhookAlertLastFired: vi.fn(),
}));

vi.mock("./autonomousLoop/eventBus", () => ({
  publishEvent: vi.fn(),
}));

vi.mock("./alertDispatcher", () => ({
  buildHmacSignature: vi.fn(() => "test-sig"),
}));

vi.mock("./logger", () => ({
  logger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  }),
  errData: (e: unknown) => ({ message: String(e) }),
}));

// ── Imports (after mocks) ─────────────────────────────────────────────────────
import { dispatchVerdictChanged } from "./verdictChangeDispatcher";
import { getActiveWebhookAlerts, updateWebhookAlertLastFired } from "./db";
import { publishEvent } from "./autonomousLoop/eventBus";
import { buildHmacSignature } from "./alertDispatcher";

// ── Fixtures ──────────────────────────────────────────────────────────────────
const basePayload: VerdictChangedPayload = {
  claimId: 123,
  documentId: 456,
  previousLabel: "Insufficient",
  newLabel: "Supported",
  previousScore: 0.45,
  newScore: 0.87,
};

function makeWebhook(overrides?: Partial<{
  id: number;
  url: string;
  secret: string;
  eventTypes: string[];
}>) {
  return {
    id: overrides?.id ?? 1,
    url: overrides?.url ?? "https://example.com/webhook",
    secret: overrides?.secret ?? "test-secret",
    eventTypes: overrides?.eventTypes ?? ["verdict_changed"],
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────
describe("dispatchVerdictChanged()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: no active webhooks
    vi.mocked(getActiveWebhookAlerts).mockResolvedValue([]);
    vi.mocked(updateWebhookAlertLastFired).mockImplementation(async () => {});
    vi.mocked(publishEvent).mockResolvedValue(0);
    // Mock global fetch
    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
  });

  it("calls getActiveWebhookAlerts with the claim document ID", async () => {
    await dispatchVerdictChanged(basePayload);
    expect(getActiveWebhookAlerts).toHaveBeenCalled();
  });

  it("publishes verdict_complete event with correct fields", async () => {
    await dispatchVerdictChanged(basePayload);
    expect(publishEvent).toHaveBeenCalledWith(
      "verdict_complete",
      expect.objectContaining({
        claimId: basePayload.claimId,
        documentId: basePayload.documentId,
        previousLabel: basePayload.previousLabel,
        newLabel: basePayload.newLabel,
        previousScore: basePayload.previousScore,
        newScore: basePayload.newScore,
      })
    );
  });

  it("does not call fetch when there are no active webhooks", async () => {
    await dispatchVerdictChanged(basePayload);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("calls fetch for each active webhook", async () => {
    vi.mocked(getActiveWebhookAlerts).mockResolvedValue([
      makeWebhook({ id: 1, url: "https://hook1.example.com" }),
      makeWebhook({ id: 2, url: "https://hook2.example.com" }),
    ] as never);

    await dispatchVerdictChanged(basePayload);

    expect(global.fetch).toHaveBeenCalledTimes(2);
    const urls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.map(
      (c: unknown[]) => c[0] as string
    );
    expect(urls).toContain("https://hook1.example.com");
    expect(urls).toContain("https://hook2.example.com");
  });

  it("includes HMAC signature header in webhook POST", async () => {
    vi.mocked(getActiveWebhookAlerts).mockResolvedValue([
      makeWebhook({ secret: "my-secret" }),
    ] as never);

    await dispatchVerdictChanged(basePayload);

    expect(buildHmacSignature).toHaveBeenCalled();
    const fetchCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const init = fetchCall[1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers["X-TruthDesk-Signature"]).toBe("sha256=test-sig");
  });

  it("updates lastFired for each webhook that was called", async () => {
    vi.mocked(getActiveWebhookAlerts).mockResolvedValue([
      makeWebhook({ id: 7 }),
    ] as never);

    await dispatchVerdictChanged(basePayload);

    expect(updateWebhookAlertLastFired).toHaveBeenCalledWith(7);
  });

  it("does not throw when a webhook fetch fails", async () => {
    vi.mocked(getActiveWebhookAlerts).mockResolvedValue([
      makeWebhook({ url: "https://failing-hook.example.com" }),
    ] as never);
    (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("Network error")
    );

    await expect(dispatchVerdictChanged(basePayload)).resolves.toBeUndefined();
  });

  it("does not throw when publishEvent fails", async () => {
    vi.mocked(publishEvent).mockRejectedValue(new Error("Bus error"));

    await expect(dispatchVerdictChanged(basePayload)).resolves.toBeUndefined();
  });

  it("does not throw when getActiveWebhookAlerts fails", async () => {
    vi.mocked(getActiveWebhookAlerts).mockRejectedValue(
      new Error("DB error")
    );

    await expect(dispatchVerdictChanged(basePayload)).resolves.toBeUndefined();
  });

  it("still publishes event even when webhook fan-out throws", async () => {
    vi.mocked(getActiveWebhookAlerts).mockRejectedValue(new Error("DB down"));

    await dispatchVerdictChanged(basePayload);

    // publishEvent should still be called despite webhook failure
    expect(publishEvent).toHaveBeenCalledWith("verdict_complete", expect.any(Object));
  });

  it("handles payload with zero score change", async () => {
    const zeroChange: VerdictChangedPayload = {
      ...basePayload,
      previousScore: 0.5,
      newScore: 0.5,
    };
    await expect(dispatchVerdictChanged(zeroChange)).resolves.toBeUndefined();
    expect(publishEvent).toHaveBeenCalledWith(
      "verdict_complete",
      expect.objectContaining({ previousScore: 0.5, newScore: 0.5 })
    );
  });
});
