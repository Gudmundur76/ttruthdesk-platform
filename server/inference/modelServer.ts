/**
 * modelServer.ts — Local Model HTTP Server
 *
 * Wraps the LocalClaimVerifier in a lightweight Express HTTP server so it can
 * be run as a sidecar process alongside the main API server.
 *
 * PRD_SKILLOPT_AGENT2MODEL §3.2 — model:serve script.
 *
 * Usage:
 *   pnpm model:serve                  # starts on port 8081 (default)
 *   MODEL_SERVER_PORT=9000 pnpm model:serve
 *
 * Endpoints:
 *   GET  /health                      → { status: "ok", modelId, available }
 *   GET  /capabilities                → LocalVerifierCapabilities
 *   POST /verify                      → { claimText, domain? } → LocalVerificationResult
 *   POST /verify/batch                → { claims: [{claimText, domain?}] } → LocalVerificationResult[]
 *
 * The server is intentionally minimal — no auth, no rate limiting — because it
 * is only accessible on localhost. The main API server (routers.ts) is the
 * public-facing entry point.
 */

import express, { type Request, type Response } from "express";
import { getLocalClaimVerifier } from "./claimVerifier";
import { logger } from "../logger";

const log = logger("inference/modelServer");

const PORT = parseInt(process.env.MODEL_SERVER_PORT ?? "8081", 10);

// ─── Request/Response Types ───────────────────────────────────────────────────

interface VerifyRequest {
  claimText: string;
  domain?: string;
}

interface BatchVerifyRequest {
  claims: VerifyRequest[];
}

// ─── Route Handlers ───────────────────────────────────────────────────────────

async function handleHealth(_req: Request, res: Response): Promise<void> {
  const verifier = getLocalClaimVerifier();
  const available = await verifier.ping();
  res.json({
    status: available ? "ok" : "degraded",
    modelId: process.env.LOCAL_MODEL_ID ?? "claim-verifier-v1-q4",
    available,
    timestamp: new Date().toISOString(),
  });
}

async function handleCapabilities(_req: Request, res: Response): Promise<void> {
  const verifier = getLocalClaimVerifier();
  const capabilities = await verifier.getCapabilities();
  res.json(capabilities);
}

async function handleVerify(req: Request, res: Response): Promise<void> {
  const body = req.body as Partial<VerifyRequest>;

  if (!body.claimText || typeof body.claimText !== "string") {
    res
      .status(400)
      .json({ error: "claimText is required and must be a string" });
    return;
  }

  if (body.claimText.length > 2000) {
    res
      .status(400)
      .json({ error: "claimText exceeds maximum length of 2000 characters" });
    return;
  }

  const verifier = getLocalClaimVerifier();
  const result = await verifier.verify(body.claimText, body.domain);
  res.json(result);
}

async function handleBatchVerify(req: Request, res: Response): Promise<void> {
  const body = req.body as Partial<BatchVerifyRequest>;

  if (!Array.isArray(body.claims)) {
    res.status(400).json({ error: "claims must be an array" });
    return;
  }

  if (body.claims.length === 0) {
    res.json([]);
    return;
  }

  if (body.claims.length > 50) {
    res.status(400).json({ error: "Maximum 50 claims per batch request" });
    return;
  }

  const verifier = getLocalClaimVerifier();
  const results = await Promise.all(
    body.claims.map(c => verifier.verify(c.claimText, c.domain))
  );
  res.json(results);
}

// ─── Server Factory ───────────────────────────────────────────────────────────

export function createModelServer(): express.Application {
  const app = express();
  app.use(express.json({ limit: "1mb" }));

  app.get("/health", (req, res) => void handleHealth(req, res));
  app.get("/capabilities", (req, res) => void handleCapabilities(req, res));
  app.post("/verify", (req, res) => void handleVerify(req, res));
  app.post("/verify/batch", (req, res) => void handleBatchVerify(req, res));

  // 404 handler
  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: "Not found" });
  });

  return app;
}

// ─── CLI Entry Point ──────────────────────────────────────────────────────────

// Only start the server when this file is run directly (not when imported)
if (require.main === module) {
  const app = createModelServer();
  app.listen(PORT, "127.0.0.1", () => {
    log.info(
      `[ModelServer] Local model server running on http://127.0.0.1:${PORT}`
    );
    log.info(`[ModelServer] Health: http://127.0.0.1:${PORT}/health`);
    log.info(`[ModelServer] Verify: POST http://127.0.0.1:${PORT}/verify`);
  });
}
