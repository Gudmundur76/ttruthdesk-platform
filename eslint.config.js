// eslint.config.js — ESM flat config (project uses "type": "module")
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

export default tseslint.config(
  // Ignore generated/vendor dirs and non-TS assets
  {
    ignores: [
      "node_modules/**",
      "dist/**",
      "drizzle/migrations/**",
      "patches/**",
      "client/public/**", // Manus runtime assets — not our code
      "scripts/**", // Node.js ESM scripts — separate lint pass if needed
    ],
  },

  // TypeScript files — base recommended rules
  ...tseslint.configs.recommended,

  // ─── Production code (server + client, not tests) ────────────────────────
  {
    files: ["**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      // ── Hard errors: these should never appear in production code ──────────
      "no-debugger": "error",
      "no-eval": "error",
      "no-implied-eval": "error",
      "react-hooks/rules-of-hooks": "error",

      // ── Promoted from warn to error for production server code ─────────────
      // `any` in server code bypasses the type system entirely. Every `any`
      // must be a conscious decision — use `unknown` + narrowing instead.
      "@typescript-eslint/no-explicit-any": "error",
      // Unused variables are dead code and often indicate a logic mistake.
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      // prefer-const prevents accidental mutation of variables.
      "prefer-const": "error",

      // ── Warnings: important but not blocking ───────────────────────────────
      "react-hooks/exhaustive-deps": "warn",
      // @ts-expect-error is fine but must explain why
      "@typescript-eslint/ban-ts-comment": [
        "warn",
        {
          "ts-expect-error": "allow-with-description",
          minimumDescriptionLength: 3,
        },
      ],
      "@typescript-eslint/no-this-alias": "warn",
      // Complexity gate: warn when a function exceeds 20 branches
      complexity: ["warn", 20],
      // Warn on console.log in production code (use structured logging instead)
      "no-console": ["warn", { allow: ["warn", "error", "info"] }],
    },
  },

  // ─── Server-only overrides ────────────────────────────────────────────────
  // Server code uses console.info for structured logging — allow it
  {
    files: ["server/**/*.ts"],
    rules: {
      "no-console": "off",
    },
  },

  // ─── Test files — relax rules that conflict with mock patterns ────────────
  {
    files: ["**/*.test.ts", "**/*.test.tsx", "**/*.spec.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/ban-ts-comment": "off",
      "no-console": "off",
      "prefer-const": "warn",
    },
  }
);
