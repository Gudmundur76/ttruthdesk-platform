/**
 * authorityEnforcer.test.ts — Tests for PRD-MASTER FR-MASTER-02.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../db", () => ({ getDb: vi.fn().mockResolvedValue(null) }));

import {
  checkEmitAuthority,
  checkReceiveAuthority,
  batchCheckAuthority,
  enforceEmitAuthority,
} from "./authorityEnforcer";

describe("checkEmitAuthority", () => {
  it("returns null when layer is authorised to emit the event", () => {
    // L1 emits verdict_complete
    const result = checkEmitAuthority("L1", "verdict_complete");
    expect(result).toBeNull();
  });

  it("returns violation when layer is not authorised to emit the event", () => {
    // L0 does not emit verdict_complete
    const result = checkEmitAuthority("L0", "verdict_complete");
    expect(result).not.toBeNull();
    expect(result!.layerId).toBe("L0");
    expect(result!.attemptedEvent).toBe("verdict_complete");
    expect(result!.reason).toContain("not authorised");
  });

  it("returns violation for unknown layer", () => {
    const result = checkEmitAuthority("L99", "verdict_complete");
    expect(result).not.toBeNull();
    expect(result!.reason).toContain("no registered contract");
  });
});

describe("checkReceiveAuthority", () => {
  it("returns null when layer accepts the event", () => {
    // L1 accepts document_submitted
    const result = checkReceiveAuthority("L1", "document_submitted");
    expect(result).toBeNull();
  });

  it("returns violation when layer does not accept the event", () => {
    // L5 does not accept document_submitted
    const result = checkReceiveAuthority("L5", "document_submitted");
    expect(result).not.toBeNull();
    expect(result!.reason).toContain("does not accept");
  });
});

describe("batchCheckAuthority", () => {
  it("returns empty array when all pairs are authorised", () => {
    const violations = batchCheckAuthority([
      { layerId: "L1", eventType: "verdict_complete", direction: "emit" },
      { layerId: "L2", eventType: "verdict_complete", direction: "receive" },
    ]);
    expect(violations).toHaveLength(0);
  });

  it("returns violations for unauthorised pairs", () => {
    const violations = batchCheckAuthority([
      { layerId: "L0", eventType: "verdict_complete", direction: "emit" },
      { layerId: "L5", eventType: "document_submitted", direction: "receive" },
    ]);
    expect(violations).toHaveLength(2);
  });
});

describe("enforceEmitAuthority", () => {
  it("resolves without error when authorised", async () => {
    await expect(
      enforceEmitAuthority("L1", "verdict_complete", "corr-123")
    ).resolves.toBeUndefined();
  });

  it("throws LayerError when not authorised", async () => {
    await expect(
      enforceEmitAuthority("L0", "verdict_complete", "corr-123")
    ).rejects.toThrow("not authorised");
  });
});
