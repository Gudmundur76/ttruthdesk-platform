/**
 * verticalCopilotActions.ts — Per-Vertical CopilotKit Action Sets
 *
 * Defines three tiers of CopilotKit server-side tools:
 *  - Laxey tier    (SMB / supplement brands) — claim verify, registry browse, embed code gen
 *  - Alvotech tier (pharma / biotech)         — + document audit, clinical trial lookup, entity graph
 *  - Academic tier (research institutions)    — + full discovery engine, adapter codegen, knowledge export
 *
 * These are registered as CopilotKit tools in server/copilotRuntime.ts
 */

import { getDb } from "./db";
import { claims, documents, verticalConfigs } from "../drizzle/schema";
import { eq, desc } from "drizzle-orm";
import {
  BUILT_IN_SOURCES,
  probeSource,
  createDiscoveryRun,
  runDiscovery,
  getDiscoveryRun,
  getRegistryEntriesByVertical,
} from "./discoveryEngine";
import {
  createMicronDeployment,
  deployMicron,
  getMicronDeploymentsByUser,
  generateSiteConfig,
  generateSiteHtml,
} from "./micronDeploy";
import { generateDockerCompose, generateNginxConfig } from "./privateMode";
import { logger, errData } from "./logger";
const log = logger("verticalCopilotActions");


// ─── Shared helpers ───────────────────────────────────────────────────────────

async function getRecentClaimsForVertical(verticalKey: string, limit = 10) {
  const db = await getDb();
  if (!db) return [];
  // claims doesn't have verticalDomain — select all recent claims up to limit
  return db
    .select({
      id: claims.id,
      claimText: claims.claimText,
      verdict: claims.verdict,
      confidenceScore: claims.confidenceScore,
    })
    .from(claims)
    .orderBy(desc(claims.createdAt))
    .limit(limit);
}

// ─── Laxey tier tools ─────────────────────────────────────────────────────────

export const LAXEY_TOOLS = {
  /** Verify a single claim against the knowledge base */
  async verifyClaim(args: { claim: string; vertical?: string }) {
    const { claim, vertical = "protein_supplement" } = args;
    // Delegate to the existing public verify-claim endpoint logic
    const db = await getDb();
    if (!db) return { error: "Database unavailable" };

    // Simple similarity search in existing claims
    const allClaims = await db
      .select({
        id: claims.id,
        claimText: claims.claimText,
        verdict: claims.verdict,
        confidenceScore: claims.confidenceScore,
        rationale: claims.verdictRationale,
      })
      .from(claims)
      .limit(50);

    const lower = claim.toLowerCase();
    const match = allClaims.find(c =>
      c.claimText.toLowerCase().includes(lower.slice(0, 30))
    );

    if (match) {
      return {
        verdict: match.verdict,
        confidence: match.confidenceScore,
        rationale: match.rationale,
        source: "knowledge_base",
        claimId: match.id,
      };
    }

    return {
      verdict: "Insufficient Evidence",
      confidence: 0,
      rationale: `No matching claim found in the ${vertical} knowledge base for: "${claim}"`,
      source: "knowledge_base",
    };
  },

  /** Get recent claims for a vertical */
  async getRecentClaims(args: { vertical?: string; limit?: number }) {
    const { limit = 10 } = args;
    return getRecentClaimsForVertical("structural_biology", limit);
  },

  /** Generate embed code for a vertical */
  generateEmbedCode(args: {
    vertical: string;
    theme?: "auto" | "light" | "dark";
    position?: "bottom-right" | "bottom-left" | "top-right" | "top-left";
    apiBase?: string;
  }) {
    const {
      vertical,
      theme = "auto",
      position = "bottom-right",
      apiBase = "https://truthdesk.claims",
    } = args;

    const iframeCode = `<!-- Truth Desk Embed Widget -->
<iframe
  src="${apiBase}/api/embed/frame?vertical=${vertical}&theme=${theme}"
  width="400"
  height="440"
  frameborder="0"
  style="border-radius:16px;box-shadow:0 4px 24px rgba(0,0,0,.15);"
  title="Truth Desk Claim Verifier"
  sandbox="allow-scripts allow-same-origin allow-popups"
></iframe>`;

    const sdkCode = `<!-- Truth Desk Floating Widget SDK -->
<script>
  window.TruthDesk = {
    config: {
      vertical: '${vertical}',
      theme: '${theme}',
      position: '${position}',
      apiBase: '${apiBase}'
    }
  };
</script>
<script src="${apiBase}/embed/sdk.js" async></script>`;

    return {
      iframeCode,
      sdkCode,
      vertical,
      previewUrl: `${apiBase}/api/embed/frame?vertical=${vertical}&theme=${theme}`,
    };
  },

  /** Get available verticals */
  async getVerticals() {
    const db = await getDb();
    if (!db) return [];
    const rows = await db
      .select({
        domainKey: verticalConfigs.domainKey,
        displayName: verticalConfigs.displayName,
        enabled: verticalConfigs.enabled,
      })
      .from(verticalConfigs)
      .where(eq(verticalConfigs.enabled, true));
    return rows;
  },
};

// ─── Alvotech tier tools (extends Laxey) ─────────────────────────────────────

export const ALVOTECH_TOOLS = {
  ...LAXEY_TOOLS,

  /** Get document audit status */
  async getDocumentAudit(args: { documentId?: number; limit?: number }) {
    const db = await getDb();
    if (!db) return [];
    const q = db
      .select({
        id: documents.id,
        title: documents.title,
        status: documents.status,
        claimCount: documents.claimCount,
        verticalDomain: documents.verticalDomain,
        createdAt: documents.createdAt,
      })
      .from(documents)
      .orderBy(desc(documents.createdAt))
      .limit(args.limit ?? 20);
    return q;
  },

  /** Get entity claims (protein, PDB ID, etc.) */
  async getEntityClaims(args: { entityType: string; canonicalName: string }) {
    const db = await getDb();
    if (!db)
      return {
        claims: [],
        entityType: args.entityType,
        canonicalName: args.canonicalName,
      };
    // Fetch a broader set then filter in-memory by canonicalName match
    const all = await db
      .select({
        id: claims.id,
        claimText: claims.claimText,
        verdict: claims.verdict,
        confidenceScore: claims.confidenceScore,
        rationale: claims.verdictRationale,
        pdbId: claims.pdbId,
        proteinName: claims.proteinName,
      })
      .from(claims)
      .limit(200);
    const lower = args.canonicalName.toLowerCase();
    const rows = all
      .filter(
        c =>
          c.claimText?.toLowerCase().includes(lower) ||
          c.proteinName?.toLowerCase().includes(lower) ||
          c.pdbId?.toLowerCase() === lower
      )
      .slice(0, 30);
    return {
      claims: rows,
      entityType: args.entityType,
      canonicalName: args.canonicalName,
    };
  },

  /** Compare two claims */
  async compareClaims(args: {
    claimA: string;
    claimB: string;
    vertical?: string;
  }) {
    const { claimA, claimB, vertical = "structural_biology" } = args;
    const [resultA, resultB] = await Promise.all([
      LAXEY_TOOLS.verifyClaim({ claim: claimA, vertical }),
      LAXEY_TOOLS.verifyClaim({ claim: claimB, vertical }),
    ]);
    const agreement =
      resultA.verdict === resultB.verdict ? "agreement" : "disagreement";
    return {
      claimA: { text: claimA, ...resultA },
      claimB: { text: claimB, ...resultB },
      agreement,
      summary: `Claim A is "${resultA.verdict}" and Claim B is "${resultB.verdict}" — ${agreement}.`,
    };
  },

  /** Deploy a Micron site */
  async deployMicronSite(args: {
    verticalKey: string;
    displayName: string;
    deployTarget: "vercel" | "netlify" | "docker" | "ipfs";
    domain?: string;
    userId: number;
    apiBase?: string;
    deployConfig?: Record<string, string>;
  }) {
    const apiBase = args.apiBase ?? "https://truthdesk.claims";
    const deployment = await createMicronDeployment({
      verticalKey: args.verticalKey,
      displayName: args.displayName,
      domain: args.domain,
      deployTarget: args.deployTarget,
      config: args.deployConfig ?? {},
      userId: args.userId,
    });

    // Run deploy asynchronously (don't await — return immediately)
    deployMicron({
      deploymentId: deployment.id,
      verticalKey: args.verticalKey,
      displayName: args.displayName,
      domain: args.domain,
      deployTarget: args.deployTarget,
      config: args.deployConfig ?? {},
      apiBase,
    }).catch(e => log.error("[deployMicron] error:", errData(e)));

    return {
      deploymentId: deployment.id,
      status: "building",
      message: `Micron deployment started for ${args.displayName} → ${args.deployTarget}`,
    };
  },

  /** Get Micron deployments for a user */
  async getMicronDeployments(args: { userId: number }) {
    return getMicronDeploymentsByUser(args.userId);
  },
};

// ─── Academic tier tools (extends Alvotech) ───────────────────────────────────

export const ACADEMIC_TOOLS = {
  ...ALVOTECH_TOOLS,

  /** Run the Auto-Discovery Engine for a vertical */
  async runDiscoveryEngine(args: {
    verticalKey: string;
    skipProbe?: boolean;
    skipCodegen?: boolean;
  }) {
    const runId = await createDiscoveryRun(args.verticalKey);
    // Run asynchronously
    runDiscovery({
      runId,
      verticalKey: args.verticalKey,
      skipProbe: args.skipProbe,
      skipCodegen: args.skipCodegen,
    }).catch(e => log.error("[runDiscovery] error:", errData(e)));
    return {
      runId,
      status: "running",
      message: `Discovery run #${runId} started for vertical: ${args.verticalKey}`,
    };
  },

  /** Get discovery run status */
  async getDiscoveryRunStatus(args: { runId: number }) {
    const run = await getDiscoveryRun(args.runId);
    if (!run) return { error: `Run #${args.runId} not found` };
    return run;
  },

  /** Get registered sources for a vertical */
  async getRegisteredSources(args: { verticalKey: string }) {
    return getRegistryEntriesByVertical(args.verticalKey);
  },

  /** Get built-in source registry */
  getBuiltInSources(args: { verticalKey?: string; category?: string }) {
    let sources = BUILT_IN_SOURCES;
    if (args.verticalKey) {
      sources = sources.filter(s => s.verticals.includes(args.verticalKey!));
    }
    if (args.category) {
      sources = sources.filter(s => s.category === args.category);
    }
    return sources;
  },

  /** Probe a specific source */
  async probeSource(args: { sourceId: string }) {
    const source = BUILT_IN_SOURCES.find(s => s.sourceId === args.sourceId);
    if (!source) return { error: `Source ${args.sourceId} not found` };
    return probeSource(source);
  },

  /** Generate Docker Compose for private deployment */
  generatePrivateDeployment(args: {
    verticalKey: string;
    domain?: string;
    includeLocalDb?: boolean;
    includeNginx?: boolean;
    includeSaml?: boolean;
  }) {
    const composeYml = generateDockerCompose({
      verticalKey: args.verticalKey,
      domain: args.domain,
      includeLocalDb: args.includeLocalDb ?? true,
      includeNginx: args.includeNginx ?? false,
      includeSaml: args.includeSaml ?? false,
    });
    const nginxConf = args.includeNginx
      ? generateNginxConfig({ domain: args.domain ?? "localhost" })
      : null;
    return {
      composeYml,
      nginxConf,
      instructions: [
        "1. Save docker-compose.yml to a directory",
        args.includeNginx ? "2. Save nginx.conf to the same directory" : null,
        "3. Copy your SSL certs to ./certs/ (fullchain.pem, privkey.pem)",
        "4. Create .env with required secrets (JWT_SECRET, MYSQL_ROOT_PASSWORD, etc.)",
        "5. Run: docker-compose up -d",
        `6. Access at http${args.domain ? `s://${args.domain}` : "://localhost:3000"}`,
      ].filter(Boolean),
    };
  },

  /** Generate Micron site HTML for download */
  generateMicronSiteHtml(args: {
    verticalKey: string;
    displayName: string;
    domain?: string;
    apiBase?: string;
  }) {
    const apiBase = args.apiBase ?? "https://truthdesk.claims";
    const config = generateSiteConfig({
      verticalKey: args.verticalKey,
      displayName: args.displayName,
      domain: args.domain,
      apiBase,
    });
    return {
      html: generateSiteHtml(config),
      config,
      filename: `${args.verticalKey}-site.html`,
    };
  },

  /** Export knowledge base as JSON-LD */
  async exportKnowledgeBase(args: {
    verticalKey: string;
    format?: "jsonld" | "csv" | "json";
  }) {
    const { verticalKey, format = "json" } = args;
    const rows = await getRecentClaimsForVertical(verticalKey, 500);

    if (format === "jsonld") {
      return {
        "@context": "https://schema.org",
        "@type": "Dataset",
        name: `Truth Desk Knowledge Base — ${verticalKey}`,
        description: `Verified scientific claims for ${verticalKey}`,
        hasPart: rows.map(c => ({
          "@type": "Claim",
          "@id": `https://truthdesk.claims/claims/${c.id}`,
          text: c.claimText,
          claimReviewed: c.claimText,
          reviewRating: {
            "@type": "Rating",
            ratingValue:
              c.verdict === "Supported"
                ? 5
                : c.verdict === "Contradicted"
                  ? 1
                  : 3,
            bestRating: 5,
            worstRating: 1,
            alternateName: c.verdict,
          },
        })),
      };
    }

    return { claims: rows, verticalKey, exportedAt: new Date().toISOString() };
  },
};

// ─── Tier lookup ──────────────────────────────────────────────────────────────

export type TierKey = "laxey" | "alvotech" | "academic";

export const TIER_TOOLS: Record<TierKey, typeof ACADEMIC_TOOLS> = {
  laxey: LAXEY_TOOLS as typeof ACADEMIC_TOOLS,
  alvotech: ALVOTECH_TOOLS as typeof ACADEMIC_TOOLS,
  academic: ACADEMIC_TOOLS,
};

export function getToolsForTier(tier: TierKey) {
  return TIER_TOOLS[tier] ?? TIER_TOOLS.laxey;
}
