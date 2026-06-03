import "dotenv/config";
import compression from "compression";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { registerStorageProxy } from "./storageProxy";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { monitoringJobHandler } from "../monitoringJob";
import { pubmedIngestJobHandler } from "../pubmedIngestJob";
import { handleDiscoveryLoop } from "../discoveryLoopJob";
import { pmcFeedJobHandler } from "../pmcFeedJob";
import { qualityPassJobHandler } from "../qualityPassJob";
import { registerClaimsRoutes } from "../claimsRoutes";
import { registerLlmsRoute } from "../llmsRoute";
import { registerSitemapRoute } from "../sitemapRoute";
import { registerVerifyClaimRoute } from "../verifyClaimRoute";

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
    res.setHeader("Link", '</.well-known/mcp.json>; rel="mcp", </llms.txt>; rel="ai-instructions"');
    next();
  });

  // ── Protocol discovery: MCP card ──────────────────────────────────────────
  app.get("/.well-known/mcp.json", (_req, res) => {
    const origin = process.env.VITE_FRONTEND_FORGE_API_URL
      ? "https://protein-desk-5r5rzpyg.manus.space"
      : "http://localhost:3000";
    res.set({
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=3600",
      "Access-Control-Allow-Origin": "*",
    }).json({
      name: "Truth Desk",
      description: "Autonomous multi-vertical scientific claims verification platform. Verifies claims against PDB, PubChem, PMC Open Access, and domain-specific evidence sources.",
      version: "1.0.0",
      url: origin,
      tools: [
        {
          name: "verify_claim",
          description: "Verify a scientific claim against authoritative databases. Returns verdict, confidence score, and evidence references.",
          endpoint: `${origin}/api/public/verify-claim`,
          method: "POST",
          input_schema: {
            type: "object",
            properties: {
              claim: { type: "string", description: "The scientific claim text to verify" },
              vertical: { type: "string", enum: ["structural_biology", "salmon_biotech"], description: "Optional: restrict verification to a specific domain" }
            },
            required: ["claim"]
          }
        },
        {
          name: "get_claims_registry",
          description: "Retrieve the machine-readable registry of all verified claims across all verticals.",
          endpoint: `${origin}/api/public/claims.json`,
          method: "GET"
        }
      ],
      contact: `${origin}/pricing`,
      llms_txt: `${origin}/llms.txt`,
      sitemap: `${origin}/sitemap.xml`
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

  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  registerStorageProxy(app);
  registerOAuthRoutes(app);
  // Scheduled job endpoints (must be before Vite/static fallthrough)
  app.post("/api/scheduled/monitoring", monitoringJobHandler);
  app.post("/api/scheduled/pubmed-ingest", pubmedIngestJobHandler);
  app.post("/api/scheduled/discovery-loop", handleDiscoveryLoop);
  app.post("/api/scheduled/pmc-feed", pmcFeedJobHandler);
  app.post("/api/scheduled/quality-pass", qualityPassJobHandler);
  // Admin bulk seed: triggers a long-lookback PMC feed across all verticals
  app.post("/api/admin/bulk-seed", async (req, res) => {
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
}

startServer().catch(console.error);
