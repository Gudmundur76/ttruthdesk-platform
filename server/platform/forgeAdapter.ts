/**
 * server/platform/forgeAdapter.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Manus Forge API adapter — implements IForgeAdapter.
 *
 * Wraps the Forge gRPC-gateway endpoints for email and secret management.
 * When BUILT_IN_FORGE_API_URL / BUILT_IN_FORGE_API_KEY are not set, all
 * methods degrade gracefully (return { ok: false, error: "not configured" })
 * so the rest of the application continues to function.
 *
 * Swap this file for a different IForgeAdapter implementation to migrate
 * away from the Manus platform without touching business logic.
 */
import { ENV } from "../_core/env";
import type { EmailPayload, IForgeAdapter, SecretPayload } from "./types";

class ManusForgeAdapter implements IForgeAdapter {
  isAvailable(): boolean {
    return !!(ENV.forgeApiUrl && ENV.forgeApiKey);
  }

  async sendEmail(payload: EmailPayload): Promise<{ ok: boolean; error?: string }> {
    if (!this.isAvailable()) {
      return { ok: false, error: "Forge API not configured" };
    }
    try {
      const endpoint = `${ENV.forgeApiUrl!.replace(/\/$/, "")}/webdevtoken.v1.WebDevService/SendEmail`;
      const resp = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          authorization: `Bearer ${ENV.forgeApiKey}`,
        },
        body: JSON.stringify({
          to: payload.to,
          subject: payload.subject,
          html: payload.html,
          text: payload.text ?? "",
        }),
      });
      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        return { ok: false, error: `Forge email error ${resp.status}: ${body}` };
      }
      return { ok: true };
    } catch (err: unknown) {
      return { ok: false, error: String(err) };
    }
  }

  async setSecret(payload: SecretPayload): Promise<{ ok: boolean; error?: string }> {
    if (!this.isAvailable()) {
      return { ok: false, error: "Forge API not configured" };
    }
    try {
      const endpoint = `${ENV.forgeApiUrl!.replace(/\/$/, "")}/webdevtoken.v1.WebDevService/SetSecret`;
      const resp = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          authorization: `Bearer ${ENV.forgeApiKey}`,
          "x-app-id": payload.appId,
        },
        body: JSON.stringify({ key: payload.key, value: payload.value }),
      });
      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        return { ok: false, error: `Forge secret error ${resp.status}: ${body}` };
      }
      return { ok: true };
    } catch (err: unknown) {
      return { ok: false, error: String(err) };
    }
  }
}

// Singleton — one adapter per process
let _adapter: ManusForgeAdapter | null = null;

export function getForgeAdapter(): IForgeAdapter {
  if (!_adapter) _adapter = new ManusForgeAdapter();
  return _adapter;
}

/** For testing: inject a mock adapter */
export function setForgeAdapter(adapter: IForgeAdapter): void {
  _adapter = adapter as ManusForgeAdapter;
}
