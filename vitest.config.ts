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
      // Current baseline (Jun 2026): lines 26.95%, branches 65%+, functions 36.64%, statements 26.95%.
      // The low percentages reflect the many vertical adapter stubs and autonomous agent engines
      // that are exercised at runtime but not yet unit-tested.
      // Raise these thresholds incrementally as test coverage grows:
      //   Next target: lines 40%, functions 50% (add adapter + agent unit tests)
      //   Final target: lines 70%, functions 70% (full coverage)
      thresholds: {
        lines: 25,
        branches: 45,
        functions: 35,
        statements: 25,
      },
    },
  },
});
