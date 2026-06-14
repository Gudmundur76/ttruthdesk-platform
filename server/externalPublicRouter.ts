/**
 * externalPublicRouter.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Alias routes for the /api/external/public/* path prefix.
 *
 * Some external integrations (OpenAPI spec generators, third-party audit tools)
 * discovered and cached the /api/external/public/* path prefix.  These routes
 * are thin proxies that forward each request to the canonical /api/public/*
 * handler by rewriting req.url and re-dispatching through the app router.
 *
 * Canonical routes (the real implementations):
 *   GET /api/public/claims/:id          — single claim by numeric or composite ID
 *   GET /api/public/stats               — aggregate corpus stats
 *   GET /api/public/verticals           — per-vertical stats
 *   GET /api/public/leaderboard         — top graph entities
 *   GET /api/public/contradictions      — recent contradiction pairs
 *
 * Alias routes (this file):
 *   GET /api/external/public/claims/:id → /api/public/claims/:id
 *   GET /api/external/public/stats      → /api/public/stats
 *   GET /api/external/public/verticals  → /api/public/verticals
 *   GET /api/external/public/leaderboard → /api/public/leaderboard
 *   GET /api/external/public/contradictions → /api/public/contradictions
 *
 * Design constraints: max 200 lines, max 20 lines/function, max 3 params
 */
import type { Express, Request, Response, NextFunction } from "express";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

/** Rewrite /api/external/public/* → /api/public/* and re-dispatch */
function forwardToPublic(
  app: Express,
  req: Request,
  res: Response,
  next: NextFunction
): void {
  req.url = req.url.replace(/^\/api\/external\/public/, "/api/public");
  app(req, res, next);
}

export function registerExternalPublicRoutes(app: Express): void {
  // OPTIONS pre-flight for all alias routes
  app.options("/api/external/public/*", (_req, res) => {
    res.set(CORS_HEADERS).status(204).end();
  });

  // GET /api/external/public/claims/:id
  app.get("/api/external/public/claims/:id", (req, res, next) => {
    forwardToPublic(app, req, res, next);
  });

  // GET /api/external/public/stats
  app.get("/api/external/public/stats", (req, res, next) => {
    forwardToPublic(app, req, res, next);
  });

  // GET /api/external/public/verticals
  app.get("/api/external/public/verticals", (req, res, next) => {
    forwardToPublic(app, req, res, next);
  });

  // GET /api/external/public/leaderboard
  app.get("/api/external/public/leaderboard", (req, res, next) => {
    forwardToPublic(app, req, res, next);
  });

  // GET /api/external/public/contradictions
  app.get("/api/external/public/contradictions", (req, res, next) => {
    forwardToPublic(app, req, res, next);
  });
}
