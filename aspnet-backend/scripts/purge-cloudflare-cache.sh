#!/bin/bash
# =============================================================================
# Project NEXUS .NET Edition - Cloudflare Cache Purge (All Domains)
# =============================================================================
# Purges the Cloudflare cache for all project domains.
# Called automatically after every deployment by scripts/deploy.sh (Step 6)
# and after the .NET Edition SPA swap documented in .claude/production-containers.md.
#
# Usage:
#   bash scripts/purge-cloudflare-cache.sh
#
# API Token:
#   Reads from /opt/nexus-backend/.cloudflare-api-token (production)
#   or CLOUDFLARE_API_TOKEN env var.
#
# Note: a zone returning HTTP 401 here means the token is not scoped to that
# zone (token-permission issue, not a script bug). Re-scope at
# https://dash.cloudflare.com/profile/api-tokens.
# =============================================================================

# --- Configuration ---
DEPLOY_DIR="/opt/nexus-backend"
TOKEN_FILE="$DEPLOY_DIR/.cloudflare-api-token"

# Active Cloudflare zone IDs (7 — exchangemembers.com removed 2026-05-12;
# it was the legacy CRM URL, superseded by crm.project-nexus.ie, and the
# Cloudflare token wasn't scoped to it anyway — it was the only 401).
declare -A ZONES=(
    ["project-nexus.ie"]="d6d9903416081a10ac2d496d9b8456fb"
    ["hour-timebank.ie"]="54502ac7dc583e8acdb9b5ed87b0ba60"
    ["timebankireland.ie"]="9b5f481234f8f1ab134bf943d6193816"
    ["timebank.global"]="7ac1e69f5a1fdc7894236548adf7be1e"
    ["nexuscivic.ie"]="65eb5427905a35e7c6186977f8c5a370"
    ["project-nexus.net"]="ab50a7ee4c5f427b7bc436db26496c7d"
    ["festivalflags.ie"]="e9009e5ca261271de5ea7de4aa3ede62"
)

# --- Colors ---
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

# --- Resolve API token ---
if [ -n "$CLOUDFLARE_API_TOKEN" ]; then
    CF_TOKEN="$CLOUDFLARE_API_TOKEN"
elif [ -f "$TOKEN_FILE" ]; then
    CF_TOKEN=$(cat "$TOKEN_FILE" | tr -d '[:space:]')
else
    echo -e "${RED}[FAIL]${NC} Cloudflare API token not found"
    echo "       Set CLOUDFLARE_API_TOKEN env var or create $TOKEN_FILE"
    exit 1
fi

# --- Purge all zones ---
echo -e "${CYAN}[INFO]${NC} Purging Cloudflare cache for all ${#ZONES[@]} domains..."

PURGE_FAILED=0
PURGE_SUCCESS=0

for DOMAIN in "${!ZONES[@]}"; do
    ZONE_ID="${ZONES[$DOMAIN]}"

    RESPONSE=$(curl -s -w "\n%{http_code}" -X POST \
        "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/purge_cache" \
        -H "Authorization: Bearer ${CF_TOKEN}" \
        -H "Content-Type: application/json" \
        --data '{"purge_everything":true}' \
        2>/dev/null)

    HTTP_CODE=$(echo "$RESPONSE" | tail -1)

    # Check for success (response is multi-line JSON, match with or without space)
    if echo "$RESPONSE" | grep -q '"success":\s*true'; then
        echo -e "  ${GREEN}[OK]${NC}   $DOMAIN"
        PURGE_SUCCESS=$((PURGE_SUCCESS + 1))
    else
        echo -e "  ${RED}[FAIL]${NC} $DOMAIN (HTTP $HTTP_CODE)"
        PURGE_FAILED=$((PURGE_FAILED + 1))
    fi
done

echo ""
if [ $PURGE_FAILED -eq 0 ]; then
    echo -e "${GREEN}[OK]${NC}   All $PURGE_SUCCESS domains purged successfully"
    exit 0
else
    echo -e "${YELLOW}[WARN]${NC} $PURGE_SUCCESS succeeded, $PURGE_FAILED failed"
    exit 1
fi
