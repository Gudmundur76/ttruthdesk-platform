/**
 * apiKeyService.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Manages API keys for programmatic access to the Truth Desk API.
 *
 * Security model:
 *   - Raw key is generated as 32 random bytes (hex-encoded, 64 chars)
 *   - Only the SHA-256 hash is stored in the DB
 *   - The raw key is returned ONCE at creation time and never again
 *   - The first 8 chars of the raw key are stored as keyPrefix for identification
 *
 * API:
 *   generateApiKey(opts)           — create a new key, return raw key once
 *   validateApiKey(rawKey)         — verify key and return userId + scopes
 *   revokeApiKey(keyId, userId)    — soft-delete by setting revokedAt
 *   listApiKeys(userId)            — list all non-revoked keys for a user
 *   touchLastUsed(keyId)           — update lastUsedAt (fire-and-forget)
 */

import { createHash, randomBytes } from "crypto";
import type { ResultSetHeader } from "mysql2";
import { getDb } from "./db";
import { apiKeys } from "../drizzle/schema";
import { eq, and, isNull } from "drizzle-orm";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ApiKeyScope = "read" | "write" | "admin";

export interface GenerateApiKeyOpts {
  userId: number;
  label: string;
  scopes: ApiKeyScope[];
  expiresAt?: Date;
}

export interface GenerateApiKeyResult {
  id: number;
  rawKey: string;       // shown ONCE — user must copy it
  keyPrefix: string;    // first 8 chars, safe to show later
  label: string;
  scopes: ApiKeyScope[];
  createdAt: Date;
}

export interface ApiKeyRecord {
  id: number;
  userId: number;
  label: string;
  scopes: ApiKeyScope[];
  keyPrefix: string;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  createdAt: Date;
}

export interface ValidateApiKeyResult {
  valid: boolean;
  keyId?: number;
  userId?: number;
  scopes?: ApiKeyScope[];
  reason?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function hashKey(rawKey: string): string {
  return createHash("sha256").update(rawKey).digest("hex");
}

function generateRawKey(): string {
  return randomBytes(32).toString("hex");
}

// ─── Generate a new API key ───────────────────────────────────────────────────

export async function generateApiKey(opts: GenerateApiKeyOpts): Promise<GenerateApiKeyResult | null> {
  const db = await getDb();
  if (!db) return null;

  const { userId, label, scopes, expiresAt } = opts;

  if (!label.trim()) throw new Error("Label must not be empty");
  if (scopes.length === 0) throw new Error("At least one scope is required");

  const rawKey = generateRawKey();
  const keyHash = hashKey(rawKey);
  const keyPrefix = rawKey.slice(0, 8);

  const result = await db.insert(apiKeys).values({
    userId,
    keyHash,
    label: label.trim(),
    scopes: scopes as string[],
    keyPrefix,
    expiresAt: expiresAt ?? null,
  });

  const insertId = (result as unknown as ResultSetHeader).insertId ?? 0;

  return {
    id: insertId,
    rawKey,
    keyPrefix,
    label: label.trim(),
    scopes,
    createdAt: new Date(),
  };
}

// ─── In-memory rate limiter for validateApiKey ──────────────────────────────
// Sliding window: max 20 attempts per IP per 60 seconds.
// The key parameter is a string identifier (IP address or similar).

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_ATTEMPTS = 20;
const _rateLimitMap = new Map<string, number[]>();

export function checkApiKeyRateLimit(identifier: string): boolean {
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW_MS;
  const attempts = (_rateLimitMap.get(identifier) ?? []).filter((t) => t > windowStart);
  if (attempts.length >= RATE_LIMIT_MAX_ATTEMPTS) {
    return false; // rate limited
  }
  attempts.push(now);
  _rateLimitMap.set(identifier, attempts);
  // Periodically prune stale entries to prevent unbounded memory growth
  if (_rateLimitMap.size > 10_000) {
    Array.from(_rateLimitMap.entries()).forEach(([k, ts]: [string, number[]]) => {
      if (ts.every((t: number) => t <= windowStart)) _rateLimitMap.delete(k);
    });
  }
  return true; // allowed
}

// ─── Validate an API key ──────────────────────────────────────────────────────

export async function validateApiKey(rawKey: string, callerIp?: string): Promise<ValidateApiKeyResult> {
  // Rate-limit by caller IP if provided
  if (callerIp && !checkApiKeyRateLimit(callerIp)) {
    return { valid: false, reason: "rate_limited" };
  }

  if (!rawKey || rawKey.length !== 64) {
    return { valid: false, reason: "invalid_format" };
  }

  const db = await getDb();
  if (!db) return { valid: false, reason: "db_unavailable" };

  const keyHash = hashKey(rawKey);
  const now = new Date();

  const rows = await db
    .select()
    .from(apiKeys)
    .where(eq(apiKeys.keyHash, keyHash))
    .limit(1);

  if (rows.length === 0) {
    return { valid: false, reason: "not_found" };
  }

  const key = rows[0];

  if (key.revokedAt !== null) {
    return { valid: false, reason: "revoked" };
  }

  if (key.expiresAt !== null && key.expiresAt < now) {
    return { valid: false, reason: "expired" };
  }

  // Fire-and-forget last used update
  touchLastUsed(key.id).catch(() => {});

  return {
    valid: true,
    keyId: key.id,
    userId: key.userId,
    scopes: (key.scopes as ApiKeyScope[]) ?? [],
  };
}

// ─── Revoke an API key ────────────────────────────────────────────────────────

export async function revokeApiKey(keyId: number, userId: number): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;

  const result = await db
    .update(apiKeys)
    .set({ revokedAt: new Date() })
    .where(and(eq(apiKeys.id, keyId), eq(apiKeys.userId, userId)));

  return ((result as unknown as ResultSetHeader).affectedRows ?? 0) > 0;
}

// ─── List API keys for a user ─────────────────────────────────────────────────

export async function listApiKeys(userId: number): Promise<ApiKeyRecord[]> {
  const db = await getDb();
  if (!db) return [];

  const rows = await db
    .select({
      id: apiKeys.id,
      userId: apiKeys.userId,
      label: apiKeys.label,
      scopes: apiKeys.scopes,
      keyPrefix: apiKeys.keyPrefix,
      lastUsedAt: apiKeys.lastUsedAt,
      expiresAt: apiKeys.expiresAt,
      createdAt: apiKeys.createdAt,
    })
    .from(apiKeys)
    .where(and(eq(apiKeys.userId, userId), isNull(apiKeys.revokedAt)));

  return rows.map((r) => ({
    id: r.id,
    userId: r.userId,
    label: r.label,
    scopes: (r.scopes as ApiKeyScope[]) ?? [],
    keyPrefix: r.keyPrefix,
    lastUsedAt: r.lastUsedAt,
    expiresAt: r.expiresAt,
    createdAt: r.createdAt,
  }));
}

// ─── Touch lastUsedAt (fire-and-forget) ──────────────────────────────────────

export async function touchLastUsed(keyId: number): Promise<void> {
  const db = await getDb();
  if (!db) return;

  await db
    .update(apiKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiKeys.id, keyId));
}
