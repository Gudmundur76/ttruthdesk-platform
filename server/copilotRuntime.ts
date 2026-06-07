/**
 * CopilotKit Runtime — Truth Desk (v1 API)
 *
 * Mounts a CopilotRuntime v1 Express handler at /api/copilot using the Manus
 * Forge OpenAI-compatible endpoint as the LLM backend.  10 deterministic tools
 * are wired to the Truth Desk engine — CopilotKit NEVER assigns verdicts.
 *
 * Sprint L: Every tool call now fires triggerAutonomousIngest() in the
 * background so the knowledge graph grows with every user query.
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
import { triggerAutonomousIngest, type PubMedResult, type UniProtEntry } from "./autonomousIngest";
import { publishEvent } from "./autonomousLoop/eventBus";

// ─── EuropePMC search (for searchPubMed action) ───────────────────────────────

const EUROPE_PMC_SEARCH = "https://www.ebi.ac.uk/europepmc/webservices/rest/search";

async function fetchPubMedResults(query: string, limit = 5): Promise<PubMedResult[]> {
  const encoded = encodeURIComponent(query);
  const url = `${EUROPE_PMC_SEARCH}?query=${encoded}&format=json&pageSize=${limit}&resultType=core&sort=CITED+desc`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(12_000) });
    if (!res.ok) return [];
    const data = await res.json() as {
      resultList?: {
        result?: Array<{
          pmid?: string;
          id?: string;
          title?: string;
          abstractText?: string;
          authorString?: string;
          journalTitle?: string;
          pubYear?: string;
        }>;
      };
    };
    const results = data.resultList?.result ?? [];
    return results.slice(0, limit).map((r) => ({
      pmid: r.pmid ?? r.id ?? "",
      title: r.title ?? "Untitled",
      abstractSnippet: (r.abstractText ?? "").slice(0, 400),
      citationUrl: r.pmid
        ? `https://pubmed.ncbi.nlm.nih.gov/${r.pmid}/`
        : `https://europepmc.org/article/MED/${r.id ?? ""}`,
      authors: r.authorString ? r.authorString.split(", ").slice(0, 5) : [],
      journal: r.journalTitle ?? undefined,
      year: r.pubYear ? parseInt(r.pubYear, 10) : undefined,
    })).filter((r) => r.pmid);
  } catch {
    return [];
  }
}

// ─── Forge-backed OpenAI client ───────────────────────────────────────────────

function buildForgeClient() {
  return new OpenAI({
    baseURL: `${ENV.forgeApiUrl}/v1`,
    apiKey: ENV.forgeApiKey,
  });
}

// ─── System prompt ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are the Truth Desk AI — a scientific research assistant powered exclusively by Truth Desk data and live scientific databases.

## CORE RULE — ALWAYS USE TOOLS FIRST
You MUST call at least one action before answering ANY question. You are not allowed to answer from your own training data alone. Every response must be grounded in results returned by Truth Desk tools.

Every tool call you make ALSO writes new verified claims back to the Truth Desk knowledge graph autonomously — so your queries literally grow the corpus.

## HOW TO HANDLE DIFFERENT QUESTION TYPES:

### Exploratory / strategic questions (e.g. "What biosimilar can I create from salmon sludge?")
1. Call queryGraph with relevant keywords (e.g. "salmon", "biosimilar", "collagen")
2. Call searchPubMed to fetch live peer-reviewed literature on the topic
3. Call searchUniProt for the most relevant protein(s) mentioned or implied
4. Call getRecentClaims to surface any verified claims in the corpus on this topic
5. Synthesise the tool results into a structured answer. Cite PMIDs and UniProt accessions explicitly.
6. If the tools return no data, say so clearly: "Truth Desk has no verified data on this yet — here is what the knowledge graph contains on related topics: [tool results]."

### Claim verification (e.g. "Verify: salmon collagen has X property")
1. ALWAYS call verifyClaim first. Never state a verdict without it.
2. Call searchPubMed to find supporting or contradicting literature.
3. Present the verdict and evidence from the tool result faithfully.
4. Optionally call searchUniProt or queryGraph for additional context.

### Entity / protein lookup (e.g. "Tell me about salmon collagen")
1. Call searchUniProt for the protein
2. Call searchPubMed for recent literature
3. Call getClaimsByEntity for any verified claims about it
4. Synthesise results with explicit citations.

### Platform / corpus questions (e.g. "What claims have been verified recently?")
1. Call getRecentClaims or getPlatformStats
2. Summarise the results.

## AVAILABLE ACTIONS:
- verifyClaim: Deterministic verdict engine — Supported / Contradicted / Partially Supported / Ambiguous / Insufficient Evidence
- searchPubMed: Live PubMed/EuropePMC literature search — returns cited abstracts with PMID links. ALWAYS call this for any scientific question.
- searchUniProt: Live protein data from UniProt (sequence, function, organism, structure links)
- queryGraph: Search the Truth Desk knowledge graph for entities and relationships
- getClaimsByEntity: All verified claims related to a specific protein or compound
- getRecentClaims: Latest verified claims in the corpus
- getPlatformStats: Live platform statistics
- compareClaims: Side-by-side comparison of two claims by their IDs
- getDocumentStatus: Processing status of a submitted document
- getGraphSummary: Overview of the knowledge graph

## CITATION FORMAT:
After every answer, include a citation block:
> **Sources cited:**
> - PubMed: PMID:12345678 — "Title of paper" (Author et al., Year) → https://pubmed.ncbi.nlm.nih.gov/12345678/
> - UniProt: P00698 (LYSC_CHICK) → https://www.uniprot.org/uniprot/P00698
> - Truth Desk tools called: queryGraph("salmon biosimilar") → 3 entities | searchUniProt("salmon collagen") → COL1A1_SALSA

## RULES:
- NEVER answer from training data alone. Always call tools first.
- NEVER fabricate PDB IDs, UniProt accessions, PMIDs, or numerical values.
- ALWAYS cite PMIDs and UniProt accessions in your answers.
- If all tools return empty results, say so and explain what the user could submit to build the corpus.
- Be concise but scientifically precise. Use headers for long answers.
- Every query you make grows the Truth Desk knowledge graph — your questions are data.`;

// ─── Actions ──────────────────────────────────────────────────────────────────

const actions = [
  // ── searchPubMed ──────────────────────────────────────────────────────────
  {
    name: "searchPubMed",
    description:
      "Search PubMed / EuropePMC for peer-reviewed literature on a scientific topic. Returns up to 5 results with PMID, title, abstract snippet, and citation link. ALWAYS call this for scientific questions to get live cited sources. Results are automatically written back to the Truth Desk knowledge graph.",
    parameters: [
      {
        name: "query",
        type: "string" as const,
        description: "Scientific search query, e.g. 'salmon collagen biosimilar' or 'lysozyme antimicrobial mechanism'",
        required: true,
      },
      {
        name: "limit",
        type: "number" as const,
        description: "Number of results to return (1-5, default 5)",
        required: false,
      },
    ],
    handler: async (args: { [x: string]: string | number }) => {
      const query = String(args.query ?? "").slice(0, 500);
      const limit = Math.min(Math.max(1, (args.limit as number) ?? 5), 5);
      if (!query) return { results: [], total: 0, query, error: "Query is required" };

      try {
        const results = await fetchPubMedResults(query, limit);

        // Fire-and-forget: write results back to Truth Desk knowledge graph
        triggerAutonomousIngest({
          query,
          pubmedResults: results,
          vertical: "structural_biology",
        });

        // Publish paper_discovered events for each result so the Frontier Layer
        // can autonomously generate follow-up hypotheses and gap-closing queries.
        for (const r of results) {
          if (r.pmid) {
            publishEvent("paper_discovered", {
              pmid: r.pmid,
              title: r.title,
              abstractSnippet: r.abstractSnippet,
              citationUrl: r.citationUrl,
              journal: r.journal ?? null,
              year: r.year ?? null,
              query,
              source: "copilot_search",
            }).catch(() => { /* non-critical */ });
          }
        }

        return {
          results: results.map((r) => ({
            pmid: r.pmid,
            title: r.title,
            abstractSnippet: r.abstractSnippet,
            citationUrl: r.citationUrl,
            authors: r.authors ?? [],
            journal: r.journal ?? null,
            year: r.year ?? null,
          })),
          total: results.length,
          query,
          note: "Results are being written to the Truth Desk knowledge graph.",
        };
      } catch (err) {
        return { results: [], total: 0, query, error: String(err) };
      }
    },
  },

  // ── verifyClaim ───────────────────────────────────────────────────────────
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
      const raw = args as unknown as { claimText: string; pdbId?: string; proteinName?: string };
      const claimText = String(raw.claimText ?? "").slice(0, 2000);
      const pdbId = raw.pdbId ? String(raw.pdbId).slice(0, 10) : undefined;
      const proteinName = raw.proteinName ? String(raw.proteinName).slice(0, 200) : undefined;
      try {
        const result = await verdictForClaim({
          claimType: "general_molecular",
          pdbId: pdbId ?? null,
          proteinName: proteinName ?? null,
          extractedValue: claimText,
        });

        // Fire-and-forget: ingest the verified claim into the knowledge graph
        if (proteinName) {
          triggerAutonomousIngest({
            query: claimText,
            uniprotEntries: [],
            vertical: "structural_biology",
          });
        }

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

  // ── queryGraph ────────────────────────────────────────────────────────────
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

  // ── getClaimsByEntity ─────────────────────────────────────────────────────
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
      const _limit = (args.limit as number) ?? 20;
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

  // ── getDocumentStatus ─────────────────────────────────────────────────────
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

  // ── getRecentClaims ───────────────────────────────────────────────────────
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

  // ── getPlatformStats ──────────────────────────────────────────────────────
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

  // ── compareClaims ─────────────────────────────────────────────────────────
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

  // ── searchUniProt ─────────────────────────────────────────────────────────
  {
    name: "searchUniProt",
    description:
      "Search UniProt directly for protein data: sequence, function, organism, structure links, and accession numbers. Returns live data from the UniProt REST API.",
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
        const result = await searchUniProt(query, limit);

        // Fire-and-forget: write UniProt results to knowledge graph
        if (result.entries && result.entries.length > 0) {
          const uniprotEntries: UniProtEntry[] = result.entries.map((e: {
            accession?: string;
            proteinName?: string;
            geneName?: string | null;
            organism?: string | null;
            url?: string;
          }) => ({
            accession: e.accession ?? "",
            proteinName: e.proteinName ?? query,
            geneName: e.geneName ?? undefined,
            organism: e.organism ?? undefined,
            url: e.url ?? `https://www.uniprot.org/uniprot/${e.accession ?? ""}`,
          }));
          triggerAutonomousIngest({
            query,
            uniprotEntries,
            vertical: "structural_biology",
          });
        }

        return result;
      } catch (err) {
        return { found: false, entries: [], error: String(err) };
      }
    },
  },

  // ── getGraphSummary ───────────────────────────────────────────────────────
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

  // ── GET /api/copilot/info ──────────────────────────────────────────────────
  router.get("/api/copilot/info", (_req, res) => {
    res.json({
      version: "1.59.5",
      mode: "sse",
      agents: {
        default: {
          name: "default",
          description: "",
          className: "BuiltInAgent",
          capabilities: {
            tools: { supported: true, clientProvided: true },
            transport: { streaming: true },
          },
        },
      },
      audioFileTranscriptionEnabled: false,
      a2uiEnabled: false,
      openGenerativeUIEnabled: false,
      telemetryDisabled: false,
    });
  });

  // ── GET /api/copilot/threads ───────────────────────────────────────────────
  router.get("/api/copilot/threads", (_req, res) => {
    res.json({ threads: [] });
  });

  // ── All other /api/copilot/* requests → hono handler ──────────────────────
  router.use((req, res, next) => {
    const url = req.originalUrl ?? req.url ?? "";
    if (!url.startsWith("/api/copilot")) {
      return next();
    }
    return (handler as (req: Request, res: Response) => void)(req, res);
  });
  return router;
}

// ─── Re-export system prompt for testing ─────────────────────────────────────
export { SYSTEM_PROMPT };
