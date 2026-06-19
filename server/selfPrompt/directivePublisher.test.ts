/**
 * directivePublisher.test.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Unit tests for selfPrompt/directivePublisher.ts — publishFrontierDirective()
 *
 * T058 coverage:
 *   - FR-L2-24: Directive objects are first-class outputs with required fields
 *   - FR-L2-25: All four directive types are supported
 *   - FR-L2-26: confidence must be in [0, 1]
 *   - FR-L2-27: TTL defaults to 60, capped at 1440
 *   - FR-L2-28: Event published on event bus
 *   - reason must be >= 20 chars
 *   - DB failure is non-fatal (directive still returned)
 *   - publishFrontierDirectives() processes multiple requests in order
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  mockGetDb: vi.fn(),
  mockPublishEvent: vi.fn(),
}));

vi.mock("../db", () => ({ getDb: mocks.mockGetDb }));
vi.mock("../autonomousLoop/eventBus", () => ({
  publishEvent: mocks.mockPublishEvent,
}));
vi.mock("../logger", () => {
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return { logger: () => log, errData: (e: unknown) => e };
});

import {
  publishFrontierDirective,
  publishFrontierDirectives,
  type FrontierDirectiveRequest,
  type FrontierDirectiveResult,
} from "./directivePublisher";

function makeRequest(
  overrides: Partial<FrontierDirectiveRequest> = {}
): FrontierDirectiveRequest {
  return {
    directiveType: "focus_gap",
    targetGapId: 1,
    reason: "This gap has been open for over 30 days without resolution.",
    confidence: 0.8,
    ...overrides,
  };
}

function makeDb() {
  const insertChain = {
    values: vi.fn().mockResolvedValue([{ insertId: 42 }]),
  };
  return {
    insert: vi.fn().mockReturnValue(insertChain),
  };
}

describe("publishFrontierDirective() — T058", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mockGetDb.mockResolvedValue(makeDb());
    mocks.mockPublishEvent.mockResolvedValue(undefined);
  });

  // ─── FR-L2-24: First-class directive output ───────────────────────────────
  it("FR-L2-24: returns a result with directiveId, directiveType, confidence, ttlMinutes, expiresAt", async () => {
    const result = await publishFrontierDirective(makeRequest());
    expect(result.directiveId).toBeTruthy();
    expect(typeof result.directiveId).toBe("string");
    expect(result.directiveType).toBe("focus_gap");
    expect(result.confidence).toBe(0.8);
    expect(result.ttlMinutes).toBe(60); // default
    expect(result.expiresAt).toBeInstanceOf(Date);
    expect(result.reason).toContain("30 days");
  });

  // ─── FR-L2-25: All four directive types ───────────────────────────────────
  it("FR-L2-25: supports focus_gap directive type", async () => {
    const result = await publishFrontierDirective(
      makeRequest({ directiveType: "focus_gap", targetGapId: 5 })
    );
    expect(result.directiveType).toBe("focus_gap");
  });

  it("FR-L2-25: supports skip_mapping directive type", async () => {
    const result = await publishFrontierDirective(
      makeRequest({ directiveType: "skip_mapping" })
    );
    expect(result.directiveType).toBe("skip_mapping");
  });

  it("FR-L2-25: supports prioritize_hypotheses directive type", async () => {
    const result = await publishFrontierDirective(
      makeRequest({ directiveType: "prioritize_hypotheses" })
    );
    expect(result.directiveType).toBe("prioritize_hypotheses");
  });

  it("FR-L2-25: supports deep_dive_entity directive type", async () => {
    const result = await publishFrontierDirective(
      makeRequest({ directiveType: "deep_dive_entity", targetEntityId: 10 })
    );
    expect(result.directiveType).toBe("deep_dive_entity");
  });

  // ─── FR-L2-26: confidence validation ─────────────────────────────────────
  it("FR-L2-26: throws when confidence < 0", async () => {
    await expect(
      publishFrontierDirective(makeRequest({ confidence: -0.1 }))
    ).rejects.toThrow("FR-L2-26");
  });

  it("FR-L2-26: throws when confidence > 1", async () => {
    await expect(
      publishFrontierDirective(makeRequest({ confidence: 1.1 }))
    ).rejects.toThrow("FR-L2-26");
  });

  it("FR-L2-26: accepts confidence = 0", async () => {
    const result = await publishFrontierDirective(
      makeRequest({ confidence: 0 })
    );
    expect(result.confidence).toBe(0);
  });

  it("FR-L2-26: accepts confidence = 1", async () => {
    const result = await publishFrontierDirective(
      makeRequest({ confidence: 1 })
    );
    expect(result.confidence).toBe(1);
  });

  // ─── FR-L2-27: TTL default and cap ───────────────────────────────────────
  it("FR-L2-27: TTL defaults to 60 when not specified", async () => {
    const result = await publishFrontierDirective(makeRequest());
    expect(result.ttlMinutes).toBe(60);
  });

  it("FR-L2-27: TTL is capped at 1440 (24 hours)", async () => {
    const result = await publishFrontierDirective(
      makeRequest({ ttlMinutes: 9999 })
    );
    expect(result.ttlMinutes).toBe(1440);
  });

  it("FR-L2-27: TTL is accepted when within range", async () => {
    const result = await publishFrontierDirective(
      makeRequest({ ttlMinutes: 120 })
    );
    expect(result.ttlMinutes).toBe(120);
  });

  it("FR-L2-27: expiresAt is in the future", async () => {
    const before = Date.now();
    const result = await publishFrontierDirective(makeRequest());
    expect(result.expiresAt.getTime()).toBeGreaterThan(before);
  });

  // ─── FR-L2-28: Event publication ─────────────────────────────────────────
  it("FR-L2-28: publishes convergence_gate_opened event", async () => {
    await publishFrontierDirective(makeRequest());
    expect(mocks.mockPublishEvent).toHaveBeenCalledOnce();
    const [eventType, payload] = mocks.mockPublishEvent.mock.calls[0];
    expect(eventType).toBe("convergence_gate_opened");
    expect(payload.directiveType).toBe("focus_gap");
    expect(payload.confidence).toBe(0.8);
    expect(payload.directiveId).toBeTruthy();
  });

  // ─── reason validation ────────────────────────────────────────────────────
  it("throws when reason is shorter than 20 chars", async () => {
    await expect(
      publishFrontierDirective(makeRequest({ reason: "Too short" }))
    ).rejects.toThrow("FR-L2-15");
  });

  it("accepts reason of exactly 20 chars", async () => {
    const result = await publishFrontierDirective(
      makeRequest({ reason: "Exactly twenty chars!" })
    );
    expect(result.reason).toHaveLength(21); // "Exactly twenty chars!" is 21 chars
  });

  // ─── focus_gap requires targetGapId ──────────────────────────────────────
  it("throws when focus_gap directive has no targetGapId", async () => {
    await expect(
      publishFrontierDirective(
        makeRequest({ directiveType: "focus_gap", targetGapId: undefined })
      )
    ).rejects.toThrow("focus_gap");
  });

  // ─── deep_dive_entity requires targetEntityId ────────────────────────────
  it("throws when deep_dive_entity has no targetEntityId", async () => {
    await expect(
      publishFrontierDirective(
        makeRequest({
          directiveType: "deep_dive_entity",
          targetEntityId: undefined,
        })
      )
    ).rejects.toThrow("deep_dive_entity");
  });

  // ─── DB failure is non-fatal ──────────────────────────────────────────────
  it("returns a result even when DB insert fails", async () => {
    const failDb = {
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockRejectedValue(new Error("DB connection lost")),
      }),
    };
    mocks.mockGetDb.mockResolvedValue(failDb);
    const result = await publishFrontierDirective(makeRequest());
    expect(result.directiveId).toBeTruthy();
    expect(result.dbRowId).toBeUndefined();
    // Event should still be published
    expect(mocks.mockPublishEvent).toHaveBeenCalledOnce();
  });

  it("returns a result even when DB is unavailable (null)", async () => {
    mocks.mockGetDb.mockResolvedValue(null);
    const result = await publishFrontierDirective(makeRequest());
    expect(result.directiveId).toBeTruthy();
    expect(result.dbRowId).toBeUndefined();
  });

  // ─── Event failure is non-fatal ───────────────────────────────────────────
  it("returns a result even when event publication fails", async () => {
    mocks.mockPublishEvent.mockRejectedValueOnce(new Error("Event bus down"));
    const result = await publishFrontierDirective(makeRequest());
    expect(result.directiveId).toBeTruthy();
  });

  // ─── issuedByCycleId passthrough ─────────────────────────────────────────
  it("passes issuedByCycleId through to the result", async () => {
    const result = await publishFrontierDirective(
      makeRequest({ issuedByCycleId: 99 })
    );
    expect(result.issuedByCycleId).toBe(99);
  });

  it("issuedByCycleId is undefined when not provided", async () => {
    const result = await publishFrontierDirective(makeRequest());
    expect(result.issuedByCycleId).toBeUndefined();
  });
});

// ─── publishFrontierDirectives() — batch ─────────────────────────────────────
describe("publishFrontierDirectives() — T058 batch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mockGetDb.mockResolvedValue(makeDb());
    mocks.mockPublishEvent.mockResolvedValue(undefined);
  });

  it("returns results for all valid requests", async () => {
    const requests = [
      makeRequest({ directiveType: "focus_gap", targetGapId: 1 }),
      makeRequest({ directiveType: "skip_mapping" }),
    ];
    const results = await publishFrontierDirectives(requests);
    expect(results).toHaveLength(2);
    expect(results[0].directiveType).toBe("focus_gap");
    expect(results[1].directiveType).toBe("skip_mapping");
  });

  it("skips invalid requests and continues with valid ones", async () => {
    const requests = [
      makeRequest({ directiveType: "focus_gap", targetGapId: 1 }),
      makeRequest({ confidence: 99 }), // invalid
      makeRequest({ directiveType: "skip_mapping" }),
    ];
    const results = await publishFrontierDirectives(requests);
    // Only 2 valid requests succeed
    expect(results).toHaveLength(2);
  });

  it("returns empty array for empty input", async () => {
    const results = await publishFrontierDirectives([]);
    expect(results).toHaveLength(0);
  });

  it("publishes events for each valid directive", async () => {
    const requests = [
      makeRequest({ directiveType: "focus_gap", targetGapId: 1 }),
      makeRequest({ directiveType: "skip_mapping" }),
    ];
    await publishFrontierDirectives(requests);
    expect(mocks.mockPublishEvent).toHaveBeenCalledTimes(2);
  });
});
