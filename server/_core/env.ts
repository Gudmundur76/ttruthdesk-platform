export const ENV = {
  appId: process.env.VITE_APP_ID ?? "",
  cookieSecret: process.env.JWT_SECRET ?? "",
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
  openRouterApiKey: process.env.OPENROUTER_API_KEY ?? "",
};
