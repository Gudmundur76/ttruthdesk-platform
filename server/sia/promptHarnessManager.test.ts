/**
 * promptHarnessManager.test.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Unit tests for the SIA Prompt Harness Manager.
 * Tests: getActivePrompt(), seedPromptIfMissing(), activatePrompt().
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockGetDb } = vi.hoisted(() => ({ mockGetDb: vi.fn() }));
vi.mock("../../server/db", () => ({ getDb: mockGetDb }));

import {
  getActivePrompt,
  seedPromptIfMissing,
  activatePrompt,
  type HarnessComponent,
} from "./promptHarnessManager";

// ─── DB mock helpers ──────────────────────────────────────────────────────────
function makeChain(rows: unknown[] = []) {
  const p = Promise.resolve(rows);
  const c: Record<string, unknown> = {};
  c.select = vi.fn().mockReturnValue(c);
  c.from = vi.fn().mockReturnValue(c);
  c.where = vi.fn().mockReturnValue(c);
  c.orderBy = vi.fn().mockReturnValue(c);
  c.limit = vi.fn().mockResolvedValue(rows);
  c.insert = vi.fn().mockReturnValue(c);
  c.values = vi.fn().mockResolvedValue([{ insertId: 1 }]);
  c.update = vi.fn().mockReturnValue(c);
  c.set = vi.fn().mockReturnValue(c);
  c.then = (a: unknown, b: unknown) =>
    p.then(
      a as Parameters<typeof p.then>[0],
      b as Parameters<typeof p.then>[1]
    );
  c.catch = p.catch.bind(p);
  c.finally = p.finally.bind(p);
  return c;
}

function makeDb(rows: unknown[] = []) {
  const chain = makeChain(rows);
  return {
    select: vi.fn().mockReturnValue(chain),
    insert: vi.fn().mockReturnValue(chain),
    update: vi.fn().mockReturnValue(chain),
  };
}

// ─── getActivePrompt ──────────────────────────────────────────────────────────
describe("promptHarnessManager — getActivePrompt()", () => {
  const component: HarnessComponent = "claim_extractor";

  it("returns seed prompt when DB is unavailable", async () => {
    mockGetDb.mockResolvedValue(null);

    const result = await getActivePrompt(component);

    expect(result.component).toBe(component);
    expect(result.generation).toBe(1);
    expect(typeof result.promptText).toBe("string");
    expect(result.promptText.length).toBeGreaterThan(0);
    expect(result.id).toBe(0);
  });

  it("returns active prompt from DB when found", async () => {
    const db = makeDb([]);
    const promptRow = {
      id: 42,
      component,
      generation: 3,
      promptText: "Custom prompt text v3",
      isActive: true,
    };
    const chain = makeChain([promptRow]);
    chain.limit = vi.fn().mockResolvedValue([promptRow]);
    chain.orderBy = vi.fn().mockReturnValue(chain);
    chain.where = vi.fn().mockReturnValue(chain);
    chain.from = vi.fn().mockReturnValue(chain);
    db.select = vi.fn().mockReturnValue(chain);
    mockGetDb.mockResolvedValue(db);

    const result = await getActivePrompt(component);

    expect(result.id).toBe(42);
    expect(result.generation).toBe(3);
    expect(result.promptText).toBe("Custom prompt text v3");
  });

  it("falls back to seed prompt when DB has no active prompt", async () => {
    const db = makeDb([]);
    const chain = makeChain([]);
    chain.limit = vi.fn().mockResolvedValue([]);
    chain.orderBy = vi.fn().mockReturnValue(chain);
    chain.where = vi.fn().mockReturnValue(chain);
    chain.from = vi.fn().mockReturnValue(chain);
    // Also mock the seedPromptIfMissing insert chain
    const insertChain = makeChain([]);
    insertChain.values = vi.fn().mockResolvedValue([{ insertId: 1 }]);
    db.select = vi.fn().mockReturnValue(chain);
    db.insert = vi.fn().mockReturnValue(insertChain);
    mockGetDb.mockResolvedValue(db);

    const result = await getActivePrompt(component);

    expect(result.component).toBe(component);
    expect(result.generation).toBe(1);
    expect(result.id).toBe(0);
  });

  it("returns ActivePrompt with all required fields", async () => {
    mockGetDb.mockResolvedValue(null);

    const result = await getActivePrompt("verdict_rationale");

    expect(typeof result.id).toBe("number");
    expect(typeof result.component).toBe("string");
    expect(typeof result.generation).toBe("number");
    expect(typeof result.promptText).toBe("string");
  });
});

// ─── seedPromptIfMissing ──────────────────────────────────────────────────────
describe("promptHarnessManager — seedPromptIfMissing()", () => {
  const component: HarnessComponent = "passage_extractor";

  it("returns without error when DB is unavailable", async () => {
    mockGetDb.mockResolvedValue(null);

    await expect(seedPromptIfMissing(component)).resolves.toBeUndefined();
  });

  it("inserts seed prompt when none exists", async () => {
    const db = makeDb([]);
    // No existing prompt
    const selectChain = makeChain([]);
    selectChain.limit = vi.fn().mockResolvedValue([]);
    selectChain.where = vi.fn().mockReturnValue(selectChain);
    selectChain.from = vi.fn().mockReturnValue(selectChain);
    db.select = vi.fn().mockReturnValue(selectChain);
    const insertChain = makeChain([]);
    insertChain.values = vi.fn().mockResolvedValue([{ insertId: 1 }]);
    db.insert = vi.fn().mockReturnValue(insertChain);
    mockGetDb.mockResolvedValue(db);

    await seedPromptIfMissing(component);

    expect(db.insert).toHaveBeenCalledTimes(1);
  });

  it("does not insert when prompt already exists", async () => {
    const db = makeDb([]);
    const existingRow = { id: 5 };
    const selectChain = makeChain([existingRow]);
    selectChain.limit = vi.fn().mockResolvedValue([existingRow]);
    selectChain.where = vi.fn().mockReturnValue(selectChain);
    selectChain.from = vi.fn().mockReturnValue(selectChain);
    db.select = vi.fn().mockReturnValue(selectChain);
    db.insert = vi.fn();
    mockGetDb.mockResolvedValue(db);

    await seedPromptIfMissing(component);

    expect(db.insert).not.toHaveBeenCalled();
  });
});

// ─── activatePrompt ───────────────────────────────────────────────────────────
describe("promptHarnessManager — activatePrompt()", () => {
  const component: HarnessComponent = "misrep_classifier";

  it("throws when DB is unavailable", async () => {
    mockGetDb.mockResolvedValue(null);

    await expect(
      activatePrompt(component, 2, "New prompt text")
    ).rejects.toThrow("Database unavailable");
  });

  it("returns a new prompt id when DB is available", async () => {
    const db = makeDb([]);
    // update chain for deactivating old prompt
    const updateChain = makeChain([]);
    updateChain.set = vi.fn().mockReturnValue(updateChain);
    updateChain.where = vi.fn().mockResolvedValue([{ affectedRows: 1 }]);
    db.update = vi.fn().mockReturnValue(updateChain);
    // insert chain for new prompt
    const insertChain = makeChain([]);
    insertChain.values = vi.fn().mockResolvedValue([{ insertId: 99 }]);
    db.insert = vi.fn().mockReturnValue(insertChain);
    mockGetDb.mockResolvedValue(db);

    const newId = await activatePrompt(component, 2, "New prompt text");

    expect(typeof newId).toBe("number");
  });
});
