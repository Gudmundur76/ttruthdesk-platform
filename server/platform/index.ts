/**
 * server/platform/index.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Barrel export for all platform adapters.
 *
 * Import from here in business logic:
 *   import { getForgeAdapter, getStorageAdapter, getNotificationAdapter, getLLMAdapter } from "./platform";
 *
 * In tests, inject mocks via the setter functions:
 *   import { setForgeAdapter } from "./platform/forgeAdapter";
 *   setForgeAdapter(mockForgeAdapter);
 */
export * from "./types";
export { getForgeAdapter, setForgeAdapter } from "./forgeAdapter";
export { getStorageAdapter, setStorageAdapter } from "./storageAdapter";
export { getNotificationAdapter, setNotificationAdapter } from "./notificationAdapter";
export { getLLMAdapter, setLLMAdapter } from "./llmAdapter";
