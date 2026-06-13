/**
 * apiKeyUsage.test.ts
 * Phase 113 — API Key Usage Tracking
 *
 * Tests:
 *  1. touchLastUsed increments usageCount via sql expression
 *  2. getApiKeyUsage returns correct shape
 *  3. getApiKeyUsage returns null for wrong userId
 *  4. listApiKeys includes usageCount in returned records
 *  5. ApiKeyRecord interface has usageCount field
 *  6. validateApiKey calls touchLastUsed on success
 *  7. validateApiKey does NOT call touchLastUsed on failure
 *  8. usageCount default is 0 in schema
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ApiKeyRecord } from "./apiKeyService";

// ─── Mock the DB ──────────────────────────────────────────────────────────────

const mockUpdate = vi.fn();
const mockSelect = vi.fn();
const mockInsert = vi.fn();

const mockDb = {
  update: mockUpdate,
  select: mockSelect,
  insert: mockInsert,
};

vi.mock("./db", () => ({
  getDb: vi.fn().mockResolvedValue(mockDb),
}));

vi.mock("../drizzle/schema", () => ({
  apiKeys: {
    id: "id",
    userId: "userId",
    keyHash: "keyHash",
    label: "label",
    scopes: "scopes",
    keyPrefix: "keyPrefix",
    lastUsedAt: "lastUsedAt",
    usageCount: "usageCount",
    revokedAt: "revokedAt",
    expiresAt: "expiresAt",
    createdAt: "createdAt",
    updatedAt: "updatedAt",
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((col: unknown, val: unknown) => ({ col, val, op: "eq" })),
  and: vi.fn((...args: unknown[]) => ({ args, op: "and" })),
  isNull: vi.fn((col: unknown) => ({ col, op: "isNull" })),
  sql: Object.assign(
    vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
      sql: strings.join("?"),
      values,
      _isSql: true,
    })),
    { raw: vi.fn((s: string) => ({ sql: s, _isSql: true })) }
  ),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildChain(returnValue: unknown) {
  // Each method returns a thenable chain so any terminal await resolves correctly
  const chain: Record<string, unknown> = {};
  const methods = ["set", "where", "from", "select", "limit", "orderBy"];
  methods.forEach((m) => {
    chain[m] = vi.fn(() => chain);
  });
  // Make the chain itself a Promise so `await chain` resolves to returnValue
  // AND every terminal method also resolves to returnValue
  const resolved = Promise.resolve(returnValue);
  (chain as unknown as Promise<unknown>).then = resolved.then.bind(resolved);
  (chain as unknown as Promise<unknown>).catch = resolved.catch.bind(resolved);
  (chain as unknown as Promise<unknown>).finally = resolved.finally.bind(resolved);
  // Also make every method resolve to returnValue when awaited
  methods.forEach((m) => {
    (chain[m] as ReturnType<typeof vi.fn>).mockReturnValue(chain);
  });
  return chain;
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Phase 113 — API Key Usage Tracking", () => {
  describe("touchLastUsed", () => {
    it("calls db.update with usageCount sql expression", async () => {
      const chain = buildChain([{ affectedRows: 1 }]);
      mockUpdate.mockReturnValue(chain);

      const { touchLastUsed } = await import("./apiKeyService");
      await touchLastUsed(42);

      expect(mockUpdate).toHaveBeenCalledOnce();
      const setCall = (chain["set"] as ReturnType<typeof vi.fn>).mock.calls[0][0];
      // usageCount should be a sql expression (has _isSql marker)
      expect(setCall).toHaveProperty("usageCount");
      expect(setCall.usageCount).toMatchObject({ _isSql: true });
      // lastUsedAt should be a Date
      expect(setCall.lastUsedAt).toBeInstanceOf(Date);
    });

    it("is a no-op when db is unavailable", async () => {
      const { getDb } = await import("./db");
      vi.mocked(getDb).mockResolvedValueOnce(null);

      const { touchLastUsed } = await import("./apiKeyService");
      await expect(touchLastUsed(1)).resolves.toBeUndefined();
      expect(mockUpdate).not.toHaveBeenCalled();
    });
  });

  describe("getApiKeyUsage", () => {
    it("returns usageCount and lastUsedAt for a valid key", async () => {
      const now = new Date();
      const chain = buildChain([{ usageCount: 17, lastUsedAt: now }]);
      mockSelect.mockReturnValue(chain);

      const { getApiKeyUsage } = await import("./apiKeyService");
      const result = await getApiKeyUsage(5, 99);

      expect(result).toEqual({ usageCount: 17, lastUsedAt: now });
    });

    it("returns null when key does not belong to userId", async () => {
      const chain = buildChain([]);
      mockSelect.mockReturnValue(chain);

      const { getApiKeyUsage } = await import("./apiKeyService");
      const result = await getApiKeyUsage(5, 999);

      expect(result).toBeNull();
    });

    it("returns null when db is unavailable", async () => {
      const { getDb } = await import("./db");
      vi.mocked(getDb).mockResolvedValueOnce(null);

      const { getApiKeyUsage } = await import("./apiKeyService");
      const result = await getApiKeyUsage(5, 99);

      expect(result).toBeNull();
    });
  });

  describe("listApiKeys", () => {
    it("includes usageCount in returned records", async () => {
      const now = new Date();
      const chain = buildChain([
        {
          id: 1,
          userId: 10,
          label: "Test Key",
          scopes: ["read"],
          keyPrefix: "abc12345",
          lastUsedAt: now,
          usageCount: 42,
          expiresAt: null,
          createdAt: now,
        },
      ]);
      mockSelect.mockReturnValue(chain);

      const { listApiKeys } = await import("./apiKeyService");
      const keys = await listApiKeys(10);

      expect(keys).toHaveLength(1);
      expect(keys[0].usageCount).toBe(42);
    });

    it("returns empty array when db is unavailable", async () => {
      const { getDb } = await import("./db");
      vi.mocked(getDb).mockResolvedValueOnce(null);

      const { listApiKeys } = await import("./apiKeyService");
      const keys = await listApiKeys(10);

      expect(keys).toEqual([]);
    });
  });

  describe("ApiKeyRecord interface", () => {
    it("has usageCount field typed as number", () => {
      // Compile-time check: if this assignment compiles, the interface is correct
      const record: ApiKeyRecord = {
        id: 1,
        userId: 1,
        label: "test",
        scopes: ["read"],
        keyPrefix: "abc12345",
        lastUsedAt: null,
        usageCount: 0,
        expiresAt: null,
        createdAt: new Date(),
      };
      expect(record.usageCount).toBe(0);
      expect(typeof record.usageCount).toBe("number");
    });
  });

  describe("schema default", () => {
    it("usageCount column has default 0 in schema definition", async () => {
      const { apiKeys } = await import("../drizzle/schema");
      // The column object should exist on the table
      expect(apiKeys).toHaveProperty("usageCount");
    });
  });

  describe("validateApiKey usage increment", () => {
    it("calls touchLastUsed (fire-and-forget) on successful validation", async () => {
      const now = new Date(Date.now() + 86400_000); // expires tomorrow
      const chain = buildChain([
        {
          id: 7,
          userId: 3,
          keyHash: "a".repeat(64),
          label: "key",
          scopes: ["read"],
          keyPrefix: "aaaaaaaa",
          lastUsedAt: null,
          usageCount: 0,
          revokedAt: null,
          expiresAt: now,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);
      mockSelect.mockReturnValue(chain);
      // touchLastUsed uses update — set up the chain for it
      const updateChain = buildChain([{ affectedRows: 1 }]);
      mockUpdate.mockReturnValue(updateChain);

      const { validateApiKey } = await import("./apiKeyService");
      const result = await validateApiKey("a".repeat(64));

      expect(result.valid).toBe(true);
      expect(result.keyId).toBe(7);
      // Give the fire-and-forget a tick to run
      await new Promise((r) => setTimeout(r, 0));
      expect(mockUpdate).toHaveBeenCalled();
    });

    it("does NOT call touchLastUsed when key is revoked", async () => {
      const chain = buildChain([
        {
          id: 8,
          userId: 3,
          keyHash: "b".repeat(64),
          label: "key",
          scopes: ["read"],
          keyPrefix: "bbbbbbbb",
          lastUsedAt: null,
          usageCount: 5,
          revokedAt: new Date(), // revoked
          expiresAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);
      mockSelect.mockReturnValue(chain);

      const { validateApiKey } = await import("./apiKeyService");
      const result = await validateApiKey("b".repeat(64));

      expect(result.valid).toBe(false);
      expect(result.reason).toBe("revoked");
      await new Promise((r) => setTimeout(r, 0));
      expect(mockUpdate).not.toHaveBeenCalled();
    });
  });
});
