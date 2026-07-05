/**
 * @file server/publicV1ClaimRoute.ts
 * @description Public API endpoint for fetching a single verified claim by ID.
 *   GET /api/v1/claim/:id
 *   Requires Bearer token auth (CITATION_API_KEY).
 *   Returns the claim, its verdict, confidence score, source citations, and full provenance.
 */
import type { Express, Request, Response } from "express";
import { ENV } from "./_core/env";
import { getClaimWithDocument, getCitationsByClaimId } from "./db";

// ─── Auth guard (same pattern as publicV1SearchRoute) ─────────────────────────
function checkAuth(req: Request, res: Response): boolean {
  if (!ENV.citationApiKey) {
    // If the server doesn't have an API key configured, deny all public API access
    res.status(503).json({ error: "API key not configured on server" });
    return false;
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing or invalid Authorization header" });
    return false;
  }

  const token = authHeader.split(" ")[1];
  if (token !== ENV.citationApiKey) {
    res.status(403).json({ error: "Invalid API key" });
    return false;
  }

  return true;
}

export function registerPublicV1ClaimRoute(app: Express) {
  app.get("/api/v1/claim/:id", async (req: Request, res: Response) => {
    // 1. Check Auth
    if (!checkAuth(req, res)) return;

    // 2. Parse ID
    const claimId = parseInt(req.params.id, 10);
    if (isNaN(claimId)) {
      return res
        .status(400)
        .json({ error: "Invalid claim ID format. Must be an integer." });
    }

    try {
      // 3. Fetch Claim and Document
      const data = await getClaimWithDocument(claimId);
      if (!data || !data.claim) {
        return res.status(404).json({ error: "Claim not found" });
      }

      // 4. Fetch Citations (Evidence)
      const citations = await getCitationsByClaimId(claimId);

      // 5. Format Response
      const claim = data.claim;

      // Parse source refs if available (MRAgent fields)
      let sourceRefs = [];
      try {
        if (claim.sourceRefs) {
          sourceRefs =
            typeof claim.sourceRefs === "string"
              ? JSON.parse(claim.sourceRefs)
              : claim.sourceRefs;
        }
      } catch (e) {
        console.error(
          `[v1/claim] Failed to parse sourceRefs for claim ${claimId}`,
          e
        );
      }

      // Parse PDB evidence if available
      let pdbEvidence = null;
      try {
        if (claim.pdbEvidenceRaw) {
          pdbEvidence =
            typeof claim.pdbEvidenceRaw === "string"
              ? JSON.parse(claim.pdbEvidenceRaw)
              : claim.pdbEvidenceRaw;
        }
      } catch (e) {
        console.error(
          `[v1/claim] Failed to parse pdbEvidenceRaw for claim ${claimId}`,
          e
        );
      }

      res.json({
        id: String(claim.id),
        claim: claim.claimText,
        domain: claim.claimType, // Stored in claimType field after Sprint 40

        // Core Verdict
        verdict: {
          status: claim.verdict,
          confidenceScore: claim.confidenceScore ?? 0,
          rationale: claim.verdictRationale,
          method: claim.verdictMethod ?? "unknown",
          compositeTruthScore: claim.compositeTruthScore ?? null,
          compositeTruthLabel: claim.compositeTruthLabel ?? null,
        },

        // Entity Information
        entities: {
          proteinName: claim.proteinName,
          pdbId: claim.pdbId,
          organism: claim.organism,
          ligand: claim.ligand,
          experimentalMethod: claim.experimentalMethod,
        },

        // Provenance & Citations
        evidence: {
          sourceDocumentId: String(claim.documentId),
          sourcePassage: claim.sourcePassage,
          passageConfidence: claim.passageConfidence,
          sourceRefs: sourceRefs,
          pdbEvidence: pdbEvidence,
          citations: citations.map(c => ({
            id: String(c.id),
            type: c.citationType,
            passageText: c.passageText,
            confidence: c.citationConfidence,
            createdAt: c.createdAt,
          })),
        },

        // Timestamps
        timestamps: {
          createdAt: claim.createdAt,
          updatedAt: claim.updatedAt,
          verifiedAt: claim.pdbEvidenceCheckedAt ?? claim.updatedAt,
        },
      });
    } catch (err) {
      console.error(`[v1/claim] Error fetching claim ${claimId}:`, err);
      res.status(500).json({ error: "Internal server error" });
    }
  });
}
