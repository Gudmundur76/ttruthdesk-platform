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
      "client/public/**",   // Manus runtime assets — not our code
      "scripts/**",         // Node.js ESM scripts — separate lint pass if needed
    ],
  },

  // TypeScript files
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      // Quality gates — warn so CI sees them but doesn't block
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "no-debugger": "error",
      // Allow @ts-expect-error without descriptions (common in test mocks)
      "@typescript-eslint/ban-ts-comment": ["warn", {
        "ts-expect-error": "allow-with-description",
        minimumDescriptionLength: 3,
      }],
      // Allow 'this' aliasing (used in some legacy patterns)
      "@typescript-eslint/no-this-alias": "warn",
      // Allow prefer-const to be a warning not error
      "prefer-const": "warn",
    },
  },
  // Relax for test files — mocks use any extensively
  {
    files: ["**/*.test.ts", "**/*.test.tsx"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/ban-ts-comment": "off",
    },
  },
);
