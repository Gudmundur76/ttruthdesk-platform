/**
 * directivePublisher.test.ts — Tests for DirectivePublisher
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Mock publishEvent before importing DirectivePublisher ────────────────────
vi.mock("./autonomousLoop/eventBus", () => ({
  publishEvent: vi.fn().mockResolvedValue(undefined),
}));

// ── Mock child_process.spawn so no real Python processes are spawned ─────────
vi.mock("child_process", async () => {
  const { EventEmitter } = await import("events");
  function makeMockProc() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const proc: any = new EventEmitter();
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    proc.stdin = { write: vi.fn(), end: vi.fn() };
    proc.kill = vi.fn();
    // Simulate immediate close with code 0
    setImmediate(() => proc.emit("close", 0));
    return proc;
  }
  return { spawn: vi.fn().mockImplementation(makeMockProc) };
});

import { DirectivePublisher, getDirectivePublisher } from "./directivePublisher";
import { publishEvent } from "./autonomousLoop/eventBus";

// ── Tests ────────────────────────────────────────────────────────────────────

describe("DirectivePublisher.publishDirective()", () => {
  let publisher: DirectivePublisher;

  beforeEach(() => {
    publisher = new DirectivePublisher();
    vi.clearAllMocks();
  });

  it("returns a UUID string", async () => {
    const id = await publisher.publishDirective({ triggerReason: "gap_detected" });
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
  });

  it("calls publishEvent with frontier_directive type", async () => {
    await publisher.publishDirective({ triggerReason: "confidence_low" });
    expect(publishEvent).toHaveBeenCalledOnce();
    const [eventType, payload] = (publishEvent as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(eventType).toBe("frontier_directive");
    expect(payload.triggerReason).toBe("confidence_low");
  });

  it("includes the returned UUID in the event payload", async () => {
    const id = await publisher.publishDirective({ triggerReason: "scheduled" });
    const [, payload] = (publishEvent as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(payload.directiveId).toBe(id);
  });

  it("applies defaults for optional fields", async () => {
    await publisher.publishDirective({ triggerReason: "manual" });
    const [, payload] = (publishEvent as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(payload.priority).toBe(5);
    expect(payload.targetGapIds).toEqual([]);
    expect(payload.maxIterations).toBe(10);
    expect(payload.evidenceStrengthThreshold).toBe(0.6);
  });

  it("respects custom priority and targetGapIds", async () => {
    await publisher.publishDirective({
      triggerReason: "gap_detected",
      priority: 8,
      targetGapIds: ["gap-1", "gap-2"],
      maxIterations: 5,
    });
    const [, payload] = (publishEvent as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(payload.priority).toBe(8);
    expect(payload.targetGapIds).toEqual(["gap-1", "gap-2"]);
    expect(payload.maxIterations).toBe(5);
  });

  it("still returns a UUID even when publishEvent throws", async () => {
    (publishEvent as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("bus unavailable")
    );
    const id = await publisher.publishDirective({ triggerReason: "manual" });
    expect(id).toBeTruthy();
    expect(id).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it("generates a different UUID on each call", async () => {
    const id1 = await publisher.publishDirective({ triggerReason: "manual" });
    const id2 = await publisher.publishDirective({ triggerReason: "manual" });
    expect(id1).not.toBe(id2);
  });
});

describe("DirectivePublisher.recordDirectiveOutcome()", () => {
  let publisher: DirectivePublisher;

  beforeEach(() => {
    publisher = new DirectivePublisher();
    vi.clearAllMocks();
  });

  it("does not throw for a complete outcome", async () => {
    await expect(
      publisher.recordDirectiveOutcome("some-uuid", {
        status: "complete",
        iterationsUsed: 3,
        hypothesesGenerated: 7,
        durationMs: 1200,
      })
    ).resolves.toBeUndefined();
  });

  it("does not throw for a failed outcome", async () => {
    await expect(
      publisher.recordDirectiveOutcome("some-uuid", {
        status: "failed",
        errorMessage: "timeout",
      })
    ).resolves.toBeUndefined();
  });

  it("does not throw for a cancelled outcome", async () => {
    await expect(
      publisher.recordDirectiveOutcome("some-uuid", { status: "cancelled" })
    ).resolves.toBeUndefined();
  });
});

describe("getDirectivePublisher() singleton", () => {
  it("returns the same instance on repeated calls", () => {
    const a = getDirectivePublisher();
    const b = getDirectivePublisher();
    expect(a).toBe(b);
  });

  it("returns a DirectivePublisher instance", () => {
    const p = getDirectivePublisher();
    expect(p).toBeInstanceOf(DirectivePublisher);
  });
});
