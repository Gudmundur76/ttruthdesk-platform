/**
 * sourceRegistry.test.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Unit tests for the Source Registry — whitelist management, approval/rejection,
 * and health-check orchestration.
 *
 * SOURCE_WHITELIST is an in-memory array; we mutate it in tests and restore
 * it via beforeEach resets.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getApprovedSources,
  getPendingSources,
  getSourceById,
  approveSource,
  rejectSource,
  runHealthCheck,
  runAllHealthChecks,
  SOURCE_WHITELIST,
  type SourceDefinition,
} from "./sourceRegistry";

// ─── Snapshot & restore helpers ───────────────────────────────────────────────
// We need to restore the in-memory whitelist after each test that mutates it.
let originalStates: Map<
  string,
  { approved: boolean; approvedAt: string | null }
>;

beforeEach(() => {
  // Snapshot current approved/approvedAt state for all entries
  originalStates = new Map(
    SOURCE_WHITELIST.map(s => [
      s.id,
      { approved: s.approved, approvedAt: s.approvedAt ?? null },
    ])
  );
});

afterEach(() => {
  // Restore original state
  for (const source of SOURCE_WHITELIST) {
    const original = originalStates.get(source.id);
    if (original) {
      source.approved = original.approved;
      source.approvedAt = original.approvedAt ?? null;
    }
  }
});

// ─── getApprovedSources ───────────────────────────────────────────────────────
describe("sourceRegistry — getApprovedSources()", () => {
  it("returns only approved sources", () => {
    const approved = getApprovedSources();

    expect(Array.isArray(approved)).toBe(true);
    expect(approved.every(s => s.approved === true)).toBe(true);
  });

  it("returns a non-empty list (at least one source is approved in the whitelist)", () => {
    const approved = getApprovedSources();

    expect(approved.length).toBeGreaterThan(0);
  });

  it("each approved source has required fields", () => {
    const approved = getApprovedSources();

    for (const source of approved) {
      expect(typeof source.id).toBe("string");
      expect(typeof source.displayName).toBe("string");
      expect(typeof source.apiBaseUrl).toBe("string");
      expect(typeof source.healthCheckFn).toBe("function");
    }
  });
});

// ─── getPendingSources ────────────────────────────────────────────────────────
describe("sourceRegistry — getPendingSources()", () => {
  it("returns only unapproved sources", () => {
    const pending = getPendingSources();

    expect(Array.isArray(pending)).toBe(true);
    expect(pending.every(s => s.approved === false)).toBe(true);
  });

  it("approved + pending = total whitelist length", () => {
    const approved = getApprovedSources();
    const pending = getPendingSources();

    expect(approved.length + pending.length).toBe(SOURCE_WHITELIST.length);
  });
});

// ─── getSourceById ────────────────────────────────────────────────────────────
describe("sourceRegistry — getSourceById()", () => {
  it("returns the correct source for a known id", () => {
    const firstSource = SOURCE_WHITELIST[0];
    const found = getSourceById(firstSource.id);

    expect(found).toBeDefined();
    expect(found!.id).toBe(firstSource.id);
  });

  it("returns undefined for an unknown id", () => {
    const result = getSourceById("__nonexistent_source_id__");

    expect(result).toBeUndefined();
  });
});

// ─── approveSource ────────────────────────────────────────────────────────────
describe("sourceRegistry — approveSource()", () => {
  it("returns false for an unknown source id", () => {
    const result = approveSource("__nonexistent__");

    expect(result).toBe(false);
  });

  it("sets approved:true and approvedAt for a pending source", () => {
    // Find a pending source to approve
    const pending = getPendingSources();
    if (pending.length === 0) {
      // All sources are approved — temporarily reject one for this test
      const target = SOURCE_WHITELIST[0];
      target.approved = false;
      target.approvedAt = null;
    }

    const pendingNow = getPendingSources();
    expect(pendingNow.length).toBeGreaterThan(0);

    const target = pendingNow[0];
    const result = approveSource(target.id);

    expect(result).toBe(true);
    expect(target.approved).toBe(true);
    expect(target.approvedAt).toBeTruthy();
  });

  it("is idempotent — approving an already-approved source returns true", () => {
    const approved = getApprovedSources();
    if (approved.length === 0) return; // nothing to test

    const target = approved[0];
    const result = approveSource(target.id);

    expect(result).toBe(true);
    expect(target.approved).toBe(true);
  });
});

// ─── rejectSource ─────────────────────────────────────────────────────────────
describe("sourceRegistry — rejectSource()", () => {
  it("returns false for an unknown source id", () => {
    const result = rejectSource("__nonexistent__");

    expect(result).toBe(false);
  });

  it("sets approved:false and clears approvedAt for an approved source", () => {
    const approved = getApprovedSources();
    if (approved.length === 0) return;

    const target = approved[0];
    const result = rejectSource(target.id);

    expect(result).toBe(true);
    expect(target.approved).toBe(false);
    expect(target.approvedAt).toBeNull();
  });

  it("approve → reject cycle works correctly", () => {
    // Start with a pending source
    const pending = getPendingSources();
    let target: SourceDefinition;
    if (pending.length > 0) {
      target = pending[0];
    } else {
      target = SOURCE_WHITELIST[0];
      target.approved = false;
      target.approvedAt = null;
    }

    approveSource(target.id);
    expect(target.approved).toBe(true);

    rejectSource(target.id);
    expect(target.approved).toBe(false);
    expect(target.approvedAt).toBeNull();
  });
});

// ─── runHealthCheck ───────────────────────────────────────────────────────────
describe("sourceRegistry — runHealthCheck()", () => {
  it("returns null for an unknown source id", async () => {
    const result = await runHealthCheck("__nonexistent__");

    expect(result).toBeNull();
  });

  it("calls the source's healthCheckFn and returns a SourceHealthResult", async () => {
    const mockHealthFn = vi.fn().mockResolvedValue({
      healthy: true,
      latencyMs: 42,
    });

    // Temporarily inject a mock source
    const mockSource: SourceDefinition = {
      id: "__test_source__",
      displayName: "Test Source",
      description: "A mock source for testing",
      apiBaseUrl: "https://test.example.com",
      schema: ["pdb_id"],
      approved: true,
      approvedAt: new Date().toISOString(),
      failureMode: "degrade",
      healthCheckFn: mockHealthFn,
    };
    SOURCE_WHITELIST.push(mockSource);

    try {
      const result = await runHealthCheck("__test_source__");

      expect(result).not.toBeNull();
      expect(result!.healthy).toBe(true);
      expect(result!.latencyMs).toBe(42);
      expect(typeof result!.checkedAt).toBe("string");
      expect(mockHealthFn).toHaveBeenCalledOnce();
    } finally {
      // Remove mock source
      const idx = SOURCE_WHITELIST.findIndex(s => s.id === "__test_source__");
      if (idx !== -1) SOURCE_WHITELIST.splice(idx, 1);
    }
  });
});

// ─── runAllHealthChecks ───────────────────────────────────────────────────────
describe("sourceRegistry — runAllHealthChecks()", () => {
  it("returns a record keyed by source id", async () => {
    // Mock all healthCheckFns to avoid real network calls
    const origFns = SOURCE_WHITELIST.map(s => s.healthCheckFn);
    SOURCE_WHITELIST.forEach(s => {
      s.healthCheckFn = vi
        .fn()
        .mockResolvedValue({ healthy: true, latencyMs: 10 });
    });

    try {
      const results = await runAllHealthChecks();

      expect(typeof results).toBe("object");
      for (const source of SOURCE_WHITELIST) {
        expect(results[source.id]).toBeDefined();
        expect(typeof results[source.id].healthy).toBe("boolean");
        expect(typeof results[source.id].checkedAt).toBe("string");
      }
    } finally {
      SOURCE_WHITELIST.forEach((s, i) => {
        s.healthCheckFn = origFns[i];
      });
    }
  });

  it("records error for sources whose healthCheckFn throws", async () => {
    const origFns = SOURCE_WHITELIST.map(s => s.healthCheckFn);
    SOURCE_WHITELIST.forEach(s => {
      s.healthCheckFn = vi.fn().mockRejectedValue(new Error("network error"));
    });

    try {
      const results = await runAllHealthChecks();

      for (const source of SOURCE_WHITELIST) {
        expect(results[source.id].healthy).toBe(false);
        expect(results[source.id].error).toContain("network error");
      }
    } finally {
      SOURCE_WHITELIST.forEach((s, i) => {
        s.healthCheckFn = origFns[i];
      });
    }
  });

  it("resolves even when some sources fail and others succeed", async () => {
    if (SOURCE_WHITELIST.length < 2) return;

    const origFns = SOURCE_WHITELIST.map(s => s.healthCheckFn);
    SOURCE_WHITELIST[0].healthCheckFn = vi
      .fn()
      .mockResolvedValue({ healthy: true, latencyMs: 5 });
    SOURCE_WHITELIST[1].healthCheckFn = vi
      .fn()
      .mockRejectedValue(new Error("timeout"));
    // Rest succeed
    SOURCE_WHITELIST.slice(2).forEach(s => {
      s.healthCheckFn = vi
        .fn()
        .mockResolvedValue({ healthy: true, latencyMs: 5 });
    });

    try {
      const results = await runAllHealthChecks();

      expect(results[SOURCE_WHITELIST[0].id].healthy).toBe(true);
      expect(results[SOURCE_WHITELIST[1].id].healthy).toBe(false);
    } finally {
      SOURCE_WHITELIST.forEach((s, i) => {
        s.healthCheckFn = origFns[i];
      });
    }
  });
});
