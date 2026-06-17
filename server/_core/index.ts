import "dotenv/config";
import { ACTIVE_JWK_PUBLIC_KEY } from "../jwksKeys";
import compression from "compression";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { registerMagicLinkRoutes } from "../magicLink";
import { registerStorageProxy } from "./storageProxy";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { monitoringJobHandler } from "../monitoringJob";
import { pubmedIngestJobHandler } from "../pubmedIngestJob";
import { handleDiscoveryLoop } from "../discoveryLoopJob";
import { pmcFeedJobHandler } from "../pmcFeedJob";
import { qualityPassJobHandler } from "../qualityPassJob";
import { predictionBackfillHandler } from "../predictionBackfillJob";
import { swarmTickHandler } from "../swarmTickJob";
import { orchestratorTickHandler } from "../orchestratorTickJob";
import { registerClaimsRoutes } from "../claimsRoutes";
import { registerLlmsRoute } from "../llmsRoute";
import { registerSitemapRoute } from "../sitemapRoute";
import { registerVerifyClaimRoute } from "../verifyClaimRoute";
import { registerAnswerRoute } from "../answerRoute";
import { registerStreamVerifyRoute } from "../streamVerifyRoute";
import { registerProvenanceRoute } from "../epistemicProvenance";
import { registerFindSimilarRoute } from "../findSimilarRoute";
import { createDreamStartRouter } from "../dream/dreamStartRoute";
import { registerMcpServer } from "../mcpServer";
import { registerSubmitClaimRoute } from "../submitClaimRoute";
import { registerClaimPageRoute } from "../claimPageRoute";
import { registerWikiPageRoute } from "../wikiPageRoute";
import { registerBadgeRoute } from "../badgeRoute";
import { registerEmbedWidgetRoutes } from "../embedWidgetRoute";
import { registerEmbedRoutes } from "../embedRoutes";
import { registerBackfillWikiRoute } from "../backfillWikiRoute";
import { registerDreamStagingRoute } from "../dreamStagingRoute";
import { registerBackfillEmbeddingsRoute } from "../backfillEmbeddingsRoute";
import { registerBackfillDomainClaimsRoute } from "../backfillDomainClaimsRoute";
import { createCoordRouter } from "../coordApi/index";
import { createApiV2Router } from "../apiV2Router";
import { createExportRouter } from "../exportRouter";
import { batchAuditRouter } from "../batchAuditRouter";
import { agentIngestionHandler } from "../agentIngestionEndpoint";
import { registerClaimHistoryRoute } from "../claimHistoryRoute";
import { registerClaimProvenanceRoute } from "../claimProvenanceRoute";
import { registerBatchVerifyRoute } from "../batchVerifyRoute";
import { registerExternalPublicRoutes } from "../externalPublicRouter";
import { qualityScorerJobHandler } from "../qualityScorerJob";
import { generatePdfReport } from "../pdfReportGenerator";
import { sdk } from "./sdk";
import { startTelegramBot } from "../telegramBot";
import { runWikiLint } from "../wikiLinter";
import { wikiEngineLintJobHandler } from "../wikiLintJob";
import { ENV } from "./env";
import { registerHostingerWebhookRoute } from "../hostingerWebhook";
import { registerTranslateAndSearchApi } from "../translateAndSearchApi";
import { detailedHealthHandler } from "../detailedHealthRoute";
import { ingestionAlertHandler } from "../ingestionAlertJob";
import { domainIngestJobHandler } from "../domainIngestScheduler";
import { registerCitationSearchRoute } from "../citationSearchRoute";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  const app = express();
  const server = createServer(app);

  // ── Compression (gzip/brotli) — improves speed score ──────────────────────
  app.use(compression());

  // ── Security headers ────────────────────────────────────────────────────────
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader(
      "Strict-Transport-Security",
      "max-age=31536000; includeSubDomains"
    );
    res.setHeader("X-XSS-Protection", "0");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader(
      "Permissions-Policy",
      "camera=(), microphone=(), geolocation=(), payment=()"
    );
    next();
  });
  // ── No-index: ttruthdesk.claims is an internal admin tool ─────────────────
  app.use((_req, res, next) => {
    res.setHeader("X-Robots-Tag", "noindex, nofollow");
    next();
  });
  // ── Markdown Negotiation: Accept: text/markdown → Content-Type: text/markdown ──
  app.use((req, res, next) => {
    const accept = req.headers["accept"] ?? "";
    if (
      accept.includes("text/markdown") &&
      !req.path.startsWith("/api/") &&
      !req.path.startsWith("/.well-known/") &&
      !req.path.includes(".")
    ) {
      const md = [
        "# Truth Desk",
        "",
        "Autonomous multi-vertical scientific claims verification platform.",
        "",
        "## What we do",
        "",
        "Truth Desk verifies scientific claims in biotech documents against authoritative databases:",
        "- RCSB Protein Data Bank (PDB) — 3D molecular structures",
        "- PubChem — chemical compound data",
        "- PMC Open Access — peer-reviewed literature",
        "- UniProt — protein sequence and function",
        "- ClinicalTrials.gov — clinical trial data",
        "- OpenFDA — drug safety and adverse event data",
        "",
        "## Machine-readable endpoints",
        "",
        "- GET /api/public/claims?page=N&page_size=100 — paginated claims corpus (all 3,900+ verdicts)",
        "  - Filters: ?verdict=Supported|Contradicted|Ambiguous|... &vertical=structural_biology|... &claim_type=pdb_id|...",
        "  - Cursor: ?updated_since=2024-01-01T00:00:00Z for incremental crawls",
        "  - RFC 5988 Link headers: first/prev/next/last for pagination",
        "  - Headers: X-Total-Count, X-Total-Pages, X-Page, X-Page-Size",
        "- GET /api/public/claims.json — most recent 200 verified claims (legacy)",
        "- POST /api/public/verify-claim — verify a single claim",
        "- GET /.well-known/mcp.json — MCP tool card",
        "- GET /llms.txt — AI instructions",
        "- GET /sitemap.xml — all public report URLs (4,000+ claim URLs)",
        "- GET /.well-known/agent-skills/index.json — agent skills discovery",
        "- GET /.well-known/api-catalog — API catalog (RFC 9727)",
        "- GET /.well-known/oauth-protected-resource — OAuth resource metadata (RFC 9728)",
        "",
        "## Verticals",
        "",
        "- Structural Biology (live) — RCSB PDB, PDB Europe, UniProt",
        "- Salmon Biotech (live) — PubChem, PubMed Aquaculture, FAO Fisheries",
        "- Protein Supplements (live) — PubChem, PubMed Sports Nutrition, USDA FoodData Central",
        "- Creatine & Ergogenics (live) — PubChem, PubMed RCTs, Cochrane Reviews",
        "- Gut Microbiome & Protein (live) — PubMed Microbiome, Human Microbiome Project",
        "- Collagen & Peptides (live) — PubChem, PubMed Dermatology, ClinicalTrials.gov",
        "- Plant-Based Protein (live) — PubChem, USDA FoodData Central, FAO/WHO DIAAS Reports",
        "- Sports Nutrition RCTs (live) — PubMed RCTs, Cochrane Library, ISSN Position Stands",
        "- UniProt Protein Identity (live) — UniProt/Swiss-Prot, UniProt/TrEMBL, NCBI Gene",
        "- ClinicalTrials.gov (live) — ClinicalTrials.gov, EU Clinical Trials Register, WHO ICTRP",
      ].join("\n");
      const tokens = Math.ceil(md.length / 4);
      return res
        .set({
          "Content-Type": "text/markdown; charset=utf-8",
          "Cache-Control": "public, max-age=3600",
          "x-markdown-tokens": String(tokens),
        })
        .send(md);
    }
    next();
  });

  // ── Protocol discovery: MCP card ──────────────────────────────────────────
  const SITE_ORIGIN =
    ENV.appUrl ||
    (process.env.NODE_ENV === "production"
      ? "https://truthdesk.claims"
      : "http://localhost:3000");

  const MCP_TOOLS = [
    {
      name: "verify_claim",
      description:
        "Verify a scientific claim against authoritative databases (PDB, PubChem, PubMed). Returns verdict (supported|refuted|inconclusive), confidence score 0-1, evidence source, and PDB/PubChem accession if applicable. Rate-limited to 30 req/min.",
      endpoint: `${SITE_ORIGIN}/api/public/verify-claim`,
      method: "POST",
      input_schema: {
        type: "object",
        properties: {
          claim: {
            type: "string",
            description:
              "The scientific claim text to verify, e.g. 'BRCA1 forms a heterodimer with BARD1 stabilised by a RING domain interface'",
          },
          vertical: {
            type: "string",
            enum: [
              "structural_biology",
              "salmon_biotech",
              "protein_supplement",
              "creatine_ergogenics",
              "gut_microbiome",
              "collagen_peptides",
              "plant_based_protein",
              "sports_nutrition_rct",
              "uniprot",
              "clinical_trials",
            ],
            description:
              "Optional: restrict verification to a specific research domain",
          },
        },
        required: ["claim"],
      },
      output_schema: {
        type: "object",
        properties: {
          verdict: {
            type: "string",
            enum: [
              "Supported",
              "Contradicted",
              "Ambiguous",
              "Insufficient Evidence",
              "Out of Scope",
              "Needs Expert Review",
            ],
            description:
              "Supported: claim verified against authoritative source. Contradicted: claim contradicts source data. Ambiguous: evidence is mixed. Insufficient Evidence: not enough data. Out of Scope: claim type cannot be auto-verified. Needs Expert Review: requires domain specialist.",
          },
          confidenceScore: { type: "number", description: "0.0–1.0" },
          evidenceSource: {
            type: "string",
            description: "Primary database used for verification",
          },
          pdbId: {
            type: "string",
            description: "PDB accession if structural evidence found",
          },
          pubchemCid: {
            type: "number",
            description: "PubChem CID if compound evidence found",
          },
          summary: {
            type: "string",
            description: "Human-readable explanation of the verdict",
          },
        },
      },
    },
    {
      name: "get_claims_registry",
      description:
        "Retrieve the full machine-readable registry of all verified claims across all verticals. Returns JSON array of claim objects with verdict, confidence, evidence source, and report URL.",
      endpoint: `${SITE_ORIGIN}/api/public/claims.json`,
      method: "GET",
      output_schema: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            claimText: { type: "string" },
            verdict: {
              type: "string",
              enum: [
                "Supported",
                "Contradicted",
                "Ambiguous",
                "Insufficient Evidence",
                "Out of Scope",
                "Needs Expert Review",
              ],
            },
            confidenceScore: { type: "number" },
            verticalDomain: { type: "string" },
            evidenceSource: { type: "string" },
            reportUrl: { type: "string" },
          },
        },
      },
    },
    {
      name: "list_claims",
      description:
        "Paginated access to all 3,900+ verified claims in the Truth Desk corpus. Supports filtering by verdict, vertical domain, claim type, and updated_since cursor for incremental crawls. Returns RFC 5988 Link headers (first/prev/next/last) and X-Total-Count for full corpus traversal.",
      endpoint: `${SITE_ORIGIN}/api/public/claims`,
      method: "GET",
      input_schema: {
        type: "object",
        properties: {
          page: {
            type: "integer",
            minimum: 1,
            description: "Page number (1-based, default 1)",
          },
          page_size: {
            type: "integer",
            minimum: 1,
            maximum: 500,
            description: "Claims per page (default 100, max 500)",
          },
          verdict: {
            type: "string",
            enum: [
              "Supported",
              "Contradicted",
              "Partially Supported",
              "Ambiguous",
              "Insufficient Evidence",
              "Out of Scope",
              "Needs Expert Review",
            ],
            description: "Filter by verdict",
          },
          vertical: {
            type: "string",
            enum: [
              "structural_biology",
              "salmon_biotech",
              "protein_supplement",
              "creatine_ergogenics",
              "gut_microbiome",
              "collagen_peptides",
              "plant_based_protein",
              "sports_nutrition_rct",
              "uniprot",
              "clinical_trials",
            ],
            description: "Filter by research vertical",
          },
          claim_type: {
            type: "string",
            description:
              "Filter by claim type (e.g. resolution, pdb_id, method)",
          },
          updated_since: {
            type: "string",
            format: "date-time",
            description:
              "ISO 8601 cursor for incremental crawls — returns only claims updated after this timestamp",
          },
          q: {
            type: "string",
            description:
              "Full-text search query — filters claims by claim text, rationale, PDB ID, or claim type",
          },
        },
      },
      output_schema: {
        type: "object",
        properties: {
          page: { type: "integer" },
          page_size: { type: "integer" },
          total: { type: "integer", description: "Total matching claims" },
          total_pages: { type: "integer" },
          claims: {
            type: "array",
            items: {
              type: "object",
              properties: {
                claim_id: { type: "integer" },
                claim_text: { type: "string" },
                verdict: { type: "string" },
                confidence_score: { type: "number" },
                vertical_domain: { type: "string" },
                document_title: { type: "string" },
                page_url: {
                  type: "string",
                  description: "Canonical URL for this claim",
                },
                audit_url: {
                  type: "string",
                  description: "Deep link into the audit report",
                },
                updated_at: { type: "string", format: "date-time" },
              },
            },
          },
        },
      },
    },
    {
      name: "search_claims",
      description:
        "Search the full Truth Desk corpus (3,900+ verified claims) by keyword. Returns up to 200 matching claims with verdicts, rationale, evidence URLs, and direct timeline deep-links. Ideal for AI agents and MCP integrations that need to find claims about a specific topic, organism, protein, or method without paginating through the full corpus.",
      endpoint: `${SITE_ORIGIN}/api/public/claims/search`,
      method: "GET",
      input_schema: {
        type: "object",
        properties: {
          q: {
            type: "string",
            description:
              "Search query — matched against claim text, verdict rationale, PDB ID, and claim type. Example: 'Piscirickettsia salmonis intracellular'",
          },
          limit: {
            type: "integer",
            minimum: 1,
            maximum: 200,
            description: "Max results to return (default 50, max 200)",
          },
          verdict: {
            type: "string",
            enum: [
              "Supported",
              "Contradicted",
              "Partially Supported",
              "Ambiguous",
              "Insufficient Evidence",
              "Out of Scope",
              "Needs Expert Review",
            ],
            description: "Optional: filter results by verdict",
          },
          vertical: {
            type: "string",
            enum: [
              "structural_biology",
              "salmon_biotech",
              "protein_supplement",
              "creatine_ergogenics",
              "gut_microbiome",
              "collagen_peptides",
              "plant_based_protein",
              "sports_nutrition_rct",
              "uniprot",
              "clinical_trials",
            ],
            description: "Optional: restrict to a research vertical",
          },
        },
        required: ["q"],
      },
      output_schema: {
        type: "object",
        properties: {
          query: { type: "string" },
          total_matches: {
            type: "integer",
            description: "Total claims matching the query in the full corpus",
          },
          returned: {
            type: "integer",
            description: "Number of claims returned in this response",
          },
          claims: {
            type: "array",
            items: {
              type: "object",
              properties: {
                claim_id: { type: "integer" },
                claim_text: { type: "string" },
                verdict: { type: "string" },
                verdict_rationale: { type: "string" },
                confidence_score: { type: "number" },
                vertical_domain: { type: "string" },
                pdb_id: { type: "string" },
                evidence_url: { type: "string" },
                page_url: {
                  type: "string",
                  description: "Canonical claim page URL",
                },
                timeline_url: {
                  type: "string",
                  description: "Evidence timeline deep-link for this claim",
                },
                updated_at: { type: "string", format: "date-time" },
              },
            },
          },
        },
      },
    },
    {
      name: "get_platform_summary",
      description:
        "Retrieve a markdown summary of the Truth Desk platform including available verticals, endpoints, and capabilities. Useful for agent orientation before making API calls.",
      endpoint: `${SITE_ORIGIN}/api/md`,
      method: "GET",
      output_schema: { type: "string", description: "Markdown text" },
    },
    {
      name: "get_knowledge_graph_data",
      description:
        "Retrieve the raw knowledge graph data as JSON, including all document nodes, claim nodes, and evidence edges. Useful for graph analysis and relationship discovery.",
      endpoint: `${SITE_ORIGIN}/api/public/graph.json`,
      method: "GET",
      output_schema: {
        type: "object",
        properties: {
          nodes: { type: "array", description: "Document and evidence nodes" },
          links: { type: "array", description: "Edges between nodes" },
        },
      },
    },
    {
      name: "claims.byEntity",
      description:
        "Retrieve all verified claims for a specific entity (protein, PDB ID, method, organism). Returns claims with verdicts, rationale, and evidence links. Use entity_type values: protein, pdb_id, method, organism, ligand.",
      endpoint: `${SITE_ORIGIN}/api/trpc/graph.entities`,
      method: "GET",
      input_schema: {
        type: "object",
        properties: {
          entityType: {
            type: "string",
            enum: [
              "protein",
              "pdb_id",
              "method",
              "organism",
              "ligand",
              "author",
              "concept",
            ],
            description: "Entity category",
          },
          canonicalName: {
            type: "string",
            description: "Canonical entity name, e.g. 'lysozyme' or '1LYZ'",
          },
        },
        required: ["entityType", "canonicalName"],
      },
      output_schema: {
        type: "object",
        properties: {
          entity: { type: "object", description: "Entity metadata" },
          markdown: {
            type: "string",
            description: "Wiki page markdown with all claims",
          },
          jsonld: { type: "object", description: "Schema.org Dataset JSON-LD" },
        },
      },
    },
    {
      name: "graph.query",
      description:
        "Ask a natural language question about the protein knowledge graph. Returns an LLM-synthesised answer grounded in the graph entities and relations. Example: 'What contradictions exist about PDB 1LYZ resolution?'",
      endpoint: `${SITE_ORIGIN}/api/trpc/graph.query`,
      method: "POST",
      input_schema: {
        type: "object",
        properties: {
          question: {
            type: "string",
            description: "Natural language question about the knowledge graph",
          },
        },
        required: ["question"],
      },
      output_schema: {
        type: "object",
        properties: {
          answer: {
            type: "string",
            description: "LLM-synthesised answer with entity citations",
          },
          entities: {
            type: "array",
            description: "Entities referenced in the answer",
          },
          contradictions: {
            type: "array",
            description: "Any contradiction edges relevant to the question",
          },
        },
      },
    },
    {
      name: "reports.generate",
      description:
        "Submit a scientific document (abstract, whitepaper, pitch deck) for automated claim extraction and verification. Returns a document ID for polling status and retrieving the full audit report.",
      endpoint: `${SITE_ORIGIN}/api/trpc/documents.create`,
      method: "POST",
      input_schema: {
        type: "object",
        properties: {
          title: { type: "string", description: "Document title" },
          rawText: {
            type: "string",
            description: "Full text of the document to audit",
          },
          sourceType: {
            type: "string",
            enum: ["manual", "pmid", "doi", "url"],
            description: "How the document was sourced",
          },
          verticalDomain: {
            type: "string",
            enum: [
              "structural_biology",
              "salmon_biotech",
              "protein_supplement",
              "creatine_ergogenics",
              "gut_microbiome",
              "collagen_peptides",
              "plant_based_protein",
              "sports_nutrition_rct",
              "uniprot",
              "clinical_trials",
              "general",
            ],
            description: "Research domain for targeted verification",
          },
        },
        required: ["rawText"],
      },
      output_schema: {
        type: "object",
        properties: {
          documentId: {
            type: "number",
            description:
              "Use this ID to poll /api/trpc/documents.get for status",
          },
          status: {
            type: "string",
            enum: [
              "pending",
              "extracting",
              "validating",
              "generating_report",
              "complete",
              "failed",
            ],
          },
        },
      },
    },
  ];

  app.get("/.well-known/mcp.json", (_req, res) => {
    res
      .set({
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=3600",
        "Access-Control-Allow-Origin": "*",
      })
      .json({
        schema_version: "v1",
        name: "citation.is",
        display_name: "citation.is — Scientific Grounding Layer for AI Systems",
        description:
          "citation.is is the scientific grounding layer for AI systems. Provides verified claim lookup, real-time verification, and autonomous ingestion from PubMed, UniProt, PubChem, PDB, and PMC Open Access. No authentication required for read operations. Ideal for Perplexity, Claude, ChatGPT, and any MCP-compatible AI agent that needs grounded, citable scientific answers.",
        version: "1.0.0",
        url: SITE_ORIGIN,
        mcp_endpoint: `${SITE_ORIGIN}/mcp`,
        npm_package: "@citation-is/mcp-server",
        npm_install: "npx @citation-is/mcp-server",
        tools: MCP_TOOLS,
        resources: [
          {
            uri: `${SITE_ORIGIN}/llms.txt`,
            description: "AI instructions and endpoint documentation",
          },
          {
            uri: `${SITE_ORIGIN}/llms-full.txt`,
            description:
              "Full verified claims corpus for LLM grounding and RAG",
          },
          {
            uri: `${SITE_ORIGIN}/api/public/claims.json`,
            description:
              "Machine-readable claims registry (bulk download, CC BY 4.0)",
          },
          {
            uri: `${SITE_ORIGIN}/sitemap.xml`,
            description: "All public claim and registry URLs",
          },
        ],
        contact: `${SITE_ORIGIN}/developers`,
        license: "CC BY 4.0",
        provider: { name: "citation.is", url: SITE_ORIGIN },
        integration: {
          claude_desktop: {
            config: {
              mcpServers: {
                "citation-is": {
                  command: "npx",
                  args: ["-y", "@citation-is/mcp-server"],
                },
              },
            },
          },
          http: {
            endpoint: `${SITE_ORIGIN}/mcp`,
            protocol: "MCP 2024-11-05 (JSON-RPC 2.0 over HTTP)",
            auth: "None required for read tools. Bearer token for write tools.",
          },
        },
        policy_conformance: {
          framework: "MCP 2024-11-05",
          credential_scoping: true,
          audit_trail: true,
          data_protection: "CC BY 4.0 — public read, authenticated write",
          agent_identity: "OAuth 2.0 PKCE",
          opr: `${SITE_ORIGIN}/.well-known/auth.md`,
        },
      });
  });

  // ── MCP SSE endpoint (streamable HTTP transport) ──────────────────────────
  app.get("/mcp", (_req, res) => {
    res.set({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders();
    // Send MCP initialize response
    const initEvent = {
      jsonrpc: "2.0",
      id: 1,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {}, resources: {} },
        serverInfo: { name: "Truth Desk", version: "1.0.0" },
      },
    };
    res.write(`data: ${JSON.stringify(initEvent)}\n\n`);
    // Send tools/list
    const toolsEvent = {
      jsonrpc: "2.0",
      method: "notifications/tools/list_changed",
      params: { tools: MCP_TOOLS },
    };
    res.write(`data: ${JSON.stringify(toolsEvent)}\n\n`);
    // Keep connection alive with heartbeat
    const heartbeat = setInterval(() => {
      res.write(`: heartbeat\n\n`);
    }, 15000);
    res.on("close", () => clearInterval(heartbeat));
  });

  // ── /mcp forwards to the full MCP server implementation at /api/mcp ─────
  // Kept for backward compatibility with agents that discovered the old endpoint.
  app.post("/mcp", express.json(), (req, res) => {
    // Forward to the real handler — preserves all headers, auth, rate limiting
    req.url = "/api/mcp";
    (
      app as unknown as {
        _router: {
          handle: (req: unknown, res: unknown, next: () => void) => void;
        };
      }
    )._router.handle(req, res, () => {
      res.status(404).json({
        jsonrpc: "2.0",
        id: (req.body as Record<string, unknown>)?.["id"] ?? null,
        error: { code: -32601, message: "Method not found" },
      });
    });
  });

  // ── Markdown negotiation endpoint ─────────────────────────────────────────
  app.get("/api/md", (_req, res) => {
    const md = [
      "# Truth Desk",
      "",
      "Autonomous multi-vertical scientific claims verification platform.",
      "",
      "## What we do",
      "",
      "Truth Desk verifies scientific claims in biotech documents against authoritative databases:",
      "- RCSB Protein Data Bank (PDB) — 3D molecular structures",
      "- PubChem — chemical compound data",
      "- PMC Open Access — peer-reviewed literature",
      "- UniProt — protein sequence and function",
      "",
      "## Machine-readable endpoints",
      "",
      "- GET /api/public/claims?page=N&page_size=100 — paginated claims corpus (3,900+ verdicts)",
      "  Filters: ?verdict=Supported|Contradicted|Ambiguous|Partially+Supported|Insufficient+Evidence",
      "          &vertical=structural_biology|salmon_biotech|protein_supplement|creatine_ergogenics|...",
      "          &claim_type=pdb_id|protein_name|resolution|experimental_method|organism|ligand|general_molecular",
      "          &updated_since=ISO8601 for incremental crawls",
      "  Response headers: X-Total-Count, X-Total-Pages, X-Page, X-Page-Size",
      "  Link headers: RFC 5988 first/prev/next/last for pagination",
      "- GET /api/public/claims.json — most recent 200 verified claims (legacy)",
      "- POST /api/public/verify-claim — verify a single claim",
      "- GET /.well-known/mcp.json — MCP tool card",
      "- GET /llms.txt — AI instructions",
      "- GET /sitemap.xml — all public report URLs (4,000+ claim URLs)",
      "",
      "## Verticals",
      "",
      "- Structural Biology (live) — RCSB PDB, PDB Europe, UniProt",
      "- Salmon Biotech (live) — PubChem, PubMed Aquaculture, FAO Fisheries",
      "- Protein Supplements (live) — PubChem, PubMed Sports Nutrition, USDA FoodData Central",
      "- Creatine & Ergogenics (live) — PubChem, PubMed RCTs, Cochrane Reviews",
      "- Gut Microbiome & Protein (live) — PubMed Microbiome, Human Microbiome Project",
      "- Collagen & Peptides (live) — PubChem, PubMed Dermatology, ClinicalTrials.gov",
      "- Plant-Based Protein (live) — PubChem, USDA FoodData Central, FAO/WHO DIAAS Reports",
      "- Sports Nutrition RCTs (live) — PubMed RCTs, Cochrane Library, ISSN Position Stands",
      "- UniProt Protein Identity (live) — UniProt/Swiss-Prot, UniProt/TrEMBL, NCBI Gene",
      "- ClinicalTrials.gov (live) — ClinicalTrials.gov, EU Clinical Trials Register, WHO ICTRP",
    ].join("\n");
    res
      .set({
        "Content-Type": "text/markdown; charset=utf-8",
        "Cache-Control": "public, max-age=3600",
      })
      .send(md);
  });

  // ── Agent Auth: /.well-known/auth.md ────────────────────────────────────
  app.get("/.well-known/auth.md", (_req, res) => {
    const authMd = [
      "# Truth Desk — Agent Authentication Guide",
      "",
      "Truth Desk exposes public, unauthenticated endpoints for agent use. No API key is required for read operations.",
      "This service is compatible with **Microsoft Scout** and any MCP 2024-11-05 compliant agent.",
      "",
      "## Public Endpoints (no auth required)",
      "",
      "- `GET /api/public/claims?page=N&page_size=100` — paginated claims corpus (3,900+ verdicts, RFC 5988 Link headers, supports ?q= text search)",
      "- `GET /api/public/claims/search?q=...` — **recommended for agents**: full-corpus keyword search, returns up to 200 matching claims with timeline deep-links (no pagination needed)",
      "- `GET /api/public/claims/index.json` — compact index of all claim IDs, verdicts, and vertical slugs (up to 10,000 rows)",
      "- `GET /api/public/claims/:id` — single claim with full ClaimReview JSON-LD schema",
      "- `GET /api/public/claims.json` — most recent 200 verified claims (legacy)",
      "- `POST /api/public/verify-claim` — verify a single scientific claim (rate-limited: 30 req/min)",
      "- `GET /api/md` — markdown summary of the platform",
      "- `GET /.well-known/mcp.json` — MCP tool card (Scout-compatible, includes policy_conformance)",
      "- `GET /llms.txt` — AI agent instructions",
      "- `GET /sitemap.xml` — all public report URLs",
      "- `GET /mcp` — MCP SSE streaming endpoint (protocol version 2024-11-05)",
      "- `POST /mcp` — MCP JSON-RPC endpoint (initialize, tools/list, resources/list)",
      "",
      "## Authentication (for write operations)",
      "",
      "Write operations and admin endpoints use OAuth 2.0 PKCE (Entra-compatible). To authenticate:",
      "",
      "1. Redirect the user to the OAuth portal",
      "2. Exchange the code for a session token at `/api/oauth/callback`",
      "3. Include the session cookie on subsequent requests",
      "",
      "## Microsoft Scout Integration",
      "",
      "Truth Desk can be added as a Scout MCP integration. Scout can:",
      "- Call `verify_claim` to verify claims in documents flowing through Teams/Outlook",
      "- Subscribe to `get_claims_registry` for proactive contradiction alerts",
      "- Use `get_knowledge_graph_data` for relationship discovery across the corpus",
      "",
      "Scout autopilot triggers: `new_contradiction_found`, `claim_verified`, `monitoring_alert`",
      "",
      "## OAuth Protected Resources (OPR)",
      "",
      "Protected resource server: `https://protein-desk-5r5rzpyg.manus.space`",
      "Authorization server: Manus OAuth (Entra-compatible PKCE flow)",
      "Credential scoping: read (public, no token), write (session token required)",
      "",
      "## Rate Limits",
      "",
      "- `POST /api/public/verify-claim`: 30 requests per minute per IP",
      "- All other public endpoints: no rate limit",
      "",
      "## OpenAPI Specification",
      "",
      "Machine-readable API spec available at `/openapi.json` (OpenAPI 3.1).",
      "",
      "## Contact",
      "",
      "Arctic Media LLC — https://protein-desk-5r5rzpyg.manus.space/pricing",
    ].join("\n");
    res
      .set({
        "Content-Type": "text/markdown; charset=utf-8",
        "Cache-Control": "public, max-age=3600",
      })
      .send(authMd);
  });

  // ── OpenAPI 3.1 specification ──────────────────────────────────────────
  // ── robots.txt — internal admin tool, block all crawlers ──────────────────
  app.get("/robots.txt", (_req, res) => {
    res
      .set({
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "public, max-age=3600",
      })
      .send(
        "# ttruthdesk.claims — internal admin tool\nUser-agent: *\nDisallow: /\n"
      );
  });

  // ── /auth.md root (auth.md spec requires H1 containing 'auth.md') ─────────────────
  app.get("/auth.md", (_req, res) => {
    const md = [
      "# auth.md — Truth Desk Agent Registration",
      "",
      "Truth Desk exposes public, unauthenticated endpoints for agent use. No API key is required for read operations.",
      "",
      "## Agent Audience",
      "",
      "Any MCP-compatible agent, AI assistant, or automated pipeline that needs to verify scientific claims.",
      "",
      "## Registration",
      "",
      "No registration required for public read endpoints. For write operations, use OAuth 2.0 PKCE:",
      "1. Redirect user to the OAuth portal (see `/.well-known/openid-configuration`)",
      "2. Exchange code for session token at `/api/oauth/callback`",
      "3. Include session cookie on subsequent requests",
      "",
      "## Supported Methods",
      "",
      "- Public read: no credentials required",
      "- Write/admin: OAuth 2.0 PKCE session cookie",
      "",
      "## Credential Use",
      "",
      "Session cookies are scoped to the Truth Desk resource server. They are not shared with third parties.",
      "",
      "## Endpoints",
      "",
      `- POST ${SITE_ORIGIN}/api/public/verify-claim — verify a scientific claim (public)`,
      `- GET ${SITE_ORIGIN}/api/public/claims.json — claims registry (public)`,
      `- GET ${SITE_ORIGIN}/.well-known/mcp.json — MCP tool card`,
      `- GET ${SITE_ORIGIN}/.well-known/oauth-protected-resource — OAuth resource metadata (RFC 9728)`,
      `- GET ${SITE_ORIGIN}/.well-known/openid-configuration — OAuth/OIDC discovery (RFC 8414)`,
    ].join("\n");
    res
      .set({
        "Content-Type": "text/markdown; charset=utf-8",
        "Cache-Control": "public, max-age=3600",
      })
      .send(md);
  });

  // ── OAuth OIDC Discovery (RFC 8414) ────────────────────────────────────────────────
  app.get("/.well-known/openid-configuration", (_req, res) => {
    res
      .set({
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=3600",
        "Access-Control-Allow-Origin": "*",
      })
      .json({
        issuer: SITE_ORIGIN,
        authorization_endpoint: `${ENV.oAuthServerUrl || SITE_ORIGIN}/oauth/authorize`,
        token_endpoint: `${SITE_ORIGIN}/api/oauth/callback`,
        jwks_uri: `${SITE_ORIGIN}/.well-known/jwks.json`,
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code"],
        subject_types_supported: ["public"],
        id_token_signing_alg_values_supported: ["RS256"],
        scopes_supported: ["openid", "profile", "email"],
        token_endpoint_auth_methods_supported: ["none"],
        code_challenge_methods_supported: ["S256"],
      });
  });

  // ── OAuth Protected Resource Metadata (RFC 9728) ───────────────────────────────────
  app.get("/.well-known/oauth-protected-resource", (_req, res) => {
    res
      .set({
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=3600",
        "Access-Control-Allow-Origin": "*",
      })
      .json({
        resource: SITE_ORIGIN,
        authorization_servers: [ENV.oAuthServerUrl || SITE_ORIGIN],
        scopes_supported: ["openid", "profile", "email"],
        bearer_methods_supported: ["header", "cookie"],
        resource_documentation: `${SITE_ORIGIN}/auth.md`,
      });
  });

  // ── API Catalog (RFC 9727) ─────────────────────────────────────────────────────────
  app.get("/.well-known/api-catalog", (_req, res) => {
    res
      .set({
        "Content-Type": "application/linkset+json",
        "Cache-Control": "public, max-age=3600",
        "Access-Control-Allow-Origin": "*",
      })
      .json({
        linkset: [
          {
            anchor: `${SITE_ORIGIN}/api/public/claims.json`,
            "service-desc": [
              {
                href: `${SITE_ORIGIN}/openapi.json`,
                type: "application/openapi+json",
              },
            ],
            "service-doc": [{ href: `${SITE_ORIGIN}/llms.txt` }],
            status: [{ href: `${SITE_ORIGIN}/api/md` }],
          },
          {
            anchor: `${SITE_ORIGIN}/api/public/verify-claim`,
            "service-desc": [
              {
                href: `${SITE_ORIGIN}/openapi.json`,
                type: "application/openapi+json",
              },
            ],
            "service-doc": [{ href: `${SITE_ORIGIN}/llms.txt` }],
          },
          {
            anchor: `${SITE_ORIGIN}/.well-known/mcp.json`,
            "service-desc": [
              {
                href: `${SITE_ORIGIN}/.well-known/mcp.json`,
                type: "application/json",
              },
            ],
            "service-doc": [{ href: `${SITE_ORIGIN}/llms.txt` }],
          },
        ],
      });
  });

  // ── Agent Skills Discovery Index (agentskills.io v0.2.0) ──────────────────────────
  app.get("/.well-known/agent-skills/index.json", (_req, res) => {
    res
      .set({
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=3600",
        "Access-Control-Allow-Origin": "*",
      })
      .json({
        $schema: "https://schemas.agentskills.io/discovery/0.2.0/schema.json",
        skills: [
          {
            name: "verify-claim",
            type: "skill-md",
            description:
              "Verify a scientific claim against authoritative databases (PDB, PubChem, PubMed, UniProt). Returns verdict, confidence score, and evidence source.",
            url: `${SITE_ORIGIN}/.well-known/agent-skills/verify-claim/SKILL.md`,
            digest:
              "sha256:f37933cedd4ea319092b67e48dba7531e24426a74d9a0e19af10a433da821741",
          },
          {
            name: "claims-registry",
            type: "skill-md",
            description:
              "Access the full machine-readable registry of all verified scientific claims across all research verticals.",
            url: `${SITE_ORIGIN}/.well-known/agent-skills/claims-registry/SKILL.md`,
            digest:
              "sha256:9ba0b8d3389e3868a79f3372aa2c8b7c2668a1b5b73e2a87abd93ac4e13c58d4",
          },
        ],
      });
  });

  // ── Agent Skills SKILL.md files ────────────────────────────────────────────────────
  app.get("/.well-known/agent-skills/verify-claim/SKILL.md", (_req, res) => {
    const skillMd = [
      "# Skill: Verify Scientific Claim",
      "",
      "Verify a scientific claim against authoritative databases.",
      "",
      "## Endpoint",
      "",
      `POST ${SITE_ORIGIN}/api/public/verify-claim`,
      "",
      "## Input",
      "",
      "```json",
      `{ "claim": "BRCA1 forms a heterodimer with BARD1", "vertical": "structural_biology" }`,
      "```",
      "",
      "## Output",
      "",
      "```json",
      `{ "verdict": "supported", "confidenceScore": 0.92, "evidenceSource": "PDB", "pdbId": "1JM7" }`,
      "```",
      "",
      "## Rate Limit",
      "",
      "30 requests per minute per IP. No authentication required.",
    ].join("\n");
    res
      .set({
        "Content-Type": "text/markdown; charset=utf-8",
        "Cache-Control": "public, max-age=3600",
      })
      .send(skillMd);
  });

  app.get("/.well-known/agent-skills/claims-registry/SKILL.md", (_req, res) => {
    const skillMd = [
      "# Skill: Access Claims Registry",
      "",
      "Retrieve the full machine-readable registry of all verified scientific claims.",
      "",
      "## Endpoint",
      "",
      `GET ${SITE_ORIGIN}/api/public/claims.json`,
      "",
      "## Output",
      "",
      "JSON array of claim objects with verdict, confidence score, evidence source, and report URL.",
      "",
      "## Authentication",
      "",
      "None required. Public endpoint.",
    ].join("\n");
    res
      .set({
        "Content-Type": "text/markdown; charset=utf-8",
        "Cache-Control": "public, max-age=3600",
      })
      .send(skillMd);
  });

  // ── JWKS (JSON Web Key Set) — public key derived from jwksKeys.ts ───────────────────
  // Key material lives in server/jwksKeys.ts. Override via JWKS_PRIVATE_KEY secret.
  app.get("/.well-known/jwks.json", (_req, res) => {
    res
      .set({
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=86400",
        "Access-Control-Allow-Origin": "*",
      })
      .json({ keys: [ACTIVE_JWK_PUBLIC_KEY] });
  });

  const OPENAPI_SPEC = {
    openapi: "3.1.0",
    info: {
      title: "Truth Desk API",
      version: "1.0.0",
      description:
        "Autonomous multi-vertical scientific claims verification platform. Verifies claims against PDB, PubChem, PubMed, UniProt, and PMC Open Access.",
      contact: { name: "Arctic Media LLC", url: `${SITE_ORIGIN}/pricing` },
      license: {
        name: "CC BY 4.0",
        url: "https://creativecommons.org/licenses/by/4.0/",
      },
    },
    servers: [{ url: SITE_ORIGIN, description: "Production" }],
    paths: {
      "/api/public/claims.json": {
        get: {
          operationId: "getClaimsRegistry",
          summary: "Get verified claims registry",
          description:
            "Returns the full machine-readable registry of all verified scientific claims across all verticals.",
          tags: ["Public"],
          responses: {
            "200": {
              description: "Array of verified claim objects",
              content: {
                "application/json": {
                  schema: {
                    type: "array",
                    items: { $ref: "#/components/schemas/Claim" },
                  },
                },
              },
            },
          },
        },
      },
      "/api/public/verify-claim": {
        post: {
          operationId: "verifyClaim",
          summary: "Verify a scientific claim",
          description:
            "Verifies a single scientific claim against authoritative databases (PDB, PubChem, PubMed). Rate-limited to 30 requests per minute.",
          tags: ["Public"],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/VerifyClaimRequest" },
              },
            },
          },
          responses: {
            "200": {
              description: "Verification result",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/VerifyClaimResponse" },
                },
              },
            },
            "429": { description: "Rate limit exceeded" },
          },
        },
      },
      "/api/md": {
        get: {
          operationId: "getPlatformSummary",
          summary: "Get platform summary as Markdown",
          description:
            "Returns a Markdown-formatted summary of the Truth Desk platform, including verticals, endpoints, and capabilities.",
          tags: ["Discovery"],
          responses: {
            "200": {
              description: "Markdown text",
              content: { "text/markdown": { schema: { type: "string" } } },
            },
          },
        },
      },
      "/.well-known/mcp.json": {
        get: {
          operationId: "getMcpCard",
          summary: "Get MCP tool card",
          description: "Returns the MCP tool card for agent integration.",
          tags: ["Discovery"],
          responses: {
            "200": {
              description: "MCP tool card",
              content: { "application/json": { schema: { type: "object" } } },
            },
          },
        },
      },
    },
    components: {
      schemas: {
        Claim: {
          type: "object",
          properties: {
            id: { type: "string" },
            claimText: { type: "string" },
            verdict: {
              type: "string",
              enum: [
                "Supported",
                "Contradicted",
                "Ambiguous",
                "Insufficient Evidence",
                "Out of Scope",
                "Needs Expert Review",
              ],
              description:
                "Supported: claim verified against authoritative source. " +
                "Contradicted: claim contradicts source data. " +
                "Ambiguous: evidence is mixed. " +
                "Insufficient Evidence: not enough data. " +
                "Out of Scope: claim type cannot be auto-verified. " +
                "Needs Expert Review: requires domain specialist.",
            },
            confidenceScore: { type: "number", minimum: 0, maximum: 1 },
            verticalDomain: { type: "string" },
            evidenceSource: { type: "string" },
            reportUrl: { type: "string" },
          },
        },
        VerifyClaimRequest: {
          type: "object",
          required: ["claim"],
          properties: {
            claim: {
              type: "string",
              description: "The scientific claim text to verify",
            },
            vertical: {
              type: "string",
              enum: [
                "structural_biology",
                "salmon_biotech",
                "protein_supplement",
                "creatine_ergogenics",
                "gut_microbiome",
                "collagen_peptides",
                "plant_based_protein",
                "sports_nutrition_rct",
                "uniprot",
                "clinical_trials",
              ],
              description: "Optional: restrict to a specific domain",
            },
          },
        },
        VerifyClaimResponse: {
          type: "object",
          properties: {
            verdict: {
              type: "string",
              enum: [
                "Supported",
                "Contradicted",
                "Ambiguous",
                "Insufficient Evidence",
                "Out of Scope",
                "Needs Expert Review",
              ],
            },
            confidenceScore: { type: "number" },
            evidenceSource: { type: "string" },
            pdbId: { type: "string" },
            pubchemCid: { type: "number" },
            summary: { type: "string" },
          },
        },
      },
    },
  };

  app.get("/openapi.json", (_req, res) => {
    res
      .set({
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=3600",
        "Access-Control-Allow-Origin": "*",
      })
      .json(OPENAPI_SPEC);
  });

  // Raw body parser for webhook signature verification (MUST be before express.json)
  app.use(
    "/api/webhook",
    express.raw({ type: "application/json", limit: "1mb" })
  );

  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "10mb" }));
  app.use(express.urlencoded({ limit: "10mb", extended: true }));
  registerStorageProxy(app);
  registerOAuthRoutes(app);
  registerMagicLinkRoutes(app);

  // ── Auth middleware for protected routes ──────────────────────────────────
  // Scheduled endpoints: only cron callbacks (isCron=true) or admin users may call them.
  // Also accepts BUILT_IN_FORGE_API_KEY as a Bearer token — this is the fallback for
  // Manus Heartbeat jobs registered under a different project identity (cross-project
  // cron tokens are rejected by the OAuth server with "permission error for cron cookie").
  const requireCronOrAdmin: express.RequestHandler = async (req, res, next) => {
    // Fast-path: accept BUILT_IN_FORGE_API_KEY (Manus Heartbeat cron) or CRON_SECRET
    // (sandbox / external callers set via Manus Project Settings env var).
    const authHeader = req.headers["authorization"] ?? "";
    if (ENV.forgeApiKey && authHeader === `Bearer ${ENV.forgeApiKey}`) {
      return next();
    }
    if (ENV.cronSecret && authHeader === `Bearer ${ENV.cronSecret}`) {
      return next();
    }
    try {
      const user = await sdk.authenticateRequest(req);
      if (user.isCron || user.role === "admin") return next();
      res
        .status(403)
        .json({ error: "Forbidden: cron or admin access required" });
    } catch {
      res.status(401).json({ error: "Unauthorized" });
    }
  };

  // Admin endpoints: only the project owner (OWNER_OPEN_ID) or admin-role users.
  const requireOwnerOrAdmin: express.RequestHandler = async (
    req,
    res,
    next
  ) => {
    try {
      const user = await sdk.authenticateRequest(req);
      if (user.role === "admin" || user.openId === ENV.ownerOpenId)
        return next();
      res
        .status(403)
        .json({ error: "Forbidden: owner or admin access required" });
    } catch {
      res.status(401).json({ error: "Unauthorized" });
    }
  };

  // Scheduled job endpoints (must be before Vite/static fallthrough)
  app.post(
    "/api/scheduled/monitoring",
    requireCronOrAdmin,
    monitoringJobHandler
  );
  app.post(
    "/api/scheduled/pubmed-ingest",
    requireCronOrAdmin,
    pubmedIngestJobHandler
  );
  // Domain-ingest: autonomous 5-domain (biology/medicine/chemistry/physics/climate) PubMed ingest
  // Designed to run every 6 hours to grow the verified claim registry for enterprise AI clients
  app.post(
    "/api/scheduled/domain-ingest",
    requireCronOrAdmin,
    domainIngestJobHandler
  );
  app.post(
    "/api/scheduled/discovery-loop",
    requireCronOrAdmin,
    handleDiscoveryLoop
  );
  app.post("/api/scheduled/pmc-feed", requireCronOrAdmin, pmcFeedJobHandler);
  app.post(
    "/api/scheduled/quality-pass",
    requireCronOrAdmin,
    qualityPassJobHandler
  );
  app.post(
    "/api/scheduled/backfill-predictions",
    requireCronOrAdmin,
    predictionBackfillHandler
  );
  // Swarm coordinator: fans out all 5 agent jobs in parallel
  app.post("/api/scheduled/swarm-tick", requireCronOrAdmin, swarmTickHandler);
  // Orchestrator tick: auto-spawns Manus agents for verticals with pending queue items
  app.post(
    "/api/scheduled/orchestrator-tick",
    requireCronOrAdmin,
    orchestratorTickHandler
  );
  // Manus Coordination Layer: shared work queue, task registry, context store
  app.use("/api/coord", createCoordRouter());
  // Agent result ingestion: accepts structured JSON from Manus agent tasks
  app.post("/api/coord/ingest", agentIngestionHandler);
  // Quality scoring pipeline: scores all unscored/stale claims every 6 hours
  app.post(
    "/api/scheduled/quality-scorer",
    requireCronOrAdmin,
    qualityScorerJobHandler
  );
  // Public API v2: paginated, filterable endpoints for claims, entities, verticals, and audits
  app.use("/api/v2", createApiV2Router());
  // Structured data export: CSV/JSON download endpoints for claims, reports, entities
  app.use("/api/v2/export", createExportRouter());
  // Batch audit API: accept up to 20 papers in one request, run full pipeline, return structured results
  app.use(
    "/api/v2/batch-audit",
    express.json({ limit: "5mb" }),
    batchAuditRouter
  );
  // LLM health check: reports active provider, model pool, and connectivity
  app.get("/api/admin/llm-health", requireOwnerOrAdmin, async (_req, res) => {
    try {
      const { getActiveLLMProvider } = await import("../claimExtractor");
      const { invokeMultiLLM, FREE_MODEL_ROTATION, getLLMHealthSummary } =
        await import("../_core/multiLLM");
      const activeProvider = getActiveLLMProvider();
      // Test connectivity with a minimal prompt
      let connectivityOk = false;
      let connectivityError: string | null = null;
      try {
        const resp = await invokeMultiLLM({
          messages: [
            { role: "user", content: "Reply with the single word: OK" },
          ],
        });
        const text = resp?.choices?.[0]?.message?.content ?? "";
        connectivityOk = text.trim().toLowerCase().includes("ok");
      } catch (e) {
        connectivityError = String(e);
      }
      const healthSummary = getLLMHealthSummary();
      res.json({
        activeProvider,
        freeModelPool: FREE_MODEL_ROTATION,
        healthSummary,
        connectivity: { ok: connectivityOk, error: connectivityError },
        selfHostedGemma4: {
          supported: !!ENV.freeLLMApiUrl,
          apiUrl: ENV.freeLLMApiUrl || null,
          model: ENV.freeLLMModel || "gemma4:27b-it-q4_K_M",
          setupInstructions: [
            "1. Install Ollama: curl -fsSL https://ollama.com/install.sh | sh",
            "2. Pull model: ollama pull gemma4:27b-it-q4_K_M  (requires ~16GB VRAM)",
            "3. Start server: OLLAMA_HOST=0.0.0.0 ollama serve",
            "4. Set env: FREELM_API_URL=http://YOUR_SERVER_IP:11434/v1",
            "5. Set env: FREELM_MODEL=gemma4:27b-it-q4_K_M",
          ],
        },
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });
  // Wiki lint: cross-document contradiction detection (S3-based, legacy)
  app.post(
    "/api/scheduled/wiki-lint",
    requireCronOrAdmin,
    async (_req, res) => {
      try {
        const report = await runWikiLint();
        res.json({ ok: true, ...report });
      } catch (err) {
        console.error("[WikiLint] Error:", err);
        res.status(500).json({ ok: false, error: String(err) });
      }
    }
  );
  // DB-backed wiki engine lint + index rebuild (weekly)
  app.post(
    "/api/scheduled/wiki-engine-lint",
    requireCronOrAdmin,
    wikiEngineLintJobHandler
  );
  // Frontier Engine — gap detection, ranking, evidence pursuit, hypothesis generation (every 6 hours)
  app.post(
    "/api/scheduled/frontier-engine",
    requireCronOrAdmin,
    async (_req, res) => {
      try {
        const { runFrontierEngine } = await import(
          "../frontier/frontierEngine"
        );
        const result = await runFrontierEngine();
        res.json({ ok: true, ...result });
      } catch (err) {
        console.error("[FrontierEngine] Scheduled run failed:", err);
        res.status(500).json({ ok: false, error: (err as Error).message });
      }
    }
  );
  // Inverse Prompt Engine — generates verifiable questions from the knowledge graph (daily at 03:00 UTC)
  app.post(
    "/api/scheduled/inverse-prompt",
    requireCronOrAdmin,
    async (_req, res) => {
      try {
        const { runInversePromptEngine } = await import(
          "../inversePrompt/inversePromptEngine"
        );
        const result = await runInversePromptEngine();
        res.json({ ok: true, ...result });
      } catch (err) {
        console.error("[InversePrompt] Scheduled run failed:", err);
        res.status(500).json({ ok: false, error: (err as Error).message });
      }
    }
  );

  // Meta-Agent / Code Guardian — pipeline invariant checks, stub ledger, drift detection (daily at 04:00 UTC)
  app.post(
    "/api/scheduled/meta-agent",
    requireCronOrAdmin,
    async (_req, res) => {
      try {
        const { runCodeGuardian } = await import("../metaAgent/codeGuardian");
        const report = await runCodeGuardian();
        res.json({
          ok: true,
          healthScore: report.healthScore,
          healthGrade: report.healthGrade,
          criticalCount: report.criticalCount,
          warningCount: report.warningCount,
          findingsCount: report.allFindings.length,
        });
      } catch (err) {
        console.error("[MetaAgent] Scheduled run failed:", err);
        res.status(500).json({ ok: false, error: (err as Error).message });
      }
    }
  );

  // Self-Prompt Engine — publishes self_prompt_tick event to trigger pending self-prompt cycles (every 2 hours)
  app.post(
    "/api/scheduled/self-prompt",
    requireCronOrAdmin,
    async (_req, res) => {
      try {
        const { publishEvent, scheduleDrain } = await import(
          "../autonomousLoop/eventBus"
        );
        await publishEvent("scheduled_tick", {
          source: "self_prompt_cron",
          mode: "scheduled",
        });
        scheduleDrain();
        res.json({ ok: true, tickPublished: true, drainScheduled: true });
      } catch (err) {
        console.error("[SelfPrompt] Scheduled run failed:", err);
        res.status(500).json({ ok: false, error: (err as Error).message });
      }
    }
  );

  // ─── Autonomous Loop tick (safety-net fallback) ─────────────────────────────
  //
  // Since eventBus v2, publishEvent() schedules a reactive drain via setImmediate()
  // after every call. Events are processed within milliseconds of being published.
  //
  // This 2-hour cron tick is now a SAFETY NET only:
  //   1. Publishes scheduled_tick (triggers Dream State eligibility check)
  //   2. Calls scheduleDrain() to catch events that may have accumulated
  //      while the process was restarting or the reactive drain was busy
  //
  // The synchronous drain loop has been removed — the reactive worker handles it.
  app.post(
    "/api/scheduled/autonomous-loop-tick",
    requireCronOrAdmin,
    async (_req, res) => {
      try {
        const { publishEvent, scheduleDrain, getPendingEventCount } =
          await import("../autonomousLoop/eventBus");

        // Publish scheduled_tick so L0/L2 layers can react (Dream eligibility etc.)
        await publishEvent("scheduled_tick", {
          source: "cron",
          mode: "safety_net",
        });

        // Trigger a drain pass for any events that accumulated while process was idle
        scheduleDrain();
        const pendingBefore = await getPendingEventCount();

        // Check Dream State eligibility (converged = low queue depth)
        let dreamResult: unknown = null;
        try {
          const { checkDreamEligibility, runDreamSession } = await import(
            "../dream/dreamEngine"
          );
          const healthProxy = pendingBefore === 0 ? 80 : 50;
          const eligibility = await checkDreamEligibility(healthProxy);
          if (eligibility.eligible) {
            console.log(
              "[DreamEngine] Entering Dream State:",
              eligibility.reason
            );
            dreamResult = await runDreamSession({ healthScore: healthProxy });
          }
        } catch (dreamErr) {
          console.error(
            "[DreamEngine] Dream check failed (non-fatal):",
            dreamErr
          );
        }

        res.json({
          ok: true,
          mode: "safety_net",
          tickPublished: true,
          pendingEventsAtTick: pendingBefore,
          drainScheduled: true,
          dream: dreamResult,
        });
      } catch (err) {
        console.error("[AutonomousLoop] Safety-net tick failed:", err);
        res.status(500).json({ ok: false, error: (err as Error).message });
      }
    }
  );

  // ─── Autonomous Re-evaluation Loop (Phase 105) ────────────────────────────
  //
  // Triggered by heartbeat cron (every 6 hours). Discovers all claims whose
  // composite truth signals are stale because new citation edges have been
  // written since the last run, then re-scores them deterministically.
  // Idempotent: running twice produces the same result as running once.
  app.post(
    "/api/scheduled/re-evaluate",
    requireCronOrAdmin,
    async (req, res) => {
      try {
        const { runReEvaluationLoop } = await import("../reEvaluationEngine");
        const { withCronLog } = await import("../cronRunLogger");

        const lookbackHours = Math.min(
          parseInt(String(req.body?.lookbackHours ?? "24"), 10) || 24,
          168 // max 7 days
        );
        const batchSize = Math.min(
          parseInt(String(req.body?.batchSize ?? "500"), 10) || 500,
          2000
        );
        // Optional explicit document IDs (for targeted re-evaluation)
        const documentIds: number[] | undefined =
          Array.isArray(req.body?.documentIds) &&
          req.body.documentIds.length > 0
            ? (req.body.documentIds as unknown[])
                .map(Number)
                .filter(n => !isNaN(n))
            : undefined;

        const result = await withCronLog(
          "re-evaluate-composite-truth",
          async () => {
            const r = await runReEvaluationLoop({
              lookbackHours,
              batchSize,
              documentIds,
            });
            return (
              `Examined ${r.claimsExamined} claims across ${r.affectedDocuments} documents: ` +
              `${r.claimsUpdated} updated, ${r.claimsUnchanged} unchanged, ` +
              `${r.claimsErrored} errors — ${r.durationMs}ms`
            );
          }
        );

        res.json({
          ok: result.status === "ok",
          status: result.status,
          summary: result.summary,
          durationMs: result.durationMs,
        });
      } catch (err) {
        console.error("[ReEval] Scheduled re-evaluation failed:", err);
        res.status(500).json({ ok: false, error: (err as Error).message });
      }
    }
  );

  // ── Phase 107: Contradiction Detection Engine ──────────────────────────────
  //
  // Triggered by heartbeat cron (weekly). Traverses semantic_similar edges in
  // graph_claim_edges and flags claim pairs where one side is verified_faithful
  // or partially_supported and the other is contradicted / contradicted_amplified.
  // Persists findings to contradiction_alerts idempotently.
  app.post(
    "/api/scheduled/contradiction-scan",
    requireCronOrAdmin,
    async (req, res) => {
      try {
        const { runContradictionScan } = await import(
          "../contradictionDetector"
        );
        const batchSize = Math.min(
          parseInt(String(req.body?.batchSize ?? "500"), 10) || 500,
          2000
        );
        const result = await runContradictionScan(batchSize);
        res.json({
          ok: result.errors === 0,
          pairsScanned: result.pairsScanned,
          newAlerts: result.newAlerts,
          updatedAlerts: result.updatedAlerts,
          skippedResolved: result.skippedResolved,
          errors: result.errors,
          durationMs: result.durationMs,
        });
      } catch (err) {
        console.error("[ContradictionScan] Scheduled scan failed:", err);
        res.status(500).json({ ok: false, error: (err as Error).message });
      }
    }
  );

  // ── Phase 109: Source Version Agent ─────────────────────────────────────────
  //
  // Triggered by heartbeat cron (daily at 03:30 UTC). Polls each approved source,
  // computes a SHA-256 hash of the probe payload, and detects version changes.
  // On change, writes a source_versions row and publishes source_version_changed
  // to the autonomous loop event bus so affected claims get re-evaluated.
  app.post(
    "/api/scheduled/source-version-agent",
    requireCronOrAdmin,
    async (_req, res) => {
      try {
        const { runSourceVersionAgent } = await import("../sourceVersionAgent");
        const result = await runSourceVersionAgent();
        res.json({
          ok: true,
          sourcesChecked: result.sourcesChecked,
          sourcesUpdated: result.sourcesUpdated,
          sourcesUnchanged: result.sourcesUnchanged,
          sourcesErrored: result.sourcesErrored,
          sourcesSkipped: result.sourcesSkipped,
          durationMs: result.durationMs,
        });
      } catch (err) {
        console.error("[SourceVersionAgent] Scheduled run failed:", err);
        res.status(500).json({ ok: false, error: (err as Error).message });
      }
    }
  );

  // Admin bulk seed: triggers a long-lookback PMC feed across all verticals
  // Admin re-process: re-runs the analysis pipeline on all failed documents
  app.post(
    "/api/admin/reprocess-failed",
    requireOwnerOrAdmin,
    async (req, res) => {
      const {
        getFailedDocuments,
        updateDocumentStatus,
        deleteClaimsByDocument,
      } = await import("../db");
      const { runAnalysisPipeline } = await import("../analysisPipeline");
      const batchSize = Math.min(
        parseInt(String(req.body?.batchSize ?? "50"), 10) || 50,
        200
      );
      const docs = await getFailedDocuments(batchSize);
      if (docs.length === 0) {
        res.json({
          ok: true,
          message: "No failed documents found",
          requeued: 0,
        });
        return;
      }
      let requeued = 0;
      let failed = 0;
      const errors: string[] = [];
      // Process concurrently with cap of 5
      const queue = [...docs];
      const workers = Array.from({ length: 5 }, async () => {
        while (queue.length > 0) {
          const doc = queue.shift();
          if (!doc) break;
          if (!doc.rawText) {
            failed++;
            continue;
          }
          try {
            await deleteClaimsByDocument(doc.id);
            await updateDocumentStatus(doc.id, "pending");
            runAnalysisPipeline(doc.id, doc.rawText, doc.userId).catch(
              (e: unknown) =>
                console.error(`[Reprocess] doc ${doc.id} failed:`, e)
            );
            requeued++;
          } catch (e) {
            failed++;
            errors.push(`doc ${doc.id}: ${String(e)}`);
          }
        }
      });
      await Promise.all(workers);
      console.log(
        `[Reprocess] Requeued ${requeued} failed documents, ${failed} skipped`
      );
      res.json({ ok: true, requeued, failed, errors: errors.slice(0, 10) });
    }
  );

  app.post("/api/admin/bulk-seed", requireOwnerOrAdmin, async (req, res) => {
    // Delegate to pmcFeedJobHandler with allVerticals=true and extended lookback
    req.body = {
      ...req.body,
      allVerticals: true,
      lookbackDays: Math.min(
        parseInt(String(req.body?.lookbackDays ?? "90"), 10) || 90,
        365
      ),
    };
    return pmcFeedJobHandler(req, res);
  });

  // Public machine-readable claims registry (no auth required)
  registerClaimsRoutes(app);

  // Agent-callable single-claim verification endpoint
  registerVerifyClaimRoute(app);
  // Public question-to-claim answer endpoint (Phase 110)
  registerAnswerRoute(app);
  // SSE streaming verification endpoint (Phase 114)
  registerStreamVerifyRoute(app);
  // Perplexity-style citation search — full-adapter live pipeline (Sprint 29)
  registerCitationSearchRoute(app);
  // Epistemic provenance chain endpoint (Phase 121)
  registerProvenanceRoute(app);
  // Semantic similarity endpoint (Phase 124b)
  registerFindSimilarRoute(app);
  // Dream State manual trigger endpoint (Phase 127)
  app.use("/api/v2/dream", createDreamStartRouter());
  // Detailed health endpoint (Phase 129)
  app.get("/api/v2/health/detailed", detailedHealthHandler);
  // Ingestion alert heartbeat (Phase 129)
  app.post("/api/scheduled/ingestion-alerts", ingestionAlertHandler);
  registerMcpServer(app);
  // Public claim submission endpoint (Lovable site, MCP tools, external agents)
  registerSubmitClaimRoute(app);
  registerClaimPageRoute(app);
  registerWikiPageRoute(app);
  // IndexNow key verification file (Bing ownership proof — served at /<key>.txt)
  app.get(`/${ENV.indexNowKey || "_indexnow_disabled"}.txt`, (_req, res) => {
    if (!ENV.indexNowKey) {
      res.status(404).send("Not found");
      return;
    }
    res.set("Content-Type", "text/plain").send(ENV.indexNowKey);
  });
  registerBadgeRoute(app);
  registerEmbedWidgetRoutes(app);
  registerEmbedRoutes(app);
  // Hostinger inbound signed webhook — receives events from all Hostinger-hosted sites
  registerHostingerWebhookRoute(app);
  // Public translate-and-search REST API — natural language → cited evidence
  registerTranslateAndSearchApi(app);
  registerBackfillWikiRoute(app, requireOwnerOrAdmin);
  registerDreamStagingRoute(app, requireOwnerOrAdmin);
  registerBackfillEmbeddingsRoute(app, requireCronOrAdmin);
  registerBackfillDomainClaimsRoute(app, requireOwnerOrAdmin);
  // Phase 118-120: claim history, provenance, and batch verify
  registerClaimHistoryRoute(app);
  registerClaimProvenanceRoute(app);
  registerBatchVerifyRoute(app);
  // Phase 131: /api/external/public/* alias routes (third-pass audit fix)
  registerExternalPublicRoutes(app);

  // ─── Public stats endpoint — used by citation.is /status page ───────────────
  // Returns aggregate corpus stats without exposing internal pipeline details.
  app.get("/api/public/stats", async (_req, res) => {
    try {
      const { getGlobalPlatformStats } = await import("../db");
      const stats = await getGlobalPlatformStats();
      res.json({
        totalClaims: stats.totalClaims,
        verifiedClaims: stats.supportedVerdicts,
        totalDocuments: stats.totalDocuments,
        lastIngestAt: null,
        lastQualityPassAt: null,
        verticals: ["structural_biology", "salmon_biotech"],
        siaGeneration: 1,
        siaUpgradeRate: null,
      });
    } catch (err) {
      console.error("[/api/public/stats] error:", err);
      res.status(500).json({ error: "stats_unavailable" });
    }
  });

  // ── Public analytics endpoints ─────────────────────────────────────────────
  app.get("/api/public/verticals", async (_req, res) => {
    try {
      const { getVerticalStats } = await import("../db");
      const stats = await getVerticalStats();
      res.json({ verticals: stats });
    } catch (err) {
      console.error("[/api/public/verticals] error:", err);
      res.status(500).json({ error: "verticals_unavailable" });
    }
  });

  // Domain coverage status: per-domain claim counts, verification rates, last updated
  // Used by citation-desk /status page and enterprise API clients to assess coverage
  app.get("/api/public/status/domains", async (_req, res) => {
    try {
      const { getVerticalStats } = await import("../db");
      const stats = await getVerticalStats();
      // Map internal vertical stats to the 5 enterprise domains + any others
      const DOMAIN_LABELS: Record<string, string> = {
        biology: "Molecular Biology",
        medicine: "Clinical Medicine",
        chemistry: "Chemistry",
        physics: "Physics & Materials",
        climate: "Climate & Earth Science",
        structural_biology: "Structural Biology",
        salmon_biotech: "Salmon Biotech",
        protein_supplement: "Protein Supplements",
        creatine_ergogenics: "Creatine & Ergogenics",
        gut_microbiome: "Gut Microbiome",
        collagen_peptides: "Collagen & Peptides",
        plant_based_protein: "Plant-Based Protein",
        sports_nutrition_rct: "Sports Nutrition RCTs",
        uniprot: "UniProt Protein Identity",
        clinical_trials: "Clinical Trials",
      };
      const SLM_PAIR_THRESHOLD = 50;
      const domains = stats.map(s => {
        const pairsEstimate = Math.floor(s.totalClaims / 2);
        const slmReady = pairsEstimate >= SLM_PAIR_THRESHOLD;
        const pctToThreshold = Math.min(
          100,
          Math.round((pairsEstimate / SLM_PAIR_THRESHOLD) * 100)
        );
        return {
          domain: s.domain,
          label: DOMAIN_LABELS[s.domain] ?? s.domain,
          totalClaims: s.totalClaims,
          supportedClaims: s.supportedClaims,
          verificationRate:
            s.totalClaims > 0
              ? Math.round((s.supportedClaims / s.totalClaims) * 100)
              : 0,
          totalDocuments: s.totalDocs,
          completedDocuments: s.completedDocs,
          slm: {
            pairsEstimate,
            slmReady,
            pctToThreshold,
            threshold: SLM_PAIR_THRESHOLD,
          },
        };
      });
      const totals = domains.reduce(
        (acc, d) => ({
          totalClaims: acc.totalClaims + d.totalClaims,
          supportedClaims: acc.supportedClaims + d.supportedClaims,
          totalDocuments: acc.totalDocuments + d.totalDocuments,
        }),
        { totalClaims: 0, supportedClaims: 0, totalDocuments: 0 }
      );
      res.setHeader("Cache-Control", "public, max-age=300"); // 5-minute cache
      res.json({
        domains,
        totals,
        updatedAt: new Date().toISOString(),
      });
    } catch (err) {
      console.error("[/api/public/status/domains] error:", err);
      res.status(500).json({ error: "domains_unavailable" });
    }
  });
  // ── Corpus growth stats — powers the loop animation cards on the homepage ──
  // Sprint 20: wires live numbers to Papers Queued, Claims Extracted, etc.
  app.get("/api/public/corpus-growth", async (_req, res) => {
    try {
      const { getCorpusGrowthStats } = await import("../db");
      const g = await getCorpusGrowthStats();
      res.setHeader("Cache-Control", "public, max-age=60"); // 1-minute cache
      res.json({
        papersQueued: g.papersToday,
        claimsExtracted: g.claimsToday,
        verdictsAssigned: g.claimsToday, // proxy: every extracted claim gets a verdict
        graphNodes: g.totalGraphNodes,
        graphEdges: g.totalGraphEdges,
        totalClaims: g.totalClaims,
        updatedAt: new Date().toISOString(),
      });
    } catch (err) {
      console.error("[/api/public/corpus-growth] error:", err);
      res.status(500).json({ error: "corpus_growth_unavailable" });
    }
  });

  /**
   * RSS 2.0 feed — real-time claim updates for Perplexity and other AI indexers.
   * Served at both /rss.xml (canonical) and /api/public/rss (API path).
   * Includes the 50 most recent verified claims with verdict, confidence, and source URL.
   */
  const rssHandler = async (_req: express.Request, res: express.Response) => {
    try {
      const { getRecentVerifiedClaims } = await import("../db");
      const rows = await getRecentVerifiedClaims(50);
      const SITE = SITE_ORIGIN;
      const escXml = (s: string) =>
        s.replace(
          /[<>&"']/g,
          (ch: string) =>
            ({
              "<": "&lt;",
              ">": "&gt;",
              "&": "&amp;",
              '"': "&quot;",
              "'": "&apos;",
            })[ch] ?? ch
        );
      const items = rows
        .map(r => {
          const c = r.claim;
          const pubDate = c.createdAt
            ? new Date(c.createdAt).toUTCString()
            : new Date().toUTCString();
          const verdict = c.verdict ?? "Unverified";
          const confidence =
            c.confidenceScore != null
              ? ` (confidence: ${(Number(c.confidenceScore) * 100).toFixed(0)}%)`
              : "";
          const claimText = escXml(c.claimText ?? "");
          const link = `${SITE}/claims/${c.id}`;
          return [
            "    <item>",
            `      <title>${escXml(verdict)}${escXml(confidence)}: ${claimText.slice(0, 120)}</title>`,
            `      <link>${link}</link>`,
            `      <guid isPermaLink="true">${link}</guid>`,
            `      <pubDate>${pubDate}</pubDate>`,
            `      <description>${claimText}</description>`,
            `      <category>scientific-claim</category>`,
            "    </item>",
          ].join("\n");
        })
        .join("\n");
      const xml = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
        "  <channel>",
        "    <title>citation.is \u2014 Verified Scientific Claims</title>",
        `    <link>${SITE}</link>`,
        "    <description>Real-time feed of verified scientific claims across medicine, climate, economics, law, and structural biology.</description>",
        "    <language>en-us</language>",
        `    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>`,
        `    <atom:link href="${SITE}/rss.xml" rel="self" type="application/rss+xml" />`,
        items,
        "  </channel>",
        "</rss>",
      ].join("\n");
      res.setHeader("Content-Type", "application/rss+xml; charset=utf-8");
      res.setHeader("Cache-Control", "public, max-age=300"); // 5-minute cache
      res.send(xml);
    } catch (err) {
      console.error("[/rss.xml] error:", err);
      res
        .status(500)
        .send('<?xml version="1.0"?><error>rss_unavailable</error>');
    }
  };
  // ── Agent orchestrator endpoint ───────────────────────────────────────────
  // POST /api/public/agent — runs the full Planner→Executor→Verifier pipeline
  // Rate limit: 10 req/min per IP (NCBI unauthenticated cap is 3 req/s)
  const _agentRateMap = new Map<string, { count: number; resetAt: number }>();
  const AGENT_RATE_LIMIT = 10;
  const AGENT_WINDOW_MS = 60 * 1000;
  setInterval(
    () => {
      const now = Date.now();
      for (const [ip, entry] of Array.from(_agentRateMap.entries())) {
        if (now > entry.resetAt) _agentRateMap.delete(ip);
      }
    },
    5 * 60 * 1000
  );
  function _agentCheckRL(ip: string) {
    const now = Date.now();
    const e = _agentRateMap.get(ip);
    if (!e || now > e.resetAt) {
      _agentRateMap.set(ip, { count: 1, resetAt: now + AGENT_WINDOW_MS });
      return {
        allowed: true,
        remaining: AGENT_RATE_LIMIT - 1,
        resetAt: now + AGENT_WINDOW_MS,
      };
    }
    if (e.count >= AGENT_RATE_LIMIT)
      return { allowed: false, remaining: 0, resetAt: e.resetAt };
    e.count++;
    return {
      allowed: true,
      remaining: AGENT_RATE_LIMIT - e.count,
      resetAt: e.resetAt,
    };
  }
  app.options("/api/public/agent", (_req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.status(204).end();
  });
  app.post("/api/public/agent", async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    const ip =
      (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ??
      req.ip ??
      "unknown";
    const rl = _agentCheckRL(ip);
    res.setHeader("X-RateLimit-Limit", String(AGENT_RATE_LIMIT));
    res.setHeader("X-RateLimit-Remaining", String(rl.remaining));
    res.setHeader("X-RateLimit-Reset", String(Math.ceil(rl.resetAt / 1000)));
    if (!rl.allowed) {
      res.status(429).json({
        ok: false,
        error: "Rate limit exceeded. Max 10 req/min per IP.",
        retryAfterMs: rl.resetAt - Date.now(),
      });
      return;
    }
    try {
      const { runAgent } = await import("../agentOrchestrator");
      const { question } = req.body as { question?: string };
      if (
        !question ||
        typeof question !== "string" ||
        question.trim().length === 0
      ) {
        res.status(400).json({ ok: false, error: "question is required" });
        return;
      }
      if (question.trim().length > 500) {
        res.status(400).json({
          ok: false,
          error: "question must be at most 500 characters",
        });
        return;
      }
      const result = await runAgent(question.trim());
      res.json(result);
    } catch (err) {
      console.error("[/api/public/agent] error:", err);
      res.status(500).json({ ok: false, error: "agent_error" });
    }
  });

  app.get("/rss.xml", rssHandler);
  app.get("/api/public/rss", rssHandler);

  app.get("/api/public/leaderboard", async (req, res) => {
    try {
      const { getAllGraphEntities } = await import("../db");
      const limit = Math.min(
        parseInt((req.query.limit as string) ?? "20", 10),
        100
      );
      const entities = await getAllGraphEntities(limit);
      res.json({ entities });
    } catch (err) {
      console.error("[/api/public/leaderboard] error:", err);
      res.status(500).json({ error: "leaderboard_unavailable" });
    }
  });

  app.get("/api/public/contradictions", async (req, res) => {
    try {
      const { getContradictionRelations } = await import("../db");
      const limit = Math.min(
        parseInt((req.query.limit as string) ?? "50", 10),
        200
      );
      const contradictions = await getContradictionRelations(limit);
      res.json({ contradictions });
    } catch (err) {
      console.error("[/api/public/contradictions] error:", err);
      res.status(500).json({ error: "contradictions_unavailable" });
    }
  });

  // PDF report export endpoint (authenticated)
  app.get("/api/reports/:documentId/pdf", async (req, res) => {
    try {
      // Authenticate via session cookie
      let user: Awaited<ReturnType<typeof sdk.authenticateRequest>>;
      try {
        user = await sdk.authenticateRequest(req);
      } catch {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }
      void user; // user authenticated — ownership check via generatePdfReport

      const documentId = parseInt(req.params.documentId, 10);
      if (isNaN(documentId)) {
        res.status(400).json({ error: "Invalid document ID" });
        return;
      }

      const pdfBuffer = await generatePdfReport(documentId);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="audit-report-${documentId}.pdf"`
      );
      res.setHeader("Content-Length", pdfBuffer.length);
      res.end(pdfBuffer);
    } catch (err) {
      console.error("[PDF] Generation failed:", err);
      res.status(500).json({ error: "PDF generation failed" });
    }
  });

  // AI Engine Optimisation: /llms.txt
  registerLlmsRoute(app);
  registerSitemapRoute(app);

  // tRPC API — CORS headers so external frontends (Lovable, partner sites) can call public procedures
  app.use("/api/trpc", (req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, trpc-accept, x-trpc-source"
    );
    if (req.method === "OPTIONS") {
      res.sendStatus(204);
      return;
    }
    next();
  });
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });

  // Start Telegram bot (no-op if TELEGRAM_BOT_TOKEN not set)
  startTelegramBot().catch(err =>
    console.error("[TelegramBot] Startup error:", err)
  );
}

// ── Global process-level error handlers ─────────────────────────────────────
// Prevent unhandled promise rejections from silently crashing the reactive drain
// or background jobs without any log output.
process.on("unhandledRejection", (reason, promise) => {
  console.error(
    "[process] Unhandled rejection at:",
    promise,
    "reason:",
    reason
  );
});

process.on("uncaughtException", err => {
  console.error("[process] Uncaught exception:", err);
  // Do NOT exit — Cloud Run will restart the container on health-check failure;
  // exiting here would cause unnecessary cold starts for transient errors.
});

startServer().catch(console.error);
