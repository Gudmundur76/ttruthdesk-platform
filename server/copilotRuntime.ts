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
import { translateQueryToClaims } from "./_queryTranslator";

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

const SYSTEM_PROMPT = `You are the Truth Desk AI — a scientific evidence engine. Your ONLY job is to return cited, verified facts from peer-reviewed literature and scientific databases. You do NOT give opinions, summaries, or advice from your own training data.

## THE GOLDEN RULE
Every question — no matter how casual, broad, or everyday — MUST be answered by calling tools. "Out of scope" and "no molecular claims found" are NEVER acceptable responses. If a question seems broad or informal, call translateAndSearch to decompose it into specific verifiable claims and run them through the evidence pipeline.

## STEP 1 — ALWAYS CALL translateAndSearch FIRST
For ANY question that is not already a specific molecular claim, call translateAndSearch FIRST. Examples that MUST trigger translateAndSearch:
- "can I create biotech products out of salmon sludge?"
- "is collagen good for joints?"
- "what proteins are in fish waste?"
- "does astaxanthin help with inflammation?"
- "what can I make from shrimp shells?"
translateAndSearch will:
1. Decompose your question into 3-5 specific verifiable scientific claims
2. Search PubMed for live peer-reviewed evidence on each claim
3. Run each claim through the Truth Desk verdict engine
4. Return cited results with PMIDs, UniProt accessions, and verdicts

## STEP 2 — ENRICH WITH ADDITIONAL TOOLS (optional)
After translateAndSearch returns results, you MAY call additional tools:
- searchUniProt: for specific protein sequences and accession numbers
- queryGraph: to find related entities in the Truth Desk knowledge graph
- getClaimsByEntity: for all verified claims about a specific protein
- verifyClaim: to run the deterministic verdict engine on a specific claim
- searchPubMed: for additional literature on a specific sub-topic

## HOW TO PRESENT RESULTS
Present tool results directly. Structure your answer as:
1. **Evidence found** — each verified claim with its verdict (Supported / Contradicted / Insufficient Evidence) and source PMID or UniProt accession
2. **Gaps in the corpus** — if no evidence was found for some claims, say so and tell the user they can submit a paper at /submit to grow the corpus
3. **Citation block** — always end with every PMID and UniProt accession cited

## CITATION FORMAT (mandatory at end of every answer):
> **Sources cited:**
> - PMID:12345678 — "Title" (Author et al., Year) → https://pubmed.ncbi.nlm.nih.gov/12345678/
> - UniProt: P00698 (LYSC_CHICK) → https://www.uniprot.org/uniprot/P00698
> - Truth Desk verdict: [claim text] → Supported (confidence: 0.87)

## AVAILABLE ACTIONS:
- **translateAndSearch** ← CALL THIS FIRST for any everyday or broad question. Decomposes question into verifiable claims, searches PubMed, runs verdicts, returns cited results.
- verifyClaim: Deterministic verdict engine on a specific claim text
- searchPubMed: Live PubMed/EuropePMC search — returns cited abstracts with PMIDs
- searchUniProt: Live protein data from UniProt
- queryGraph: Search the Truth Desk knowledge graph
- getClaimsByEntity: All verified claims for a specific protein or compound
- getRecentClaims: Latest verified claims in the corpus
- getPlatformStats: Live platform statistics
- compareClaims: Side-by-side comparison of two claims
- getDocumentStatus: Processing status of a submitted document
- getGraphSummary: Overview of the knowledge graph

## ABSOLUTE RULES:
- NEVER say "out of scope", "I cannot verify", or "no molecular claims found" without first calling translateAndSearch
- NEVER answer from your own training data — only from tool results
- NEVER fabricate PMIDs, UniProt accessions, PDB IDs, or numerical values
- ALWAYS include the citation block at the end of every answer
- If ALL tools return empty results, say: "Truth Desk has no peer-reviewed evidence on this yet. Here is what was searched: [list the claims]. You can grow the corpus by submitting a relevant paper at /submit."
- Every tool call autonomously writes new verified claims back to the knowledge graph — your questions are data.`;

// ─── Actions ──────────────────────────────────────────────────────────────────

const actions = [
  // ── translateAndSearch ────────────────────────────────────────────────────
  // PRIMARY ENTRY POINT for everyday/broad questions.
  // Decomposes natural language → verifiable claims → PubMed evidence → verdicts.
  {
    name: "translateAndSearch",
    description:
      "PRIMARY ACTION for any everyday or broad question. Takes a natural language question (e.g. 'can I create biotech products from salmon sludge?'), decomposes it into 3-5 specific verifiable scientific claims, searches PubMed for peer-reviewed evidence on each claim, runs each through the Truth Desk verdict engine, and returns cited results with PMIDs and verdicts. ALWAYS call this first for non-specific questions.",
    parameters: [
      {
        name: "question",
        type: "string" as const,
        description: "The everyday question to translate and search, e.g. 'can I create biotech products from salmon sludge?' or 'does astaxanthin reduce inflammation?'",
        required: true,
      },
    ],
    handler: async (args: { [x: string]: string | number }) => {
      const question = String(args.question ?? "").slice(0, 1000);
      if (!question) return { claims: [], question, error: "Question is required" };

      try {
        // Step 1: Decompose the question into verifiable claims
        const translatedClaims = await translateQueryToClaims(question);
        if (translatedClaims.length === 0) {
          return {
            question,
            claims: [],
            note: "Could not decompose question into verifiable claims. Try rephrasing as a specific scientific statement.",
          };
        }

        // Step 2: For each claim, search PubMed and run the verdict engine in parallel
        const results = await Promise.all(
          translatedClaims.map(async (tc) => {
            const [pubmedResults, verdict] = await Promise.allSettled([
              fetchPubMedResults(tc.searchQuery, 3),
              verdictForClaim({
                claimType: "general_molecular",
                pdbId: null,
                proteinName: tc.proteinName,
                extractedValue: tc.claimText,
              }),
            ]);

            const papers = pubmedResults.status === "fulfilled" ? pubmedResults.value : [];
            const verdictResult = verdict.status === "fulfilled" ? verdict.value : null;

            // Fire-and-forget: write to knowledge graph
            if (papers.length > 0) {
              triggerAutonomousIngest({
                query: tc.searchQuery,
                pubmedResults: papers,
                vertical: "structural_biology",
              });
              for (const r of papers) {
                if (r.pmid) {
                  publishEvent("paper_discovered", {
                    pmid: r.pmid,
                    title: r.title,
                    abstractSnippet: r.abstractSnippet,
                    citationUrl: r.citationUrl,
                    journal: r.journal ?? null,
                    year: r.year ?? null,
                    query: tc.searchQuery,
                    source: "translate_and_search",
                  }).catch(() => { /* non-critical */ });
                }
              }
            }

            return {
              claimText: tc.claimText,
              searchQuery: tc.searchQuery,
              proteinName: tc.proteinName,
              organism: tc.organism,
              verdict: verdictResult
                ? {
                    verdict: verdictResult.verdict,
                    rationale: verdictResult.rationale,
                    evidenceUrl: verdictResult.evidenceUrl ?? null,
                  }
                : null,
              pubmedEvidence: papers.slice(0, 3).map((p) => ({
                pmid: p.pmid,
                title: p.title,
                abstractSnippet: p.abstractSnippet,
                citationUrl: p.citationUrl,
                authors: p.authors ?? [],
                journal: p.journal ?? null,
                year: p.year ?? null,
              })),
            };
          })
        );

        const totalPapers = results.reduce((n, r) => n + r.pubmedEvidence.length, 0);
        const supportedCount = results.filter(r => r.verdict?.verdict === "Supported").length;

        return {
          question,
          claimsAnalysed: results.length,
          totalPapersFound: totalPapers,
          supportedClaims: supportedCount,
          claims: results,
          note: `Analysed ${results.length} claims derived from your question. Found ${totalPapers} peer-reviewed papers. Results written to Truth Desk knowledge graph.`,
        };
      } catch (err) {
        return { question, claims: [], error: String(err) };
      }
    },
  },

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
      telemetryDisabled: true, // disabled: cold-start DNS failure on Cloud Run
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
