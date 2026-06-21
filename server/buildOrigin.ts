import type { Request } from "express";

/**
 * Derive the request origin from proxy headers, falling back to a default.
 *
 * `x-forwarded-proto` can contain a comma-separated list when requests pass
 * through multiple proxies (e.g. "https, http"). We take only the first value
 * so the constructed URL is always valid.
 *
 * @example
 *   buildOrigin(req, "http://localhost:3000")
 *   // → "https://citation.manus.space"  (in production behind a reverse proxy)
 *   // → "http://localhost:3000"       (in development, no proxy headers)
 */
export function buildOrigin(req: Request, fallback: string): string {
  const rawProto = req.headers["x-forwarded-proto"] as string | undefined;
  const proto = rawProto?.split(",")[0]?.trim();
  return proto ? `${proto}://${req.headers["host"]}` : fallback;
}
