#!/bin/bash
# =============================================================================
# Project NEXUS — Search-engine notification after a deploy
# =============================================================================
# For each active tenant domain:
#   1. Fetch its sitemap.xml and extract <loc> URLs.
#   2. Submit those URLs to IndexNow (Bing, Yandex, Seznam, Naver, Yep).
#
# IndexNow is the only post-deploy "ping" API that still works:
#   - Google deprecated GET /ping?sitemap= in 2023.
#   - Bing deprecated its own /ping endpoint in 2022 in favour of IndexNow.
#   - Yandex and Seznam consume IndexNow directly.
#   - Bing's IndexNow feed is consumed downstream by ChatGPT search, Copilot,
#     Yep, and other AI/search products.
#
# Usage:
#   sudo bash scripts/seo-ping.sh                    # ping all tenant domains
#   sudo bash scripts/seo-ping.sh --domain hour-timebank.ie
#   sudo bash scripts/seo-ping.sh --dry-run
#
# Requirements:
#   - curl, awk, grep
#   - Each tenant domain must serve /<KEY>.txt with the IndexNow key body.
#     The key file lives at react-frontend/public/<KEY>.txt and is shipped
#     with every deploy, so all tenant domains expose it automatically.
# =============================================================================

set -euo pipefail

DEPLOY_DIR="${DEPLOY_DIR:-/opt/nexus-php}"
INDEXNOW_KEY="${INDEXNOW_KEY:-b0c4bb7b09d91e2a7c335f81399e94f4}"
INDEXNOW_ENDPOINT="https://api.indexnow.org/indexnow"
MAX_URLS_PER_REQUEST=10000
LOG_DIR="${LOG_DIR:-$DEPLOY_DIR/logs}"
LOG_FILE="$LOG_DIR/seo-ping-$(date +%Y%m%d-%H%M%S).log"

FILTER_DOMAIN=""
DRY_RUN=0

while [[ $# -gt 0 ]]; do
    case "$1" in
        --domain) FILTER_DOMAIN="${2:-}"; shift 2 ;;
        --dry-run) DRY_RUN=1; shift ;;
        *) echo "Unknown option: $1" >&2; exit 2 ;;
    esac
done

mkdir -p "$LOG_DIR"
log() { echo "[$(date -Is)] $*" | tee -a "$LOG_FILE"; }

get_domains() {
    local DB_USER DB_PASS DB_NAME QUERY
    DB_USER=$(grep "^DB_USER=" "$DEPLOY_DIR/.env" 2>/dev/null | cut -d'=' -f2 | tr -d '"' || echo "nexus")
    DB_PASS=$(grep "^DB_PASS=" "$DEPLOY_DIR/.env" 2>/dev/null | cut -d'=' -f2 | tr -d '"' || true)
    DB_NAME=$(grep "^DB_NAME=" "$DEPLOY_DIR/.env" 2>/dev/null | cut -d'=' -f2 | tr -d '"' || echo "nexus")

    QUERY="SELECT domain FROM tenants WHERE is_active = 1 AND domain IS NOT NULL AND domain <> '' AND id <> 1"
    if [ -n "$FILTER_DOMAIN" ]; then
        QUERY="$QUERY AND domain = '$FILTER_DOMAIN'"
    fi

    MYSQL_PWD="$DB_PASS" docker exec -e MYSQL_PWD nexus-php-db \
        mysql -u"$DB_USER" "$DB_NAME" -N -e "$QUERY" 2>/dev/null
}

fetch_sitemap_urls() {
    local DOMAIN="$1"
    curl -sf --max-time 30 "https://${DOMAIN}/sitemap.xml" 2>/dev/null \
        | grep -oE '<loc>[^<]+</loc>' \
        | sed -e 's#<loc>##' -e 's#</loc>##' \
        | grep -E "^https://${DOMAIN}/" \
        || true
}

verify_key() {
    local DOMAIN="$1"
    local URL="https://${DOMAIN}/${INDEXNOW_KEY}.txt"
    local BODY
    BODY="$(curl -sf --max-time 10 "$URL" 2>/dev/null | tr -d '[:space:]')"
    if [ "$BODY" = "$INDEXNOW_KEY" ]; then
        return 0
    fi
    log "WARN: ${URL} did not return the key (got '${BODY:0:40}'). IndexNow submission will fail until this is fixed."
    return 1
}

submit_indexnow() {
    local DOMAIN="$1"
    shift
    local URLS=("$@")
    local COUNT="${#URLS[@]}"

    if [ "$COUNT" -eq 0 ]; then
        log "  No URLs to submit for ${DOMAIN}"
        return 0
    fi

    # Build JSON payload using printf (avoids needing jq).
    local URL_LIST=""
    for u in "${URLS[@]}"; do
        # Escape backslashes and quotes for JSON safety. Sitemap URLs from
        # SitemapService shouldn't contain either, but defend anyway.
        local ESC
        ESC=$(printf '%s' "$u" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g')
        URL_LIST+="\"${ESC}\","
    done
    URL_LIST="${URL_LIST%,}"  # strip trailing comma

    local PAYLOAD
    PAYLOAD=$(cat <<EOF
{"host":"${DOMAIN}","key":"${INDEXNOW_KEY}","keyLocation":"https://${DOMAIN}/${INDEXNOW_KEY}.txt","urlList":[${URL_LIST}]}
EOF
)

    if [ "$DRY_RUN" -eq 1 ]; then
        log "  DRY-RUN would submit ${COUNT} URLs for ${DOMAIN}"
        return 0
    fi

    local HTTP_CODE
    HTTP_CODE=$(curl -s -o /tmp/indexnow-response.$$ -w '%{http_code}' \
        -X POST "$INDEXNOW_ENDPOINT" \
        -H "Content-Type: application/json; charset=utf-8" \
        --max-time 30 \
        --data "$PAYLOAD" 2>/dev/null || echo "000")
    local RESPONSE_BODY
    RESPONSE_BODY="$(cat /tmp/indexnow-response.$$ 2>/dev/null || true)"
    rm -f /tmp/indexnow-response.$$

    # IndexNow returns 200 OK or 202 Accepted on success.
    case "$HTTP_CODE" in
        200|202)
            log "  OK ${DOMAIN} → ${HTTP_CODE} (${COUNT} URLs submitted)"
            ;;
        *)
            log "  FAIL ${DOMAIN} → ${HTTP_CODE} ${RESPONSE_BODY:0:200}"
            return 1
            ;;
    esac
}

main() {
    log "=== SEO ping (IndexNow) starting ==="
    log "Key: ${INDEXNOW_KEY}"

    local DOMAINS
    DOMAINS=$(get_domains)

    if [ -z "$DOMAINS" ]; then
        log "No active tenant domains found"
        exit 0
    fi

    local FAIL=0
    while IFS= read -r DOMAIN; do
        [ -n "$DOMAIN" ] || continue
        log "Domain: ${DOMAIN}"

        if ! verify_key "$DOMAIN"; then
            FAIL=$((FAIL + 1))
            continue
        fi

        local URLS
        URLS=$(fetch_sitemap_urls "$DOMAIN")
        if [ -z "$URLS" ]; then
            log "  No URLs in sitemap"
            continue
        fi

        # Trim to MAX_URLS_PER_REQUEST (IndexNow protocol cap).
        local URL_ARRAY
        mapfile -t URL_ARRAY <<< "$URLS"
        if [ "${#URL_ARRAY[@]}" -gt "$MAX_URLS_PER_REQUEST" ]; then
            log "  Trimming ${#URL_ARRAY[@]} URLs to ${MAX_URLS_PER_REQUEST} (IndexNow limit)"
            URL_ARRAY=("${URL_ARRAY[@]:0:$MAX_URLS_PER_REQUEST}")
        fi

        if ! submit_indexnow "$DOMAIN" "${URL_ARRAY[@]}"; then
            FAIL=$((FAIL + 1))
        fi
    done <<< "$DOMAINS"

    log "=== SEO ping complete (failures: ${FAIL}) ==="
    [ "$FAIL" -eq 0 ]
}

main "$@"
