/**
 * CopilotKit Runtime — Truth Desk (v1 API)
 *
 * Mounts a CopilotRuntime v1 Express handler at /api/copilot using the Manus
 * Forge OpenAI-compatible endpoint as the LLM backend.  9 deterministic tools
 * are wired to the Truth Desk engine — CopilotKit NEVER assigns verdicts.
 */
import OpenAI from "openai";
import {
  CopilotRuntime,
  OpenAIAdapter,
  copilotRuntimeNodeExpressEndpoint,
} from "@copilotkit/runtime";
import { type Request, type Response, Router } from "express";
import { ENV } from "./_core/env";
import {
  getAllGraphEntities,
  getClaimById,
  getClaimsByDocument,
  getDocumentById,
  getEntityClaimSummary,
  getGlobalPlatformStats,
  getGraphData,
  getRecentVerifiedClaims,
} from "./db";
import { verdictForClaim } from "./pdbAdapter";
import { searchUniProt } from "./uniprotAdapter";

// ─── Forge-backed OpenAI client ───────────────────────────────────────────────
// The Manus Forge API is OpenAI-compatible; we point the OpenAI client at it.
function buildForgeClient() {
  return new OpenAI({
    baseURL: `${ENV.forgeApiUrl}/v1`,
    apiKey: ENV.forgeApiKey,
  });
}

// ─── System prompt ────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are the Truth Desk AI assistant — a scientific claim verification copilot.

CRITICAL RULES:
1. You NEVER assign verdicts yourself. All verdicts come exclusively from the deterministic Truth Desk engine via tool calls.
2. When a user asks to verify a claim, ALWAYS call the verifyClaim action. Never state a verdict without calling the action first.
3. Present tool results faithfully. Do not editorialize or soften verdicts.
4. If a tool returns an error or insufficient evidence, say so clearly.
5. You can explain what a verdict means, but you cannot change it.

You have access to 9 actions:
- verifyClaim: Run the deterministic verdict engine on any scientific claim
- queryGraph: Search the knowledge graph for entities and claims
- getClaimsByEntity: Get all claims related to a specific entity name
- getDocumentStatus: Check the processing status of a submitted document
- getRecentClaims: Browse the latest verified claims in the corpus
- getPlatformStats: Get live platform statistics
- compareClaims: Compare two claims side-by-side by their IDs
- searchUniProt: Look up protein data directly from UniProt
- getGraphSummary: Get an overview of the knowledge graph

Always use actions to answer factual questions about scientific claims. Do not rely on your training data for specific molecular or clinical facts.`;

// ─── Actions ──────────────────────────────────────────────────────────────────

const actions = [
  {
    name: "verifyClaim",
    description:
      "Run the Truth Desk deterministic verdict engine on a scientific claim. Returns Supported, Contradicted, Partially Supported, Ambiguous, or Insufficient Evidence with source citations. ALWAYS call this before stating any verdict.",
    parameters: [
      {
        name: "claimText",
        type: "string" as const,
        description: "The scientific claim to verify, e.g. 'Lysozyme resolution is 1.5 Å'",
        required: true,
      },
      {
        name: "pdbId",
        type: "string" as const,
        description: "Optional: PDB ID if the claim references a specific structure",
        required: false,
      },
      {
        name: "proteinName",
        type: "string" as const,
        description: "Optional: the primary protein the claim is about",
        required: false,
      },
    ],
    handler: async (args: { [x: string]: string | number }) => {
      const { claimText, pdbId, proteinName } = args as unknown as { claimText: string; pdbId?: string; proteinName?: string };
      try {
        const result = await verdictForClaim({
          claimType: "general_molecular",
          pdbId: pdbId ?? null,
          proteinName: proteinName ?? null,
          extractedValue: claimText,
        });
        return {
          verdict: result.verdict,
          rationale: result.rationale,
          evidenceUrl: result.evidenceUrl ?? null,
          claimText,
        };
      } catch (err) {
        return {
          verdict: "error",
          rationale: `Verification engine error: ${err instanceof Error ? err.message : String(err)}`,
          evidenceUrl: null,
          claimText,
        };
      }
    },
  },

  {
    name: "queryGraph",
    description:
      "Search the Truth Desk knowledge graph for entities (proteins, genes, drugs, organisms) and their associated verified claims.",
    parameters: [
      {
        name: "query",
        type: "string" as const,
        description: "Natural language search query, e.g. 'lysozyme binding site'",
        required: true,
      },
      {
        name: "entityType",
        type: "string" as const,
        description: "Filter by entity type: protein, pdb_id, method, organism, ligand, author, concept, or any",
        required: false,
      },
      {
        name: "limit",
        type: "number" as const,
        description: "Maximum number of results (1-20, default 10)",
        required: false,
      },
    ],
    handler: async (args: { [x: string]: string | number }) => {
      const query = args.query as string;
      const entityType = args.entityType as string | undefined;
      const limit = (args.limit as number) ?? 10;
      try {
        const entities = await getAllGraphEntities(500);
        const q = query.toLowerCase();
        const filtered = entities
          .filter(e => {
            const typeMatch = !entityType || entityType === "any" || e.entityType === entityType;
            const nameMatch = e.canonicalName.toLowerCase().includes(q);
            return typeMatch && nameMatch;
          })
          .slice(0, Math.min(limit, 20));
        return {
          results: filtered.map(e => ({
            id: e.id,
            name: e.canonicalName,
            type: e.entityType,
            wikiPagePath: e.wikiPagePath ?? null,
          })),
          total: filtered.length,
          query,
        };
      } catch (err) {
        return { results: [], total: 0, query, error: String(err) };
      }
    },
  },

  {
    name: "getClaimsByEntity",
    description:
      "Get all claims in the Truth Desk corpus that mention a specific entity name (protein, gene, drug, PDB ID).",
    parameters: [
      {
        name: "entityName",
        type: "string" as const,
        description: "The entity name, e.g. 'lysozyme' or 'BRCA1' or '1LYZ'",
        required: true,
      },
      {
        name: "limit",
        type: "number" as const,
        description: "Maximum number of claims to return (default 20)",
        required: false,
      },
    ],
    handler: async (args: { [x: string]: string | number }) => {
      const entityName = args.entityName as string;
      const limit = (args.limit as number) ?? 20;
      try {
        const summary = await getEntityClaimSummary(entityName);
        return {
          entityName,
          supported: summary.supported,
          contradicted: summary.contradicted,
          ambiguous: summary.ambiguous,
          total: summary.total,
          lastUpdated: summary.lastUpdated,
        };
      } catch (err) {
        return {
          entityName,
          supported: 0,
          contradicted: 0,
          ambiguous: 0,
          total: 0,
          lastUpdated: null,
          error: String(err),
        };
      }
    },
  },

  {
    name: "getDocumentStatus",
    description:
      "Check the processing status of a document submitted to Truth Desk for claim extraction and verification.",
    parameters: [
      {
        name: "documentId",
        type: "number" as const,
        description: "The numeric document ID",
        required: true,
      },
    ],
    handler: async (args: { [x: string]: string | number }) => {
      const documentId = args.documentId as number;
      try {
        const doc = await getDocumentById(documentId);
        if (!doc) return { found: false, documentId };
        const claims = await getClaimsByDocument(documentId);
        const verdictCounts = claims.reduce(
          (acc: Record<string, number>, c: { verdict: string | null }) => {
            const v = c.verdict ?? "pending";
            acc[v] = (acc[v] ?? 0) + 1;
            return acc;
          },
          {} as Record<string, number>
        );
        return {
          found: true,
          documentId,
          title: doc.title ?? "Untitled",
          status: doc.status,
          claimCount: claims.length,
          verdictCounts,
          submittedAt: doc.createdAt,
        };
      } catch (err) {
        return { found: false, documentId, error: String(err) };
      }
    },
  },

  {
    name: "getRecentClaims",
    description:
      "Browse the most recently verified claims in the Truth Desk corpus across all verticals.",
    parameters: [
      {
        name: "limit",
        type: "number" as const,
        description: "Number of recent claims to return (default 10, max 50)",
        required: false,
      },
      {
        name: "verdictFilter",
        type: "string" as const,
        description: "Filter by verdict: all, Supported, Contradicted, Partially Supported, Ambiguous",
        required: false,
      },
    ],
    handler: async (args: { [x: string]: string | number }) => {
      const limit = (args.limit as number) ?? 10;
      const verdictFilter = (args.verdictFilter as string) ?? "all";
      try {
        const rows = await getRecentVerifiedClaims(200);
        const filtered =
          verdictFilter === "all"
            ? rows
            : rows.filter(
                (r: { claim: { verdict: string | null } }) =>
                  r.claim.verdict === verdictFilter
              );
        return {
          claims: filtered.slice(0, Math.min(limit, 50)).map(
            (r: {
              claim: {
                id: number;
                claimText: string;
                verdict: string | null;
                confidenceScore: number | null;
                createdAt: Date;
              };
              documentId: number;
            }) => ({
              id: r.claim.id,
              claimText: r.claim.claimText,
              verdict: r.claim.verdict,
              confidenceScore: r.claim.confidenceScore,
              documentId: r.documentId,
              createdAt: r.claim.createdAt,
            })
          ),
          total: filtered.length,
        };
      } catch (err) {
        return { claims: [], total: 0, error: String(err) };
      }
    },
  },

  {
    name: "getPlatformStats",
    description:
      "Get live statistics about the Truth Desk platform: total documents, claims, supported verdicts, and verified sources.",
    parameters: [],
    handler: async () => {
      try {
        return await getGlobalPlatformStats();
      } catch (err) {
        return { error: String(err) };
      }
    },
  },

  {
    name: "compareClaims",
    description:
      "Compare two claims side-by-side, showing their verdicts, confidence scores, and evidence sources.",
    parameters: [
      {
        name: "claimIdA",
        type: "number" as const,
        description: "ID of the first claim",
        required: true,
      },
      {
        name: "claimIdB",
        type: "number" as const,
        description: "ID of the second claim",
        required: true,
      },
    ],
    handler: async (args: { [x: string]: string | number }) => {
      const claimIdA = args.claimIdA as number;
      const claimIdB = args.claimIdB as number;
      try {
        const [a, b] = await Promise.all([getClaimById(claimIdA), getClaimById(claimIdB)]);
        return {
          claimA: a
            ? {
                id: a.id,
                claimText: a.claimText,
                verdict: a.verdict,
                confidenceScore: a.confidenceScore,
                pdbId: a.pdbId,
              }
            : null,
          claimB: b
            ? {
                id: b.id,
                claimText: b.claimText,
                verdict: b.verdict,
                confidenceScore: b.confidenceScore,
                pdbId: b.pdbId,
              }
            : null,
        };
      } catch (err) {
        return { claimA: null, claimB: null, error: String(err) };
      }
    },
  },

  {
    name: "searchUniProt",
    description:
      "Search UniProt directly for protein data: sequence, function, organism, and associated diseases.",
    parameters: [
      {
        name: "query",
        type: "string" as const,
        description: "Protein name, gene name, or UniProt accession, e.g. 'P00698' or 'lysozyme human'",
        required: true,
      },
      {
        name: "limit",
        type: "number" as const,
        description: "Maximum number of results (default 5)",
        required: false,
      },
    ],
    handler: async (args: { [x: string]: string | number }) => {
      const query = args.query as string;
      const limit = (args.limit as number) ?? 5;
      try {
        return await searchUniProt(query, limit);
      } catch (err) {
        return { found: false, entries: [], error: String(err) };
      }
    },
  },

  {
    name: "getGraphSummary",
    description:
      "Get a high-level overview of the Truth Desk knowledge graph: entity counts by type and top entities.",
    parameters: [],
    handler: async () => {
      try {
        const data = await getGraphData();
        const docs = data.documents ?? [];
        const clms = data.claims ?? [];
        return {
          documentCount: docs.length,
          claimCount: clms.length,
          statusBreakdown: docs.reduce(
            (acc: Record<string, number>, d: { status: string }) => {
              acc[d.status] = (acc[d.status] ?? 0) + 1;
              return acc;
            },
            {} as Record<string, number>
          ),
          verdictBreakdown: clms.reduce(
            (acc: Record<string, number>, c: { verdict: string | null }) => {
              const v = c.verdict ?? "pending";
              acc[v] = (acc[v] ?? 0) + 1;
              return acc;
            },
            {} as Record<string, number>
          ),
        };
      } catch (err) {
        return {
          documentCount: 0,
          claimCount: 0,
          statusBreakdown: {},
          verdictBreakdown: {},
          error: String(err),
        };
      }
    },
  },
];

// ─── Express handler factory ──────────────────────────────────────────────────

export function createCopilotRouter(): Router {
  const openaiClient = buildForgeClient();
  const serviceAdapter = new OpenAIAdapter({
    openai: openaiClient,
    model: "gemini-2.5-flash",
  });

  const runtime = new CopilotRuntime({
    actions,
  });

  const handler = copilotRuntimeNodeExpressEndpoint({
    runtime,
    serviceAdapter,
    endpoint: "/api/copilot",
  });

  const router = Router();
  // The hono app uses basePath: '/api/copilot' internally and checks the full
  // path from req.url. If we mount at '/api/copilot', Express strips that prefix
  // and hono sees '/' which doesn't match its basePath check, returning 404.
  // Solution: mount at root but guard with a path check so non-copilot routes
  // fall through to the next Express handler.
  router.use((req, res, next) => {
    const url = req.originalUrl ?? req.url ?? "";
    if (!url.startsWith("/api/copilot")) {
      return next();
    }
    return (handler as (req: Request, res: Response) => void)(req, res);
  });
  return router;
}
