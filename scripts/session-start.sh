#!/usr/bin/env bash
# =============================================================================
# SESSION-START BOOTSTRAP — Protein Truth Desk / citation.manus.space
# =============================================================================
# MANDATORY: Run this as the FIRST action in every new Manus session.
# Never make claims about environment state before running this script.
# =============================================================================

set -euo pipefail

PASS="✅"
FAIL="❌"
WARN="⚠️"

echo ""
echo "============================================================"
echo "  PROTEIN TRUTH DESK — SESSION START VERIFICATION"
echo "  $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
echo "============================================================"

# ------------------------------------------------------------
# 1. MANUS_API_KEY
# ------------------------------------------------------------
echo ""
echo "--- 1. MANUS_API_KEY ---"
if [ -n "${MANUS_API_KEY:-}" ]; then
  echo "$PASS MANUS_API_KEY is set: ${MANUS_API_KEY:0:20}..."
else
  echo "$FAIL MANUS_API_KEY is NOT set — website.publish will fail"
fi

# ------------------------------------------------------------
# 2. Project directory
# ------------------------------------------------------------
echo ""
echo "--- 2. Project directory (/home/ubuntu/protein-truth-desk) ---"
PROJECT_DIR="/home/ubuntu/protein-truth-desk"
if [ -d "$PROJECT_DIR/server" ] && [ -d "$PROJECT_DIR/client" ] && [ -f "$PROJECT_DIR/package.json" ]; then
  FILE_COUNT=$(find "$PROJECT_DIR" -type f | wc -l)
  echo "$PASS Project directory populated ($FILE_COUNT files)"
else
  echo "$FAIL Project directory is missing or incomplete"
  echo "  Run: gh repo clone Gudmundur76/ttruthdesk-platform $PROJECT_DIR"
fi

# ------------------------------------------------------------
# 3. Key Sprint 40 files
# ------------------------------------------------------------
echo ""
echo "--- 3. Sprint 40 key files ---"
SPRINT40_FILES=(
  "server/buildOrigin.ts"
  "server/backfillDomainClaimsRoute.ts"
  "server/domainClaimExtractor.ts"
  "server/domainInference.ts"
  "server/llmProviderQuality.ts"
  "server/_core/env.ts"
)
ALL_PRESENT=true
for f in "${SPRINT40_FILES[@]}"; do
  if [ -f "$PROJECT_DIR/$f" ]; then
    echo "$PASS $f"
  else
    echo "$FAIL $f — MISSING"
    ALL_PRESENT=false
  fi
done
if $ALL_PRESENT; then
  echo "$PASS All Sprint 40 files present"
fi

# ------------------------------------------------------------
# 4. Dev server health
# ------------------------------------------------------------
echo ""
echo "--- 4. Dev server (localhost:3000) ---"
if curl -sf http://localhost:3000/health > /dev/null 2>&1; then
  echo "$PASS Dev server responding on :3000"
elif curl -sf http://localhost:3000/ > /dev/null 2>&1; then
  echo "$PASS Dev server responding on :3000 (no /health endpoint)"
else
  echo "$WARN Dev server not responding — may need restart"
  echo "  Run: cd $PROJECT_DIR && pnpm dev &"
fi

# ------------------------------------------------------------
# 5. GitHub — ttruthdesk-platform
# ------------------------------------------------------------
echo ""
echo "--- 5. GitHub: ttruthdesk-platform ---"
BACKEND_CLONE="/home/ubuntu/ttruthdesk-platform"
if [ -d "$BACKEND_CLONE/.git" ]; then
  BACKEND_HEAD=$(git -C "$BACKEND_CLONE" rev-parse --short HEAD 2>/dev/null || echo "unknown")
  BACKEND_BRANCH=$(git -C "$BACKEND_CLONE" branch --show-current 2>/dev/null || echo "unknown")
  echo "$PASS Clone present at $BACKEND_CLONE"
  echo "     Branch: $BACKEND_BRANCH | HEAD: $BACKEND_HEAD"
else
  echo "$WARN Backend clone not present — clone if needed:"
  echo "     gh repo clone Gudmundur76/ttruthdesk-platform ~/ttruthdesk-platform"
fi

# ------------------------------------------------------------
# 6. GitHub — manus-persistent-drive (MANDATORY memory repo)
# ------------------------------------------------------------
echo ""
echo "--- 6. GitHub: manus-persistent-drive (MANDATORY) ---"
MEMORY_CLONE="/home/ubuntu/manus-persistent-drive"
if [ -d "$MEMORY_CLONE/.git" ]; then
  MEMORY_HEAD=$(git -C "$MEMORY_CLONE" rev-parse --short HEAD 2>/dev/null || echo "unknown")
  LAST_PHASE=$(grep -m1 "^## Phase" "$MEMORY_CLONE/phase-log.md" 2>/dev/null | head -1 || echo "unknown")
  echo "$PASS Memory repo present at $MEMORY_CLONE"
  echo "     HEAD: $MEMORY_HEAD | Last entry: $LAST_PHASE"
else
  echo "$FAIL Memory repo NOT cloned — MUST clone before proceeding:"
  echo "     gh repo clone Gudmundur76/manus-persistent-drive ~/manus-persistent-drive"
fi

# ------------------------------------------------------------
# 7. Deployed version vs internal HEAD
# ------------------------------------------------------------
echo ""
echo "--- 7. Deployment status (citation.manus.space) ---"
if [ -n "${MANUS_API_KEY:-}" ]; then
  DEPLOY_STATUS=$(curl -sf "https://api.manus.ai/v2/website.status?website_id=5R5rZPYgTj2s3EMJSc7MVm" \
    -H "x-manus-api-key: $MANUS_API_KEY" 2>/dev/null || echo '{"error":"request failed"}')
  DEPLOYED_VERSION=$(echo "$DEPLOY_STATUS" | grep -o '"version_id":"[^"]*"' | cut -d'"' -f4 || echo "unknown")
  echo "     Live version: $DEPLOYED_VERSION"
  if [ "$DEPLOYED_VERSION" = "6653bf9c" ]; then
    echo "$WARN Live site is on STALE version 6653bf9c (Phase 133)"
    echo "     Sprint 40 code is NOT deployed — save checkpoint + publish needed"
  else
    echo "$PASS Live site version: $DEPLOYED_VERSION"
  fi
else
  echo "$WARN Cannot check — MANUS_API_KEY not set"
fi

# ------------------------------------------------------------
# 8. CRON_SECRET
# ------------------------------------------------------------
echo ""
echo "--- 8. CRON_SECRET ---"
if [ -n "${CRON_SECRET:-}" ]; then
  echo "$PASS CRON_SECRET is set: ${CRON_SECRET:0:8}..."
else
  echo "$WARN CRON_SECRET not in environment (expected: ingest-36)"
fi

# ------------------------------------------------------------
# SUMMARY
# ------------------------------------------------------------
echo ""
echo "============================================================"
echo "  VERIFICATION COMPLETE"
echo "  Website:     https://citation.manus.space"
echo "  Website ID:  5R5rZPYgTj2s3EMJSc7MVm"
echo "  Backend:     https://github.com/Gudmundur76/ttruthdesk-platform"
echo "  Memory:      https://github.com/Gudmundur76/manus-persistent-drive"
echo "  CRON_SECRET: ingest-36"
echo "============================================================"
echo ""
echo "NEXT ACTIONS (if first session action):"
echo "  1. Call webdev_save_checkpoint (no API key needed — internal tool)"
echo "  2. Run: curl -s -X POST https://api.manus.ai/v2/website.publish \\"
echo "       -H \"x-manus-api-key: \$MANUS_API_KEY\" \\"
echo "       -H \"Content-Type: application/json\" \\"
echo "       -d '{\"website_id\":\"5R5rZPYgTj2s3EMJSc7MVm\",\"visibility\":\"public\"}'"
echo "  3. Update manus-persistent-drive phase-log.md with new phase entry"
echo ""
