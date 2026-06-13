import { logger, errData } from "../logger";
const log = logger("seo/indexNow");

/**
 * server/seo/indexNow.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * IndexNow integration for instant Bing/Perplexity re-indexing.
 *
 * When a claim is updated, a wiki page is compiled, or monitoring finds new
 * evidence, ping IndexNow so Bing re-crawls within hours instead of weeks.
 *
 * Setup:
 *   1. Set INDEX_NOW_KEY in environment secrets.
 *   2. Create a verification file at /<INDEX_NOW_KEY>.txt on the server
 *      (content = the key itself). This is handled automatically by the
 *      Express route registered in registerIndexNowVerificationRoute().
 *
 * Docs: https://www.indexnow.org/documentation
 */

const INDEXNOW_ENDPOINT = "https://api.indexnow.org/indexnow";
const DEFAULT_HOST = "protein-desk-5r5rzpyg.manus.space";
const BATCH_SIZE = 10_000; // IndexNow max per request

function getHost(): string {
  if (process.env.VITE_APP_URL) {
    try {
      return new URL(process.env.VITE_APP_URL).hostname;
    } catch {
      // fall through
    }
  }
  return DEFAULT_HOST;
}

function getKey(): string | null {
  return process.env.INDEX_NOW_KEY ?? null;
}

/**
 * Notify IndexNow about a single URL update.
 * Fire-and-forget — errors are logged but never thrown.
 */
export async function notifyIndexNow(url: string): Promise<void> {
  const key = getKey();
  if (!key) {
    // Key not configured — skip silently in dev
    return;
  }

  const host = getHost();

  try {
    const res = await fetch(INDEXNOW_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        host,
        key,
        keyLocation: `https://${host}/${key}.txt`,
        urlList: [url],
      }),
    });

    if (!res.ok && res.status !== 202) {
      log.warn(`[IndexNow] Unexpected status ${res.status} for ${url}`);
    } else {
      log.info(`[IndexNow] Pinged: ${url}`);
    }
  } catch (err) {
    log.warn(`[IndexNow] Failed to ping ${url}:`, errData(err));
  }
}

/**
 * Notify IndexNow about multiple URL updates in a single request.
 * Automatically batches if > 10,000 URLs.
 * Fire-and-forget — errors are logged but never thrown.
 */
export async function notifyIndexNowBatch(urls: string[]): Promise<void> {
  const key = getKey();
  if (!key || urls.length === 0) return;

  const host = getHost();

  for (let i = 0; i < urls.length; i += BATCH_SIZE) {
    const batch = urls.slice(i, i + BATCH_SIZE);
    try {
      const res = await fetch(INDEXNOW_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify({
          host,
          key,
          keyLocation: `https://${host}/${key}.txt`,
          urlList: batch,
        }),
      });

      if (!res.ok && res.status !== 202) {
        log.warn(`[IndexNow] Batch ${i / BATCH_SIZE + 1}: unexpected status ${res.status}`);
      } else {
        log.info(`[IndexNow] Batch pinged: ${batch.length} URLs`);
      }
    } catch (err) {
      log.warn(`[IndexNow] Batch failed:`, errData(err));
    }
  }
}

/**
 * Build the canonical public URL for a claim page.
 */
export function claimUrl(claimId: number): string {
  const host = getHost();
  return `https://${host}/claim/${claimId}`;
}

/**
 * Build the canonical public URL for a wiki page.
 */
export function wikiUrl(entityType: string, entitySlug: string): string {
  const host = getHost();
  return `https://${host}/wiki/${entityType}/${entitySlug}`;
}

/**
 * Build the canonical public URL for a public audit report.
 */
export function reportUrl(documentId: number): string {
  const host = getHost();
  return `https://${host}/reports/${documentId}`;
}
