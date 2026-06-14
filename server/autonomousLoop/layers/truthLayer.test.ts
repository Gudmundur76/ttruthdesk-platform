/**
 * truthLayer.test.ts
 * Unit tests for autonomousLoop/layers/truthLayer.ts
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  mockGetDb: vi.fn(),
}));

vi.mock("../../db", () => ({ getDb: mocks.mockGetDb }));
vi.mock("../../logger", () => ({
  logger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  errData: vi.fn((e: unknown) => ({ err: String(e) })),
}));

const makeDb = () => {
  const db = {
    select: vi.fn(),
    from: vi.fn(),
    where: vi.fn(),
    update: vi.fn(),
    set: vi.fn(),
    insert: vi.fn(),
    values: vi.fn(),
  };
  db.select.mockReturnValue(db);
  db.from.mockReturnValue(db);
  db.where.mockResolvedValue([]);
  db.update.mockReturnValue(db);
  db.set.mockReturnValue(db);
  db.insert.mockReturnValue(db);
  db.values.mockResolvedValue([{ insertId: 1 }]);
  return db;
};

describe("runTruthLayer()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("handles document_submitted event — returns truth_pipeline_triggered action", async () => {
    mocks.mockGetDb.mockResolvedValue(makeDb());
    const { runTruthLayer } = await import("./truthLayer");
    const result = await runTruthLayer({
      eventType: "document_submitted",
      payload: { documentId: 1 },
    } as never);
    expect(result.actions.length).toBeGreaterThan(0);
    expect(result.actions[0].type).toBe("truth_pipeline_triggered");
    expect(result.verdicts).toEqual([]);
  });

  it("handles paper_discovered event — returns truth_paper_queued action", async () => {
    mocks.mockGetDb.mockResolvedValue(makeDb());
    const { runTruthLayer } = await import("./truthLayer");
    const result = await runTruthLayer({
      eventType: "paper_discovered",
      payload: { paperId: "arxiv:1234" },
    } as never);
    expect(result.actions.length).toBeGreaterThan(0);
    expect(result.actions[0].type).toContain("truth_paper");
  });

  it("handles source_status_change retracted — returns truth_source_halt action", async () => {
    mocks.mockGetDb.mockResolvedValue(makeDb());
    const { runTruthLayer } = await import("./truthLayer");
    const result = await runTruthLayer({
      eventType: "source_status_change",
      payload: { sourceId: 5, status: "retracted" },
    } as never);
    const types = result.actions.map((a) => a.type);
    expect(types).toContain("truth_source_halt");
  });

  it("handles source_status_change active — returns truth_source_resume action", async () => {
    mocks.mockGetDb.mockResolvedValue(makeDb());
    const { runTruthLayer } = await import("./truthLayer");
    const result = await runTruthLayer({
      eventType: "source_status_change",
      payload: { sourceId: 5, status: "active" },
    } as never);
    const types = result.actions.map((a) => a.type);
    expect(types).toContain("truth_source_resume");
  });

  it("handles source_data_changed with DB available — returns success action", async () => {
    const db = makeDb();
    db.where.mockResolvedValue([{ id: 1 }, { id: 2 }]);
    mocks.mockGetDb.mockResolvedValue(db);
    const { runTruthLayer } = await import("./truthLayer");
    const result = await runTruthLayer({
      eventType: "source_data_changed",
      payload: { sourceId: 3 },
    } as never);
    expect(result.actions.length).toBeGreaterThan(0);
    const types = result.actions.map((a) => a.type);
    expect(types.some((t) => t.includes("truth_source"))).toBe(true);
  });

  it("handles unknown event type — returns empty actions and verdicts", async () => {
    mocks.mockGetDb.mockResolvedValue(makeDb());
    const { runTruthLayer } = await import("./truthLayer");
    const result = await runTruthLayer({
      eventType: "unknown_event",
      payload: {},
    } as never);
    expect(result.verdicts).toEqual([]);
  });
});
