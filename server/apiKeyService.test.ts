/**
 * apiKeyService.test.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Vitest unit tests for apiKeyService.ts
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock DB ──────────────────────────────────────────────────────────────────

const mockInsert = vi.fn();
const mockSelect = vi.fn();
const mockUpdate = vi.fn();

vi.mock("./db", () => ({
  getDb: vi.fn(async () => ({
    insert: mockInsert,
    select: mockSelect,
    update: mockUpdate,
  })),
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
  gt: vi.fn((col: unknown, val: unknown) => ({ col, val, op: "gt" })),
}));

// ─── Import after mocks ───────────────────────────────────────────────────────

import {
  generateApiKey,
  validateApiKey,
  revokeApiKey,
  listApiKeys,
  touchLastUsed,
} from "./apiKeyService";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeSelectChain(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  chain.from = vi.fn(() => chain);
  chain.where = vi.fn(() => chain);
  chain.limit = vi.fn(async () => rows);
  const thenFn = (resolve: (v: unknown) => void) => resolve(rows);
  chain.then = thenFn;
  return chain;
}

function makeUpdateChain(affectedRows = 1) {
  const chain: Record<string, unknown> = {};
  chain.set = vi.fn(() => chain);
  chain.where = vi.fn(async () => ({ affectedRows }));
  return chain;
}

// ─── generateApiKey ───────────────────────────────────────────────────────────

describe("generateApiKey", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns null when db is unavailable", async () => {
    const { getDb } = await import("./db");
    vi.mocked(getDb).mockResolvedValueOnce(null as any);

    const result = await generateApiKey({ userId: 1, label: "test", scopes: ["read"] });
    expect(result).toBeNull();
  });

  it("throws when label is empty", async () => {
    await expect(
      generateApiKey({ userId: 1, label: "  ", scopes: ["read"] })
    ).rejects.toThrow("Label must not be empty");
  });

  it("throws when scopes array is empty", async () => {
    await expect(
      generateApiKey({ userId: 1, label: "test", scopes: [] })
    ).rejects.toThrow("At least one scope is required");
  });

  it("inserts a row and returns rawKey + keyPrefix", async () => {
    const valuesChain = { values: vi.fn(async () => ({ insertId: 7 })) };
    mockInsert.mockReturnValue(valuesChain);

    const result = await generateApiKey({ userId: 1, label: "CI key", scopes: ["read", "write"] });

    expect(result).not.toBeNull();
    expect(result!.id).toBe(7);
    expect(result!.rawKey).toHaveLength(64);
    expect(result!.keyPrefix).toBe(result!.rawKey.slice(0, 8));
    expect(result!.label).toBe("CI key");
    expect(result!.scopes).toEqual(["read", "write"]);
  });

  it("trims whitespace from label", async () => {
    const valuesChain = { values: vi.fn(async () => ({ insertId: 1 })) };
    mockInsert.mockReturnValue(valuesChain);

    const result = await generateApiKey({ userId: 1, label: "  My Key  ", scopes: ["admin"] });

    expect(result!.label).toBe("My Key");
    expect(valuesChain.values).toHaveBeenCalledWith(
      expect.objectContaining({ label: "My Key" })
    );
  });

  it("passes expiresAt when provided", async () => {
    const valuesChain = { values: vi.fn(async () => ({ insertId: 1 })) };
    mockInsert.mockReturnValue(valuesChain);

    const expires = new Date("2027-01-01");
    await generateApiKey({ userId: 1, label: "expiring", scopes: ["read"], expiresAt: expires });

    expect(valuesChain.values).toHaveBeenCalledWith(
      expect.objectContaining({ expiresAt: expires })
    );
  });

  it("stores null for expiresAt when not provided", async () => {
    const valuesChain = { values: vi.fn(async () => ({ insertId: 1 })) };
    mockInsert.mockReturnValue(valuesChain);

    await generateApiKey({ userId: 1, label: "no-expiry", scopes: ["read"] });

    expect(valuesChain.values).toHaveBeenCalledWith(
      expect.objectContaining({ expiresAt: null })
    );
  });

  it("stores only the SHA-256 hash, not the raw key", async () => {
    const valuesChain = { values: vi.fn(async () => ({ insertId: 1 })) };
    mockInsert.mockReturnValue(valuesChain);

    const result = await generateApiKey({ userId: 1, label: "hash-test", scopes: ["read"] });
    const storedHash = valuesChain.values.mock.calls[0][0].keyHash;

    // The stored hash must be a 64-char hex string
    expect(storedHash).toHaveLength(64);
    expect(storedHash).toMatch(/^[0-9a-f]{64}$/);
    // It must NOT equal the raw key
    expect(storedHash).not.toBe(result!.rawKey);
  });
});

// ─── validateApiKey ───────────────────────────────────────────────────────────

describe("validateApiKey", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns invalid_format for empty string", async () => {
    const result = await validateApiKey("");
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("invalid_format");
  });

  it("returns invalid_format for wrong-length key", async () => {
    const result = await validateApiKey("abc123");
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("invalid_format");
  });

  it("returns db_unavailable when db is down", async () => {
    const { getDb } = await import("./db");
    vi.mocked(getDb).mockResolvedValueOnce(null as any);

    const result = await validateApiKey("a".repeat(64));
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("db_unavailable");
  });

  it("returns not_found when key hash does not exist in DB", async () => {
    const chain = makeSelectChain([]);
    mockSelect.mockReturnValue(chain);

    const result = await validateApiKey("b".repeat(64));
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("not_found");
  });

  it("returns revoked when revokedAt is set", async () => {
    const chain = makeSelectChain([
      { id: 1, userId: 5, scopes: ["read"], revokedAt: new Date(), expiresAt: null },
    ]);
    mockSelect.mockReturnValue(chain);
    // mock the touchLastUsed update chain (won't be called for revoked)
    const updateChain = makeUpdateChain();
    mockUpdate.mockReturnValue(updateChain);

    const result = await validateApiKey("c".repeat(64));
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("revoked");
  });

  it("returns expired when expiresAt is in the past", async () => {
    const pastDate = new Date(Date.now() - 1000);
    const chain = makeSelectChain([
      { id: 1, userId: 5, scopes: ["read"], revokedAt: null, expiresAt: pastDate },
    ]);
    mockSelect.mockReturnValue(chain);
    const updateChain = makeUpdateChain();
    mockUpdate.mockReturnValue(updateChain);

    const result = await validateApiKey("d".repeat(64));
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("expired");
  });

  it("returns valid with userId and scopes for a good key", async () => {
    const futureDate = new Date(Date.now() + 86400_000);
    const chain = makeSelectChain([
      { id: 3, userId: 7, scopes: ["read", "write"], revokedAt: null, expiresAt: futureDate },
    ]);
    mockSelect.mockReturnValue(chain);
    const updateChain = makeUpdateChain();
    mockUpdate.mockReturnValue(updateChain);

    const result = await validateApiKey("e".repeat(64));
    expect(result.valid).toBe(true);
    expect(result.userId).toBe(7);
    expect(result.scopes).toEqual(["read", "write"]);
    expect(result.keyId).toBe(3);
  });

  it("accepts a key with no expiry (expiresAt null)", async () => {
    const chain = makeSelectChain([
      { id: 4, userId: 2, scopes: ["admin"], revokedAt: null, expiresAt: null },
    ]);
    mockSelect.mockReturnValue(chain);
    const updateChain = makeUpdateChain();
    mockUpdate.mockReturnValue(updateChain);

    const result = await validateApiKey("f".repeat(64));
    expect(result.valid).toBe(true);
    expect(result.scopes).toEqual(["admin"]);
  });
});

// ─── revokeApiKey ─────────────────────────────────────────────────────────────

describe("revokeApiKey", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns false when db is unavailable", async () => {
    const { getDb } = await import("./db");
    vi.mocked(getDb).mockResolvedValueOnce(null as any);

    const result = await revokeApiKey(1, 1);
    expect(result).toBe(false);
  });

  it("returns true when key is successfully revoked", async () => {
    const updateChain = makeUpdateChain(1);
    mockUpdate.mockReturnValue(updateChain);

    const result = await revokeApiKey(5, 3);
    expect(result).toBe(true);
  });

  it("returns false when no rows were affected (key not found or wrong user)", async () => {
    const updateChain = makeUpdateChain(0);
    mockUpdate.mockReturnValue(updateChain);

    const result = await revokeApiKey(99, 3);
    expect(result).toBe(false);
  });
});

// ─── listApiKeys ──────────────────────────────────────────────────────────────

describe("listApiKeys", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns empty array when db is unavailable", async () => {
    const { getDb } = await import("./db");
    vi.mocked(getDb).mockResolvedValueOnce(null as any);

    const result = await listApiKeys(1);
    expect(result).toEqual([]);
  });

  it("returns empty array when no keys exist for user", async () => {
    const chain = makeSelectChain([]);
    mockSelect.mockReturnValue(chain);

    const result = await listApiKeys(1);
    expect(result).toEqual([]);
  });

  it("returns mapped ApiKeyRecord objects", async () => {
    const now = new Date();
    const chain = makeSelectChain([
      {
        id: 1,
        userId: 5,
        label: "My Key",
        scopes: ["read"],
        keyPrefix: "abcd1234",
        lastUsedAt: null,
        expiresAt: null,
        createdAt: now,
      },
      {
        id: 2,
        userId: 5,
        label: "Write Key",
        scopes: ["write"],
        keyPrefix: "efgh5678",
        lastUsedAt: now,
        expiresAt: null,
        createdAt: now,
      },
    ]);
    mockSelect.mockReturnValue(chain);

    const result = await listApiKeys(5);

    expect(result).toHaveLength(2);
    expect(result[0].id).toBe(1);
    expect(result[0].label).toBe("My Key");
    expect(result[0].scopes).toEqual(["read"]);
    expect(result[0].keyPrefix).toBe("abcd1234");
    expect(result[1].lastUsedAt).toEqual(now);
  });

  it("defaults scopes to empty array when null", async () => {
    const now = new Date();
    const chain = makeSelectChain([
      { id: 1, userId: 5, label: "Key", scopes: null, keyPrefix: "abc", lastUsedAt: null, expiresAt: null, createdAt: now },
    ]);
    mockSelect.mockReturnValue(chain);

    const result = await listApiKeys(5);
    expect(result[0].scopes).toEqual([]);
  });
});

// ─── touchLastUsed ────────────────────────────────────────────────────────────

describe("touchLastUsed", () => {
  beforeEach(() => vi.clearAllMocks());

  it("does nothing when db is unavailable", async () => {
    const { getDb } = await import("./db");
    vi.mocked(getDb).mockResolvedValueOnce(null as any);

    await expect(touchLastUsed(1)).resolves.toBeUndefined();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("calls update with lastUsedAt", async () => {
    const updateChain = makeUpdateChain(1);
    mockUpdate.mockReturnValue(updateChain);

    await touchLastUsed(3);

    expect(mockUpdate).toHaveBeenCalledOnce();
    expect(updateChain.set).toHaveBeenCalledWith(
      expect.objectContaining({ lastUsedAt: expect.any(Date) })
    );
  });
});
