/**
 * epistemicProvenance.ts — Phase 121
 *
 * Epistemic Provenance Chain
 *
 * Exposes two query helpers and one HTTP route:
 *
 *   getDistortionChain(claimId)
 *     — Returns ordered hops from citationEdges where originalClaimId = claimId,
 *       sorted by hopNumber ASC. Each hop shows how the claim was cited and whether
 *       it was distorted (amplified, scope-drifted, fabricated, etc.).
 *
 *   getSemanticNeighbours(claimId, limit)
 *     — Returns top-N semantic_similar edges from graphClaimEdges where
 *       sourceClaimId = claimId OR targetClaimId = claimId, sorted by weight DESC.
 *       Each neighbour is normalised to { neighbourClaimId, weight, relationType }.
 *
 *   buildProvenanceResult(claimId, hops, neighbours)
 *     — Pure function that assembles the full provenance object from query results.
 *
 *   registerProvenanceRoute(app)
 *     — Registers GET /api/public/provenance/:claimId and OPTIONS preflight.
 *
 *   PROVENANCE_TOOLS_MANIFEST
 *     — MCP tool descriptor for get_provenance (used by mcpServer.ts).
 */

import type { Express, Request, Response } from "express";
import { eq, or, desc, asc } from "drizzle-orm";
import { getDb, getClaimById } from "./db";
import { citationEdges, graphClaimEdges } from "../drizzle/schema";
import { logger } from "./logger";

const log = logger("epistemicProvenance");

// ─── CORS headers (same pattern as claimsRoutes.ts) ──────────────────────────
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Cache-Control": "public, max-age=60, s-maxage=60",
  "Content-Type": "application/json; charset=utf-8",
  "X-Content-Type-Options": "nosniff",
};

// ─── Types ────────────────────────────────────────────────────────────────────

export type DistortionType =
  | "faithful"
  | "amplification"
  | "selective_omission"
  | "scope_drift"
  | "causal_overclaim"
  | "fabrication"
  | "unknown";

export interface DistortionHop {
  hopNumber: number;
  targetPmid: string | null;
  targetTitle: string | null;
  targetDoi: string | null;
  distortionScore: number;
  distortionType: DistortionType;
  distortionRationale: string | null;
  citingClaimText: string | null;
  detectedAt: Date;
}

export interface SemanticNeighbour {
  neighbourClaimId: number;
  weight: number;
  relationType: string;
}

export interface ProvenanceResult {
  claimId: number;
  hopCount: number;
  maxDistortionScore: number;
  distortionChain: DistortionHop[];
  semanticNeighbours: SemanticNeighbour[];
  generatedAt: string;
}

// ─── getDistortionChain ───────────────────────────────────────────────────────

export async function getDistortionChain(claimId: number): Promise<DistortionHop[]> {
  const db = await getDb();
  if (!db) return [];

  const rows = await db
    .select()
    .from(citationEdges)
    .where(eq(citationEdges.originalClaimId, claimId))
    .orderBy(asc(citationEdges.hopNumber));

  return rows.map((row) => ({
    hopNumber: row.hopNumber,
    targetPmid: row.targetPmid ?? null,
    targetTitle: row.targetTitle ?? null,
    targetDoi: row.targetDoi ?? null,
    distortionScore: row.distortionScore ?? 0,
    distortionType: (row.distortionType ?? "unknown") as DistortionType,
    distortionRationale: row.distortionRationale ?? null,
    citingClaimText: row.citingClaimText ?? null,
    detectedAt: row.detectedAt,
  }));
}

// ─── getSemanticNeighbours ────────────────────────────────────────────────────

export async function getSemanticNeighbours(
  claimId: number,
  limit: number
): Promise<SemanticNeighbour[]> {
  const db = await getDb();
  if (!db) return [];

  const rows = await db
    .select()
    .from(graphClaimEdges)
    .where(
      or(
        eq(graphClaimEdges.sourceClaimId, claimId),
        eq(graphClaimEdges.targetClaimId, claimId)
      )
    )
    .orderBy(desc(graphClaimEdges.weight))
    .limit(limit);

  return rows.map((row) => ({
    neighbourClaimId:
      row.sourceClaimId === claimId ? row.targetClaimId : row.sourceClaimId,
    weight: row.weight,
    relationType: row.relationType,
  }));
}

// ─── buildProvenanceResult ────────────────────────────────────────────────────

export function buildProvenanceResult(
  claimId: number,
  hops: DistortionHop[],
  neighbours: SemanticNeighbour[]
): ProvenanceResult {
  const maxDistortionScore =
    hops.length > 0 ? Math.max(...hops.map((h) => h.distortionScore)) : 0;

  return {
    claimId,
    hopCount: hops.length,
    maxDistortionScore,
    distortionChain: hops,
    semanticNeighbours: neighbours,
    generatedAt: new Date().toISOString(),
  };
}

// ─── HTTP Route ───────────────────────────────────────────────────────────────

export function registerProvenanceRoute(app: Express): void {
  app.options("/api/public/provenance/:claimId", (_req, res) => {
    res.set(CORS_HEADERS).status(204).end();
  });

  app.get("/api/public/provenance/:claimId", async (req: Request, res: Response) => {
    const claimId = parseInt(req.params.claimId ?? "", 10);
    if (isNaN(claimId) || claimId <= 0) {
      res.set(CORS_HEADERS).status(400).json({ error: "Invalid claim ID — must be a positive integer" });
      return;
    }

    const limitParam = req.query.limit;
    const limit =
      typeof limitParam === "string" && !isNaN(parseInt(limitParam, 10))
        ? Math.min(Math.max(parseInt(limitParam, 10), 1), 50)
        : 10;

    const claim = await getClaimById(claimId);
    if (!claim) {
      res.set(CORS_HEADERS).status(404).json({ error: "Claim not found" });
      return;
    }

    const [hops, neighbours] = await Promise.all([
      getDistortionChain(claimId),
      getSemanticNeighbours(claimId, limit),
    ]);

    const provenance = buildProvenanceResult(claimId, hops, neighbours);

    log.info("provenance fetched", { claimId, hopCount: hops.length, neighbourCount: neighbours.length });

    res.set(CORS_HEADERS).status(200).json({
      claim_id: provenance.claimId,
      hop_count: provenance.hopCount,
      max_distortion_score: provenance.maxDistortionScore,
      distortion_chain: provenance.distortionChain.map((h) => ({
        hop_number: h.hopNumber,
        target_pmid: h.targetPmid,
        target_title: h.targetTitle,
        target_doi: h.targetDoi,
        distortion_score: h.distortionScore,
        distortion_type: h.distortionType,
        distortion_rationale: h.distortionRationale,
        citing_claim_text: h.citingClaimText,
        detected_at: h.detectedAt.toISOString(),
      })),
      semantic_neighbours: provenance.semanticNeighbours.map((n) => ({
        neighbour_claim_id: n.neighbourClaimId,
        weight: n.weight,
        relation_type: n.relationType,
      })),
      generated_at: provenance.generatedAt,
    });
  });
}

// ─── MCP Tool Manifest ────────────────────────────────────────────────────────

export const PROVENANCE_TOOLS_MANIFEST = [
  {
    name: "get_provenance",
    description:
      "Retrieve the epistemic provenance chain for a verified claim. Returns the distortion chain (how the claim was cited and potentially distorted across the literature) and semantic neighbours (closely related claims in the knowledge graph). Use this to understand how a claim evolved through citation and to identify related or contradicting claims.",
    inputSchema: {
      type: "object",
      properties: {
        claim_id: {
          type: ["integer", "string"],
          description: "The claim ID (integer or numeric string)",
        },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 50,
          description: "Max semantic neighbours to return (default 10)",
        },
      },
      required: ["claim_id"],
      additionalProperties: false,
    },
  },
] as const;
