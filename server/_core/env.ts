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
  // Set LLM_PROVIDER=kimi + KIMI_API_KEY for the Kimi K2.7 Code quality re-pass.
  llmProvider: (process.env.LLM_PROVIDER ?? "manus_builtin") as
    | "manus_builtin"
    | "freellmapi"
    | "kimi"
    | "openrouter"
    | "nvidia_nim"
    | "ornith_slm",
  // NVIDIA NIM (nemotron reasoning) — required when LLM_PROVIDER=nvidia_nim
  nvidiaApiKey: process.env.NVIDIA_API_KEY ?? "",
  nvidiaModel:
    process.env.NVIDIA_MODEL ?? "nvidia/llama-3.3-nemotron-super-49b-v1",
  nvidiaReasoningBudget: parseInt(
    process.env.NVIDIA_REASONING_BUDGET ?? "2048",
    10
  ),
  freeLLMApiUrl: process.env.FREELM_API_URL ?? "http://localhost:3001/v1",
  freeLLMApiKey: process.env.FREELM_API_KEY ?? "",
  kimiApiKey: process.env.KIMI_API_KEY ?? "",
  // Moonshot Open Platform: api.moonshot.ai/v1 with model kimi-k2.7-code
  // K2.7 Code: 256K ctx, thinking always enabled, +21.8% coding vs K2.6, same API key
  kimiBaseUrl: process.env.KIMI_BASE_URL ?? "https://api.moonshot.ai/v1",
  kimiModel: process.env.KIMI_MODEL ?? "kimi-k2.7-code",
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
  // RSA-2048 private key (PKCS#8 PEM) for signing JWTs. Corresponds to the public key
  // served at /.well-known/jwks.json (kid: b5e30ba415a3dcd7).
  // Stored as JWKS_PRIVATE_KEY secret. The \n-escaped form is accepted (common in env vars).
  jwksPrivateKey: (process.env.JWKS_PRIVATE_KEY ?? "").replace(/\n/g, "\n"),
  // Training corpus integration (cognitive-loop-framework flywheel)
  // Set TRAINING_CORPUS_ENABLED=true to activate the ClaimsCorpusGenerator listener.
  // TRAINING_CORPUS_PATH: absolute path to the JSONL corpus file on the training host.
  trainingCorpusEnabled: process.env.TRAINING_CORPUS_ENABLED === "true",
  trainingCorpusPath:
    process.env.TRAINING_CORPUS_PATH ?? "/data/training/claims_corpus.jsonl",
  // Cognitive loop webhook (self-improving data flywheel)
  // Set COGNITIVE_LOOP_URL to the cognitive-loop-framework HTTP API base URL.
  // After each claim verification, ttruthdesk POSTs the verdict event to
  // {cognitiveLoopUrl}/cognitive/ingest so the SLM training corpus grows automatically.
  // Leave empty to disable the flywheel webhook (safe default).
  cognitiveLoopUrl: process.env.COGNITIVE_LOOP_URL ?? "",
  cognitiveLoopWebhookSecret: process.env.COGNITIVE_LOOP_WEBHOOK_SECRET ?? "",
  // Pricing lead notifications
  // Set ADMIN_NOTIFY_EMAIL to receive new pricing access request notifications via Forge.
  // Falls back to Telegram channel notification if not set.
  adminNotifyEmail: process.env.ADMIN_NOTIFY_EMAIL ?? "",
  // CRON_SECRET: sandbox-callable bearer token for POST /api/scheduled/domain-ingest.
  // Set this in Manus Project Settings → Environment Variables.
  // When set, the endpoint accepts EITHER BUILT_IN_FORGE_API_KEY (runtime cron)
  // OR CRON_SECRET (sandbox / external callers) — whichever is non-empty and matches.
  // This allows Manus to trigger the 5-domain PubMed ingest on demand from the sandbox.
  cronSecret: process.env.CRON_SECRET ?? "",
  // ASI-Evolve molecular discovery engine integration
  // Set ASI_EVOLVE_URL to the deployed asi-evolve-discovery-engine base URL.
  // e.g. https://hivprotease-eq9ltmms.manus.space
  // When set, the molecularDiscovery vertical adapter fetches top candidates and
  // emits them to citation.manus.space as QUANTUM_DUAL-tier verified claims.
  // citation.manus.space is the canonical public URL for this ttruthdesk deployment.
  asiEvolveUrl:
    process.env.ASI_EVOLVE_URL ?? "https://hivprotease-eq9ltmms.manus.space",
  // OriginQ Cloud API key for WuKong VQE hardware job submission
  // Set ORIGINQ_API_KEY to the key from qcloud.originqc.com.cn
  originqApiKey: process.env.ORIGINQ_API_KEY ?? "",
  // self-direct inbound webhook HMAC secret.
  // Shared with self-direct's NOTIFIER_WEBHOOK_SECRET env var.
  // POST /api/self-direct/spec-ready requires x-self-direct-signature: sha256=<HMAC-SHA256(body, secret)>
  selfDirectWebhookSecret: process.env.SELF_DIRECT_WEBHOOK_SECRET ?? "",
  // Bearer token for the cognitive-loop-framework POST /v1/verify endpoint.
  // Set CITATION_API_KEY to any strong random secret (e.g. openssl rand -hex 32);
  // share it with the cognitive-loop-framework CITATION_API_KEY env var.
  // If unset, the /v1/verify endpoint returns 503 Service Unavailable.
  citationApiKey: process.env.CITATION_API_KEY ?? "",
  // Ornith-1.0-9B self-hosted inference via slm-infra-deploy (ornith-vllm service).
  // Set LLM_PROVIDER=ornith_slm and ORNITH_SLM_URL=http://<slm-host>:8080
  // ORNITH_SLM_MODEL defaults to ornith-1.0-9b (the vLLM model ID served by cortex.py)
  // ORNITH_SLM_API_KEY defaults to "ornith-local" (no auth on local vLLM)
  ornithSlmUrl: process.env.ORNITH_SLM_URL ?? "http://localhost:8080",
  ornithSlmModel: process.env.ORNITH_SLM_MODEL ?? "ornith-1.0-9b",
  ornithSlmApiKey: process.env.ORNITH_SLM_API_KEY ?? "ornith-local",
  // HallOumi-8B claim verification augmentation (oumi-ai/HallOumi-8B)
  // Set HALLOUMI_ENABLED=true and HALLOUMI_URL=http://<host>:8001
  // to enable HallOumi as a secondary confidence signal for ambiguous verdicts.
  // When enabled, claims with verdict "Ambiguous" or "Insufficient Evidence"
  // are re-evaluated by HallOumi; results stored as hallOumiSupported /
  // hallOumiConfidence on the claim record (non-blocking, does not overwrite
  // the deterministic verdict).
  // Start the server: slm-infra-deploy/scripts/start-halloumi-cpu.sh
  hallOumiEnabled: process.env.HALLOUMI_ENABLED === "true",
  hallOumiUrl: process.env.HALLOUMI_URL ?? "http://localhost:8001",
  hallOumiModel: process.env.HALLOUMI_MODEL ?? "halloumi-8b",
};
