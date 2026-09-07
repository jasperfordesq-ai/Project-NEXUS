#!/bin/bash
# =============================================================================
# Bot User-Agent list refresh (Phase 4.2).
# =============================================================================
# Source of truth: Matomo's actively-maintained device-detector list.
#   https://github.com/matomo-org/device-detector/blob/master/regexes/bots.yml
#
# We don't replace the curated list in nginx.bluegreen.conf (the $nexus_is_seo_bot
# map is hand-tuned for crawlers we actually want to serve snapshots to). This
# script generates a SUPPLEMENTARY list of names that have entered the wider
# ecosystem since the conf was last updated, so a human reviewer can decide
# whether to add them.
#
# Output is written to /opt/nexus-php/logs/bot-ua-suggestions.txt — review
# before editing the nginx map.
#
# Cron entry (monthly):
#   0 5 1 * *  root bash /opt/nexus-php/scripts/refresh-bot-ua-list.sh \
#                  >> /opt/nexus-php/logs/refresh-bot-ua-list.log 2>&1
# =============================================================================

set -euo pipefail

DEPLOY_DIR="${DEPLOY_DIR:-/opt/nexus-php}"
OUT_FILE="${OUT_FILE:-$DEPLOY_DIR/logs/bot-ua-suggestions.txt}"
SOURCE_URL="${SOURCE_URL:-https://raw.githubusercontent.com/matomo-org/device-detector/master/regexes/bots.yml}"

log() { echo "[$(date -Is)] $*"; }

# Names we already cover via nginx.bluegreen.conf's $nexus_is_seo_bot regex.
# Keep in sync if you add bots to the map.
KNOWN=(
    googlebot bingbot slurp duckduckbot baiduspider yandex sogou exabot applebot petalbot
    seznambot facebookexternalhit twitterbot linkedinbot embedly pinterest slackbot whatsapp
    telegrambot discordbot redditbot viberbot skypeuripreview vkshare ahrefsbot semrushbot
    mj12bot lighthouse "screaming frog" dotbot rogerbot sitebulb gptbot oai-searchbot
    chatgpt-user claudebot claude-web anthropic-ai perplexitybot perplexity-user bytespider
    ccbot google-extended amazonbot applebot-extended cohere-ai diffbot you.com neevabot
)

TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

if ! curl -sSfL --max-time 30 "$SOURCE_URL" -o "$TMP"; then
    log "ERROR: failed to fetch source list from $SOURCE_URL"
    exit 1
fi

# Extract `name:` fields from the YAML; cheap parse — we only need lowercase names.
NEW_NAMES=$(grep -E '^\s*name:\s*' "$TMP" \
    | sed -E 's/^\s*name:\s*["'"'"']?([^"'"'"']+)["'"'"']?.*/\1/' \
    | tr '[:upper:]' '[:lower:]' \
    | sort -u)

mkdir -p "$(dirname "$OUT_FILE")"
{
    echo "# Generated $(date -Is) from $SOURCE_URL"
    echo "# Bot names not in the current nginx map — review before adding."
    while IFS= read -r NAME; do
        [ -n "$NAME" ] || continue
        SKIP=0
        for K in "${KNOWN[@]}"; do
            if printf '%s' "$NAME" | grep -qiF "$K"; then
                SKIP=1
                break
            fi
        done
        [ "$SKIP" -eq 0 ] && echo "$NAME"
    done <<< "$NEW_NAMES"
} > "$OUT_FILE"

log "Wrote $(wc -l < "$OUT_FILE") candidate UA names to $OUT_FILE"
