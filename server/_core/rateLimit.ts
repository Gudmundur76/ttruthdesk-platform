/**
 * server/_core/rateLimit.ts — Sprint 0 Fix 1
 *
 * DB-backed persistent rate limiter.
 * Uses the rate_limit_buckets table with upsert semantics.
 * Falls back to allow:true if the DB is unavailable (fail-open).
 */
import { eq, and } from "drizzle-orm";
import { getDb } from "../db";
import { rateLimitBuckets } from "../../drizzle/schema";

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

/**
 * Check and increment a rate limit bucket.
 *
 * @param key     - IP address or API key identifier
 * @param tier    - 'anon' | 'api' | 'v2'
 * @param limit   - max requests per window
 * @param windowMs - window size in milliseconds
 */
export async function checkRateLimit(
  key: string,
  tier: string,
  limit: number,
  windowMs: number
): Promise<RateLimitResult> {
  const now = Date.now();
  const fallback: RateLimitResult = {
    allowed: true,
    remaining: limit,
    resetAt: now + windowMs,
  };

  try {
    const db = await getDb();
    if (!db) return fallback;

    // Fetch existing bucket
    const rows = await db
      .select()
      .from(rateLimitBuckets)
      .where(
        and(eq(rateLimitBuckets.key, key), eq(rateLimitBuckets.tier, tier))
      );

    const existing = rows[0] as { count: number; resetAt: number } | undefined;

    let count: number;
    let resetAt: number;

    if (!existing || existing.resetAt <= now) {
      // New bucket or expired window — start fresh
      count = 1;
      resetAt = now + windowMs;
    } else {
      count = existing.count + 1;
      resetAt = existing.resetAt;
    }

    // Upsert the bucket
    await db
      .insert(rateLimitBuckets)
      .values({
        key,
        tier,
        count,
        resetAt,
        updatedAt: now,
      })
      .onDuplicateKeyUpdate({
        set: {
          count,
          resetAt,
          updatedAt: now,
        },
      });

    const allowed = count <= limit;
    const remaining = Math.max(0, limit - count);

    return { allowed, remaining, resetAt };
  } catch {
    // Fail-open: if DB is unavailable, allow the request
    return fallback;
  }
}
