export default {
  extends: ["@commitlint/config-conventional"],
  rules: {
    // Allowed commit types
    "type-enum": [
      2,
      "always",
      [
        "feat",
        "fix",
        "docs",
        "style",
        "refactor",
        "test",
        "chore",
        "perf",
        "ci",
        "build",
        "revert",
      ],
    ],
    // Subject line max length
    "subject-max-length": [2, "always", 100],
    // Enforce scope to be one of the project domains
    "scope-enum": [
      1, // warn (not error) — scope is optional but if provided must be valid
      "always",
      [
        "auth",
        "claims",
        "pipeline",
        "kg",
        "export",
        "api",
        "ui",
        "db",
        "tests",
        "deps",
        "ci",
        "docs",
        "memory",
        "coord",
        "monitoring",
        "alerts",
        "provenance",
        "cooccurrence",
        "confidence",
        "apikeys",
      ],
    ],
    // Subject must not end with a period
    "subject-full-stop": [2, "never", "."],
    // Subject must be sentence-case or lower-case
    "subject-case": [1, "never", ["upper-case", "pascal-case"]],
    // Body must have a blank line before it
    "body-leading-blank": [2, "always"],
    // Footer must have a blank line before it
    "footer-leading-blank": [1, "always"],
    // Max header length
    "header-max-length": [2, "always", 100],
  },
};
