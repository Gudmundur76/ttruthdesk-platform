/**
 * billingRouter.test.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Phase 133 — Unit tests for server/billingRouter.ts
 *
 * Tests:
 *   1. requestAccess — happy path: persists lead, returns success
 *   2. requestAccess — DB unavailable: still returns success (notification fires)
 *   3. requestAccess — DB unavailable + no notification channel: throws INTERNAL_SERVER_ERROR
 *   4. requestAccess — invalid email: throws BAD_REQUEST
 *   5. requestAccess — name too short: throws BAD_REQUEST
 *   6. requestAccess — invalid tier: throws BAD_REQUEST
 *   7. requestAccess — Telegram notification fires (fire-and-forget, no throw)
 *   8. requestAccess — useCase is optional
 *
 * Total: 8 tests
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { TRPCError } from "@trpc/server";

// ─── Hoisted mocks ────────────────────────────────────────────────────────────
const mocks = vi.hoisted(() => ({
  mockGetDb: vi.fn(),
  mockFetch: vi.fn(),
  mockEnv: {
    telegramBotToken: "test-token",
    telegramChannelId: "test-channel",
    adminNotifyEmail: "",
    forgeApiUrl: "",
    forgeApiKey: "",
  },
}));

vi.mock("./db", () => ({ getDb: mocks.mockGetDb }));
vi.mock("./_core/env", () => ({ ENV: mocks.mockEnv }));
vi.mock("./logger", () => ({
  logger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  errData: vi.fn((e: unknown) => ({ err: String(e) })),
}));
global.fetch = mocks.mockFetch;

// ─── Import after mocks ───────────────────────────────────────────────────────
import { billingRouter } from "./billingRouter";

// ─── Helpers ──────────────────────────────────────────────────────────────────
function makeCaller() {
  return billingRouter.createCaller({} as never);
}

const VALID_INPUT = {
  name: "Alice Smith",
  email: "alice@example.com",
  organisation: "Acme Corp",
  tier: "starter" as const,
  useCase: "We need to verify biotech claims in our investor reports.",
};

// ─── Tests ────────────────────────────────────────────────────────────────────
describe("billingRouter.requestAccess", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mockEnv.telegramBotToken = "test-token";
    mocks.mockEnv.telegramChannelId = "test-channel";
    mocks.mockEnv.adminNotifyEmail = "";
    mocks.mockFetch.mockResolvedValue({ ok: true, text: async () => "" });
  });

  it("happy path: persists lead and returns success", async () => {
    const mockDb = {
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockResolvedValue([{ insertId: 42 }]),
      }),
    };
    mocks.mockGetDb.mockResolvedValue(mockDb);

    const caller = makeCaller();
    const result = await caller.requestAccess(VALID_INPUT);

    expect(result.success).toBe(true);
    expect(result.leadId).toBe(42);
    expect(result.message).toContain("received");
    expect(mockDb.insert).toHaveBeenCalledOnce();
  });

  it("DB unavailable: still returns success when Telegram is configured", async () => {
    mocks.mockGetDb.mockResolvedValue(null);

    const caller = makeCaller();
    const result = await caller.requestAccess(VALID_INPUT);

    expect(result.success).toBe(true);
    expect(result.leadId).toBeNull();
  });

  it("DB unavailable + no notification channel: throws INTERNAL_SERVER_ERROR", async () => {
    mocks.mockGetDb.mockResolvedValue(null);
    mocks.mockEnv.telegramBotToken = "";
    mocks.mockEnv.telegramChannelId = "";
    mocks.mockEnv.adminNotifyEmail = "";

    const caller = makeCaller();
    await expect(caller.requestAccess(VALID_INPUT)).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
    });
  });

  it("invalid email: throws BAD_REQUEST", async () => {
    const caller = makeCaller();
    await expect(
      caller.requestAccess({ ...VALID_INPUT, email: "not-an-email" })
    ).rejects.toBeInstanceOf(TRPCError);
  });

  it("name too short: throws BAD_REQUEST", async () => {
    const caller = makeCaller();
    await expect(
      caller.requestAccess({ ...VALID_INPUT, name: "A" })
    ).rejects.toBeInstanceOf(TRPCError);
  });

  it("invalid tier: throws BAD_REQUEST", async () => {
    const caller = makeCaller();
    await expect(
      caller.requestAccess({ ...VALID_INPUT, tier: "enterprise" as any })
    ).rejects.toBeInstanceOf(TRPCError);
  });

  it("Telegram notification fires (fire-and-forget, does not throw)", async () => {
    const mockDb = {
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockResolvedValue([{ insertId: 7 }]),
      }),
    };
    mocks.mockGetDb.mockResolvedValue(mockDb);
    mocks.mockFetch.mockResolvedValue({ ok: false, text: async () => "bad gateway" });

    const caller = makeCaller();
    // Should not throw even though Telegram returns an error
    const result = await caller.requestAccess(VALID_INPUT);
    expect(result.success).toBe(true);
  });

  it("useCase is optional: succeeds without useCase", async () => {
    const mockDb = {
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockResolvedValue([{ insertId: 5 }]),
      }),
    };
    mocks.mockGetDb.mockResolvedValue(mockDb);

    const caller = makeCaller();
    const { useCase: _, ...inputWithoutUseCase } = VALID_INPUT;
    const result = await caller.requestAccess(inputWithoutUseCase);
    expect(result.success).toBe(true);
  });
});
