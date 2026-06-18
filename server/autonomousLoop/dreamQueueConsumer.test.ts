/**
 * dreamQueueConsumer.test.ts — Tests for PRD-MASTER Phase 3 dream queue.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../db", () => ({ getDb: vi.fn() }));

import { getDb } from "../db";
import {
  fetchPendingDreamItems,
  markDreamItemCompleted,
  markDreamItemRejected,
  consumeDreamQueue,
} from "./dreamQueueConsumer";

function makeDbChain(returnValue: unknown) {
  const chain: Record<string, unknown> = {};
  const methods = ["select", "from", "where", "limit", "update", "set", "insert", "values"];
  for (const m of methods) {
    chain[m] = vi.fn(() => chain);
  }
  chain.then = (resolve: (v: unknown) => void) =>
    Promise.resolve(returnValue).then(resolve);
  return chain;
}

describe("fetchPendingDreamItems", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns empty array when db is null", async () => {
    vi.mocked(getDb).mockResolvedValue(null as never);
    const items = await fetchPendingDreamItems();
    expect(items).toEqual([]);
  });

  it("returns items from the database", async () => {
    const mockItems = [
      { id: 1, hypothesis: "test", sourceDocumentId: null, status: "pending", createdAt: Date.now(), processedAt: null },
    ];
    const chain = makeDbChain(mockItems);
    vi.mocked(getDb).mockResolvedValue({ select: vi.fn(() => chain) } as never);
    const items = await fetchPendingDreamItems(5);
    expect(items).toEqual(mockItems);
  });
});

describe("consumeDreamQueue", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns zero processed when db is null", async () => {
    vi.mocked(getDb).mockResolvedValue(null as never);
    const result = await consumeDreamQueue();
    expect(result.processed).toBe(0);
    expect(result.rejected).toBe(0);
    expect(result.errors).toHaveLength(0);
  });

  it("calls processor for each pending item", async () => {
    const mockItems = [
      { id: 1, hypothesis: "h1", sourceDocumentId: null, status: "pending", createdAt: Date.now(), processedAt: null },
      { id: 2, hypothesis: "h2", sourceDocumentId: null, status: "pending", createdAt: Date.now(), processedAt: null },
    ];
    const chain = makeDbChain([]);
    const selectChain = makeDbChain(mockItems);
    const db = {
      select: vi.fn(() => selectChain),
      update: vi.fn(() => chain),
    };
    vi.mocked(getDb).mockResolvedValue(db as never);

    const processor = vi.fn().mockResolvedValue(undefined);
    const result = await consumeDreamQueue({ batchSize: 10, processor });
    expect(processor).toHaveBeenCalledTimes(2);
    expect(result.processed).toBe(2);
  });

  it("records errors when processor throws", async () => {
    const mockItems = [
      { id: 1, hypothesis: "h1", sourceDocumentId: null, status: "pending", createdAt: Date.now(), processedAt: null },
    ];
    const chain = makeDbChain([]);
    const selectChain = makeDbChain(mockItems);
    const db = {
      select: vi.fn(() => selectChain),
      update: vi.fn(() => chain),
    };
    vi.mocked(getDb).mockResolvedValue(db as never);

    const processor = vi.fn().mockRejectedValue(new Error("processing failed"));
    const result = await consumeDreamQueue({ batchSize: 10, processor });
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("processing failed");
    expect(result.processed).toBe(0);
  });
});
