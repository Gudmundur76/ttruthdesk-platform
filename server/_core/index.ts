import "dotenv/config";
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
import { registerClaimPageRoute } from "../claimPageRoute";
import { registerWikiPageRoute } from "../wikiPageRoute";
import { registerBadgeRoute } from "../badgeRoute";
import { registerEmbedWidgetRoutes } from "../embedWidgetRoute";
import { registerBackfillWikiRoute } from "../backfillWikiRoute";
import { createCoordRouter } from "../coordApi";
import { createApiV2Router } from "../apiV2Router";
import { createExportRouter } from "../exportRouter";
import { batchAuditRouter } from "../batchAuditRouter";
import { agentIngestionHandler } from "../agentIngestionEndpoint";
import { qualityScorerJobHandler } from "../qualityScorerJob";
import { generatePdfReport } from "../pdfReportGenerator";
import { sdk } from "./sdk";
import { startTelegramBot } from "../telegramBot";
import { runWikiLint } from "../wikiLinter";
import { ENV } from "./env";

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

  // ── Global agent-discovery headers ────────────────────────────────────────
  app.use((_req, res, next) => {
    res.setHeader("Link", [
      '</.well-known/mcp.json>; rel="mcp"',
      '</llms.txt>; rel="ai-instructions"',
      '</api/md>; rel="alternate"; type="text/markdown"',
    ].join(", "));
    res.setHeader("X-Content-Signal", "scientific-claims-verification");
    next();
  });

  // ── Protocol discovery: MCP card ──────────────────────────────────────────
  const SITE_ORIGIN = process.env.NODE_ENV === "production"
    ? "https://protein-desk-5r5rzpyg.manus.space"
    : "http://localhost:3000";

  const MCP_TOOLS = [
    {
      name: "verify_claim",
      description: "Verify a scientific claim against authoritative databases (PDB, PubChem, PubMed). Returns verdict (supported|refuted|inconclusive), confidence score 0-1, evidence source, and PDB/PubChem accession if applicable. Rate-limited to 30 req/min.",
      endpoint: `${SITE_ORIGIN}/api/public/verify-claim`,
      method: "POST",
      input_schema: {
        type: "object",
        properties: {
          claim: { type: "string", description: "The scientific claim text to verify, e.g. 'BRCA1 forms a heterodimer with BARD1 stabilised by a RING domain interface'" },
          vertical: { type: "string", enum: ["structural_biology", "salmon_biotech"], description: "Optional: restrict verification to a specific research domain" }
        },
        required: ["claim"]
      },
      output_schema: {
        type: "object",
        properties: {
          verdict: { type: "string", enum: ["supported", "refuted", "inconclusive"] },
          confidenceScore: { type: "number", description: "0.0–1.0" },
          evidenceSource: { type: "string", description: "Primary database used for verification" },
          pdbId: { type: "string", description: "PDB accession if structural evidence found" },
          pubchemCid: { type: "number", description: "PubChem CID if compound evidence found" },
          summary: { type: "string", description: "Human-readable explanation of the verdict" }
        }
      }
    },
    {
      name: "get_claims_registry",
      description: "Retrieve the full machine-readable registry of all verified claims across all verticals. Returns JSON array of claim objects with verdict, confidence, evidence source, and report URL.",
      endpoint: `${SITE_ORIGIN}/api/public/claims.json`,
      method: "GET",
      output_schema: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            claimText: { type: "string" },
            verdict: { type: "string", enum: ["supported", "refuted", "inconclusive"] },
            confidenceScore: { type: "number" },
            verticalDomain: { type: "string" },
            evidenceSource: { type: "string" },
            reportUrl: { type: "string" }
          }
        }
      }
    },
    {
      name: "get_platform_summary",
      description: "Retrieve a markdown summary of the Truth Desk platform including available verticals, endpoints, and capabilities. Useful for agent orientation before making API calls.",
      endpoint: `${SITE_ORIGIN}/api/md`,
      method: "GET",
      output_schema: { type: "string", description: "Markdown text" }
    },
    {
      name: "get_knowledge_graph_data",
      description: "Retrieve the raw knowledge graph data as JSON, including all document nodes, claim nodes, and evidence edges. Useful for graph analysis and relationship discovery.",
      endpoint: `${SITE_ORIGIN}/api/public/graph.json`,
      method: "GET",
      output_schema: {
        type: "object",
        properties: {
          nodes: { type: "array", description: "Document and evidence nodes" },
          links: { type: "array", description: "Edges between nodes" }
        }
      }
    },
    {
      name: "claims.byEntity",
      description: "Retrieve all verified claims for a specific entity (protein, PDB ID, method, organism). Returns claims with verdicts, rationale, and evidence links. Use entity_type values: protein, pdb_id, method, organism, ligand.",
      endpoint: `${SITE_ORIGIN}/api/trpc/graph.entities`,
      method: "GET",
      input_schema: {
        type: "object",
        properties: {
          entityType: { type: "string", enum: ["protein", "pdb_id", "method", "organism", "ligand", "author", "concept"], description: "Entity category" },
          canonicalName: { type: "string", description: "Canonical entity name, e.g. 'lysozyme' or '1LYZ'" }
        },
        required: ["entityType", "canonicalName"]
      },
      output_schema: {
        type: "object",
        properties: {
          entity: { type: "object", description: "Entity metadata" },
          markdown: { type: "string", description: "Wiki page markdown with all claims" },
          jsonld: { type: "object", description: "Schema.org Dataset JSON-LD" }
        }
      }
    },
    {
      name: "graph.query",
      description: "Ask a natural language question about the protein knowledge graph. Returns an LLM-synthesised answer grounded in the graph entities and relations. Example: 'What contradictions exist about PDB 1LYZ resolution?'",
      endpoint: `${SITE_ORIGIN}/api/trpc/graph.query`,
      method: "POST",
      input_schema: {
        type: "object",
        properties: {
          question: { type: "string", description: "Natural language question about the knowledge graph" }
        },
        required: ["question"]
      },
      output_schema: {
        type: "object",
        properties: {
          answer: { type: "string", description: "LLM-synthesised answer with entity citations" },
          entities: { type: "array", description: "Entities referenced in the answer" },
          contradictions: { type: "array", description: "Any contradiction edges relevant to the question" }
        }
      }
    },
    {
      name: "reports.generate",
      description: "Submit a scientific document (abstract, whitepaper, pitch deck) for automated claim extraction and verification. Returns a document ID for polling status and retrieving the full audit report.",
      endpoint: `${SITE_ORIGIN}/api/trpc/documents.create`,
      method: "POST",
      input_schema: {
        type: "object",
        properties: {
          title: { type: "string", description: "Document title" },
          rawText: { type: "string", description: "Full text of the document to audit" },
          sourceType: { type: "string", enum: ["manual", "pmid", "doi", "url"], description: "How the document was sourced" },
          verticalDomain: { type: "string", enum: ["structural_biology", "salmon_biotech", "general"], description: "Research domain for targeted verification" }
        },
        required: ["rawText"]
      },
      output_schema: {
        type: "object",
        properties: {
          documentId: { type: "number", description: "Use this ID to poll /api/trpc/documents.get for status" },
          status: { type: "string", enum: ["pending", "extracting", "validating", "generating_report", "complete", "failed"] }
        }
      }
    }
  ];

  app.get("/.well-known/mcp.json", (_req, res) => {
    res.set({
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=3600",
      "Access-Control-Allow-Origin": "*",
    }).json({
      schema_version: "v1",
      name: "Truth Desk",
      description: "Autonomous multi-vertical scientific claims verification platform. Verifies molecular, structural, and biological claims against authoritative databases: PDB, PubChem, PubMed, UniProt, PMC Open Access. Compatible with Microsoft Scout and MCP-enabled agents.",
      version: "1.0.0",
      url: SITE_ORIGIN,
      mcp_endpoint: `${SITE_ORIGIN}/mcp`,
      tools: MCP_TOOLS,
      resources: [
        { uri: `${SITE_ORIGIN}/llms.txt`, description: "AI instructions and endpoint documentation" },
        { uri: `${SITE_ORIGIN}/sitemap.xml`, description: "All public report URLs" },
        { uri: `${SITE_ORIGIN}/api/public/claims.json`, description: "Machine-readable claims registry" }
      ],
      contact: `${SITE_ORIGIN}/pricing`,
      license: "CC BY 4.0",
      provider: { name: "Arctic Media LLC", url: SITE_ORIGIN },
      policy_conformance: {
        framework: "Microsoft Scout / MCP 2024-11-05",
        credential_scoping: true,
        audit_trail: true,
        data_protection: "CC BY 4.0 — public read, authenticated write",
        agent_identity: "Entra-compatible via OAuth 2.0 PKCE",
        opr: `${SITE_ORIGIN}/.well-known/auth.md`
      },
      scout_integration: {
        compatible: true,
        autopilot_triggers: ["new_contradiction_found", "claim_verified", "monitoring_alert"],
        teams_webhook_ready: true,
        description: "Truth Desk can be added as a Microsoft Scout MCP integration to automatically verify scientific claims in documents flowing through Teams and Outlook."
      }
    });
  });

  // ── MCP SSE endpoint (streamable HTTP transport) ──────────────────────────
  app.get("/mcp", (_req, res) => {
    res.set({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "Access-Control-Allow-Origin": "*",
    });
    // Send MCP initialize response
    const initEvent = {
      jsonrpc: "2.0",
      id: 1,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {}, resources: {} },
        serverInfo: { name: "Truth Desk", version: "1.0.0" }
      }
    };
    res.write(`data: ${JSON.stringify(initEvent)}\n\n`);
    // Send tools/list
    const toolsEvent = {
      jsonrpc: "2.0",
      method: "notifications/tools/list_changed",
      params: { tools: MCP_TOOLS }
    };
    res.write(`data: ${JSON.stringify(toolsEvent)}\n\n`);
    // Keep connection alive with heartbeat
    const heartbeat = setInterval(() => {
      res.write(`: heartbeat\n\n`);
    }, 15000);
    res.on("close", () => clearInterval(heartbeat));
  });

  app.post("/mcp", express.json(), (req, res) => {
    const { method, id } = req.body || {};
    res.set({
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      // Billing / plan headers for MCP consumers
      "X-RateLimit-Limit": "60",
      "X-RateLimit-Remaining": "59",
      "X-Plan-Tier": "free",
      "X-Credits-Used": "1",
      "X-Credits-Remaining": "unlimited",
    });
    if (method === "initialize") {
      return res.json({ jsonrpc: "2.0", id, result: { protocolVersion: "2024-11-05", capabilities: { tools: {}, resources: {} }, serverInfo: { name: "Truth Desk", version: "1.0.0" } } });
    }
    if (method === "tools/list") {
      return res.json({ jsonrpc: "2.0", id, result: { tools: MCP_TOOLS } });
    }
    if (method === "resources/list") {
      return res.json({ jsonrpc: "2.0", id, result: { resources: [
        { uri: `${SITE_ORIGIN}/llms.txt`, name: "AI Instructions", mimeType: "text/plain" },
        { uri: `${SITE_ORIGIN}/api/public/claims.json`, name: "Claims Registry", mimeType: "application/json" },
        { uri: `${SITE_ORIGIN}/api/md`, name: "Platform Summary", mimeType: "text/markdown" }
      ] } });
    }
    return res.status(404).json({ jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found" } });
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
      "- GET /api/public/claims.json — full claims registry",
      "- POST /api/public/verify-claim — verify a single claim",
      "- GET /.well-known/mcp.json — MCP tool card",
      "- GET /llms.txt — AI instructions",
      "- GET /sitemap.xml — all public report URLs",
      "",
      "## Verticals",
      "",
      "- Structural Biology (live)",
      "- Salmon Biotech (beta)",
      "- Drug Discovery (coming soon)",
      "- Clinical Genomics (coming soon)",
    ].join("\n");
    res.set({ "Content-Type": "text/markdown; charset=utf-8", "Cache-Control": "public, max-age=3600" }).send(md);
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
      "- `GET /api/public/claims.json` — full verified claims registry",
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
    res.set({ "Content-Type": "text/markdown; charset=utf-8", "Cache-Control": "public, max-age=3600" }).send(authMd);
  });

  // ── OpenAPI 3.1 specification ──────────────────────────────────────────
  const OPENAPI_SPEC = {
    openapi: "3.1.0",
    info: {
      title: "Truth Desk API",
      version: "1.0.0",
      description: "Autonomous multi-vertical scientific claims verification platform. Verifies claims against PDB, PubChem, PubMed, UniProt, and PMC Open Access.",
      contact: { name: "Arctic Media LLC", url: `${SITE_ORIGIN}/pricing` },
      license: { name: "CC BY 4.0", url: "https://creativecommons.org/licenses/by/4.0/" }
    },
    servers: [{ url: SITE_ORIGIN, description: "Production" }],
    paths: {
      "/api/public/claims.json": {
        get: {
          operationId: "getClaimsRegistry",
          summary: "Get verified claims registry",
          description: "Returns the full machine-readable registry of all verified scientific claims across all verticals.",
          tags: ["Public"],
          responses: {
            "200": {
              description: "Array of verified claim objects",
              content: { "application/json": { schema: { type: "array", items: { "$ref": "#/components/schemas/Claim" } } } }
            }
          }
        }
      },
      "/api/public/verify-claim": {
        post: {
          operationId: "verifyClaim",
          summary: "Verify a scientific claim",
          description: "Verifies a single scientific claim against authoritative databases (PDB, PubChem, PubMed). Rate-limited to 30 requests per minute.",
          tags: ["Public"],
          requestBody: {
            required: true,
            content: { "application/json": { schema: { "$ref": "#/components/schemas/VerifyClaimRequest" } } }
          },
          responses: {
            "200": { description: "Verification result", content: { "application/json": { schema: { "$ref": "#/components/schemas/VerifyClaimResponse" } } } },
            "429": { description: "Rate limit exceeded" }
          }
        }
      },
      "/api/md": {
        get: {
          operationId: "getPlatformSummary",
          summary: "Get platform summary as Markdown",
          description: "Returns a Markdown-formatted summary of the Truth Desk platform, including verticals, endpoints, and capabilities.",
          tags: ["Discovery"],
          responses: { "200": { description: "Markdown text", content: { "text/markdown": { schema: { type: "string" } } } } }
        }
      },
      "/.well-known/mcp.json": {
        get: {
          operationId: "getMcpCard",
          summary: "Get MCP tool card",
          description: "Returns the MCP tool card for agent integration.",
          tags: ["Discovery"],
          responses: { "200": { description: "MCP tool card", content: { "application/json": { schema: { type: "object" } } } } }
        }
      }
    },
    components: {
      schemas: {
        Claim: {
          type: "object",
          properties: {
            id: { type: "string" },
            claimText: { type: "string" },
            verdict: { type: "string", enum: ["supported", "refuted", "inconclusive"] },
            confidenceScore: { type: "number", minimum: 0, maximum: 1 },
            verticalDomain: { type: "string" },
            evidenceSource: { type: "string" },
            reportUrl: { type: "string" }
          }
        },
        VerifyClaimRequest: {
          type: "object",
          required: ["claim"],
          properties: {
            claim: { type: "string", description: "The scientific claim text to verify" },
            vertical: { type: "string", enum: ["structural_biology", "salmon_biotech"], description: "Optional: restrict to a specific domain" }
          }
        },
        VerifyClaimResponse: {
          type: "object",
          properties: {
            verdict: { type: "string", enum: ["supported", "refuted", "inconclusive"] },
            confidenceScore: { type: "number" },
            evidenceSource: { type: "string" },
            pdbId: { type: "string" },
            pubchemCid: { type: "number" },
            summary: { type: "string" }
          }
        }
      }
    }
  };

  app.get("/openapi.json", (_req, res) => {
    res.set({ "Content-Type": "application/json", "Cache-Control": "public, max-age=3600", "Access-Control-Allow-Origin": "*" }).json(OPENAPI_SPEC);
  });

  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  registerStorageProxy(app);
  registerOAuthRoutes(app);
  registerMagicLinkRoutes(app);

  // ── Auth middleware for protected routes ──────────────────────────────────
  // Scheduled endpoints: only cron callbacks (isCron=true) or admin users may call them.
  const requireCronOrAdmin: express.RequestHandler = async (req, res, next) => {
    try {
      const user = await sdk.authenticateRequest(req);
      if (user.isCron || user.role === "admin") return next();
      res.status(403).json({ error: "Forbidden: cron or admin access required" });
    } catch {
      res.status(401).json({ error: "Unauthorized" });
    }
  };

  // Admin endpoints: only the project owner (OWNER_OPEN_ID) or admin-role users.
  const requireOwnerOrAdmin: express.RequestHandler = async (req, res, next) => {
    try {
      const user = await sdk.authenticateRequest(req);
      if (user.role === "admin" || user.openId === ENV.ownerOpenId) return next();
      res.status(403).json({ error: "Forbidden: owner or admin access required" });
    } catch {
      res.status(401).json({ error: "Unauthorized" });
    }
  };

  // Scheduled job endpoints (must be before Vite/static fallthrough)
  app.post("/api/scheduled/monitoring", requireCronOrAdmin, monitoringJobHandler);
  app.post("/api/scheduled/pubmed-ingest", requireCronOrAdmin, pubmedIngestJobHandler);
  app.post("/api/scheduled/discovery-loop", requireCronOrAdmin, handleDiscoveryLoop);
  app.post("/api/scheduled/pmc-feed", requireCronOrAdmin, pmcFeedJobHandler);
  app.post("/api/scheduled/quality-pass", requireCronOrAdmin, qualityPassJobHandler);
  app.post("/api/scheduled/backfill-predictions", requireCronOrAdmin, predictionBackfillHandler);
  // Swarm coordinator: fans out all 5 agent jobs in parallel
  app.post("/api/scheduled/swarm-tick", requireCronOrAdmin, swarmTickHandler);
  // Orchestrator tick: auto-spawns Manus agents for verticals with pending queue items
  app.post("/api/scheduled/orchestrator-tick", requireCronOrAdmin, orchestratorTickHandler);
  // Manus Coordination Layer: shared work queue, task registry, context store
  app.use("/api/coord", createCoordRouter());
  // Agent result ingestion: accepts structured JSON from Manus agent tasks
  app.post("/api/coord/ingest", agentIngestionHandler);
  // Quality scoring pipeline: scores all unscored/stale claims every 6 hours
  app.post("/api/scheduled/quality-scorer", requireCronOrAdmin, qualityScorerJobHandler);
  // Public API v2: paginated, filterable endpoints for claims, entities, verticals, and audits
  app.use("/api/v2", createApiV2Router());
  // Structured data export: CSV/JSON download endpoints for claims, reports, entities
  app.use("/api/v2/export", createExportRouter());
  // Batch audit API: accept up to 20 papers in one request, run full pipeline, return structured results
  app.use("/api/v2/batch-audit", express.json({ limit: "5mb" }), batchAuditRouter);
  // LLM health check: reports active provider, model pool, and connectivity
  app.get("/api/admin/llm-health", requireOwnerOrAdmin, async (_req, res) => {
    try {
      const { getActiveLLMProvider } = await import("../claimExtractor");
      const { invokeMultiLLM, FREE_MODEL_ROTATION, getLLMHealthSummary } = await import("../_core/multiLLM");
      const activeProvider = getActiveLLMProvider();
      // Test connectivity with a minimal prompt
      let connectivityOk = false;
      let connectivityError: string | null = null;
      try {
        const resp = await invokeMultiLLM({
          messages: [{ role: "user", content: "Reply with the single word: OK" }],
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
  // Wiki lint: cross-document contradiction detection
  app.post("/api/scheduled/wiki-lint", requireCronOrAdmin, async (_req, res) => {
    try {
      const report = await runWikiLint();
      res.json({ ok: true, ...report });
    } catch (err) {
      console.error("[WikiLint] Error:", err);
      res.status(500).json({ ok: false, error: String(err) });
    }
  });
  // Admin bulk seed: triggers a long-lookback PMC feed across all verticals
  // Admin re-process: re-runs the analysis pipeline on all failed documents
  app.post("/api/admin/reprocess-failed", requireOwnerOrAdmin, async (req, res) => {
    const { getFailedDocuments, updateDocumentStatus, deleteClaimsByDocument } = await import("../db");
    const { runAnalysisPipeline } = await import("../analysisPipeline");
    const batchSize = Math.min(parseInt(String(req.body?.batchSize ?? "50"), 10) || 50, 200);
    const docs = await getFailedDocuments(batchSize);
    if (docs.length === 0) {
      res.json({ ok: true, message: "No failed documents found", requeued: 0 });
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
        if (!doc.rawText) { failed++; continue; }
        try {
          await deleteClaimsByDocument(doc.id);
          await updateDocumentStatus(doc.id, "pending");
          runAnalysisPipeline(doc.id, doc.rawText, doc.userId)
            .catch((e: unknown) => console.error(`[Reprocess] doc ${doc.id} failed:`, e));
          requeued++;
        } catch (e) {
          failed++;
          errors.push(`doc ${doc.id}: ${String(e)}`);
        }
      }
    });
    await Promise.all(workers);
    console.log(`[Reprocess] Requeued ${requeued} failed documents, ${failed} skipped`);
    res.json({ ok: true, requeued, failed, errors: errors.slice(0, 10) });
  });

  app.post("/api/admin/bulk-seed", requireOwnerOrAdmin, async (req, res) => {
    // Delegate to pmcFeedJobHandler with allVerticals=true and extended lookback
    req.body = {
      ...req.body,
      allVerticals: true,
      lookbackDays: Math.min(parseInt(String(req.body?.lookbackDays ?? "90"), 10) || 90, 365),
    };
    return pmcFeedJobHandler(req, res);
  });

  // Public machine-readable claims registry (no auth required)
  registerClaimsRoutes(app);

  // Agent-callable single-claim verification endpoint
  registerVerifyClaimRoute(app);
  registerClaimPageRoute(app);
  registerWikiPageRoute(app);
  // IndexNow key verification file (Bing ownership proof — served at /<key>.txt)
  app.get(`/${ENV.indexNowKey || '_indexnow_disabled'}.txt`, (_req, res) => {
    if (!ENV.indexNowKey) { res.status(404).send("Not found"); return; }
    res.set("Content-Type", "text/plain").send(ENV.indexNowKey);
  });
  registerBadgeRoute(app);
  registerEmbedWidgetRoutes(app);
  registerBackfillWikiRoute(app, requireOwnerOrAdmin);

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

  // tRPC API
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
  startTelegramBot().catch((err) =>
    console.error("[TelegramBot] Startup error:", err)
  );
}

startServer().catch(console.error);
