import { defineConfig } from "vitest/config";
import path from "path";

const templateRoot = path.resolve(import.meta.dirname);

export default defineConfig({
  root: templateRoot,
  resolve: {
    alias: {
      "@": path.resolve(templateRoot, "client", "src"),
      "@shared": path.resolve(templateRoot, "shared"),
      "@assets": path.resolve(templateRoot, "attached_assets"),
    },
  },
  test: {
    environment: "node",
    include: ["server/**/*.test.ts", "server/**/*.spec.ts"],
    // Provide required secrets so env.ts startup validation passes in test runs.
    // These are test-only values and are never used in production.
    env: {
      JWT_SECRET: "test-jwt-secret-for-vitest-only",
      // Minimum 32-char HMAC key required by selfDirectWebhook.test.ts
      SELF_DIRECT_WEBHOOK_SECRET: "test-self-direct-webhook-secret-32ch",
    },
    coverage: {
      provider: "v8",
      // Only measure coverage on production server code — exclude test files,
      // framework core, scripts, and generated files.
      include: ["server/**/*.ts"],
      exclude: [
        "server/**/*.test.ts",
        "server/**/*.spec.ts",
        "server/_core/**", // framework plumbing — not our business logic
        "server/storage.ts", // thin S3 wrapper
      ],
      reporter: ["text", "json", "html", "json-summary"],
      reportsDirectory: "./coverage",
      // Quality floor — CI fails if coverage drops below these thresholds.
      // Baseline (Jun 2026): lines 26.95%, branches 65%+, functions 36.64%, statements 26.95%.
      // Sprint 36 (17 Jun 2026): sprints 32-35 merged (58 adapters, 2970 tests).
      // Actuals post-Sprint 36: lines 60.24%, branches 73.07%, functions 73.04%, statements 60.24%.
      // Thresholds set at actual - 2% buffer to enforce no regression.
      // Final target: lines 70%, functions 70% (full coverage — Sprint 38+)
      thresholds: {
        lines: 58, // Sprint 36: actual 60.24% — floor at -2% buffer
        branches: 71, // Sprint 36: actual 73.07% — floor at -2% buffer
        functions: 71, // Sprint 36: actual 73.04% — floor at -2% buffer
        statements: 58, // Sprint 36: actual 60.24% — floor at -2% buffer
      },
    },
  },
});
