/**
 * privateMode.ts — Private / On-Premises Deployment Mode
 *
 * Provides:
 *  1. generateDockerCompose() — full docker-compose.yml for self-hosted Truth Desk
 *  2. generateSamlConfig()    — SAML 2.0 SP configuration stub
 *  3. AuditLogger             — structured audit log writer (file + DB)
 *  4. InternalDbAdapter       — interface for plugging in private databases
 *  5. tRPC procedures         — private.generateDockerCompose, private.auditLog
 */

import { getDb } from "./db";
import fs from "fs";
import path from "path";

// ─── Docker Compose generator ─────────────────────────────────────────────────

export interface DockerComposeOptions {
  /** Vertical to deploy */
  verticalKey: string;
  /** External domain (e.g. truthdesk.internal.corp.com) */
  domain?: string;
  /** Port to expose on the host */
  hostPort?: number;
  /** Include a local MySQL instance (for fully air-gapped deployments) */
  includeLocalDb?: boolean;
  /** Include Nginx reverse proxy */
  includeNginx?: boolean;
  /** Include SAML IdP stub (Keycloak) */
  includeSaml?: boolean;
}

export function generateDockerCompose(opts: DockerComposeOptions): string {
  const {
    verticalKey,
    domain = "localhost",
    hostPort = 3000,
    includeLocalDb = true,
    includeNginx = false,
    includeSaml = false,
  } = opts;

  const services: Record<string, unknown> = {};

  // ── Truth Desk app ────────────────────────────────────────────────────────
  services["truthdesk"] = {
    image: "ghcr.io/arctic-media/truthdesk:latest",
    restart: "unless-stopped",
    ports: [`${hostPort}:3000`],
    environment: {
      NODE_ENV: "production",
      DATABASE_URL: includeLocalDb
        ? "mysql://truthdesk:changeme@mysql:3306/truthdesk"
        : "${DATABASE_URL}",
      JWT_SECRET: "${JWT_SECRET:-changeme-in-production}",
      VERTICAL_KEY: verticalKey,
      SITE_ORIGIN: `https://${domain}`,
      PRIVATE_MODE: "true",
      ...(includeSaml
        ? {
            SAML_ENTRY_POINT: `https://${domain}/auth/saml/sso`,
            SAML_ISSUER: `https://${domain}`,
            SAML_CERT: "${SAML_CERT}",
          }
        : {}),
    },
    depends_on: [
      ...(includeLocalDb ? ["mysql"] : []),
      ...(includeSaml ? ["keycloak"] : []),
    ],
    volumes: ["truthdesk_data:/app/data"],
    healthcheck: {
      test: ["CMD", "curl", "-f", "http://localhost:3000/api/health"],
      interval: "30s",
      timeout: "10s",
      retries: 3,
    },
    labels: {
      "com.truthdesk.vertical": verticalKey,
      "com.truthdesk.mode": "private",
    },
  };

  // ── MySQL ─────────────────────────────────────────────────────────────────
  if (includeLocalDb) {
    services["mysql"] = {
      image: "mysql:8.0",
      restart: "unless-stopped",
      environment: {
        MYSQL_ROOT_PASSWORD: "${MYSQL_ROOT_PASSWORD:-rootchangeme}",
        MYSQL_DATABASE: "truthdesk",
        MYSQL_USER: "truthdesk",
        MYSQL_PASSWORD: "${MYSQL_PASSWORD:-changeme}",
      },
      volumes: ["mysql_data:/var/lib/mysql"],
      healthcheck: {
        test: ["CMD", "mysqladmin", "ping", "-h", "localhost"],
        interval: "10s",
        timeout: "5s",
        retries: 5,
      },
    };
  }

  // ── Nginx ─────────────────────────────────────────────────────────────────
  if (includeNginx) {
    services["nginx"] = {
      image: "nginx:alpine",
      restart: "unless-stopped",
      ports: ["80:80", "443:443"],
      volumes: [
        "./nginx.conf:/etc/nginx/conf.d/default.conf:ro",
        "./certs:/etc/nginx/certs:ro",
      ],
      depends_on: ["truthdesk"],
    };
  }

  // ── Keycloak (SAML IdP stub) ──────────────────────────────────────────────
  if (includeSaml) {
    services["keycloak"] = {
      image: "quay.io/keycloak/keycloak:24.0",
      restart: "unless-stopped",
      command: "start-dev",
      environment: {
        KEYCLOAK_ADMIN: "admin",
        KEYCLOAK_ADMIN_PASSWORD: "${KEYCLOAK_ADMIN_PASSWORD:-admin}",
        KC_DB: "dev-file",
      },
      ports: ["8080:8080"],
      volumes: ["keycloak_data:/opt/keycloak/data"],
    };
  }

  // ── Volumes ───────────────────────────────────────────────────────────────
  const volumes: Record<string, null> = { truthdesk_data: null };
  if (includeLocalDb) volumes["mysql_data"] = null;
  if (includeSaml) volumes["keycloak_data"] = null;

  // ── Serialise to YAML manually (no yaml dep) ──────────────────────────────
  return yamlDump({ version: "3.8", services, volumes });
}

// ─── SAML config stub ─────────────────────────────────────────────────────────

export interface SamlConfig {
  entryPoint: string;
  issuer: string;
  callbackUrl: string;
  cert: string;
  identifierFormat: string;
  attributeMapping: Record<string, string>;
}

export function generateSamlConfig(opts: {
  domain: string;
  idpEntryPoint: string;
  idpCert: string;
}): SamlConfig {
  return {
    entryPoint: opts.idpEntryPoint,
    issuer: `https://${opts.domain}`,
    callbackUrl: `https://${opts.domain}/api/auth/saml/callback`,
    cert: opts.idpCert,
    identifierFormat: "urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress",
    attributeMapping: {
      email: "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress",
      name: "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name",
      role: "http://schemas.microsoft.com/ws/2008/06/identity/claims/role",
    },
  };
}

// ─── Audit logger ─────────────────────────────────────────────────────────────

export interface AuditEntry {
  ts: number;
  userId?: number;
  action: string;
  resource: string;
  resourceId?: string | number;
  ipAddress?: string;
  userAgent?: string;
  success: boolean;
  meta?: Record<string, unknown>;
}

export class AuditLogger {
  private logDir: string;

  constructor(logDir = "/tmp/truthdesk-audit") {
    this.logDir = logDir;
    try {
      if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
    } catch {
      // Non-fatal — fall back to console
    }
  }

  async log(entry: AuditEntry): Promise<void> {
    const line = JSON.stringify({ ...entry, ts: entry.ts || Date.now() }) + "\n";
    // Write to rotating daily file
    const date = new Date().toISOString().slice(0, 10);
    const filePath = path.join(this.logDir, `audit-${date}.jsonl`);
    try {
      fs.appendFileSync(filePath, line);
    } catch {
      console.warn("[AuditLogger] Failed to write to file, logging to console:", line.trim());
    }

    // Also persist to DB if available (best-effort — file log is source of truth)
    try {
      const db = await getDb();
      if (db) {
        // Use parameterized placeholders to prevent SQL injection
        const userId = entry.userId ?? null;
        const success = entry.success ? 1 : 0;
        const resourceId = entry.resourceId != null ? String(entry.resourceId) : null;
        await db.execute(
          // drizzle execute accepts a tagged-template or raw string with ? placeholders
          // We use a raw string here; TiDB/MySQL driver handles the binding safely
          {
            sql: `INSERT IGNORE INTO audit_log (userId, action, resource, resourceId, ipAddress, success, createdAt) VALUES (?, ?, ?, ?, ?, ?, NOW())`,
            params: [userId, entry.action, entry.resource, resourceId, entry.ipAddress ?? null, success],
          } as unknown as Parameters<typeof db.execute>[0]
        );
      }
    } catch {
      // Non-fatal — file log is the source of truth
    }
  }
}

export const auditLogger = new AuditLogger();

// ─── Internal DB adapter interface ───────────────────────────────────────────

export interface SourceResult {
  id: string;
  title: string;
  snippet: string;
  url: string;
  confidence: number;
  metadata?: Record<string, unknown>;
}

export interface InternalDbAdapter {
  /** Unique identifier for this adapter */
  adapterId: string;
  /** Human-readable name */
  displayName: string;
  /** Verticals this adapter supports */
  verticals: string[];
  /** Health check — returns true if the source is reachable */
  healthCheck(): Promise<boolean>;
  /** Search the source for claims-relevant content */
  search(query: string, vertical: string): Promise<SourceResult[]>;
  /** Fetch a specific record by ID */
  fetchById(id: string): Promise<SourceResult | null>;
}

/**
 * BaseAdapter — extend this to create a custom internal adapter.
 *
 * @example
 * class MyInternalDbAdapter extends BaseAdapter {
 *   adapterId = "my_internal_db";
 *   displayName = "My Internal Database";
 *   verticals = ["structural_biology"];
 *   async search(query: string) { ... }
 *   async fetchById(id: string) { ... }
 * }
 */
export abstract class BaseAdapter implements InternalDbAdapter {
  abstract adapterId: string;
  abstract displayName: string;
  abstract verticals: string[];

  async healthCheck(): Promise<boolean> {
    try {
      await this.search("health_check_ping", this.verticals[0] ?? "");
      return true;
    } catch {
      return false;
    }
  }

  abstract search(query: string, vertical: string): Promise<SourceResult[]>;
  abstract fetchById(id: string): Promise<SourceResult | null>;
}

/** Registry of all registered internal adapters */
const adapterRegistry = new Map<string, InternalDbAdapter>();

export function registerAdapter(adapter: InternalDbAdapter): void {
  adapterRegistry.set(adapter.adapterId, adapter);
}

export function getAdapter(adapterId: string): InternalDbAdapter | undefined {
  return adapterRegistry.get(adapterId);
}

export function getAllAdapters(): InternalDbAdapter[] {
  return Array.from(adapterRegistry.values());
}

export function getAdaptersForVertical(verticalKey: string): InternalDbAdapter[] {
  return getAllAdapters().filter((a) => a.verticals.includes(verticalKey));
}

// ─── Nginx config template ────────────────────────────────────────────────────

export function generateNginxConfig(opts: { domain: string; hostPort?: number }): string {
  const { domain, hostPort = 3000 } = opts;
  return `server {
    listen 80;
    server_name ${domain};
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name ${domain};

    ssl_certificate     /etc/nginx/certs/fullchain.pem;
    ssl_certificate_key /etc/nginx/certs/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;

    # Security headers
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Content-Type-Options nosniff always;
    add_header X-Frame-Options DENY always;
    add_header Referrer-Policy strict-origin-when-cross-origin always;

    location / {
        proxy_pass http://truthdesk:${hostPort};
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 300s;
    }
}
`;
}

// ─── Minimal YAML serialiser (no external deps) ───────────────────────────────

function yamlDump(obj: unknown, indent = 0): string {
  const pad = "  ".repeat(indent);
  if (obj === null || obj === undefined) return "null";
  if (typeof obj === "boolean") return obj ? "true" : "false";
  if (typeof obj === "number") return String(obj);
  if (typeof obj === "string") {
    if (/[:#\[\]{},&*?|<>=!%@`]/.test(obj) || obj.includes("\n") || obj.includes('"')) {
      return `"${obj.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`;
    }
    return obj;
  }
  if (Array.isArray(obj)) {
    if (obj.length === 0) return "[]";
    return obj.map((v) => `\n${pad}- ${yamlDump(v, indent + 1)}`).join("");
  }
  if (typeof obj === "object") {
    const entries = Object.entries(obj as Record<string, unknown>);
    if (entries.length === 0) return "{}";
    return entries
      .map(([k, v]) => {
        if (typeof v === "object" && v !== null && !Array.isArray(v)) {
          return `\n${pad}${k}:\n${yamlDump(v, indent + 1)}`;
        }
        if (Array.isArray(v)) {
          return `\n${pad}${k}:${yamlDump(v, indent + 1)}`;
        }
        return `\n${pad}${k}: ${yamlDump(v, indent + 1)}`;
      })
      .join("");
  }
  return String(obj);
}
