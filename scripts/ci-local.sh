#!/usr/bin/env bash
# ─── ci-local.sh ─────────────────────────────────────────────────────────────
# Local CI simulation — mirrors the GitHub Actions Quality Gate exactly.
# Run this before opening a PR or merging to main to catch failures early.
#
# Usage:
#   pnpm ci:local          # full gate
#   pnpm ci:local --fast   # skip coverage (faster, still catches lint/type/test)
#
# Exit codes:
#   0 = all checks passed
#   1 = one or more checks failed (details printed above)
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

FAST=false
for arg in "$@"; do
  [[ "$arg" == "--fast" ]] && FAST=true
done

PASS=0
FAIL=0
FAILED_STEPS=()

run_step() {
  local name="$1"
  shift
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "▶  $name"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    if "$@"; then
    echo "✅  $name — PASSED"
    PASS=$((PASS + 1))
  else
    echo "❌  $name — FAILED"
    FAIL=$((FAIL + 1))
    FAILED_STEPS+=("$name")
  fi
}

echo ""
echo "╔══════════════════════════════════════════════════════════════════════╗"
echo "║          ttruthdesk-platform — Local CI Quality Gate                ║"
echo "╚══════════════════════════════════════════════════════════════════════╝"

# Layer 1: TypeScript
run_step "TypeScript check" pnpm check

# Layer 2: ESLint (full codebase, max-warnings 0)
run_step "ESLint" pnpm lint

# Layer 3: Tests
run_step "Test suite" pnpm test --run

# Layer 4: Coverage (skippable with --fast)
if [[ "$FAST" == "false" ]]; then
  run_step "Coverage thresholds" pnpm test:coverage --run
else
  echo ""
  echo "⏭   Coverage check skipped (--fast mode)"
fi

# Summary
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
if [[ $FAIL -eq 0 ]]; then
  echo "✅  All ${PASS} checks passed — safe to push."
  exit 0
else
  echo "❌  ${FAIL} check(s) failed: ${FAILED_STEPS[*]}"
  echo "    Fix the above before pushing to avoid CI failures."
  exit 1
fi
