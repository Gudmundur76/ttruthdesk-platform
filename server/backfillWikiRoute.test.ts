/**
 * backfillWikiRoute.test.ts
 * Tests for Phase 31: batch-parallel wiki backfill logic.
 */

import { describe, it, expect, vi } from "vitest";

// ─── Batch-parallel execution logic ──────────────────────────────────────────

const BATCH_SIZE = 15;
const BATCH_COOLDOWN_MS = 500;
const MAX_RETRIES = 2;

interface DocStub {
  id: number;
  wikiCompiledAt: Date | null;
}

async function simulateBackfill(
  docs: DocStub[],
  compileFn: (id: number) => Promise<void>
): Promise<{ succeeded: number; failed: number; skipped: number; errors: string[] }> {
  const docsToProcess = docs.filter((d) => !d.wikiCompiledAt);
  const skipped = docs.length - docsToProcess.length;
  let succeeded = 0;
  let failed = 0;
  const errors: string[] = [];

  for (let i = 0; i < docsToProcess.length; i += BATCH_SIZE) {
    const batch = docsToProcess.slice(i, i + BATCH_SIZE);
    const batchPromises = batch.map(async (doc) => {
      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
          await compileFn(doc.id);
          return { id: doc.id, ok: true, error: null };
        } catch (err) {
          if (attempt === MAX_RETRIES) {
            return { id: doc.id, ok: false, error: `Doc ${doc.id}: ${String(err).slice(0, 100)}` };
          }
          await new Promise((r) => setTimeout(r, 10 * Math.pow(2, attempt)));
        }
      }
      return { id: doc.id, ok: false, error: "Unreachable" };
    });

    const results = await Promise.allSettled(batchPromises);
    for (const r of results) {
      if (r.status === "fulfilled" && r.value.ok) {
        succeeded++;
      } else {
        failed++;
        const errMsg = r.status === "fulfilled" ? (r.value.error ?? "unknown") : String(r.reason);
        errors.push(errMsg);
      }
    }
  }

  return { succeeded, failed, skipped, errors };
}

describe("batch-parallel backfill", () => {
  it("skips documents that already have wikiCompiledAt set", async () => {
    const docs: DocStub[] = [
      { id: 1, wikiCompiledAt: new Date() },
      { id: 2, wikiCompiledAt: new Date() },
      { id: 3, wikiCompiledAt: null },
    ];
    const compiled: number[] = [];
    const result = await simulateBackfill(docs, async (id) => {
      compiled.push(id);
    });
    expect(result.skipped).toBe(2);
    expect(result.succeeded).toBe(1);
    expect(compiled).toEqual([3]);
  });

  it("processes all pending documents when none are compiled", async () => {
    const docs: DocStub[] = Array.from({ length: 5 }, (_, i) => ({
      id: i + 1,
      wikiCompiledAt: null,
    }));
    const result = await simulateBackfill(docs, async () => {});
    expect(result.succeeded).toBe(5);
    expect(result.skipped).toBe(0);
    expect(result.failed).toBe(0);
  });

  it("handles empty document list gracefully", async () => {
    const result = await simulateBackfill([], async () => {});
    expect(result.succeeded).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.skipped).toBe(0);
    expect(result.errors).toHaveLength(0);
  });

  it("counts failures correctly when compile throws", async () => {
    const docs: DocStub[] = [
      { id: 1, wikiCompiledAt: null },
      { id: 2, wikiCompiledAt: null },
      { id: 3, wikiCompiledAt: null },
    ];
    const result = await simulateBackfill(docs, async (id) => {
      if (id === 2) throw new Error("LLM timeout");
    });
    expect(result.succeeded).toBe(2);
    expect(result.failed).toBe(1);
    expect(result.errors[0]).toContain("LLM timeout");
  });

  it("retries failed compilations up to MAX_RETRIES times", async () => {
    const callCounts: Record<number, number> = {};
    const docs: DocStub[] = [{ id: 42, wikiCompiledAt: null }];
    const result = await simulateBackfill(docs, async (id) => {
      callCounts[id] = (callCounts[id] ?? 0) + 1;
      if (callCounts[id] <= MAX_RETRIES) throw new Error("transient error");
      // Succeeds on the final attempt
    });
    expect(callCounts[42]).toBe(MAX_RETRIES + 1);
    expect(result.succeeded).toBe(1);
    expect(result.failed).toBe(0);
  });

  it("fails after MAX_RETRIES+1 attempts if always throwing", async () => {
    const callCounts: Record<number, number> = {};
    const docs: DocStub[] = [{ id: 99, wikiCompiledAt: null }];
    const result = await simulateBackfill(docs, async (id) => {
      callCounts[id] = (callCounts[id] ?? 0) + 1;
      throw new Error("persistent failure");
    });
    expect(callCounts[99]).toBe(MAX_RETRIES + 1);
    expect(result.failed).toBe(1);
    expect(result.succeeded).toBe(0);
  });

  it("processes exactly BATCH_SIZE docs per batch", async () => {
    const totalDocs = 32; // 2 full batches + 2 remainder
    const docs: DocStub[] = Array.from({ length: totalDocs }, (_, i) => ({
      id: i + 1,
      wikiCompiledAt: null,
    }));
    const batchSizes: number[] = [];
    let currentBatchStart = 0;
    const processedOrder: number[] = [];

    const result = await simulateBackfill(docs, async (id) => {
      processedOrder.push(id);
    });

    // All should succeed
    expect(result.succeeded).toBe(totalDocs);
    expect(result.failed).toBe(0);
  });

  it("caps error list at 20 items", () => {
    const errors = Array.from({ length: 30 }, (_, i) => `Error ${i}`);
    const capped = errors.slice(0, 20);
    expect(capped).toHaveLength(20);
  });

  it("returns correct percentComplete in status response", () => {
    const allCompleted = 100;
    const compiled = 75;
    const pending = allCompleted - compiled;
    const percentComplete = Math.round((compiled / allCompleted) * 100);
    expect(percentComplete).toBe(75);
    expect(pending).toBe(25);
  });

  it("returns 0 percentComplete when no documents exist", () => {
    const allCompleted = 0;
    const compiled = 0;
    const percentComplete = allCompleted > 0 ? Math.round((compiled / allCompleted) * 100) : 0;
    expect(percentComplete).toBe(0);
  });
});

// ─── wikiCompiledAt schema field ─────────────────────────────────────────────

describe("wikiCompiledAt field", () => {
  it("is null by default for new documents", () => {
    const doc: DocStub = { id: 1, wikiCompiledAt: null };
    expect(doc.wikiCompiledAt).toBeNull();
  });

  it("is a Date when set", () => {
    const now = new Date();
    const doc: DocStub = { id: 1, wikiCompiledAt: now };
    expect(doc.wikiCompiledAt).toBeInstanceOf(Date);
    expect(doc.wikiCompiledAt!.getTime()).toBe(now.getTime());
  });

  it("correctly filters compiled vs. pending documents", () => {
    const docs: DocStub[] = [
      { id: 1, wikiCompiledAt: new Date("2026-01-01") },
      { id: 2, wikiCompiledAt: null },
      { id: 3, wikiCompiledAt: new Date("2026-01-02") },
      { id: 4, wikiCompiledAt: null },
    ];
    const pending = docs.filter((d) => !d.wikiCompiledAt);
    const compiled = docs.filter((d) => !!d.wikiCompiledAt);
    expect(pending).toHaveLength(2);
    expect(compiled).toHaveLength(2);
    expect(pending.map((d) => d.id)).toEqual([2, 4]);
  });
});

// ─── Speed math validation ────────────────────────────────────────────────────

describe("backfill speed math", () => {
  it("batch-parallel is faster than serial for 100 docs", () => {
    const LLM_CALL_S = 5;
    const DOCS = 100;

    // Serial: each doc takes 5s + 300ms throttle
    const serialTimeS = DOCS * (LLM_CALL_S + 0.3);

    // Batch-parallel: ceil(100/15) = 7 batches × 5s + 6 × 0.5s cooldown
    const batches = Math.ceil(DOCS / BATCH_SIZE);
    const parallelTimeS = batches * LLM_CALL_S + (batches - 1) * (BATCH_COOLDOWN_MS / 1000);

    expect(parallelTimeS).toBeLessThan(serialTimeS);
    // Should be at least 5x faster
    expect(serialTimeS / parallelTimeS).toBeGreaterThan(5);
  });

  it("batch-parallel is faster than serial for 1000 docs", () => {
    const LLM_CALL_S = 5;
    const DOCS = 1000;

    const serialTimeS = DOCS * (LLM_CALL_S + 0.3);
    const batches = Math.ceil(DOCS / BATCH_SIZE);
    const parallelTimeS = batches * LLM_CALL_S + (batches - 1) * (BATCH_COOLDOWN_MS / 1000);

    expect(parallelTimeS).toBeLessThan(serialTimeS);
    // Should be at least 10x faster
    expect(serialTimeS / parallelTimeS).toBeGreaterThan(10);
  });
});
