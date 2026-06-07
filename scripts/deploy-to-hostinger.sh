#!/usr/bin/env bash
# deploy-to-hostinger.sh — Deploy a Truth Desk micron to Hostinger Pro via SFTP
#
# Prerequisites:
#   - Hostinger Pro Agency plan ($29/mo, 100 sites)
#   - Domain added in hPanel → Websites → Add Website
#   - SFTP credentials from hPanel → Advanced → SSH Access
#   - lftp installed: brew install lftp  OR  sudo apt install lftp
#
# Usage:
#   chmod +x scripts/deploy-to-hostinger.sh
#   ./scripts/deploy-to-hostinger.sh \
#     --vertical=structural_biology \
#     --domain=salmonbio.wiki \
#     --hostinger-user=u123456789 \
#     --hostinger-host=89.116.123.45
#
# Optional flags:
#   --hostinger-port=21        (default: 21)
#   --hostinger-pass=SECRET    (or set HOSTINGER_PASS env var)
#   --remote-dir=/public_html  (default: /public_html)
#   --skip-generate            (skip site generation, deploy existing dist/)
#   --dry-run                  (show what would be uploaded, don't upload)

set -euo pipefail

# ─── Defaults ─────────────────────────────────────────────────────────────
VERTICAL=""
DOMAIN=""
H_USER=""
H_HOST=""
H_PORT="21"
H_PASS="${HOSTINGER_PASS:-}"
REMOTE_DIR="/public_html"
SKIP_GENERATE=false
DRY_RUN=false
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# ─── Parse args ────────────────────────────────────────────────────────────
for arg in "$@"; do
  case $arg in
    --vertical=*)    VERTICAL="${arg#*=}" ;;
    --domain=*)      DOMAIN="${arg#*=}" ;;
    --hostinger-user=*) H_USER="${arg#*=}" ;;
    --hostinger-host=*) H_HOST="${arg#*=}" ;;
    --hostinger-port=*) H_PORT="${arg#*=}" ;;
    --hostinger-pass=*) H_PASS="${arg#*=}" ;;
    --remote-dir=*)  REMOTE_DIR="${arg#*=}" ;;
    --skip-generate) SKIP_GENERATE=true ;;
    --dry-run)       DRY_RUN=true ;;
    *) echo "Unknown argument: $arg"; exit 1 ;;
  esac
done

# ─── Validate required args ────────────────────────────────────────────────
missing=()
[[ -z "$VERTICAL" ]] && missing+=("--vertical")
[[ -z "$DOMAIN"   ]] && missing+=("--domain")
[[ -z "$H_USER"   ]] && missing+=("--hostinger-user")
[[ -z "$H_HOST"   ]] && missing+=("--hostinger-host")

if [[ ${#missing[@]} -gt 0 ]]; then
  echo "❌ Missing required arguments: ${missing[*]}"
  echo ""
  echo "Usage:"
  echo "  ./scripts/deploy-to-hostinger.sh \\"
  echo "    --vertical=structural_biology \\"
  echo "    --domain=salmonbio.wiki \\"
  echo "    --hostinger-user=u123456789 \\"
  echo "    --hostinger-host=89.116.123.45"
  exit 1
fi

LOCAL_DIR="$PROJECT_DIR/dist/$DOMAIN"

# ─── Step 1: Generate static site ─────────────────────────────────────────
if [[ "$SKIP_GENERATE" == false ]]; then
  echo "🔨 Generating micron site..."
  cd "$PROJECT_DIR"
  npx tsx scripts/generate-micron.ts \
    --vertical="$VERTICAL" \
    --domain="$DOMAIN" \
    --out="$LOCAL_DIR"
  echo ""
fi

# Verify output exists
if [[ ! -f "$LOCAL_DIR/index.html" ]]; then
  echo "❌ index.html not found at $LOCAL_DIR"
  echo "   Run without --skip-generate to generate the site first."
  exit 1
fi

# ─── Step 2: Show file list ────────────────────────────────────────────────
echo "📦 Files to deploy:"
find "$LOCAL_DIR" -type f | sort | while read -r f; do
  size=$(wc -c < "$f")
  rel="${f#$LOCAL_DIR/}"
  printf "   %-40s %s bytes\n" "$rel" "$size"
done
echo ""

if [[ "$DRY_RUN" == true ]]; then
  echo "🔍 Dry run — no files uploaded."
  echo "   Remove --dry-run to deploy."
  exit 0
fi

# ─── Step 3: Deploy via SFTP (lftp) ───────────────────────────────────────
echo "🚀 Deploying to $H_HOST via SFTP..."

# Prompt for password if not set
if [[ -z "$H_PASS" ]]; then
  echo -n "   Hostinger SFTP password for $H_USER: "
  read -rs H_PASS
  echo ""
fi

# Check lftp is available
if ! command -v lftp &>/dev/null; then
  echo "❌ lftp not found. Install it:"
  echo "   macOS:  brew install lftp"
  echo "   Ubuntu: sudo apt install lftp"
  echo ""
  echo "   Alternatively, use FileZilla or Hostinger's File Manager to upload:"
  echo "   $LOCAL_DIR → $REMOTE_DIR"
  exit 1
fi

lftp -u "$H_USER,$H_PASS" "sftp://$H_HOST:$H_PORT" <<LFTP_SCRIPT
  set sftp:auto-confirm yes
  set net:timeout 30
  set net:max-retries 3
  mirror --reverse --delete --verbose \
    "$LOCAL_DIR/" \
    "$REMOTE_DIR/"
  bye
LFTP_SCRIPT

echo ""
echo "✅ Deployed successfully!"
echo ""
echo "   Site URL : https://$DOMAIN"
echo "   Verify   : curl -s https://$DOMAIN/ | grep '<title>'"
echo "   API test : curl -s -X POST https://ttruthdesk.claims/api/public/verify-claim \\"
echo "                -H 'Content-Type: application/json' \\"
echo "                -d '{\"claim\":\"test claim\"}'"
echo ""
echo "   Next micron:"
echo "   ./scripts/deploy-to-hostinger.sh \\"
echo "     --vertical=biosimilar \\"
echo "     --domain=biosimilar.wiki \\"
echo "     --hostinger-user=$H_USER \\"
echo "     --hostinger-host=$H_HOST"
