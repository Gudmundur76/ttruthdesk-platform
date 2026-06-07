/**
 * micronDeploy.ts — Micron Deployment Service
 *
 * A "Micron" is a lightweight, auto-generated standalone site for a single
 * Truth Desk vertical. It can be deployed to Vercel, Netlify, Docker, or IPFS.
 *
 * Architecture:
 *  1. generateSiteConfig() — builds the full site config (pages, SEO, RSS, llms.txt)
 *  2. Deploy target adapters — vercel, netlify, docker, ipfs
 *  3. tRPC procedures — micron.deploy, micron.list, micron.status
 */

import { getDb } from "./db";
import { micronDeployments } from "../drizzle/schema";
import { eq } from "drizzle-orm";
import type { MicronDeployment } from "../drizzle/schema";

// ─── Types ────────────────────────────────────────────────────────────────────

export type DeployTarget = "vercel" | "netlify" | "docker" | "ipfs";

export interface MicronSiteConfig {
  verticalKey: string;
  displayName: string;
  domain?: string;
  description: string;
  primaryColor: string;
  /** JSON-serialisable page list */
  pages: Array<{
    path: string;
    title: string;
    description: string;
    template: "home" | "registry" | "claim" | "wiki" | "about";
  }>;
  seoMeta: {
    title: string;
    description: string;
    keywords: string[];
    ogImage?: string;
  };
  rssEnabled: boolean;
  llmsTxtEnabled: boolean;
  indexNowEnabled: boolean;
  apiBase: string;
}

export interface DeployResult {
  success: boolean;
  siteUrl?: string;
  deploymentId?: string;
  errorMessage?: string;
  /** Deploy-target-specific metadata */
  meta?: Record<string, string>;
}

// ─── Site config generator ────────────────────────────────────────────────────

export function generateSiteConfig(opts: {
  verticalKey: string;
  displayName: string;
  domain?: string;
  apiBase: string;
}): MicronSiteConfig {
  const { verticalKey, displayName, domain, apiBase } = opts;

  const verticalColors: Record<string, string> = {
    structural_biology: "#7c3aed",
    salmon_biotech: "#0891b2",
    protein_supplement: "#16a34a",
    creatine_ergogenics: "#ea580c",
    gut_microbiome: "#65a30d",
    collagen_peptides: "#db2777",
    plant_based_protein: "#15803d",
    sports_nutrition_rct: "#b45309",
    uniprot: "#2563eb",
    clinical_trials: "#dc2626",
  };

  return {
    verticalKey,
    displayName,
    domain,
    description: `Verified scientific claims for ${displayName} — powered by Truth Desk`,
    primaryColor: verticalColors[verticalKey] ?? "#7c3aed",
    pages: [
      {
        path: "/",
        title: `${displayName} Claims Registry`,
        description: `Browse verified scientific claims in ${displayName}`,
        template: "home",
      },
      {
        path: "/registry",
        title: "Claims Registry",
        description: "All verified claims with verdicts and evidence",
        template: "registry",
      },
      {
        path: "/wiki",
        title: "Knowledge Wiki",
        description: "Entity-level knowledge pages",
        template: "wiki",
      },
      {
        path: "/about",
        title: "About",
        description: "How claims are verified",
        template: "about",
      },
    ],
    seoMeta: {
      title: `${displayName} — Truth Desk`,
      description: `Verified scientific claims for ${displayName}. Powered by Truth Desk autonomous verification.`,
      keywords: [displayName, "scientific claims", "verification", "evidence-based", verticalKey],
    },
    rssEnabled: true,
    llmsTxtEnabled: true,
    indexNowEnabled: true,
    apiBase,
  };
}

// ─── HTML escape helper ──────────────────────────────────────────────────────
function escHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

// ─── Site template HTML generator ────────────────────────────────────────────

export function generateSiteHtml(config: MicronSiteConfig): string {
  // Escape all user-controlled strings before interpolating into HTML
  const safeTitle = escHtml(config.seoMeta.title);
  const safeDesc = escHtml(config.seoMeta.description);
  const safeKeywords = escHtml(config.seoMeta.keywords.join(", "));
  const safeDisplayName = escHtml(config.displayName);
  const safeSiteDesc = escHtml(config.description);
  const safeVerticalKey = encodeURIComponent(config.verticalKey);
  // apiBase must be a valid https URL — strip anything that isn't
  const safeApiBase = /^https?:\/\/[a-zA-Z0-9._:/-]+$/.test(config.apiBase)
    ? config.apiBase
    : "https://ttruthdesk.claims";
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${safeTitle}</title>
  <meta name="description" content="${safeDesc}" />
  <meta name="keywords" content="${safeKeywords}" />
  <meta property="og:title" content="${safeTitle}" />
  <meta property="og:description" content="${safeDesc}" />
  <meta property="og:type" content="website" />
  <link rel="alternate" type="application/rss+xml" title="${safeDisplayName} Claims Feed" href="/rss.xml" />
  <style>
    :root { --accent: ${config.primaryColor}; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0d0b12; color: #e8e6f0; }
    header { padding: 24px 32px; border-bottom: 1px solid #2d2a3d; display: flex; align-items: center; gap: 12px; }
    .logo { width: 32px; height: 32px; background: var(--accent); border-radius: 8px; }
    h1 { font-size: 20px; font-weight: 700; }
    .badge { background: var(--accent); color: #fff; font-size: 11px; padding: 2px 8px; border-radius: 12px; }
    main { max-width: 900px; margin: 0 auto; padding: 40px 24px; }
    .hero { text-align: center; margin-bottom: 48px; }
    .hero h2 { font-size: 36px; font-weight: 800; margin-bottom: 12px; }
    .hero p { font-size: 16px; opacity: 0.7; }
    .widget-container { background: #1a1730; border: 1px solid #2d2a3d; border-radius: 16px; padding: 24px; margin: 32px 0; }
    iframe { width: 100%; height: 440px; border: none; border-radius: 12px; }
    .powered { text-align: center; margin-top: 48px; font-size: 12px; opacity: 0.4; }
    .powered a { color: inherit; }
  </style>
  <script>
    window.TruthDesk = { config: { vertical: ${JSON.stringify(config.verticalKey)}, theme: 'dark', apiBase: ${JSON.stringify(safeApiBase)} } };
  </script>
  <script src="${safeApiBase}/embed/sdk.js" async></script>
</head>
<body>
  <header>
    <div class="logo"></div>
    <h1>${safeDisplayName}</h1>
    <span class="badge">Truth Desk</span>
  </header>
  <main>
    <div class="hero">
      <h2>Verified Scientific Claims</h2>
      <p>${safeSiteDesc}</p>
    </div>
    <div class="widget-container">
      <iframe
        src="${safeApiBase}/api/embed/frame?vertical=${safeVerticalKey}&theme=dark"
        title="Truth Desk Claim Verifier"
        sandbox="allow-scripts allow-same-origin allow-popups"
      ></iframe>
    </div>
  </main>
  <div class="powered">Powered by <a href="${safeApiBase}" target="_blank">Truth Desk</a></div>
</body>
</html>`;
}

// ─── Deploy target adapters ───────────────────────────────────────────────────

/** Validate that a hook URL is a safe HTTPS endpoint at a known provider */
function validateHookUrl(url: string, allowedHosts: string[]): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return false;
    return allowedHosts.some(h => parsed.hostname === h || parsed.hostname.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

async function deployToVercel(
  config: MicronSiteConfig,
  deployConfig: Record<string, string>
): Promise<DeployResult> {
  // Vercel Deploy Hook — POST to the deploy hook URL triggers a new deployment
  const hookUrl = deployConfig.vercelDeployHook;
  if (!hookUrl) {
    return {
      success: false,
      errorMessage:
        "Vercel deploy hook URL not configured. Add vercelDeployHook to deployment config.",
    };
  }
  if (!validateHookUrl(hookUrl, ["api.vercel.com", "vercel.com"])) {
    return { success: false, errorMessage: "Invalid Vercel deploy hook URL. Must be an https://api.vercel.com or https://vercel.com URL." };
  }
  try {
    const res = await fetch(hookUrl, {
      method: "POST",
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      return { success: false, errorMessage: `Vercel hook returned ${res.status}` };
    }
    const data = (await res.json()) as { job?: { id?: string } };
    return {
      success: true,
      siteUrl: deployConfig.vercelSiteUrl || `https://${config.verticalKey.replace(/_/g, "-")}.vercel.app`,
      deploymentId: data.job?.id,
      meta: { provider: "vercel", hookTriggered: "true" },
    };
  } catch (e: unknown) {
    return { success: false, errorMessage: String(e) };
  }
}

async function deployToNetlify(
  config: MicronSiteConfig,
  deployConfig: Record<string, string>
): Promise<DeployResult> {
  const hookUrl = deployConfig.netlifyBuildHook;
  if (!hookUrl) {
    return {
      success: false,
      errorMessage:
        "Netlify build hook URL not configured. Add netlifyBuildHook to deployment config.",
    };
  }
  if (!validateHookUrl(hookUrl, ["api.netlify.com", "netlify.com"])) {
    return { success: false, errorMessage: "Invalid Netlify build hook URL. Must be an https://api.netlify.com URL." };
  }
  try {
    const res = await fetch(hookUrl, {
      method: "POST",
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      return { success: false, errorMessage: `Netlify hook returned ${res.status}` };
    }
    return {
      success: true,
      siteUrl:
        deployConfig.netlifySiteUrl ||
        `https://${config.verticalKey.replace(/_/g, "-")}.netlify.app`,
      meta: { provider: "netlify", hookTriggered: "true" },
    };
  } catch (e: unknown) {
    return { success: false, errorMessage: String(e) };
  }
}

async function deployToDocker(
  config: MicronSiteConfig,
  _deployConfig: Record<string, string>
): Promise<DeployResult> {
  // Generate docker-compose.yml content for the micron site
  const composeYml = `version: '3.8'
services:
  ${config.verticalKey}-site:
    image: nginx:alpine
    ports:
      - "8080:80"
    volumes:
      - ./html:/usr/share/nginx/html:ro
    environment:
      - VERTICAL=${config.verticalKey}
      - API_BASE=${config.apiBase}
    restart: unless-stopped
    labels:
      - "com.truthdesk.vertical=${config.verticalKey}"
      - "com.truthdesk.micron=true"
`;
  // Return the compose file as metadata — the user can download and run it
  return {
    success: true,
    siteUrl: `http://localhost:8080`,
    meta: {
      provider: "docker",
      composeYml,
      htmlContent: generateSiteHtml(config),
      instructions: "Download the docker-compose.yml and html/index.html, then run: docker-compose up -d",
    },
  };
}

async function deployToIpfs(
  config: MicronSiteConfig,
  deployConfig: Record<string, string>
): Promise<DeployResult> {
  // IPFS deployment via Pinata or web3.storage API
  const pinataJwt = deployConfig.pinataJwt;
  if (!pinataJwt) {
    return {
      success: false,
      errorMessage: "Pinata JWT not configured. Add pinataJwt to deployment config.",
    };
  }
  const html = generateSiteHtml(config);
  try {
    const formData = new FormData();
    const blob = new Blob([html], { type: "text/html" });
    formData.append("file", blob, "index.html");
    formData.append(
      "pinataMetadata",
      JSON.stringify({ name: `truthdesk-${config.verticalKey}` })
    );
    const res = await fetch("https://api.pinata.cloud/pinning/pinFileToIPFS", {
      method: "POST",
      headers: { Authorization: `Bearer ${pinataJwt}` },
      body: formData,
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      return { success: false, errorMessage: `Pinata returned ${res.status}` };
    }
    const data = (await res.json()) as { IpfsHash?: string };
    const cid = data.IpfsHash;
    return {
      success: true,
      siteUrl: `https://ipfs.io/ipfs/${cid}`,
      deploymentId: cid,
      meta: { provider: "ipfs", cid: cid ?? "" },
    };
  } catch (e: unknown) {
    return { success: false, errorMessage: String(e) };
  }
}

// ─── Main deploy function ─────────────────────────────────────────────────────

export async function deployMicron(opts: {
  deploymentId: number;
  verticalKey: string;
  displayName: string;
  domain?: string;
  deployTarget: DeployTarget;
  config: Record<string, string>;
  apiBase: string;
}): Promise<DeployResult> {
  const { deploymentId, verticalKey, displayName, domain, deployTarget, config, apiBase } = opts;

  // Mark as building
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  await db
    .update(micronDeployments)
    .set({ status: "building" })
    .where(eq(micronDeployments.id, deploymentId));

  const siteConfig = generateSiteConfig({ verticalKey, displayName, domain, apiBase });

  let result: DeployResult;
  try {
    switch (deployTarget) {
      case "vercel":
        result = await deployToVercel(siteConfig, config);
        break;
      case "netlify":
        result = await deployToNetlify(siteConfig, config);
        break;
      case "docker":
        result = await deployToDocker(siteConfig, config);
        break;
      case "ipfs":
        result = await deployToIpfs(siteConfig, config);
        break;
      default:
        result = { success: false, errorMessage: `Unknown deploy target: ${deployTarget}` };
    }
  } catch (e: unknown) {
    result = { success: false, errorMessage: String(e) };
  }

  // Update DB record
  const db2 = await getDb();
  if (db2) await db2
    .update(micronDeployments)
    .set({
      status: result.success ? "deployed" : "failed",
      siteUrl: result.siteUrl,
      errorMessage: result.errorMessage,
      deployedAt: result.success ? new Date() : undefined,
    })
    .where(eq(micronDeployments.id, deploymentId));

  return result;
}

// ─── DB helpers ───────────────────────────────────────────────────────────────

export async function createMicronDeployment(opts: {
  verticalKey: string;
  displayName: string;
  domain?: string;
  deployTarget: DeployTarget;
  config: Record<string, string>;
  userId: number;
}): Promise<MicronDeployment> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const [row] = await db
    .insert(micronDeployments)
    .values({
      verticalKey: opts.verticalKey,
      displayName: opts.displayName,
      domain: opts.domain,
      deployTarget: opts.deployTarget,
      config: opts.config,
      userId: opts.userId,
      status: "pending",
    })
    .$returningId();
  const [deployment] = await db
    .select()
    .from(micronDeployments)
    .where(eq(micronDeployments.id, row.id));
  return deployment;
}

export async function getMicronDeploymentsByUser(userId: number): Promise<MicronDeployment[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(micronDeployments)
    .where(eq(micronDeployments.userId, userId))
    .orderBy(micronDeployments.createdAt);
}

export async function getMicronDeploymentById(id: number): Promise<MicronDeployment | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const [row] = await db
    .select()
    .from(micronDeployments)
    .where(eq(micronDeployments.id, id));
  return row;
}

export async function getAllMicronDeployments(): Promise<MicronDeployment[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(micronDeployments)
    .orderBy(micronDeployments.createdAt);
}
