/**
 * verticalFeedMerger.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Merges the static VERTICAL_FEED_CONFIGS with any active records from the
 * `vertical_configs` DB table (created via the Vertical Expansion Wizard).
 *
 * Rules:
 *  - DB records with `enabled = true` are included.
 *  - If a DB record has the same `domainKey` as a static config, the DB record
 *    OVERRIDES the static one (allows admins to update MeSH terms without a
 *    code deploy).
 *  - Static configs that have no DB override are included as-is.
 *  - DB records with `enabled = false` are excluded, even if a static config
 *    exists for the same domainKey.
 *
 * Called by pmcFeedJob on each run so new verticals are picked up immediately
 * after being created in the Wizard — no server restart required.
 */

import { getDb } from "./db";
import { verticalConfigs } from "../drizzle/schema";
import {} from "drizzle-orm";
import {
  VERTICAL_FEED_CONFIGS,
  type VerticalFeedConfig,
} from "./verticalFeedConfig";
import { logger, errData } from "./logger";
const log = logger("verticalFeedMerger");


/**
 * Returns the merged list of VerticalFeedConfig objects to use for the current
 * PMC feed run. Fetches DB records on every call (cheap — small table).
 */
export async function getActiveVerticalFeedConfigs(): Promise<
  VerticalFeedConfig[]
> {
  let dbConfigs: Array<{
    domainKey: string;
    displayName: string;
    meshTerms: string[];
    enabled: boolean;
    qualityTier: string;
  }> = [];

  try {
    const db = await getDb();
    if (!db) throw new Error("DB not available");
    dbConfigs = await db
      .select({
        domainKey: verticalConfigs.domainKey,
        displayName: verticalConfigs.displayName,
        meshTerms: verticalConfigs.meshTerms,
        enabled: verticalConfigs.enabled,
        qualityTier: verticalConfigs.qualityTier,
      })
      .from(verticalConfigs);
  } catch (err) {
    // If the table doesn't exist yet (first deploy before migration), fall back
    // to static configs gracefully.
    log.warn(
      "[VerticalFeedMerger] Could not query vertical_configs table, using static configs:",
      errData(err)
    );
    return VERTICAL_FEED_CONFIGS;
  }

  // Build a map of DB configs keyed by domainKey for O(1) lookup
  const dbMap = new Map<string, VerticalFeedConfig>();
  for (const row of dbConfigs) {
    if (!row.enabled) continue; // skip disabled verticals
    if (!row.meshTerms || row.meshTerms.length === 0) continue; // skip empty configs

    dbMap.set(row.domainKey, {
      domainKey: row.domainKey,
      displayName: row.displayName,
      // DB stores raw MeSH terms; wrap each in the standard PMC OA filter
      meshQueries: row.meshTerms.map(term =>
        term.includes("free full text[sb]")
          ? term
          : `${term} AND free full text[sb]`
      ),
      maxResultsPerQuery: 50,
    });
  }

  // Start with static configs, but let DB records override by domainKey
  const merged = new Map<string, VerticalFeedConfig>();

  for (const staticCfg of VERTICAL_FEED_CONFIGS) {
    // If DB has an enabled override for this key, use it; otherwise use static
    merged.set(
      staticCfg.domainKey,
      dbMap.get(staticCfg.domainKey) ?? staticCfg
    );
  }

  // Add any DB-only verticals (new ones created via the Wizard)
  for (const [key, cfg] of Array.from(dbMap.entries())) {
    if (!merged.has(key)) {
      merged.set(key, cfg);
    }
  }

  // Remove any domainKeys that are explicitly disabled in DB
  const disabledKeys = dbConfigs.filter(r => !r.enabled).map(r => r.domainKey);
  for (const key of disabledKeys) {
    merged.delete(key);
  }

  const result = Array.from(merged.values()) as VerticalFeedConfig[];
  log.info(
    `[VerticalFeedMerger] Active verticals: ${result.map(c => c.domainKey).join(", ")} (${result.length} total, ${dbMap.size} from DB)`
  );
  return result;
}
