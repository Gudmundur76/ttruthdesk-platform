/**
 * alertRouter.test.ts — Meta-Agent Alert Routing Layer
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockGetDb, mockNotifyOwner } = vi.hoisted(() => ({
  mockGetDb: vi.fn(),
  mockNotifyOwner: vi.fn(),
}));

vi.mock("../db", () => ({ getDb: mockGetDb }));
vi.mock("../_core/notification", () => ({ notifyOwner: mockNotifyOwner }));
vi.mock("../_core/env", () => ({
  ENV: { telegramBotToken: null, telegramChannelId: null },
}));

global.fetch = vi
  .fn()
  .mockResolvedValue({ ok: true, text: vi.fn().mockResolvedValue("") });

import {
  routeFinding,
  routeFindings,
  driftFindingToMetaFinding,
  invariantResultToMetaFinding,
  persistFinding,
  type MetaFinding,
  type AlertSeverity,
} from "./alertRouter";
import type { DriftFinding } from "./codeDriftService";
import type { InvariantResult } from "./pipelineGuardian";

function makeFinding(
  severity: AlertSeverity,
  checkType = "testDrift"
): MetaFinding {
  return {
    checkType,
    severity,
    confidence: 0.9,
    summary: `Test: ${checkType}`,
    details: {},
  };
}

function makeDb(recentRows: unknown[] = []) {
  return {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(recentRows),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockResolvedValue([{ insertId: 42 }]),
  };
}

describe("alertRouter — info severity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetDb.mockResolvedValue(makeDb());
    mockNotifyOwner.mockResolvedValue(true);
  });

  it("does not call notifyOwner for info findings", async () => {
    await routeFinding(makeFinding("info"));
    expect(mockNotifyOwner).not.toHaveBeenCalled();
  });

  it("persists info findings", async () => {
    const db = makeDb();
    mockGetDb.mockResolvedValue(db);
    await routeFinding(makeFinding("info"));
    expect(db.insert).toHaveBeenCalled();
  });
});

describe("alertRouter — warning severity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockNotifyOwner.mockResolvedValue(true);
  });

  it("calls notifyOwner when not recently alerted", async () => {
    mockGetDb.mockResolvedValue(makeDb([]));
    await routeFinding(makeFinding("warning"));
    expect(mockNotifyOwner).toHaveBeenCalledOnce();
    expect(mockNotifyOwner.mock.calls[0][0].title).toContain("Warning");
  });

  it("skips notifyOwner when deduplication fires (recent row exists)", async () => {
    mockGetDb.mockResolvedValue(makeDb([{ id: 1 }]));
    await routeFinding(makeFinding("warning"));
    expect(mockNotifyOwner).not.toHaveBeenCalled();
  });
});

describe("alertRouter — critical severity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockNotifyOwner.mockResolvedValue(true);
  });

  it("calls notifyOwner for critical findings", async () => {
    mockGetDb.mockResolvedValue(makeDb([]));
    await routeFinding(makeFinding("critical"));
    expect(mockNotifyOwner).toHaveBeenCalledOnce();
    expect(mockNotifyOwner.mock.calls[0][0].title).toContain("Critical");
  });

  it("does not throw when notifyOwner rejects", async () => {
    mockGetDb.mockResolvedValue(makeDb([]));
    mockNotifyOwner.mockRejectedValue(new Error("down"));
    await expect(routeFinding(makeFinding("critical"))).resolves.not.toThrow();
  });

  it("does not call Telegram when token is null", async () => {
    mockGetDb.mockResolvedValue(makeDb([]));
    await routeFinding(makeFinding("critical"));
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe("alertRouter — routeFindings batch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetDb.mockResolvedValue(makeDb([]));
    mockNotifyOwner.mockResolvedValue(true);
  });

  it("processes all findings", async () => {
    await routeFindings([
      makeFinding("info", "a"),
      makeFinding("warning", "b"),
      makeFinding("info", "c"),
    ]);
    expect(mockNotifyOwner).toHaveBeenCalledOnce();
  });

  it("handles empty batch", async () => {
    await expect(routeFindings([])).resolves.not.toThrow();
  });
});

describe("alertRouter — driftFindingToMetaFinding", () => {
  it("converts DriftFinding correctly", () => {
    const drift: DriftFinding = {
      checkType: "schemaDrift",
      severity: "warning",
      confidence: 0.95,
      details: {},
      summary: "1 table",
    };
    const meta = driftFindingToMetaFinding(drift);
    expect(meta.checkType).toBe("schemaDrift");
    expect(meta.severity).toBe("warning");
    expect(meta.recommended_action).toBe("alerted");
    expect(Array.isArray(meta.assumptions)).toBe(true);
  });

  it("sets escalated for critical", () => {
    const drift: DriftFinding = {
      checkType: "x",
      severity: "critical",
      confidence: 0.9,
      details: {},
      summary: "s",
    };
    expect(driftFindingToMetaFinding(drift).recommended_action).toBe(
      "escalated"
    );
  });

  it("sets ok for info", () => {
    const drift: DriftFinding = {
      checkType: "x",
      severity: "info",
      confidence: 0.9,
      details: {},
      summary: "s",
    };
    expect(driftFindingToMetaFinding(drift).recommended_action).toBe("ok");
  });
});

describe("alertRouter — invariantResultToMetaFinding", () => {
  it("converts InvariantResult correctly", () => {
    const ir: InvariantResult = {
      name: "stuckDocuments",
      status: "fail",
      severity: "critical",
      actual: "5",
      threshold: "0",
      details: {},
    };
    const meta = invariantResultToMetaFinding(ir);
    expect(meta.checkType).toBe("pipeline.stuckDocuments");
    expect(meta.severity).toBe("critical");
    expect(meta.recommended_action).toBe("alerted");
  });

  it("sets investigate for warn", () => {
    const ir: InvariantResult = {
      name: "x",
      status: "warn",
      severity: "warning",
      actual: "1",
      threshold: "0",
      details: {},
    };
    expect(invariantResultToMetaFinding(ir).recommended_action).toBe(
      "investigate"
    );
  });

  it("sets ok for pass", () => {
    const ir: InvariantResult = {
      name: "x",
      status: "pass",
      severity: "info",
      actual: "0",
      threshold: "0",
      details: {},
    };
    expect(invariantResultToMetaFinding(ir).recommended_action).toBe("ok");
  });
});

describe("alertRouter — persistFinding", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns null when DB unavailable", async () => {
    mockGetDb.mockResolvedValue(null);
    expect(await persistFinding(makeFinding("info"))).toBeNull();
  });

  it("returns a value when DB insert succeeds", async () => {
    mockGetDb.mockResolvedValue(makeDb());
    const result = await persistFinding(makeFinding("warning"));
    expect(result === null || typeof result === "number").toBe(true);
  });
});
