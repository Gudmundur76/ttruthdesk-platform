/**
 * paperDiscoveredHandler.test.ts
 * Unit tests for frontier/paperDiscoveredHandler.ts
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  mockGetDb: vi.fn(),
  mockInvokeLLM: vi.fn(),
}));

vi.mock("../db", () => ({ getDb: mocks.mockGetDb }));
vi.mock("../_core/llm", () => ({ invokeLLM: mocks.mockInvokeLLM }));
vi.mock("../logger", () => ({
  logger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  errData: vi.fn((e: unknown) => ({ err: String(e) })),
}));

const makeDb = () => {
  const db = {
    insert: vi.fn(),
    values: vi.fn(),
  };
  db.insert.mockReturnValue(db);
  db.values.mockResolvedValue([{ insertId: 1 }]);
  return db;
};

const makeLLMResponse = (hypotheses: Array<{ claimText: string; rationale: string; searchTerms: string[] }>) => ({
  choices: [
    {
      message: {
        content: JSON.stringify({ hypotheses }),
      },
    },
  ],
});

describe("handlePaperDiscovered()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("returns skip action when event payload is missing pmid", async () => {
    const { handlePaperDiscovered } = await import("./paperDiscoveredHandler");
    const result = await handlePaperDiscovered({
      eventType: "paper_discovered",
      payload: { title: "Some paper" },
    } as never);
    expect(result.actions[0].type).toBe("paper_discovered_skip");
    expect(result.result.hypothesesGenerated).toBe(0);
  });

  it("returns skip action when event payload is missing title", async () => {
    const { handlePaperDiscovered } = await import("./paperDiscoveredHandler");
    const result = await handlePaperDiscovered({
      eventType: "paper_discovered",
      payload: { pmid: "12345" },
    } as never);
    expect(result.actions[0].type).toBe("paper_discovered_skip");
  });

  it("generates hypotheses and queues them when LLM returns valid response", async () => {
    const db = makeDb();
    mocks.mockGetDb.mockResolvedValue(db);
    mocks.mockInvokeLLM.mockResolvedValue(makeLLMResponse([
      { claimText: "Protein X inhibits pathway Y", rationale: "Based on structural data", searchTerms: ["protein X", "pathway Y"] },
      { claimText: "Receptor Z binds ligand W", rationale: "Extrapolated from binding data", searchTerms: ["receptor Z", "ligand W"] },
    ]));
    const { handlePaperDiscovered } = await import("./paperDiscoveredHandler");
    const result = await handlePaperDiscovered({
      eventType: "paper_discovered",
      payload: { pmid: "12345", title: "A study of protein interactions", abstractSnippet: "We studied..." },
    } as never);
    expect(result.result.hypothesesGenerated).toBe(2);
    expect(result.result.queueItemsCreated).toBe(2);
    expect(result.actions[0].type).toBe("paper_discovered_hypotheses");
    expect(result.actions[0].result).toBe("success");
  });

  it("handles LLM failure gracefully — returns 0 hypotheses", async () => {
    mocks.mockGetDb.mockResolvedValue(makeDb());
    mocks.mockInvokeLLM.mockRejectedValue(new Error("LLM timeout"));
    const { handlePaperDiscovered } = await import("./paperDiscoveredHandler");
    const result = await handlePaperDiscovered({
      eventType: "paper_discovered",
      payload: { pmid: "99999", title: "Another paper" },
    } as never);
    expect(result.result.hypothesesGenerated).toBe(0);
    expect(result.result.queueItemsCreated).toBe(0);
    expect(result.actions[0].result).toBe("skipped");
  });

  it("handles DB unavailable — queues 0 items but still generates hypotheses", async () => {
    mocks.mockGetDb.mockResolvedValue(null);
    mocks.mockInvokeLLM.mockResolvedValue(makeLLMResponse([
      { claimText: "Protein A activates enzyme B", rationale: "From paper", searchTerms: ["protein A"] },
    ]));
    const { handlePaperDiscovered } = await import("./paperDiscoveredHandler");
    const result = await handlePaperDiscovered({
      eventType: "paper_discovered",
      payload: { pmid: "11111", title: "Enzyme study" },
    } as never);
    expect(result.result.hypothesesGenerated).toBe(1);
    expect(result.result.queueItemsCreated).toBe(0);
  });
});
