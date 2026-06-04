// Validate critical secrets at startup — fail fast rather than running with insecure defaults
const _jwtSecret = process.env.JWT_SECRET;
if (!_jwtSecret) {
  throw new Error(
    "[env] JWT_SECRET is not set. Set this environment variable before starting the server. " +
    "Without it, session cookies cannot be signed securely."
  );
}

export const ENV = {
  appId: process.env.VITE_APP_ID ?? "",
  cookieSecret: _jwtSecret,
  databaseUrl: process.env.DATABASE_URL ?? "",
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  isProduction: process.env.NODE_ENV === "production",
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? "",
  // Two-pass corpus LLM provider config
  // Options: "manus_builtin" | "freellmapi" | "kimi" | "openrouter"
  // Default is "manus_builtin" — the Manus-managed free LLM (no external proxy needed).
  // Set LLM_PROVIDER=openrouter + OPENROUTER_API_KEY for free OpenRouter models.
  // Set LLM_PROVIDER=freellmapi + FREELM_API_URL for a self-hosted free LLM proxy.
  // Set LLM_PROVIDER=kimi + KIMI_API_KEY for the Kimi K2 quality re-pass.
  llmProvider: (process.env.LLM_PROVIDER ?? "manus_builtin") as "manus_builtin" | "freellmapi" | "kimi" | "openrouter",
  freeLLMApiUrl: process.env.FREELM_API_URL ?? "http://localhost:3001/v1",
  freeLLMApiKey: process.env.FREELM_API_KEY ?? "",
  kimiApiKey: process.env.KIMI_API_KEY ?? "",
  // Kimi for Coding plan (kimi.com) uses api.kimi.com/coding/v1 with model kimi-for-coding
  // Moonshot Open Platform (platform.moonshot.ai) uses api.moonshot.ai/v1 with model kimi-k2.6
  kimiBaseUrl: process.env.KIMI_BASE_URL ?? "https://api.kimi.com/coding/v1",
  // kimi-for-coding = Kimi K2.6 (262K ctx, reasoning, image/video in) via kimi.com plan
  kimiModel: process.env.KIMI_MODEL ?? "kimi-for-coding",
  openRouterApiKey: process.env.OPENROUTER_API_KEY ?? "",
  // Comma-separated pool of OpenRouter keys for round-robin rotation (multiplies free-tier throughput)
  openRouterApiKeys: process.env.OPENROUTER_API_KEYS ?? "",
  // Self-hosted model name for freellmapi provider (e.g. gemma4:27b-it-q4_K_M for Ollama)
  freeLLMModel: process.env.FREELM_MODEL ?? "auto",
  // Telegram bot integration
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN ?? "",
  telegramChannelId: process.env.TELEGRAM_CHANNEL_ID ?? "",
  // PayPal checkout
  paypalClientId: process.env.PAYPAL_CLIENT_ID ?? "",
  paypalSecret: process.env.PAYPAL_SECRET ?? "",
  paypalMode: (process.env.PAYPAL_MODE ?? "sandbox") as "sandbox" | "live",
  // IndexNow (Bing/Perplexity instant re-indexing)
  indexNowKey: process.env.INDEX_NOW_KEY ?? "",
  // Manus Coordination Layer
  // COORD_API_KEY: shared secret for /api/coord/* endpoints (set in env)
  // MANUS_API_KEY: Manus platform API key for spawning tasks via task.create
  coordApiKey: process.env.COORD_API_KEY ?? "",
  // MANUS_API_KEY: Manus platform API key — falls back to ASIONE (the Iventure connector key
  // which is the same Manus API key available in all sessions via the secrets system)
  manusApiKey: process.env.MANUS_API_KEY ?? process.env.ASIONE ?? "",
  // Public base URL of this deployment (used by orchestrator for coord self-calls)
  // Set VITE_APP_URL to the deployed domain, e.g. https://protein-truth-desk.manus.space
  appUrl: process.env.VITE_APP_URL ?? "",
};
