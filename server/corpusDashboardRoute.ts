/**
 * corpusDashboardRoute.ts
 *
 * GET /api/public/corpus-dashboard
 *
 * Returns a unified snapshot of corpus health, verdict distribution,
 * MRAgent cache stats, SIA generation history, and vertical breakdown.
 * No authentication required — public read-only endpoint.
 *
 * Response shape: CorpusDashboardSnapshot
 *
 * Design constraints: max 200 lines, max 20 lines/function, max 3 params
 */
import type { Express, Request, Response } from "express";
import {
  getGlobalPlatformStats,
  getCorpusGrowthStats,
  getVerticalStats,
  getContradictionRelations,
} from "./db";
import { getMemoryStats } from "./mrAgentClient";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Cache-Control": "public, max-age=60, s-maxage=60, stale-while-revalidate=300",
  "Content-Type": "application/json; charset=utf-8",
};

/** Fallback mock data used when the database is unavailable (e.g. static deploy) */
function getMockSnapshot() {
  return {
    ok: true,
    live: false,
    generatedAt: new Date().toISOString(),
    platform: {
      totalDocuments: 334,
      totalClaims: 8847,
      supportedVerdicts: 668,
      verifiedSources: 4,
    },
    growth: {
      claimsToday: 3,
      papersToday: 2,
      graphNodesToday: 12,
      totalClaims: 8847,
      totalGraphNodes: 2431,
      totalGraphEdges: 6204,
    },
    verdictDistribution: {
      supported: 668,
      partiallySupported: 89,
      contradicted: 41,
      insufficientEvidence: 8049,
    },
    verticals: [
      { domain: "structural_biology", totalClaims: 3241, supportedClaims: 312 },
      { domain: "salmon_biotech", totalClaims: 1820, supportedClaims: 198 },
      { domain: "clinical_trials", totalClaims: 1104, supportedClaims: 87 },
      { domain: "chemistry", totalClaims: 892, supportedClaims: 41 },
      { domain: "genomics", totalClaims: 671, supportedClaims: 30 },
    ],
    mragent: {
      totalEpisodes: 0,
      cacheHitRate: 0,
      available: false,
    },
    sia: {
      generation: 1,
      lastRunAt: null,
      f1Before: null,
      f1After: null,
    },
    recentContradictions: [],
  };
}

async function buildLiveSnapshot() {
  const [platform, growth, verticals] = await Promise.all([
    getGlobalPlatformStats(),
    getCorpusGrowthStats(),
    getVerticalStats(),
  ]);

  // Verdict distribution from platform stats
  const verdictDistribution = {
    supported: platform.supportedVerdicts,
    partiallySupported: 0,
    contradicted: 0,
    insufficientEvidence: Math.max(0, platform.totalClaims - platform.supportedVerdicts),
  };

  // MRAgent memory stats (non-blocking — fails gracefully)
  let mragentStats = { totalEpisodes: 0, cacheHitRate: 0, available: false };
  try {
    const stats = await getMemoryStats();
    if (stats) {
      mragentStats = {
        totalEpisodes: stats.episode_count ?? 0,
        cacheHitRate: stats.cache_hit_rate ?? 0,
        available: true,
      };
    }
  } catch {
    // MRAgent offline — continue with defaults
  }

  // Recent contradictions (non-blocking)
  let recentContradictions: unknown[] = [];
  try {
    recentContradictions = (await getContradictionRelations()) ?? [];
  } catch {
    // DB unavailable — continue
  }

  // Top 5 verticals by claim count
  const topVerticals = [...verticals]
    .sort((a, b) => b.totalClaims - a.totalClaims)
    .slice(0, 5)
    .map((v) => ({
      domain: v.domain,
      totalClaims: v.totalClaims,
      supportedClaims: v.supportedClaims,
    }));

  return {
    ok: true,
    live: true,
    generatedAt: new Date().toISOString(),
    platform,
    growth,
    verdictDistribution,
    verticals: topVerticals,
    mragent: mragentStats,
    sia: { generation: 1, lastRunAt: null, f1Before: null, f1After: null },
    recentContradictions,
  };
}

export function registerCorpusDashboardRoute(app: Express): void {
  app.options("/api/public/corpus-dashboard", (_req, res) => {
    res.set(CORS_HEADERS).status(204).end();
  });

  app.get(
    "/api/public/corpus-dashboard",
    async (_req: Request, res: Response) => {
      try {
        const snapshot = await buildLiveSnapshot();
        res.set(CORS_HEADERS).json(snapshot);
      } catch {
        // Fall back to mock data so the dashboard always renders
        res.set(CORS_HEADERS).json(getMockSnapshot());
      }
    }
  );
}
