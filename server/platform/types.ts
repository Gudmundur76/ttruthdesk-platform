/**
 * server/platform/types.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Interface contracts for all Manus platform adapters.
 *
 * These interfaces decouple business logic from the Manus Forge API, OAuth
 * server, and storage layer. Any adapter that satisfies these interfaces can
 * replace the Manus-specific implementation — enabling local testing, staging
 * environments, or migration to a different hosting platform.
 *
 * Usage:
 *   import { getForgeAdapter } from "./platform/forgeAdapter";
 *   import { getStorageAdapter } from "./platform/storageAdapter";
 *   import { getNotificationAdapter } from "./platform/notificationAdapter";
 */

// ─── Forge / Email adapter ────────────────────────────────────────────────────

export interface EmailPayload {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export interface SecretPayload {
  key: string;
  value: string;
  appId: string;
}

export interface IForgeAdapter {
  /** Send a transactional email via the Forge email service */
  sendEmail(payload: EmailPayload): Promise<{ ok: boolean; error?: string }>;
  /** Persist a secret to the Forge secret store */
  setSecret(payload: SecretPayload): Promise<{ ok: boolean; error?: string }>;
  /** Return true if the Forge adapter is configured and available */
  isAvailable(): boolean;
}

// ─── Storage adapter ──────────────────────────────────────────────────────────

export interface StoragePutResult {
  key: string;
  url: string;
}

export interface IStorageAdapter {
  /** Upload bytes and return a stable URL */
  put(key: string, data: Buffer | Uint8Array | string, contentType?: string): Promise<StoragePutResult>;
  /** Get a presigned read URL for an existing key */
  get(key: string, expiresInSeconds?: number): Promise<{ key: string; url: string }>;
  /** Return true if the storage adapter is configured and available */
  isAvailable(): boolean;
}

// ─── Notification adapter ─────────────────────────────────────────────────────

export interface NotificationPayload {
  title: string;
  content: string;
}

export interface INotificationAdapter {
  /** Send an owner notification (push / webhook / email) */
  notify(payload: NotificationPayload): Promise<boolean>;
  /** Return true if the notification adapter is configured and available */
  isAvailable(): boolean;
}

// ─── LLM adapter ─────────────────────────────────────────────────────────────

export interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LLMOptions {
  messages: LLMMessage[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
  responseFormat?: { type: "json_schema"; json_schema: Record<string, unknown> };
}

export interface LLMResult {
  content: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
}

export interface ILLMAdapter {
  /** Invoke a chat completion */
  complete(options: LLMOptions): Promise<LLMResult>;
  /** Return the default model identifier */
  defaultModel(): string;
  /** Return true if the LLM adapter is configured and available */
  isAvailable(): boolean;
}
