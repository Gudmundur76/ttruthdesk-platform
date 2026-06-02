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
  // Options: "manus_builtin" | "freellmapi" | "kimi"
  llmProvider: (process.env.LLM_PROVIDER ?? "manus_builtin") as "manus_builtin" | "freellmapi" | "kimi",
  freeLLMApiUrl: process.env.FREELM_API_URL ?? "http://localhost:3001/v1",
  freeLLMApiKey: process.env.FREELM_API_KEY ?? "",
  kimiApiKey: process.env.KIMI_API_KEY ?? "",
};
