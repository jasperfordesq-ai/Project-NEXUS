#!/bin/bash
# =============================================================================
# Project NEXUS - Cloudflare Cache Purge (All Domains)
# =============================================================================
# Purges the entire Cloudflare cache for every zone on the account.
# Called automatically after every deployment by the blue-green deploy.
#
# Usage:
#   sudo bash scripts/purge-cloudflare-cache.sh
#   sudo bash scripts/purge-cloudflare-cache.sh --dry-run   # show coverage only
#
# API Token:
#   Reads from /opt/nexus-php/.cloudflare-api-token (production)
#   or CLOUDFLARE_API_TOKEN environment variable
#
# 🔴 The zone list is DISCOVERED from the Cloudflare API, not just hardcoded.
#
# It used to be a hardcoded list of 7. On 2026-08-12 the account actually had 9
# active zones, and the two missing ones were not spare domains — both are served
# by this platform from the production box:
#
#   timebanks.us       ProxyPass / -> ${NEXUS_FRONTEND_PORT}  (the React app)
#   pairc-goodman.com  ProxyPass / -> :3000, /api -> :8090    (app + API)
#
# So every deploy left those two serving stale HTML and asset bundles from
# Cloudflare's edge, indefinitely, because nothing ever purged them. A hardcoded
# list cannot notice a domain someone adds later, and nothing else was checking.
#
# Discovery fixes that class of bug rather than just the two instances: any zone
# added to the account is purged by the next deploy with no code change. The
# static list below is kept as a FLOOR, so a token that cannot list zones (or an
# API outage) still purges everything we already knew about, and the script says
# loudly that its coverage may be incomplete instead of silently shrinking.
# =============================================================================

# --- Configuration ---
DEPLOY_DIR="/opt/nexus-php"
TOKEN_FILE="$DEPLOY_DIR/.cloudflare-api-token"

DRY_RUN=0
if [ "${1:-}" = "--dry-run" ]; then
    DRY_RUN=1
fi

# Known platform zones. This is a FLOOR, not the whole truth — discovery adds to
# it. Verified against the account on 2026-08-12.
declare -A ZONES=(
    ["project-nexus.ie"]="d6d9903416081a10ac2d496d9b8456fb"
    ["hour-timebank.ie"]="54502ac7dc583e8acdb9b5ed87b0ba60"
    ["timebankireland.ie"]="9b5f481234f8f1ab134bf943d6193816"
    ["timebank.global"]="7ac1e69f5a1fdc7894236548adf7be1e"
    ["nexuscivic.ie"]="65eb5427905a35e7c6186977f8c5a370"
    ["project-nexus.net"]="ab50a7ee4c5f427b7bc436db26496c7d"
    ["festivalflags.ie"]="e9009e5ca261271de5ea7de4aa3ede62"
    ["pairc-goodman.com"]="ecd51b8b1e35d3a170364c35058749c0"
    ["timebanks.us"]="ed5c87c8e847734a5083362d226b0c1d"
)
STATIC_ZONE_COUNT=${#ZONES[@]}

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

# --- Discover every zone on the account -------------------------------------
# Emits "<name> <id>" per line. Non-zero return means discovery did not work and
# the caller must fall back to the static floor.
discover_zones() {
    local resp
    resp=$(curl -s --max-time 20 --connect-timeout 5 \
        "https://api.cloudflare.com/client/v4/zones?per_page=100" \
        -H "Authorization: Bearer ${CF_TOKEN}" 2>/dev/null) || return 1

    printf '%s' "$resp" | grep -q '"success":[[:space:]]*true' || return 1

    if command -v python3 >/dev/null 2>&1; then
        printf '%s' "$resp" | python3 -c 'import sys, json
try:
    d = json.load(sys.stdin)
except Exception:
    sys.exit(1)
for z in d.get("result", []):
    if z.get("name") and z.get("id"):
        print(z["name"], z["id"])'
        return $?
    fi

    # Fallback parser (key order dependent — only used when python3 is absent).
    printf '%s' "$resp" \
        | tr '{' '\n' \
        | grep -oE '"id":"[0-9a-f]{32}","name":"[^"]+"' \
        | sed -E 's/"id":"([0-9a-f]{32})","name":"([^"]+)"/\2 \1/'
}

DISCOVERY_OK=0
ADDED=0
if DISCOVERED=$(discover_zones) && [ -n "$DISCOVERED" ]; then
    DISCOVERY_OK=1
    while read -r ZNAME ZID; do
        [ -z "$ZNAME" ] && continue
        [ -z "$ZID" ] && continue
        if [ -z "${ZONES[$ZNAME]:-}" ]; then
            ADDED=$((ADDED + 1))
            echo -e "${CYAN}[INFO]${NC} Zone discovered that was not in the static list: $ZNAME"
        fi
        ZONES["$ZNAME"]="$ZID"
    done <<< "$DISCOVERED"
fi

if [ $DISCOVERY_OK -eq 1 ]; then
    echo -e "${CYAN}[INFO]${NC} Zone discovery OK — ${#ZONES[@]} zones (${STATIC_ZONE_COUNT} known, ${ADDED} newly discovered)"
else
    echo -e "${YELLOW}[WARN]${NC} Could not list zones from the Cloudflare API."
    echo -e "${YELLOW}[WARN]${NC} Falling back to the ${STATIC_ZONE_COUNT} hardcoded zones — a domain added"
    echo -e "${YELLOW}[WARN]${NC} since this script was last edited will NOT be purged."
fi

if [ $DRY_RUN -eq 1 ]; then
    echo -e "${CYAN}[INFO]${NC} --dry-run: would purge these ${#ZONES[@]} zones:"
    for DOMAIN in "${!ZONES[@]}"; do
        echo "    $DOMAIN"
    done | sort
    exit 0
fi

# --- Purge all zones ---
echo -e "${CYAN}[INFO]${NC} Purging Cloudflare cache for all ${#ZONES[@]} domains..."

PURGE_FAILED=0
PURGE_SUCCESS=0

for DOMAIN in "${!ZONES[@]}"; do
    ZONE_ID="${ZONES[$DOMAIN]}"

    RESPONSE=$(curl -s -w "\n%{http_code}" --max-time 15 --connect-timeout 5 -X POST \
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
