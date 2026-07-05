/**
 * githubPushWebhook.ts — GitHub Push Webhook Handler
 * ─────────────────────────────────────────────────────────────────────────────
 * Listens for GitHub push events on the `main` branch and performs an
 * in-place deployment on the persistent VM:
 *
 *   1. Validates the X-Hub-Signature-256 HMAC (GitHub webhook secret).
 *   2. Ignores pushes to branches other than `main`.
 *   3. Runs: git pull origin main && npm run build && pm2 restart ttruthdesk
 *   4. Returns { ok: true, commit, output } on success.
 *
 * ─── Setup ───────────────────────────────────────────────────────────────────
 * Set GITHUB_PUSH_WEBHOOK_SECRET in the server environment to the same value
 * configured in GitHub → Settings → Webhooks → Secret.
 *
 * The route is registered BEFORE the global express.json middleware so that
 * the raw body is available for HMAC verification.
 *
 * ─── Route ───────────────────────────────────────────────────────────────────
 * POST /api/github/push
 */
import type { Express, Request, Response } from "express";
import crypto from "crypto";
import { exec } from "child_process";
import { promisify } from "util";
import { logger } from "./logger";

const log = logger("githubPushWebhook");
const execAsync = promisify(exec);

const WEBHOOK_SECRET = process.env.GITHUB_PUSH_WEBHOOK_SECRET ?? "";
const REPO_DIR = process.env.TTRUTHDESK_REPO_DIR ?? "/home/ubuntu/ttruthdesk-platform";
const PM2_APP_NAME = process.env.PM2_APP_NAME ?? "ttruthdesk";

// ─── Signature verification ───────────────────────────────────────────────────
function verifySignature(rawBody: string, signatureHeader: string): boolean {
  if (!WEBHOOK_SECRET) {
    log.warn("GITHUB_PUSH_WEBHOOK_SECRET not set — rejecting all push webhooks");
    return false;
  }
  const expected = `sha256=${crypto
    .createHmac("sha256", WEBHOOK_SECRET)
    .update(rawBody, "utf8")
    .digest("hex")}`;
  try {
    return crypto.timingSafeEqual(
      Buffer.from(expected, "utf8"),
      Buffer.from(signatureHeader, "utf8")
    );
  } catch {
    return false;
  }
}

// ─── Deploy runner ────────────────────────────────────────────────────────────
async function runDeploy(): Promise<{ output: string; durationMs: number }> {
  const start = Date.now();
  const cmd = [
    `cd ${REPO_DIR}`,
    `git pull origin main --ff-only`,
    `npm run build`,
    `pm2 restart ${PM2_APP_NAME} --update-env`,
  ].join(" && ");

  const { stdout, stderr } = await execAsync(cmd, {
    timeout: 180_000, // 3 minutes max
    env: { ...process.env, NODE_ENV: "production" },
  });

  const output = (stdout + stderr).trim().slice(0, 2000);
  return { output, durationMs: Date.now() - start };
}

// ─── Route handler ────────────────────────────────────────────────────────────
export function registerGithubPushWebhookRoute(app: Express): void {
  // Raw body capture MUST be registered before global express.json middleware
  app.post(
    "/api/github/push",
    (req: Request & { rawBody?: string }, res: Response): void => {
      void handlePush(req, res);
    }
  );
}

async function handlePush(
  req: Request & { rawBody?: string },
  res: Response
): Promise<void> {
  // ── 1. Signature check ────────────────────────────────────────────────────
  const sigHeader = (req.headers["x-hub-signature-256"] as string) ?? "";
  const rawBody = req.rawBody ?? JSON.stringify(req.body);

  if (!verifySignature(rawBody, sigHeader)) {
    log.warn("GitHub push webhook: invalid signature — rejected");
    res.status(401).json({ ok: false, error: "Invalid signature" });
    return;
  }

  // ── 2. Event type check ───────────────────────────────────────────────────
  const event = (req.headers["x-github-event"] as string) ?? "";
  if (event === "ping") {
    log.info("GitHub push webhook: ping received — OK");
    res.json({ ok: true, message: "pong" });
    return;
  }
  if (event !== "push") {
    res.json({ ok: true, message: `Ignored event: ${event}` });
    return;
  }

  // ── 3. Branch filter — only deploy on pushes to main ─────────────────────
  const payload = req.body as { ref?: string; after?: string; head_commit?: { id?: string; message?: string } };
  const ref = payload.ref ?? "";
  const commit = payload.after ?? payload.head_commit?.id ?? "unknown";
  const commitMsg = (payload.head_commit?.message ?? "").slice(0, 80);

  if (ref !== "refs/heads/main") {
    log.info(`GitHub push webhook: ignored push to ${ref}`);
    res.json({ ok: true, message: `Ignored push to ${ref}` });
    return;
  }

  log.info(`GitHub push webhook: deploying commit ${commit.slice(0, 8)} — "${commitMsg}"`);

  // ── 4. Respond immediately (GitHub expects < 10s) then deploy async ───────
  res.json({ ok: true, commit: commit.slice(0, 8), message: "Deploy started" });

  // ── 5. Run deploy ─────────────────────────────────────────────────────────
  try {
    const { output, durationMs } = await runDeploy();
    log.info(`GitHub push webhook: deploy complete in ${durationMs}ms\n${output}`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error(`GitHub push webhook: deploy FAILED — ${msg}`);
  }
}
