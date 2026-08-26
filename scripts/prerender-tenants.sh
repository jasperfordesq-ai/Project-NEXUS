#!/bin/bash
# =============================================================================
# Project NEXUS - Per-Tenant Server-Side Pre-Rendering
# =============================================================================
# Plans and refreshes only the tenant pages that need it:
#   - missing cache files
#   - cache files that reference frontend assets no longer in the active image
#   - explicitly scoped tenant/routes
#   - all pages when --force is supplied
#
# Usage:
#   sudo bash scripts/prerender-tenants.sh
#   sudo bash scripts/prerender-tenants.sh --force
#   sudo bash scripts/prerender-tenants.sh --tenant hour-timebank
#   sudo bash scripts/prerender-tenants.sh --routes /about,/privacy
#   sudo bash scripts/prerender-tenants.sh --tenant hour-timebank --routes /about
#
# Requirements:
#   - Target frontend container must be running
#   - API must be responding (maintenance mode OFF)
#   - Docker must be available (uses mcr.microsoft.com/playwright image)
# =============================================================================

set -euo pipefail

DEPLOY_DIR="${DEPLOY_DIR:-/opt/nexus-php}"
PRERENDER_CONFIG_DIR="${PRERENDER_CONFIG_DIR:-$DEPLOY_DIR}"
PRERENDER_CODE_DIR="${PRERENDER_CODE_DIR:-$DEPLOY_DIR}"
CONTAINER_RESOLVER="${NEXUS_CONTAINER_RESOLVER:-$PRERENDER_CODE_DIR/scripts/resolve-active-container.sh}"

# Auto-detect the active react container. Blue/green deploys leave only one
# color running at a time; legacy single-color setups use `nexus-react-prod`.
# Override with NGINX_CONTAINER=... if you need to target a specific one
# (e.g. warming the inactive color before a cutover).
if [ -z "${NGINX_CONTAINER:-}" ]; then
    if [ ! -r "$CONTAINER_RESOLVER" ]; then
        echo "Prerender active-container resolver unavailable at $CONTAINER_RESOLVER" >&2
        exit 69
    fi
    # shellcheck source=resolve-active-container.sh
    source "$CONTAINER_RESOLVER"
    if ! NGINX_CONTAINER="$(resolve_active_nexus_container react)"; then
        echo "Could not resolve the active React container" >&2
        exit 69
    fi
fi
PRERENDER_DIR="/usr/share/nginx/html/prerendered"
PLAYWRIGHT_IMAGE="${PLAYWRIGHT_IMAGE:-mcr.microsoft.com/playwright:v1.59.1-noble}"
PLAYWRIGHT_NPM_VERSION="${PLAYWRIGHT_NPM_VERSION:-1.59.1}"
WORKER_SCRIPT="$PRERENDER_CODE_DIR/scripts/prerender-worker.mjs"
OUTPUT_PARENT="${PRERENDER_OUTPUT_DIR:-${TMPDIR:-/tmp}}"
mkdir -p "$OUTPUT_PARENT"
OUTPUT_PARENT="$(cd "$OUTPUT_PARENT" && pwd -P)"
[ "$OUTPUT_PARENT" != "/" ] || { echo "Refusing to use / as prerender output parent" >&2; exit 64; }
# Always own a fresh mode-0700 child. Cleanup can then remove only a directory
# created by this run, never an operator-supplied override path itself.
OUTPUT_DIR="$(mktemp -d "$OUTPUT_PARENT/nexus-prerender.XXXXXX")"
SECRET_DIR="$(mktemp -d "$OUTPUT_PARENT/nexus-prerender-secret.XXXXXX")"
chmod 0700 "$SECRET_DIR"
MAINTENANCE_SECRET_FILE="$SECRET_DIR/maintenance-render.token"
WORK_DIR="$PRERENDER_CONFIG_DIR/.prerender-worker"
PRERENDER_CONCURRENCY="${PRERENDER_CONCURRENCY:-4}"
PRERENDER_MEMORY_LIMIT="${PRERENDER_MEMORY_LIMIT:-3g}"
PRERENDER_CPU_LIMIT="${PRERENDER_CPU_LIMIT:-2.0}"
PRERENDER_PIDS_LIMIT="${PRERENDER_PIDS_LIMIT:-512}"
PRERENDER_SHM_SIZE="${PRERENDER_SHM_SIZE:-1g}"
PRERENDER_ALLOW_PRIVATE_HOSTS="${PRERENDER_ALLOW_PRIVATE_HOSTS:-0}"
PRERENDER_JOB_ID="${PRERENDER_JOB_ID:-}"
PRERENDER_JOB_CLAIMED_BY="${PRERENDER_JOB_CLAIMED_BY:-}"
PRERENDER_PUBLISH_TEST_MODE="${PRERENDER_PUBLISH_TEST_MODE:-0}"
PRERENDER_STATUS_OVERRIDE_LIST="${PRERENDER_STATUS_OVERRIDE_LIST:-$PRERENDER_DIR/.status-overrides.list}"
PRERENDER_PUBLISH_EPOCH="${PRERENDER_PUBLISH_EPOCH:-}"
PRERENDER_FAILURE_BACKOFF_SECONDS="${PRERENDER_FAILURE_BACKOFF_SECONDS:-21600}"
LOCK_DIR="$PRERENDER_CONFIG_DIR/.prerender-lock"
LOCK_PID_FILE="$LOCK_DIR/pid"
LOCK_START_FILE="$LOCK_DIR/start_time"
LOCK_TOKEN_FILE="$LOCK_DIR/token"
LOCK_FILE="$PRERENDER_CONFIG_DIR/.prerender-lock.flock"
LOCK_TAKEOVER_GRACE_SECONDS="${LOCK_TAKEOVER_GRACE_SECONDS:-10}"
LOCK_FD=""
LOCK_ACQUIRED=0
LOCK_OWNER_TOKEN=""
LOCK_OWNER_START_TIME=""
# Stable container name so supersession (and crash recovery) can kill the
# Playwright worker without having to discover its container ID.
PRERENDER_DOCKER_NAME="${PRERENDER_DOCKER_NAME:-nexus-prerender-worker}"
PRERENDER_DOCKER_OWNER_LABEL="ie.project-nexus.prerender-owner"

# Emergency static floor used only when an operator explicitly passes
# --no-sitemap / NEXUS_PRERENDER_NO_SITEMAP=1. Keep this list limited to
# routes that are public for every tenant. Feature/module-gated routes MUST
# come from `prerender:plan-routes`; guessing them here creates cross-tenant
# 404 snapshots.
PUBLIC_ROUTES=(
    "/"
    "/about"
    "/faq"
    "/contact"
    "/help"
    "/terms"
    "/privacy"
    "/accessibility"
    "/cookies"
    "/community-guidelines"
    "/trust-and-safety"
    "/account-deletion"
    "/child-safety"
    "/acceptable-use"
    "/legal"
    "/terms/versions"
    "/privacy/versions"
    "/accessibility/versions"
    "/cookies/versions"
    "/community-guidelines/versions"
    "/acceptable-use/versions"
    "/timebanking-guide"
    "/regional-analytics"
    "/platform/terms"
    "/platform/privacy"
    "/platform/disclaimer"
    "/features"
    "/changelog"
    "/development-status"
    "/pilot-inquiry"
    "/pilot-apply"
    "/developers"
    "/developers/auth"
    "/developers/endpoints"
    "/developers/webhooks"
    # Tenant-gated routes (TenantSlugGate). For tenants that don't match the
    # gate, React Router renders a fallback — that fallback is what gets
    # prerendered. Either way, bots no longer hit an empty SPA shell.
    "/partner"
    "/social-prescribing"
    "/impact-report"
    "/impact-summary"
    "/strategic-plan"
)

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

log_info() { echo -e "${CYAN}[INFO]${NC} $*"; }
log_ok()   { echo -e "${GREEN}[OK]${NC}   $*"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $*"; }
log_err()  { echo -e "${RED}[FAIL]${NC} $*"; }

[[ "$PLAYWRIGHT_NPM_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] \
    || { log_err "Invalid PLAYWRIGHT_NPM_VERSION"; exit 64; }
[[ "$PRERENDER_MEMORY_LIMIT" =~ ^[1-9][0-9]*[kKmMgG]?$ ]] \
    || { log_err "Invalid PRERENDER_MEMORY_LIMIT"; exit 64; }
[[ "$PRERENDER_CPU_LIMIT" =~ ^(0[.][1-9][0-9]*|[1-9][0-9]*([.][0-9]+)?)$ ]] \
    || { log_err "Invalid PRERENDER_CPU_LIMIT"; exit 64; }
[[ "$PRERENDER_PIDS_LIMIT" =~ ^[0-9]+$ ]] && [ "$PRERENDER_PIDS_LIMIT" -ge 64 ] \
    || { log_err "Invalid PRERENDER_PIDS_LIMIT (minimum 64)"; exit 64; }
[[ "$PRERENDER_SHM_SIZE" =~ ^[1-9][0-9]*[kKmMgG]?$ ]] \
    || { log_err "Invalid PRERENDER_SHM_SIZE"; exit 64; }
[[ "$PRERENDER_ALLOW_PRIVATE_HOSTS" =~ ^[01]$ ]] \
    || { log_err "Invalid PRERENDER_ALLOW_PRIVATE_HOSTS (expected 0 or 1)"; exit 64; }
if { [ -n "$PRERENDER_JOB_ID" ] || [ -n "$PRERENDER_JOB_CLAIMED_BY" ]; } \
    && { [[ ! "$PRERENDER_JOB_ID" =~ ^[0-9]+$ ]] \
        || [[ ! "$PRERENDER_JOB_CLAIMED_BY" =~ ^[A-Za-z0-9_.:-]+$ ]]; }; then
    log_err "Invalid or incomplete prerender job lease identity"
    exit 64
fi
[[ "$PRERENDER_PUBLISH_TEST_MODE" =~ ^[01]$ ]] \
    || { log_err "Invalid PRERENDER_PUBLISH_TEST_MODE"; exit 64; }
export PRERENDER_ALLOW_PRIVATE_HOSTS

# Structured event log — JSONL, one line per event. Tail with:
#   sudo tail -f /opt/nexus-php/logs/prerender-events.jsonl | jq .
# Aggregate supersession rate, skip-on-clean rate, render durations from this.
PRERENDER_EVENT_LOG="${PRERENDER_EVENT_LOG:-$PRERENDER_CONFIG_DIR/logs/prerender-events.jsonl}"
emit_event() {
    local EVENT="$1"; shift
    local EXTRA="${1:-}"
    local DIR
    DIR="$(dirname "$PRERENDER_EVENT_LOG")"
    [ -d "$DIR" ] || mkdir -p "$DIR" 2>/dev/null || return 0
    local LINE
    LINE="$(printf '{"ts":"%s","event":"%s","pid":%d,"host":"%s","commit":"%s"%s}' \
        "$(date -Is)" \
        "$(json_escape "$EVENT")" \
        "$$" \
        "$(json_escape "$(hostname 2>/dev/null || echo unknown)")" \
        "$(json_escape "$(git -C "$PRERENDER_CODE_DIR" rev-parse --short HEAD 2>/dev/null || echo unknown)")" \
        "${EXTRA:+,$EXTRA}")"
    printf '%s\n' "$LINE" >> "$PRERENDER_EVENT_LOG" 2>/dev/null || true
}

FILTER_TENANT=""
FILTER_ROUTES=""
FORCE_RENDER=0
DRY_RUN=0
# Default: ask the PHP container for the dynamic plan (static floor + sitemap).
# Set NEXUS_PRERENDER_NO_SITEMAP=1 to fall back to the hardcoded PUBLIC_ROUTES
# floor only — useful as an emergency switch if the planner misbehaves.
USE_SITEMAP_PLAN=1
if [ "${NEXUS_PRERENDER_NO_SITEMAP:-0}" = "1" ]; then
    USE_SITEMAP_PLAN=0
fi

while [[ $# -gt 0 ]]; do
    case "$1" in
        --tenant) FILTER_TENANT="${2:-}"; shift 2 ;;
        --routes) FILTER_ROUTES="${2:-}"; shift 2 ;;
        --force) FORCE_RENDER=1; shift ;;
        --dry-run) DRY_RUN=1; shift ;;
        --no-sitemap) USE_SITEMAP_PLAN=0; shift ;;
        *) log_err "Unknown pre-render option: $1"; exit 2 ;;
    esac
done

if [ -n "$FILTER_ROUTES" ]; then
    # Explicit --routes overrides the sitemap plan completely.
    IFS=',' read -r -a PUBLIC_ROUTES <<< "$FILTER_ROUTES"
    USE_SITEMAP_PLAN=0
fi

if [ -n "$FILTER_TENANT" ] && [[ ! "$FILTER_TENANT" =~ ^[A-Za-z0-9_-]+$ ]]; then
    log_err "Invalid tenant slug for pre-rendering: $FILTER_TENANT"
    exit 1
fi

ROUTE_RE='^/[A-Za-z0-9._~/%:@!$()*+,;=-]*$'
route_is_path_safe() {
    local ROUTE="$1"
    local LOWER REST MATCH
    [[ "$ROUTE" =~ $ROUTE_RE ]] || return 1
    if [ "$ROUTE" != "/" ]; then ROUTE="${ROUTE%/}"; fi
    [ -n "$ROUTE" ] || ROUTE="/"
    [[ "$ROUTE" != *"//"* ]] || return 1
    [[ ! "$ROUTE" =~ (^|/)\.{1,2}(/|$) ]] || return 1
    LOWER="${ROUTE,,}"
    [[ ! "$LOWER" =~ %(00|25|2e|2f|5c) ]] || return 1
    REST="$ROUTE"
    while [[ "$REST" =~ %([0-9A-Fa-f]{2}) ]]; do
        MATCH="${BASH_REMATCH[0]}"
        REST="${REST/"$MATCH"/}"
    done
    [[ "$REST" != *%* ]]
}

host_is_path_safe() {
    local HOST="${1,,}"
    [[ "$HOST" =~ ^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$ ]] \
        && [[ "$HOST" != *".."* ]]
}

route_is_global_explicit_safe() {
    case "$1" in
        /|/about|/faq|/contact|/help|/terms|/privacy|/accessibility|/cookies|\
/community-guidelines|/trust-and-safety|/account-deletion|/child-safety|/acceptable-use|/legal|/terms/versions|\
/privacy/versions|/accessibility/versions|/cookies/versions|/community-guidelines/versions|\
/acceptable-use/versions|/timebanking-guide|/regional-analytics|/platform/terms|\
/platform/privacy|/platform/disclaimer|/features|/changelog|/developers|/developers/auth|\
/developers/endpoints|/developers/webhooks|/development-status|/pilot-inquiry|/pilot-apply|\
/partner|/social-prescribing|/impact-report|/impact-summary|/strategic-plan)
            return 0
            ;;
        *)
            return 1
            ;;
    esac
}
for ROUTE in "${PUBLIC_ROUTES[@]}"; do
    if ! route_is_path_safe "$ROUTE"; then
        log_err "Invalid route for pre-rendering: $ROUTE"
        exit 1
    fi
    if [ -n "$FILTER_ROUTES" ] && [ -z "$FILTER_TENANT" ]; then
        if ! route_is_global_explicit_safe "$ROUTE"; then
            log_err "Explicit --routes without --tenant is limited to always-public routes: $ROUTE"
            exit 1
        fi
        if [[ "$ROUTE" =~ ^/page/[^/]+$ ]] \
            || [[ "$ROUTE" =~ ^/blog/[^/]+$ ]] \
            || [[ "$ROUTE" =~ ^/listings/[^/]+$ ]] \
            || [[ "$ROUTE" =~ ^/events/[^/]+$ ]] \
            || [[ "$ROUTE" =~ ^/jobs/[^/]+$ ]] \
            || [[ "$ROUTE" =~ ^/groups/[^/]+$ ]] \
            || [[ "$ROUTE" =~ ^/organisations/[^/]+$ ]] \
            || [[ "$ROUTE" =~ ^/ideation/[^/]+$ ]] \
            || [[ "$ROUTE" =~ ^/kb/[^/]+$ ]] \
            || [[ "$ROUTE" =~ ^/volunteering/opportunities/[^/]+$ ]] \
            || [[ "$ROUTE" =~ ^/marketplace/category/[^/]+$ ]] \
            || [[ "$ROUTE" =~ ^/marketplace/[^/]+$ && "$ROUTE" != "/marketplace/free" && "$ROUTE" != "/marketplace/map" ]]; then
            log_err "Route requires --tenant to avoid cross-tenant snapshots: $ROUTE"
            exit 1
        fi
    fi
done

process_start_time() {
    local PID="$1"
    local STAT REST

    [ -r "/proc/$PID/stat" ] || return 1
    IFS= read -r STAT < "/proc/$PID/stat" || return 1
    # The command name in /proc/<pid>/stat is parenthesised and may contain
    # spaces. Strip through the final `) ` first; starttime is then field 20.
    REST="${STAT##*) }"
    awk '{print $20}' <<< "$REST"
}

process_is_prerender_owner() {
    local PID="$1"
    local EXPECTED_START="$2"
    local CURRENT_START

    [[ "$PID" =~ ^[0-9]+$ ]] || return 1
    [[ "$EXPECTED_START" =~ ^[0-9]+$ ]] || return 1
    CURRENT_START="$(process_start_time "$PID" 2>/dev/null || true)"
    [ -n "$CURRENT_START" ] && [ "$CURRENT_START" = "$EXPECTED_START" ] || return 1
    [ -r "/proc/$PID/cmdline" ] || return 1
    tr '\0' '\n' < "/proc/$PID/cmdline" 2>/dev/null \
        | grep -Eq '(^|/)prerender-tenants[.]sh$'
}

generate_lock_owner_token() {
    local TOKEN
    TOKEN="$(od -An -N24 -tx1 /dev/urandom 2>/dev/null | tr -d '[:space:]')"
    [ "${#TOKEN}" -eq 48 ] || return 1
    printf '%s\n' "$TOKEN"
}

read_lock_metadata() {
    PRIOR_PID="$(cat "$LOCK_PID_FILE" 2>/dev/null || true)"
    PRIOR_START="$(cat "$LOCK_START_FILE" 2>/dev/null || true)"
    PRIOR_TOKEN="$(cat "$LOCK_TOKEN_FILE" 2>/dev/null || true)"
}

worker_owner_token() {
    docker inspect \
        --format "{{ index .Config.Labels \"$PRERENDER_DOCKER_OWNER_LABEL\" }}" \
        "$PRERENDER_DOCKER_NAME" 2>/dev/null || true
}

remove_worker_if_owned() {
    local EXPECTED_TOKEN="$1"
    local MODE="${2:-stop}"
    local ACTUAL_TOKEN

    [ -n "$EXPECTED_TOKEN" ] || return 0
    ACTUAL_TOKEN="$(worker_owner_token)"
    [ "$ACTUAL_TOKEN" = "$EXPECTED_TOKEN" ] || return 0

    if [ "$MODE" = "kill" ]; then
        docker kill "$PRERENDER_DOCKER_NAME" >/dev/null 2>&1 || true
    else
        docker stop "$PRERENDER_DOCKER_NAME" >/dev/null 2>&1 || true
    fi
    docker rm -f "$PRERENDER_DOCKER_NAME" >/dev/null 2>&1 || true
}

lock_metadata_matches_current_owner() {
    [ -n "$LOCK_OWNER_TOKEN" ] \
        && [ "$(cat "$LOCK_PID_FILE" 2>/dev/null || true)" = "$$" ] \
        && [ "$(cat "$LOCK_START_FILE" 2>/dev/null || true)" = "$LOCK_OWNER_START_TIME" ] \
        && [ "$(cat "$LOCK_TOKEN_FILE" 2>/dev/null || true)" = "$LOCK_OWNER_TOKEN" ]
}

write_lock_metadata() {
    local CLAIM_DIR="${LOCK_DIR}.claim.${LOCK_OWNER_TOKEN}"

    rm -rf "$CLAIM_DIR" 2>/dev/null || true
    mkdir -m 700 "$CLAIM_DIR"
    printf '%s\n' "$$" > "$CLAIM_DIR/pid"
    printf '%s\n' "$LOCK_OWNER_START_TIME" > "$CLAIM_DIR/start_time"
    printf '%s\n' "$LOCK_OWNER_TOKEN" > "$CLAIM_DIR/token"
    rm -rf "$LOCK_DIR" 2>/dev/null || true
    mv "$CLAIM_DIR" "$LOCK_DIR"
}

claim_lock() {
    LOCK_OWNER_START_TIME="$(process_start_time "$$" 2>/dev/null || true)"
    LOCK_OWNER_TOKEN="$(generate_lock_owner_token 2>/dev/null || true)"
    if [[ ! "$LOCK_OWNER_START_TIME" =~ ^[0-9]+$ ]] || [ -z "$LOCK_OWNER_TOKEN" ]; then
        log_err "Could not establish a fenced pre-render lock identity"
        exit 1
    fi

    write_lock_metadata
    LOCK_ACQUIRED=1
}

cleanup() {
    rm -rf "$OUTPUT_DIR" 2>/dev/null || true
    rm -rf "$SECRET_DIR" 2>/dev/null || true

    if [ "${LOCK_ACQUIRED:-0}" -eq 1 ]; then
        # A stable Docker name is not proof of ownership. Only stop a worker
        # carrying this run's unguessable label, and only remove metadata that
        # still names this exact process instance and token.
        remove_worker_if_owned "$LOCK_OWNER_TOKEN" stop
        if lock_metadata_matches_current_owner; then
            rm -rf "$LOCK_DIR" 2>/dev/null || true
        fi
        LOCK_ACQUIRED=0
    fi

    if [ -n "${LOCK_FD:-}" ]; then
        flock -u "$LOCK_FD" 2>/dev/null || true
        exec {LOCK_FD}>&- 2>/dev/null || true
        LOCK_FD=""
    fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

acquire_lock() {
    local PRIOR_PID="" PRIOR_START="" PRIOR_TOKEN=""
    local WAITED=0
    local LOCK_HELD=0

    command -v flock >/dev/null 2>&1 \
        || { log_err "flock is required for the pre-render execution lock"; exit 69; }
    mkdir -p "$PRERENDER_CONFIG_DIR"
    exec {LOCK_FD}>"$LOCK_FILE"

    read_lock_metadata
    if flock -n "$LOCK_FD"; then
        LOCK_HELD=1

        # Compatibility with the previous mkdir/PID-only lock. If it names a
        # real pre-render process, capture its current start time before any
        # signal and re-check that identity before escalation. An unrelated
        # reused PID is never signalled.
        if [ -n "$PRIOR_PID" ] && [[ "$PRIOR_PID" =~ ^[0-9]+$ ]]; then
            if [ -z "$PRIOR_START" ]; then
                PRIOR_START="$(process_start_time "$PRIOR_PID" 2>/dev/null || true)"
            fi
            if process_is_prerender_owner "$PRIOR_PID" "$PRIOR_START"; then
                log_warn "Superseding legacy pre-render owner (pid $PRIOR_PID)"
                remove_worker_if_owned "$PRIOR_TOKEN" kill
                kill -TERM "$PRIOR_PID" 2>/dev/null || true
                while process_is_prerender_owner "$PRIOR_PID" "$PRIOR_START" \
                    && [ "$WAITED" -lt "$LOCK_TAKEOVER_GRACE_SECONDS" ]; do
                    sleep 1
                    WAITED=$((WAITED + 1))
                done
                if process_is_prerender_owner "$PRIOR_PID" "$PRIOR_START"; then
                    log_warn "Legacy pre-render did not exit within ${LOCK_TAKEOVER_GRACE_SECONDS}s; sending SIGKILL"
                    kill -KILL "$PRIOR_PID" 2>/dev/null || true
                    sleep 1
                fi
            fi
        fi

        # Reap only a container tied to the stale metadata token. An
        # unlabelled or differently-labelled global name is left untouched.
        remove_worker_if_owned "$PRIOR_TOKEN" kill
        claim_lock
        return 0
    fi

    # Another contender may have replaced the owner between our initial
    # metadata read and the failed non-blocking flock. Re-read under the
    # observed contention; stale metadata can only make us refuse takeover,
    # never signal an unverified process.
    read_lock_metadata

    # Lock-or-cancel: a fresh deploy supersedes an in-flight render, but only
    # after proving the PID is the same process instance recorded by the owner
    # (PID + kernel start time + script command line). Corrupt/legacy metadata
    # while an advisory lock is held fails closed instead of killing a guess.
    if [ -z "$PRIOR_TOKEN" ] \
        || ! [[ "$PRIOR_TOKEN" =~ ^[0-9a-f]{48}$ ]] \
        || ! process_is_prerender_owner "$PRIOR_PID" "$PRIOR_START"; then
        log_err "Pre-render lock is held but its owner identity cannot be verified; refusing unsafe takeover"
        emit_event "lock_takeover_refused" "\"reason\":\"owner_identity_mismatch\""
        exit 1
    fi

    log_warn "Superseding in-flight pre-render (pid $PRIOR_PID)"
    emit_event "supersede" "\"prior_pid\":$PRIOR_PID,\"reason\":\"newer_deploy\""
    remove_worker_if_owned "$PRIOR_TOKEN" kill
    kill -TERM "$PRIOR_PID" 2>/dev/null || true

    while [ "$WAITED" -lt "$LOCK_TAKEOVER_GRACE_SECONDS" ]; do
        if flock -n "$LOCK_FD"; then
            LOCK_HELD=1
            break
        fi
        sleep 1
        WAITED=$((WAITED + 1))
    done

    if [ "$LOCK_HELD" -ne 1 ]; then
        if process_is_prerender_owner "$PRIOR_PID" "$PRIOR_START"; then
            log_warn "Prior pre-render did not exit within ${LOCK_TAKEOVER_GRACE_SECONDS}s; sending SIGKILL"
            kill -KILL "$PRIOR_PID" 2>/dev/null || true
            sleep 1
        else
            log_warn "Prior PID identity changed before escalation; refusing to signal it"
        fi
        if flock -n "$LOCK_FD"; then
            LOCK_HELD=1
        fi
    fi

    if [ "$LOCK_HELD" -ne 1 ]; then
        log_err "Could not acquire pre-render lock after fenced takeover attempt"
        exit 1
    fi

    claim_lock
}

list_contains() {
    local NEEDLE="$1"
    local HAYSTACK="$2"
    printf '%s\n' "$HAYSTACK" | grep -Fxq "$NEEDLE"
}

append_query_param() {
    local URL="$1"
    local PARAM="$2"

    if [[ "$URL" == *\?* ]]; then
        echo "${URL}&${PARAM}"
    else
        echo "${URL}?${PARAM}"
    fi
}

json_escape() {
    local VALUE="$1"
    VALUE=${VALUE//\\/\\\\}
    VALUE=${VALUE//\"/\\\"}
    VALUE=${VALUE//$'\t'/\\t}
    VALUE=${VALUE//$'\r'/\\r}
    VALUE=${VALUE//$'\n'/\\n}
    printf '%s' "$VALUE"
}

route_cache_path() {
    local HOST="$1"
    local OUT_ROUTE="$2"

    # A path-hosted tenant homepage is assembled as prefix=/tenant + route=/.
    # Normalise it to /tenant so cache keys match filesystem `find` output.
    OUT_ROUTE="${OUT_ROUTE%/}"
    if [ -z "$OUT_ROUTE" ] || [ "$OUT_ROUTE" = "/" ]; then
        echo "${HOST}/index.html"
    else
        echo "${HOST}${OUT_ROUTE}/index.html"
    fi
}

get_frontend_host() {
    local FRONTEND_URL
    FRONTEND_URL=$(grep "^FRONTEND_URL=" "$PRERENDER_CONFIG_DIR/.env" 2>/dev/null | cut -d'=' -f2 | tr -d '"' || true)
    FRONTEND_URL="${FRONTEND_URL:-https://app.project-nexus.ie}"
    echo "$FRONTEND_URL" | sed 's|https\?://||' | sed 's|/.*||'
}

# Ask the PHP container for the full per-tenant route plan (static floor +
# sitemap-derived URLs). Output: JSON to stdout. Empty string on failure; the
# caller fails closed unless an operator explicitly selected --no-sitemap.
get_route_plan() {
    local PLAN_APP_CONTAINER="${PRERENDER_APP_CONTAINER:-${APP_CONTAINER:-}}"
    local ARGS APP_COLOR="" REACT_COLOR=""
    if [ -z "$PLAN_APP_CONTAINER" ]; then
        if [ ! -r "$CONTAINER_RESOLVER" ]; then
            return 0
        fi
        # shellcheck source=resolve-active-container.sh
        source "$CONTAINER_RESOLVER"
        PLAN_APP_CONTAINER="$(resolve_active_nexus_container php-app 2>/dev/null || true)"
    fi

    if ! docker ps --format '{{.Names}}' | grep -Fqx -- "$PLAN_APP_CONTAINER"; then
        return 0
    fi

    # Planner and snapshot injection must observe the same blue/green color.
    # Explicit non-standard container overrides remain supported for operators.
    if [[ "$PLAN_APP_CONTAINER" =~ ^nexus-(blue|green)-php-app$ ]]; then
        APP_COLOR="${BASH_REMATCH[1]}"
    fi
    if [[ "$NGINX_CONTAINER" =~ ^nexus-(blue|green)-react$ ]]; then
        REACT_COLOR="${BASH_REMATCH[1]}"
    fi
    if [ -n "$APP_COLOR" ] && [ -n "$REACT_COLOR" ] && [ "$APP_COLOR" != "$REACT_COLOR" ]; then
        log_err "Resolved PHP and React containers are from different active colors" >&2
        return 0
    fi

    ARGS=(php artisan prerender:plan-routes)
    if [ -n "$FILTER_TENANT" ]; then ARGS+=(--tenant="$FILTER_TENANT"); fi

    # Strip non-JSON stderr; only the last JSON object line counts.
    docker exec "$PLAN_APP_CONTAINER" "${ARGS[@]}" 2>/dev/null \
        | awk '/^\{/{ json=$0 } END{ print json }' || true
}

assert_job_lease() {
    [ -n "$PRERENDER_JOB_ID" ] || return 0
    local LEASE_APP_CONTAINER="${PRERENDER_APP_CONTAINER:-${APP_CONTAINER:-}}"
    if [ -z "$LEASE_APP_CONTAINER" ]; then
        [ -r "$CONTAINER_RESOLVER" ] || return 1
        # shellcheck source=resolve-active-container.sh
        source "$CONTAINER_RESOLVER"
        LEASE_APP_CONTAINER="$(resolve_active_nexus_container php-app 2>/dev/null || true)"
    fi
    [ -n "$LEASE_APP_CONTAINER" ] || return 1
    timeout --foreground --signal=TERM --kill-after=5s 30s \
        docker exec "$LEASE_APP_CONTAINER" php artisan prerender:process-queue \
            --heartbeat-id="$PRERENDER_JOB_ID" \
            --claimed-by="$PRERENDER_JOB_CLAIMED_BY" >/dev/null 2>&1
}

get_tenants() {
    local DB_USER DB_PASS DB_NAME QUERY
    DB_USER=$(grep "^DB_USER=" "$PRERENDER_CONFIG_DIR/.env" 2>/dev/null | cut -d'=' -f2 | tr -d '"' || echo "nexus")
    DB_PASS=$(grep "^DB_PASS=" "$PRERENDER_CONFIG_DIR/.env" 2>/dev/null | cut -d'=' -f2 | tr -d '"' || true)
    DB_NAME=$(grep "^DB_NAME=" "$PRERENDER_CONFIG_DIR/.env" 2>/dev/null | cut -d'=' -f2 | tr -d '"' || echo "nexus")

    # Tenant 1 is the platform root. project-nexus.ie is served by the private
    # commercial sales-site repository, not the React tenant frontend.
    # parent_domain: parent's domain when this tenant has no own domain but its
    # parent does — used for sub-tenant path routing (timebanking.uk/cardiff).
    QUERY="SELECT t.id, t.slug, COALESCE(NULLIF(t.domain, ''), '__NEXUS_EMPTY__') as domain, COALESCE(NULLIF(p.domain, ''), '__NEXUS_EMPTY__') as parent_domain FROM tenants t LEFT JOIN tenants p ON p.id = t.parent_id AND p.id <> 1 AND p.is_active = 1 WHERE t.is_active = 1 AND t.id <> 1"
    if [ -n "$FILTER_TENANT" ]; then
        # Defense-in-depth: re-validate here at the point of use.
        # Top-level validation (line ~159) runs first; this is a safety net
        # against future callers that bypass the top-level check.
        if [[ ! "$FILTER_TENANT" =~ ^[A-Za-z0-9_-]+$ ]]; then
            log_err "get_tenants: FILTER_TENANT contains invalid characters"
            return 1
        fi
        QUERY="$QUERY AND t.slug = '$FILTER_TENANT'"
    fi
    QUERY="$QUERY ORDER BY id"

    docker exec -e MYSQL_PWD="$DB_PASS" nexus-php-db \
        mysql -u"$DB_USER" "$DB_NAME" -N -e "$QUERY" 2>/dev/null
}

load_existing_cache_paths() {
    docker exec -e PRERENDER_DIR="$PRERENDER_DIR" "$NGINX_CONTAINER" sh -c '
        find "$PRERENDER_DIR" -name index.html -type f 2>/dev/null \
            | sed "s#^$PRERENDER_DIR/##" \
            | sort
    ' 2>/dev/null || true
}

load_stale_cache_paths() {
    # No-op since the introduction of bot-only prerender serving in nginx.
    # Snapshots are now served exclusively to crawlers, which do not execute
    # JavaScript, so build-hashed asset URLs in stale snapshots cannot break
    # any client. A snapshot stays valid until its content (DB-driven) changes.
    # Use --force to rerender unconditionally.
    return 0
}

load_recent_failure_paths() {
    docker exec \
        -e PRERENDER_DIR="$PRERENDER_DIR" \
        -e PRERENDER_FAILURE_BACKOFF_SECONDS="$PRERENDER_FAILURE_BACKOFF_SECONDS" \
        "$NGINX_CONTAINER" sh -c '
            FILE="$PRERENDER_DIR/.failures.tsv"
            NOW="$(date +%s)"
            [ -f "$FILE" ] || exit 0
            awk -v now="$NOW" -v ttl="$PRERENDER_FAILURE_BACKOFF_SECONDS" \
                '"'"'$1 ~ /^[0-9]+$/ && $2 != "" && now - $1 < ttl { print $2 }'"'"' "$FILE" \
                | sort -u
        ' 2>/dev/null || true
}

load_current_assets() {
    docker exec "$NGINX_CONTAINER" sh -c '
        find /usr/share/nginx/html/assets -type f \( -name "*.js" -o -name "*.css" \) 2>/dev/null \
            | sed "s#^/usr/share/nginx/html##" \
            | sort
    ' 2>/dev/null || true
}

should_render_cache_path() {
    local CACHE_PATH="$1"

    if [ "$FORCE_RENDER" -eq 1 ]; then
        return 0
    fi

    if [ -n "$FILTER_TENANT" ] || [ -n "$FILTER_ROUTES" ]; then
        return 0
    fi

    if ! list_contains "$CACHE_PATH" "$EXISTING_CACHE_PATHS"; then
        if list_contains "$CACHE_PATH" "$RECENT_FAILURE_PATHS"; then
            return 1
        fi
        return 0
    fi

    if list_contains "$CACHE_PATH" "$STALE_CACHE_PATHS"; then
        if list_contains "$CACHE_PATH" "$RECENT_FAILURE_PATHS"; then
            return 1
        fi
        return 0
    fi

    return 1
}

# Emit one manifest entry. All callers use this so format stays consistent.
emit_manifest_entry() {
    local HOST="$1" PREFIX="$2" ROUTE="$3" TENANT_ID="$4" SLUG="$5"
    local FULL_URL RENDER_URL OUT_ROUTE OUT_PATH CACHE_PATH
    HOST="${HOST,,}"
    if ! host_is_path_safe "$HOST" || ! route_is_path_safe "$ROUTE"; then
        log_err "Unsafe host or route refused during manifest assembly: $HOST $ROUTE"
        exit 64
    fi
    if [ "$ROUTE" != "/" ]; then ROUTE="${ROUTE%/}"; fi
    [ -n "$ROUTE" ] || ROUTE="/"
    FULL_URL="https://${HOST}${PREFIX}${ROUTE}"
    RENDER_URL=$(append_query_param "$FULL_URL" "nexus_prerender_bypass=1")
    OUT_ROUTE="${PREFIX}${ROUTE}"
    CACHE_PATH=$(route_cache_path "$HOST" "$OUT_ROUTE")
    OUT_PATH="/output/${CACHE_PATH}"

    if ! should_render_cache_path "$CACHE_PATH"; then
        return 1
    fi

    if [ "$FIRST" -eq 1 ]; then
        FIRST=0
    else
        echo ","
    fi

    printf '{"url":"%s","canonicalUrl":"%s","output":"%s","cachePath":"%s","tenantId":"%s","tenantSlug":"%s","host":"%s","route":"%s"}' \
        "$(json_escape "$RENDER_URL")" \
        "$(json_escape "$FULL_URL")" \
        "$(json_escape "$OUT_PATH")" \
        "$(json_escape "$CACHE_PATH")" \
        "$(json_escape "$TENANT_ID")" \
        "$(json_escape "$SLUG")" \
        "$(json_escape "$HOST")" \
        "$(json_escape "$ROUTE")"
    return 0
}

# Legacy path: build a manifest from PUBLIC_ROUTES × tenants. Used when the
# sitemap planner is unavailable or the operator passed --routes/--no-sitemap.
build_manifest_static() {
    local TENANTS="$1"
    local APP_HOST="$2"
    local MANIFEST_FILE="$3"
    local FIRST=1
    local COUNT=0
    local TOTAL=0

    {
        echo '{"urls":['

        while IFS=$'\t' read -r TENANT_ID SLUG DOMAIN PARENT_DOMAIN; do
            [ -n "$TENANT_ID" ] || continue
            [ "$DOMAIN" = "__NEXUS_EMPTY__" ] && DOMAIN=""
            [ "$PARENT_DOMAIN" = "__NEXUS_EMPTY__" ] && PARENT_DOMAIN=""

            local HOST PREFIX
            if [ -n "$DOMAIN" ]; then
                HOST="$DOMAIN"
                PREFIX=""
            elif [ -n "$PARENT_DOMAIN" ]; then
                HOST="$PARENT_DOMAIN"
                PREFIX="/${SLUG}"
            elif [ -n "$SLUG" ]; then
                HOST="$APP_HOST"
                PREFIX="/${SLUG}"
            else
                continue
            fi

            for ROUTE in "${PUBLIC_ROUTES[@]}"; do
                TOTAL=$((TOTAL + 1))
                if emit_manifest_entry "$HOST" "$PREFIX" "$ROUTE" "$TENANT_ID" "$SLUG"; then
                    COUNT=$((COUNT + 1))
                fi
            done
        done <<< "$TENANTS"

        echo ']}'
    } > "$MANIFEST_FILE"

    SELECTED_COUNT="$COUNT"
    TOTAL_COUNT="$TOTAL"
}

# Sitemap path: build a manifest from the planner's per-tenant route lists.
# Parses the JSON with python3 (always available on the host's playwright base).
# Each tenant gets the union of the static floor + dynamic sitemap URLs.
build_manifest_from_plan() {
    local PLAN_JSON="$1"
    local MANIFEST_FILE="$2"
    local PARSED
    # Heredoc-in-command-substitution gotcha: bash requires the heredoc
    # delimiter to be the very last token on the line that opens it — adding
    # `2>/dev/null || true` there triggers a parse error. Wrap the whole
    # python call in an outer subshell with `|| true` to swallow non-zero
    # exits without confusing the parser.
    # The Python program itself is supplied on stdin, so pass the plan through
    # fd 3. Piping JSON into `python3 -` here would be silently overridden by
    # the heredoc and leave the parser with an empty input stream.
    PARSED=$( ( python3 - 3<<<"$PLAN_JSON" 2>/dev/null <<'PYEOF'
import ipaddress, json, os, re, sys
try:
    with os.fdopen(3, encoding="utf-8", closefd=False) as source:
        plan = json.load(source)
except Exception:
    sys.exit(0)
host_re = re.compile(r'^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$', re.I)
local_host_re = re.compile(r'^(?:localhost|[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)$', re.I)
slug_re = re.compile(r'^[A-Za-z0-9_-]{1,64}$')
route_re = re.compile(r'^/[A-Za-z0-9._~/%:@!$()*+,;=\-]*$')
allow_private_hosts = os.environ.get('PRERENDER_ALLOW_PRIVATE_HOSTS') == '1'

def normalize_route(route):
    if not isinstance(route, str) or len(route) > 1024 or not route_re.fullmatch(route):
        return None
    if route != '/':
        route = route.rstrip('/')
    route = route or '/'
    if '//' in route or re.search(r'(?:^|/)\.{1,2}(?:/|$)', route):
        return None
    if re.search(r'%(?![0-9A-Fa-f]{2})', route):
        return None
    if re.search(r'%(?:00|25|2e|2f|5c)', route, re.I):
        return None
    return route

tenants = plan.get('tenants') if isinstance(plan, dict) else None
if not isinstance(tenants, list) or not tenants:
    sys.exit(0)

lines = []
seen_ids = set()
seen_slugs = set()
for t in tenants:
    if not isinstance(t, dict):
        sys.exit(0)
    tid = str(t.get('tenant_id', ''))
    slug = t.get('slug', '') or ''
    host = (t.get('host', '') or '').lower().rstrip('.')
    prefix = t.get('prefix', '') or ''
    routes = t.get('routes')
    try:
        ipaddress.ip_address(host)
        host_is_ip = True
    except ValueError:
        host_is_ip = False
    host_is_valid = bool(host_re.fullmatch(host)) or (
        allow_private_hosts and (host_is_ip or bool(local_host_re.fullmatch(host)))
    )
    if (not tid.isdigit() or int(tid) <= 0 or not slug_re.fullmatch(slug)
            or (host_is_ip and not allow_private_hosts) or not host_is_valid or prefix not in ('', f'/{slug}')
            or not isinstance(routes, list) or not routes
            or tid in seen_ids or slug in seen_slugs):
        sys.exit(0)
    seen_ids.add(tid)
    seen_slugs.add(slug)
    prefix_field = prefix if prefix else '__NEXUS_ROOT__'
    for route in routes:
        route = normalize_route(route)
        if route is None:
            sys.exit(0)
        lines.append(f"{tid}\t{slug}\t{host}\t{prefix_field}\t{route}")

if not lines:
    sys.exit(0)
print('\n'.join(lines))
PYEOF
    ) || true )

    if [ -z "$PARSED" ]; then
        return 1
    fi

    local FIRST=1
    local COUNT=0
    local TOTAL=0

    {
        echo '{"urls":['
        while IFS=$'\t' read -r TENANT_ID SLUG HOST PREFIX ROUTE; do
            [ -n "$TENANT_ID" ] && [ -n "$HOST" ] || continue
            [ "$PREFIX" = "__NEXUS_ROOT__" ] && PREFIX=""
            TOTAL=$((TOTAL + 1))
            if emit_manifest_entry "$HOST" "$PREFIX" "$ROUTE" "$TENANT_ID" "$SLUG"; then
                COUNT=$((COUNT + 1))
            fi
        done <<< "$PARSED"
        echo ']}'
    } > "$MANIFEST_FILE"

    SELECTED_COUNT="$COUNT"
    TOTAL_COUNT="$TOTAL"
    return 0
}

build_manifest() {
    local TENANTS="$1"
    local APP_HOST="$2"
    local MANIFEST_FILE="$3"

    if [ "$USE_SITEMAP_PLAN" -eq 1 ]; then
        local PLAN_JSON
        PLAN_JSON="$(get_route_plan)"
        if [ -n "$PLAN_JSON" ]; then
            if build_manifest_from_plan "$PLAN_JSON" "$MANIFEST_FILE"; then
                log_info "Route plan: sitemap-driven ($SELECTED_COUNT selected / $TOTAL_COUNT candidate)"
                emit_event "plan_source" "\"source\":\"sitemap\",\"selected\":$SELECTED_COUNT,\"total\":$TOTAL_COUNT"
                return 0
            fi
            log_err "Tenant route plan could not be parsed; refusing an unsafe global fallback"
        else
            log_err "Tenant route plan unavailable (PHP container or artisan failed)"
        fi
        emit_event "plan_failed" '"source":"sitemap"'
        return 1
    fi

    build_manifest_static "$TENANTS" "$APP_HOST" "$MANIFEST_FILE"
    log_warn "Route plan: explicit emergency static floor only ($SELECTED_COUNT selected / $TOTAL_COUNT candidate)"
    emit_event "plan_source" "\"source\":\"static\",\"selected\":$SELECTED_COUNT,\"total\":$TOTAL_COUNT"
}

validate_output_assets() {
    local CURRENT_ASSETS="$1"
    local INVALID=0

    # Bot-only serving (see react-frontend/CLAUDE.md "Prerender Pipeline") means
    # asset-hash mismatches in snapshots don't matter to anyone: bots don't
    # execute JS, and the read-side load_stale_cache_paths is already a no-op
    # by the same logic. Keep the check as a STATISTIC (counted + logged) for
    # the inventory.asset_invalid_count metric and admin visibility, but stop
    # discarding the rendered HTML — the body content is what crawlers need.
    while IFS= read -r FILE; do
        [ -n "$FILE" ] || continue
        local BAD_ASSET=""

        while IFS= read -r ASSET; do
            [ -n "$ASSET" ] || continue
            if ! list_contains "$ASSET" "$CURRENT_ASSETS"; then
                BAD_ASSET="$ASSET"
                break
            fi
        done < <(grep -hoE '/assets/[^"<>[:space:]]+\.(js|css)' "$FILE" 2>/dev/null | sed 's/[?#].*$//' | sort -u)

        if [ -n "$BAD_ASSET" ]; then
            log_warn "Snapshot $(realpath --relative-to="$OUTPUT_DIR" "$FILE" 2>/dev/null || echo "$FILE") references stale asset $BAD_ASSET (keeping — bot-only serving)" >&2
            INVALID=$((INVALID + 1))
        fi
    done < <(find "$OUTPUT_DIR" -name index.html -type f 2>/dev/null)

    echo "$INVALID"
}

validate_rendered_bundles() {
    local manifest_file="$1"
    python3 - "$manifest_file" "$OUTPUT_DIR" <<'PYEOF'
import hashlib, json, pathlib, re, sys

manifest_path = pathlib.Path(sys.argv[1])
output_root = pathlib.Path(sys.argv[2]).resolve()
manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
entries = manifest.get("urls") if isinstance(manifest, dict) else None
if not isinstance(entries, list):
    raise SystemExit("manifest urls are unavailable")
by_path = {}
for entry in entries:
    if not isinstance(entry, dict):
        raise SystemExit("manifest entry is not an object")
    cache_path = entry.get("cachePath")
    if not isinstance(cache_path, str) or cache_path in by_path:
        raise SystemExit("manifest cache paths are invalid or duplicated")
    by_path[cache_path] = entry

success_path = output_root / ".prerender-successes.txt"
if not success_path.is_file():
    raise SystemExit("worker success manifest is missing")
for cache_path in (line.strip() for line in success_path.read_text(encoding="utf-8").splitlines()):
    if not cache_path:
        continue
    entry = by_path.get(cache_path)
    if entry is None:
        raise SystemExit(f"success path is absent from manifest: {cache_path}")
    index_path = (output_root / cache_path).resolve()
    if output_root not in index_path.parents or index_path.name != "index.html" or not index_path.is_file():
        raise SystemExit(f"unsafe or missing rendered HTML: {cache_path}")
    route_dir = index_path.parent
    identity_path = route_dir / "_tenant.json"
    checksum_path = route_dir / "index.html.sha256"
    if identity_path.is_symlink() or not identity_path.is_file():
        raise SystemExit(f"missing tenant identity: {cache_path}")
    identity = json.loads(identity_path.read_text(encoding="utf-8"))
    if (str(identity.get("tenantId")) != str(entry.get("tenantId"))
            or identity.get("tenantSlug") != entry.get("tenantSlug")
            or str(identity.get("host", "")).lower() != str(entry.get("host", "")).lower()):
        raise SystemExit(f"tenant identity mismatch: {cache_path}")
    if checksum_path.is_symlink() or not checksum_path.is_file():
        raise SystemExit(f"missing checksum: {cache_path}")
    match = re.fullmatch(r"([a-f0-9]{64})\s+([0-9]+)\s*", checksum_path.read_text(encoding="ascii"))
    html = index_path.read_bytes()
    if not match or match.group(1) != hashlib.sha256(html).hexdigest() or int(match.group(2)) != len(html):
        raise SystemExit(f"checksum mismatch: {cache_path}")
PYEOF
}

update_failure_registry() {
    local SUCCESS_FILE="$OUTPUT_DIR/.prerender-successes.txt"
    local FAILURE_FILE="$OUTPUT_DIR/.prerender-failures.txt"

    if [ ! -f "$SUCCESS_FILE" ] && [ ! -f "$FAILURE_FILE" ]; then
        return 0
    fi

    local TMP_DIR="${PRERENDER_DIR}/.failure-update-$(date +%s)-$$"
    docker exec "$NGINX_CONTAINER" mkdir -p "$TMP_DIR"

    [ -f "$SUCCESS_FILE" ] && docker cp "$SUCCESS_FILE" "${NGINX_CONTAINER}:${TMP_DIR}/successes.txt"
    [ -f "$FAILURE_FILE" ] && docker cp "$FAILURE_FILE" "${NGINX_CONTAINER}:${TMP_DIR}/failures.txt"

    docker exec \
        -e PRERENDER_DIR="$PRERENDER_DIR" \
        -e TMP_DIR="$TMP_DIR" \
        -e PRERENDER_FAILURE_BACKOFF_SECONDS="$PRERENDER_FAILURE_BACKOFF_SECONDS" \
        "$NGINX_CONTAINER" sh -c '
            set -eu
            REGISTRY="$PRERENDER_DIR/.failures.tsv"
            TMP_REGISTRY="$PRERENDER_DIR/.failures.tsv.tmp"
            NOW="$(date +%s)"
            touch "$REGISTRY"
            touch "$TMP_DIR/successes.txt" "$TMP_DIR/failures.txt"

            awk -v now="$NOW" -v ttl="$PRERENDER_FAILURE_BACKOFF_SECONDS" \
                '"'"'FNR == NR { success[$0]=1; next }
                   $1 ~ /^[0-9]+$/ && $2 != "" && now - $1 < ttl && !($2 in success) { print $0 }'"'"' \
                "$TMP_DIR/successes.txt" "$REGISTRY" > "$TMP_REGISTRY" || true

            while IFS= read -r cache_path; do
                [ -n "$cache_path" ] || continue
                printf "%s\t%s\n" "$NOW" "$cache_path" >> "$TMP_REGISTRY"
            done < "$TMP_DIR/failures.txt"

            awk '"'"'{ latest[$2]=$1 } END { for (path in latest) print latest[path] "\t" path }'"'"' "$TMP_REGISTRY" > "$REGISTRY"
            rm -rf "$TMP_DIR" "$TMP_REGISTRY"
        '
}

capture_publish_epoch() {
    if [[ "$PRERENDER_PUBLISH_EPOCH" =~ ^[a-f0-9]{32}$ ]]; then
        return 0
    fi

    # Every newly claimed host execution owns a fresh publication epoch. This
    # fences an orphaned in-container `docker exec` publisher whose parent was
    # killed during lock takeover; merely reading its epoch would let both
    # generations remain authoritative.
    PRERENDER_PUBLISH_EPOCH=$(docker exec \
        -e PRERENDER_DIR="$PRERENDER_DIR" \
        -e PRERENDER_PHP_UID="${PRERENDER_PHP_UID:-33}" \
        "$NGINX_CONTAINER" sh -c '
        set -eu
        php_uid="${PRERENDER_PHP_UID:-33}"
        : >> "$PRERENDER_DIR/.mutation.lock"
        chmod 0660 "$PRERENDER_DIR/.mutation.lock"
        setfacl -m "u:${php_uid}:rw,u:nginx:rw,m:rw" "$PRERENDER_DIR/.mutation.lock"
        exec 8>"$PRERENDER_DIR/.mutation.lock"
        flock -w 120 8 || exit 75
        epoch_file="$PRERENDER_DIR/.publish-epoch"
        token="$(od -An -N16 -tx1 /dev/urandom | tr -d " \n")"
        tmp="${epoch_file}.tmp.$$"
        printf "%s\n" "$token" > "$tmp"
        mv "$tmp" "$epoch_file"
        printf "%s" "$token"
    ')
    [[ "$PRERENDER_PUBLISH_EPOCH" =~ ^[a-f0-9]{32}$ ]] || {
        log_err "Could not establish a valid prerender publisher epoch"
        return 1
    }
}

assert_publish_epoch() {
    local current
    current=$(docker exec -e PRERENDER_DIR="$PRERENDER_DIR" "$NGINX_CONTAINER" sh -c \
        'tr -d "\r\n" < "$PRERENDER_DIR/.publish-epoch"' 2>/dev/null || true)
    [ -n "$PRERENDER_PUBLISH_EPOCH" ] && [ "$current" = "$PRERENDER_PUBLISH_EPOCH" ]
}

inject_rendered_pages() {
    local FILE_COUNT="$1"
    local AUTHORITATIVE_RESET="${2:-0}"
    local INCOMING_DIR="${PRERENDER_DIR}/.incoming-$(date +%s)-$$"

    assert_job_lease || { log_err "Prerender job lease was lost before publication"; return 75; }
    assert_publish_epoch || { log_err "Prerender publisher epoch was superseded before publication"; return 75; }
    docker exec "$NGINX_CONTAINER" mkdir -p "$INCOMING_DIR"
    docker cp "$OUTPUT_DIR/." "${NGINX_CONTAINER}:${INCOMING_DIR}/"

    assert_job_lease || {
        docker exec "$NGINX_CONTAINER" rm -rf "$INCOMING_DIR" 2>/dev/null || true
        log_err "Prerender job lease was lost while staging publication"
        return 75
    }
    assert_publish_epoch || {
        docker exec "$NGINX_CONTAINER" rm -rf "$INCOMING_DIR" 2>/dev/null || true
        log_err "Prerender publisher epoch was superseded while staging publication"
        return 75
    }

    docker exec \
        -e PRERENDER_DIR="$PRERENDER_DIR" \
        -e INCOMING_DIR="$INCOMING_DIR" \
        -e AUTHORITATIVE_RESET="$AUTHORITATIVE_RESET" \
        -e EXPECTED_FILE_COUNT="$FILE_COUNT" \
        -e PRERENDER_JOB_ID="$PRERENDER_JOB_ID" \
        -e PRERENDER_JOB_CLAIMED_BY="$PRERENDER_JOB_CLAIMED_BY" \
        -e PRERENDER_PUBLISH_EPOCH="$PRERENDER_PUBLISH_EPOCH" \
        -e PRERENDER_PUBLISH_TEST_MODE="$PRERENDER_PUBLISH_TEST_MODE" \
        -e PRERENDER_STATUS_OVERRIDE_LIST="$PRERENDER_STATUS_OVERRIDE_LIST" \
        -e PRERENDER_PHP_UID="${PRERENDER_PHP_UID:-33}" \
        "$NGINX_CONTAINER" sh -c '
        set -eu

        # The Laravel app mounts the same volume read/write for authenticated
        # invalidation and purge operations. One shared advisory lock prevents
        # those deletions from interleaving with a host-tree transaction.
        php_uid="${PRERENDER_PHP_UID:-33}"
        case "$php_uid" in ""|*[!0-9]*) echo "Invalid PRERENDER_PHP_UID" >&2; exit 1 ;; esac
        chmod 0770 "$PRERENDER_DIR"
        setfacl -m "u:${php_uid}:rwx,u:nginx:rwx,m:rwx,d:u:${php_uid}:rwx,d:u:nginx:rwx,d:m:rwx" "$PRERENDER_DIR"
        : >> "$PRERENDER_DIR/.mutation.lock"
        chmod 0660 "$PRERENDER_DIR/.mutation.lock"
        setfacl -m "u:${php_uid}:rw,u:nginx:rw,m:rw" "$PRERENDER_DIR/.mutation.lock"
        exec 8>"$PRERENDER_DIR/.mutation.lock"
        flock -w 120 8 || { echo "Timed out acquiring prerender mutation lock" >&2; exit 1; }

        # Docker copies worker output as root. Normalize ACLs before any live
        # rename so Apache/PHP uid 33 can invalidate and quarantine snapshots
        # later without world-writable cache trees.
        find "$INCOMING_DIR" -type d -exec chmod 0770 {} \;
        find "$INCOMING_DIR" -type d -exec setfacl -m "u:${php_uid}:rwx,u:nginx:rwx,m:rwx,d:u:${php_uid}:rwx,d:u:nginx:rwx,d:m:rwx" {} \;
        find "$INCOMING_DIR" -type f -exec chmod 0660 {} \;
        find "$INCOMING_DIR" -type f -exec setfacl -m "u:${php_uid}:rw,u:nginx:rw,m:rw" {} \;

        assert_shared_job_lease() {
            [ -n "${PRERENDER_JOB_ID:-}" ] || return 0
            owner_key="$(printf "%s" "${PRERENDER_JOB_CLAIMED_BY:-}" \
                | base64 | tr -d "\r\n=" | tr "/+" "_-")"
            lease="$PRERENDER_DIR/.leases/${PRERENDER_JOB_ID}.${owner_key}.token"
            [ -f "$lease" ] || return 1
            [ "$(tr -d "\r\n" < "$lease")" = "${PRERENDER_JOB_CLAIMED_BY:-}" ]
        }
        assert_publish_epoch() {
            [ -n "${PRERENDER_PUBLISH_EPOCH:-}" ] || return 1
            [ -f "$PRERENDER_DIR/.publish-epoch" ] || return 1
            [ "$(tr -d "\r\n" < "$PRERENDER_DIR/.publish-epoch")" = "$PRERENDER_PUBLISH_EPOCH" ]
        }
        assert_publication_fence() {
            assert_shared_job_lease && assert_publish_epoch
        }
        assert_publication_fence || {
            echo "Prerender shared publication lease is absent or superseded" >&2
            rm -rf "$INCOMING_DIR"
            exit 75
        }

        reload_nginx_or_fail() {
            if [ "${PRERENDER_PUBLISH_TEST_MODE:-0}" = "1" ]; then return 0; fi
            nginx -t >/dev/null 2>&1 && nginx -s reload >/dev/null 2>&1
        }

        safe_host_component() {
            host="$1"
            [ -n "$host" ] || return 1
            [ "$host" != "." ] && [ "$host" != ".." ] || return 1
            case "$host" in
                .*|*..*|*[!A-Za-z0-9._-]*) return 1 ;;
            esac
            return 0
        }

        # An authoritative reset is a complete generation, not a collection
        # of unrelated route updates. Swap whole host trees so a custom-domain
        # tenant (or every path-hosted tenant sharing one host) can never be
        # left with a mixture of old and new pages. A durable transaction
        # journal restores the previous generation after an interrupted run.
        recover_transaction() {
                backup="$1"
                state="$(cat "$backup/state" 2>/dev/null || true)"
                if [ "$state" = "committed" ]; then
                    rm -rf "$backup"
                    return 0
                fi
                # No state means publication never began.
                if [ -z "$state" ]; then
                    rm -rf "$backup"
                    return 0
                fi
                if [ "$state" != "prepared" ] \
                    && [ "$state" != "backing-up" ] \
                    && [ "$state" != "publishing" ]; then
                    echo "Unknown prerender publication transaction state: $state" >&2
                    return 1
                fi
                # New host trees are not moved into place until every old
                # tree has been backed up and the state becomes publishing.
                # During prepared/backing-up, deleting an intended new host
                # could delete an old tree that had not yet been moved.
                # `new-hosts` is persisted before the first rename. Remove
                # every intended new tree during rollback, including a brand
                # new host moved just before a power loss could append a
                # secondary progress log.
                if [ "$state" = "publishing" ] && [ -f "$backup/new-hosts" ]; then
                    while IFS= read -r host; do
                        [ -n "$host" ] || continue
                        safe_host_component "$host" || return 1
                        rm -rf "$PRERENDER_DIR/$host"
                    done < "$backup/new-hosts"
                fi
                if [ -d "$backup/hosts" ]; then
                    for old in "$backup"/hosts/*; do
                        [ -e "$old" ] || continue
                        host="$(basename "$old")"
                        safe_host_component "$host" || return 1
                        rm -rf "$PRERENDER_DIR/$host"
                        mv "$old" "$PRERENDER_DIR/$host"
                    done
                fi
                if [ -d "$backup/metadata" ]; then
                    for metadata in \
                        ".last-run.json:last-run.json" \
                        ".status-overrides.json:status-overrides.json" \
                        ".last-manifest.json:last-manifest.json" \
                        ".tenant-identity-v1:tenant-identity-v1" \
                        ".authoritative-repair-required:authoritative-repair-required"; do
                        live_name="${metadata%%:*}"
                        backup_name="${metadata#*:}"
                        if [ -f "$backup/metadata/$backup_name" ]; then
                            rm -f "$PRERENDER_DIR/$live_name"
                            mv "$backup/metadata/$backup_name" "$PRERENDER_DIR/$live_name"
                        elif [ "$state" = "publishing" ]; then
                            # No previous file existed; discard a new file that
                            # may have been installed before interruption.
                            rm -f "$PRERENDER_DIR/$live_name"
                        fi
                    done
                fi
                if [ "$state" = "publishing" ]; then
                    status_tmp="${PRERENDER_STATUS_OVERRIDE_LIST}.rollback.$$"
                    if [ -f "$backup/metadata/nginx-status-overrides.list" ]; then
                        cp "$backup/metadata/nginx-status-overrides.list" "$status_tmp"
                    else
                        : > "$status_tmp"
                    fi
                    mv "$status_tmp" "$PRERENDER_STATUS_OVERRIDE_LIST"
                    reload_nginx_or_fail || return 1
                fi
                rm -rf "$backup"
        }

            # Recover an earlier process/power interruption before starting a
            # new publication. A committed journal means the new generation
            # won and only cleanup was interrupted; every other known state is
            # rolled back to its last-known-good host trees.
            for previous in "$PRERENDER_DIR"/.publish-backup-*; do
                [ -d "$previous" ] || continue
                recover_transaction "$previous"
            done
            for orphan in "$PRERENDER_DIR"/.incoming-*; do
                [ -d "$orphan" ] || continue
                [ "$orphan" = "$INCOMING_DIR" ] && continue
                rm -rf "$orphan"
            done

        # Count equality is insufficient: {A,B} expected and {A,C} staged
        # would otherwise commit. Recover any older transaction first, then
        # prove the staged path set exactly matches the worker success set.
        successes="$INCOMING_DIR/.prerender-successes.txt"
        expected="$INCOMING_DIR/.validated-expected-paths.txt"
        actual="$INCOMING_DIR/.validated-actual-paths.txt"
        [ -f "$successes" ] || {
            echo "Missing prerender success manifest" >&2
            rm -rf "$INCOMING_DIR"
            exit 1
        }
        sed "/^[[:space:]]*$/d" "$successes" | sort > "$expected"
        find "$INCOMING_DIR" -name index.html -type f \
            | sed "s#^$INCOMING_DIR/##" | sort > "$actual"
        expected_count="$(wc -l < "$expected" | tr -d " ")"
        unique_expected_count="$(sort -u "$expected" | wc -l | tr -d " ")"
        actual_count="$(wc -l < "$actual" | tr -d " ")"
        if [ "$expected_count" -ne "$EXPECTED_FILE_COUNT" ] \
            || [ "$unique_expected_count" -ne "$EXPECTED_FILE_COUNT" ] \
            || [ "$actual_count" -ne "$EXPECTED_FILE_COUNT" ] \
            || ! cmp -s "$expected" "$actual"; then
            echo "Rendered cache paths do not exactly match the validated success manifest" >&2
            rm -rf "$INCOMING_DIR"
            exit 1
        fi

        if [ "$AUTHORITATIVE_RESET" = "1" ]; then

            incoming_count="$(find "$INCOMING_DIR" -name index.html -type f | wc -l | tr -d " ")"
            if [ "$incoming_count" -ne "$EXPECTED_FILE_COUNT" ]; then
                echo "Authoritative publication count mismatch: $incoming_count != $EXPECTED_FILE_COUNT" >&2
                rm -rf "$INCOMING_DIR"
                exit 1
            fi
            identity_count="$(find "$INCOMING_DIR" -name _tenant.json -type f | wc -l | tr -d " ")"
            if [ "$identity_count" -ne "$EXPECTED_FILE_COUNT" ]; then
                echo "Authoritative publication is missing tenant identity sidecars: $identity_count != $EXPECTED_FILE_COUNT" >&2
                rm -rf "$INCOMING_DIR"
                exit 1
            fi

            # Prove every complete bundle belongs to the manifest tenant and
            # its checksum describes the exact HTML bytes before the first
            # live rename. The enforcement marker below is safe only if this
            # generation has no missing, malformed, or cross-tenant sidecar.
            manifest="$INCOMING_DIR/manifest.json"
            [ -f "$manifest" ] || {
                echo "Authoritative publication is missing its manifest" >&2
                exit 1
            }
            while IFS= read -r rel; do
                [ -n "$rel" ] || continue
                route_dir="${rel%/index.html}"
                index="$INCOMING_DIR/$rel"
                identity="$INCOMING_DIR/$route_dir/_tenant.json"
                checksum="$INCOMING_DIR/$route_dir/index.html.sha256"
                expected_identity="$(jq -r --arg path "$rel" "
                    [.urls[] | select(.cachePath == \$path)]
                    | if length == 1
                      then .[0] | [(.tenantId | tostring), .tenantSlug, (.host | ascii_downcase)] | @tsv
                      else empty
                      end
                " "$manifest")"
                [ -n "$expected_identity" ] || {
                    echo "Manifest has no unique identity for $rel" >&2
                    exit 1
                }
                expected_id="$(printf "%s" "$expected_identity" | cut -f1)"
                expected_slug="$(printf "%s" "$expected_identity" | cut -f2)"
                expected_host="$(printf "%s" "$expected_identity" | cut -f3)"
                jq -e \
                    --arg id "$expected_id" \
                    --arg slug "$expected_slug" \
                    --arg host "$expected_host" \
                    "(.tenantId | tostring) == \$id
                     and .tenantSlug == \$slug
                     and (.host | ascii_downcase) == \$host" \
                    "$identity" >/dev/null || {
                        echo "Tenant identity sidecar does not match manifest: $rel" >&2
                        exit 1
                    }
                [ -f "$checksum" ] && [ ! -L "$checksum" ] || {
                    echo "Missing checksum sidecar: $rel" >&2
                    exit 1
                }
                read -r recorded_hash recorded_bytes < "$checksum"
                actual_hash="$(sha256sum "$index" | cut -d" " -f1)"
                actual_bytes="$(wc -c < "$index" | tr -d " ")"
                case "$recorded_hash" in
                    *[!a-f0-9]*|"") echo "Malformed checksum sidecar: $rel" >&2; exit 1 ;;
                esac
                [ "${#recorded_hash}" -eq 64 ] \
                    && [ "$recorded_hash" = "$actual_hash" ] \
                    && [ "$recorded_bytes" = "$actual_bytes" ] || {
                        echo "Checksum sidecar does not match HTML: $rel" >&2
                        exit 1
                    }
            done < "$expected"

            transaction_id="$(date +%s)-$$"
            backup="$PRERENDER_DIR/.publish-backup-$transaction_id"
            mkdir -p "$backup/hosts" "$backup/metadata"
            : > "$backup/new-hosts"
            : > "$backup/old-hosts"
            : > "$backup/published-hosts"

            # Install rollback before validating the staged host set so any
            # early exit also removes the incoming tree and empty journal.
            printf "%s\n" prepared > "$backup/state"
            rollback_current_transaction() {
                trap - EXIT HUP INT TERM
                recover_transaction "$backup" || true
                rm -rf "$INCOMING_DIR"
            }
            trap rollback_current_transaction EXIT HUP INT TERM

            for new_tree in "$INCOMING_DIR"/*; do
                [ -d "$new_tree" ] || continue
                host="$(basename "$new_tree")"
                if ! safe_host_component "$host"; then
                    echo "Unsafe host tree in authoritative prerender output: $host" >&2
                    exit 1
                fi
                printf "%s\n" "$host" >> "$backup/new-hosts"
            done
            if [ "$EXPECTED_FILE_COUNT" -gt 0 ] && [ ! -s "$backup/new-hosts" ]; then
                echo "Authoritative prerender output contains no host trees" >&2
                exit 1
            fi

            # Persist the complete journal before the first live mutation.
            sync "$backup/state" "$backup/new-hosts" 2>/dev/null || sync
            printf "%s\n" backing-up > "$backup/state"

            # Every non-hidden top-level directory is a host-generation tree,
            # including a quarantined tree that now contains only `_status`.
            # Hidden operational directories/files at the volume root remain.
            for old_tree in "$PRERENDER_DIR"/*; do
                [ -d "$old_tree" ] || continue
                [ "$old_tree" != "$INCOMING_DIR" ] || continue
                host="$(basename "$old_tree")"
                if ! safe_host_component "$host"; then
                    echo "Unsafe live host tree prevents authoritative publication: $host" >&2
                    exit 1
                fi
                assert_publication_fence || { echo "Prerender publication fence lost before backup" >&2; exit 75; }
                printf "%s\n" "$host" >> "$backup/old-hosts"
                mv "$old_tree" "$backup/hosts/$host"
            done

            # Back up generation metadata before allowing any new host tree
            # into the live namespace, so rollback can restore it exactly.
            for metadata in \
                ".last-run.json:last-run.json" \
                ".status-overrides.json:status-overrides.json" \
                ".last-manifest.json:last-manifest.json" \
                ".tenant-identity-v1:tenant-identity-v1" \
                ".authoritative-repair-required:authoritative-repair-required"; do
                live_name="${metadata%%:*}"
                backup_name="${metadata#*:}"
                if [ -f "$PRERENDER_DIR/$live_name" ]; then
                    mv "$PRERENDER_DIR/$live_name" "$backup/metadata/$backup_name"
                fi
            done
            if [ -f "$PRERENDER_STATUS_OVERRIDE_LIST" ]; then
                cp "$PRERENDER_STATUS_OVERRIDE_LIST" "$backup/metadata/nginx-status-overrides.list"
            fi

            # Persist every backup rename before the state permits recovery to
            # delete live new-host paths.
            sync
            printf "%s\n" publishing > "$backup/state"
            sync "$backup/state" 2>/dev/null || sync

            while IFS= read -r host; do
                [ -n "$host" ] || continue
                assert_publication_fence || { echo "Prerender publication fence lost before host publication" >&2; exit 75; }
                if [ -e "$PRERENDER_DIR/$host" ] || [ -L "$PRERENDER_DIR/$host" ]; then
                    echo "Live cache path blocks authoritative host publication: $host" >&2
                    exit 1
                fi
                mv "$INCOMING_DIR/$host" "$PRERENDER_DIR/$host"
                # Directory rename durability is part of the transaction, not
                # an optional cleanup detail.
                sync
            done < "$backup/new-hosts"

            [ ! -f "$INCOMING_DIR/.prerender-results.json" ] || mv "$INCOMING_DIR/.prerender-results.json" "$PRERENDER_DIR/.last-run.json"
            [ ! -f "$INCOMING_DIR/.prerender-status-overrides.json" ] || mv "$INCOMING_DIR/.prerender-status-overrides.json" "$PRERENDER_DIR/.status-overrides.json"
            [ ! -f "$INCOMING_DIR/manifest.json" ] || mv "$INCOMING_DIR/manifest.json" "$PRERENDER_DIR/.last-manifest.json"
            rm -f "$INCOMING_DIR/.prerender-successes.txt" "$INCOMING_DIR/.prerender-failures.txt"

            # Build the status map from this exact generation. Normal pages
            # are 200; an explicit tenant maintenance snapshot may carry 503.
            # Old 404/410 entries therefore disappear rather than surviving a
            # fresh authoritative rebuild.
            status_tmp="${PRERENDER_STATUS_OVERRIDE_LIST}.new.$$"
            printf "%s\n" "# Authoritative prerender generation - generated transactionally" > "$status_tmp"
            find "$PRERENDER_DIR" -path "$PRERENDER_DIR/.publish-backup-*" -prune -o \
                -path "$PRERENDER_DIR/.leases" -prune -o -name _status -type f -print \
                | while IFS= read -r sidecar; do
                    rel="${sidecar#$PRERENDER_DIR/}"
                    status="$(tr -d "\r\n" < "$sidecar")"
                    [ "$status" = "503" ] || {
                        echo "Unexpected status sidecar in authoritative generation: $rel=$status" >&2
                        exit 1
                    }
                    base="${rel%/_status}"
                    host="${base%%/*}"
                    if [ "$base" = "$host" ]; then
                        route="/"
                    else
                        route="/${base#*/}"
                    fi
                    safe_host_component "$host" || exit 1
                    case "$route" in *\"*|*\\*) exit 1 ;; esac
                    full="${host}${route}"
                    printf "    \"%s\" \"503\";\n" "$full" >> "$status_tmp"
                    case "$route" in
                        */) ;;
                        *) printf "    \"%s/\" \"503\";\n" "$full" >> "$status_tmp" ;;
                    esac
                done
            mv "$status_tmp" "$PRERENDER_STATUS_OVERRIDE_LIST"
            reload_nginx_or_fail

            # Activate strict missing-sidecar enforcement only after a full
            # identity-bearing generation and status map are live. The marker
            # participates in the journal, so rollback restores the previous
            # rollout state instead of treating legacy snapshots as corrupt.
            identity_marker_tmp="$PRERENDER_DIR/.tenant-identity-v1.new.$$"
            printf "%s\n" "v1" > "$identity_marker_tmp"
            mv "$identity_marker_tmp" "$PRERENDER_DIR/.tenant-identity-v1"

            sync
            assert_publication_fence || { echo "Prerender publication fence lost before publication commit" >&2; exit 75; }
            printf "%s\n" committed > "$backup/state"
            sync "$backup/state" 2>/dev/null || sync
            sync
            trap - EXIT HUP INT TERM
            rm -rf "$backup" "$INCOMING_DIR"
            exit 0
        fi

        # A targeted update may replace only ordinary HTTP-200 snapshots.
        # Changing to or from a status-bearing maintenance snapshot requires
        # an authoritative reset, where HTML and the compiled nginx status map
        # are committed and rolled back as one transaction.
        while IFS= read -r rel; do
            [ -n "$rel" ] || continue
            route_dir="${rel%/index.html}"
            if [ -f "$INCOMING_DIR/$route_dir/_status" ] \
                || [ -f "$PRERENDER_DIR/$route_dir/_status" ]; then
                echo "Targeted publication cannot change a status-bearing snapshot: $route_dir" >&2
                rm -rf "$INCOMING_DIR"
                exit 1
            fi
        done < "$expected"

        # Commit one validated HTTP-200 bundle at a time. Required sidecars
        # move before HTML, so the index rename is the route-level visibility
        # point; optional Markdown is replaced or removed in the same critical
        # section. Epoch rotation is serialized by this mutation lock, and the
        # job lease is checked immediately before and after every route.
        while IFS= read -r rel; do
            [ -n "$rel" ] || continue
            assert_publication_fence || { echo "Prerender publication fence lost during targeted publication" >&2; exit 75; }
            route_dir="${rel%/index.html}"
            incoming_route="$INCOMING_DIR/$route_dir"
            live_route="$PRERENDER_DIR/$route_dir"
            mkdir -p "$live_route"

            [ -f "$incoming_route/index.html" ] \
                && [ -f "$incoming_route/index.html.sha256" ] \
                && [ -f "$incoming_route/_tenant.json" ] || {
                    echo "Targeted snapshot bundle is incomplete: $rel" >&2
                    exit 1
                }
            rm -f "$live_route/_status"
            mv -f "$incoming_route/index.html.sha256" "$live_route/index.html.sha256"
            mv -f "$incoming_route/_tenant.json" "$live_route/_tenant.json"
            if [ -f "$incoming_route/index.md" ]; then
                mv -f "$incoming_route/index.md" "$live_route/index.md"
            else
                rm -f "$live_route/index.md"
            fi
            assert_publication_fence || { echo "Prerender publication fence lost before targeted route commit" >&2; exit 75; }
            mv -f "$incoming_route/index.html" "$live_route/index.html"
            assert_publication_fence || { echo "Prerender publication fence lost after targeted route commit" >&2; exit 75; }
        done < "$expected"

        if [ -f "$INCOMING_DIR/.prerender-results.json" ]; then
            assert_publication_fence || { echo "Prerender publication fence lost before targeted metadata" >&2; exit 75; }
            mv -f "$INCOMING_DIR/.prerender-results.json" "$PRERENDER_DIR/.last-run.json"
        fi
        if [ -f "$INCOMING_DIR/.prerender-status-overrides.json" ]; then
            mv -f "$INCOMING_DIR/.prerender-status-overrides.json" "$PRERENDER_DIR/.status-overrides.json"
        fi

        rm -f "$INCOMING_DIR/.prerender-successes.txt" "$INCOMING_DIR/.prerender-failures.txt"

        if [ -f "$INCOMING_DIR/manifest.json" ]; then
            mv -f "$INCOMING_DIR/manifest.json" "$PRERENDER_DIR/.last-manifest.json"
        fi

        assert_publication_fence || { echo "Prerender publication fence lost before targeted publication completion" >&2; exit 75; }
        rm -rf "$INCOMING_DIR"
    '

    if [ "$AUTHORITATIVE_RESET" -eq 1 ]; then
        log_ok "$FILE_COUNT pre-rendered page(s) published as complete host-tree generation(s) in $NGINX_CONTAINER"
    else
        log_ok "$FILE_COUNT pre-rendered page(s) injected into $NGINX_CONTAINER"
    fi
}

# Generate a per-route nginx override include from the worker's status manifest.
# The include defines a map that drives the error_page fallback in the server
# block; reloading nginx after we write it activates the new status routing.
#
# Output file inside the nginx container:
#   /etc/nginx/conf.d/prerender-status-overrides.conf
#
# Shape:
#   map "$host$uri" $nexus_prerender_status_override {
#       default "";
#       "hour-timebank.ie/community-not-found/" "404";
#       ...
#   }
write_nginx_status_overrides() {
    # The file is `include`d from inside a `map` block in nginx.bluegreen.conf,
    # so it must contain ONLY data lines: `"key" "value";`. The map default is
    # already set ("") in the parent block.
    local LIST_PATH="$PRERENDER_STATUS_OVERRIDE_LIST"
    local BACKUP_PATH="${LIST_PATH}.bak"

    # Rebuild from every live `_status` sidecar. Targeted refreshes must not
    # erase mappings for unrelated routes, while a 404 -> 200 refresh must
    # remove the old mapping immediately.
    local STAGE_DIR
    STAGE_DIR="$(mktemp -d -t prerender-status.XXXXXX)" || return 1
    local HOST_STATUSES="$STAGE_DIR/statuses.tsv"
    local HOST_LIST="$STAGE_DIR/overrides.list"

    docker exec -e PRERENDER_DIR="$PRERENDER_DIR" "$NGINX_CONTAINER" sh -c '
        find "$PRERENDER_DIR" -path "$PRERENDER_DIR/.incoming-*" -prune -o \
            -name _status -type f -print 2>/dev/null | while IFS= read -r file; do
                rel="${file#$PRERENDER_DIR/}"
                status="$(cat "$file" 2>/dev/null || true)"
                printf "%s\t%s\n" "$rel" "$status"
            done
    ' > "$HOST_STATUSES" 2>/dev/null || {
        rm -rf "$STAGE_DIR"
        return 0
    }

    {
        echo "# Auto-generated by scripts/prerender-tenants.sh — do not edit."
        echo "# Data lines for the map in nginx.bluegreen.conf."
        python3 - "$HOST_STATUSES" <<'PYEOF' || true
import sys
for raw in open(sys.argv[1], encoding="utf-8"):
    raw = raw.rstrip("\n")
    if "\t" not in raw:
        continue
    sidecar_path, raw_status = raw.rsplit("\t", 1)
    try:
        status = int(raw_status)
    except ValueError:
        continue
    if status not in (404, 410, 503):
        continue
    if not sidecar_path.endswith("/_status"):
        continue
    key = sidecar_path[:-len("_status")]
    if not key or any(c in key for c in ["\"", "\\", "\n", "\r"]):
        continue
    # Two flavours of $uri normalisation: "host/route/" and "host/route".
    # nginx may present either depending on whether the request URI ends
    # with a slash. Emit both so the map matches.
    base = key.rstrip("/")
    if "/" in base:
        host, _, route = base.partition("/")
        route = "/" + route
    else:
        host, route = base, "/"
    full = f"{host}{route}"
    print(f"    \"{full}\" \"{status}\";")
    if not route.endswith("/"):
        print(f"    \"{full}/\" \"{status}\";")
PYEOF
    } > "$HOST_LIST"

    # Snapshot the current list so we can revert on nginx -t failure.
    docker exec "$NGINX_CONTAINER" sh -c "[ -f '$LIST_PATH' ] && cp -f '$LIST_PATH' '$BACKUP_PATH' || true" 2>/dev/null
    docker cp "$HOST_LIST" "${NGINX_CONTAINER}:${LIST_PATH}" 2>/dev/null
    rm -rf "$STAGE_DIR"

    # Validate. nginx -t loads the whole config including our list file;
    # if it fails (malformed line, etc) we revert and skip the reload.
    if docker exec "$NGINX_CONTAINER" nginx -t >/dev/null 2>&1; then
        docker exec "$NGINX_CONTAINER" nginx -s reload >/dev/null 2>&1 || true
        docker exec "$NGINX_CONTAINER" rm -f "$BACKUP_PATH" 2>/dev/null || true
        emit_event "status_overrides_applied"
    else
        log_warn "nginx -t failed after writing status overrides; reverting"
        docker exec "$NGINX_CONTAINER" sh -c "[ -f '$BACKUP_PATH' ] && mv -f '$BACKUP_PATH' '$LIST_PATH' || true" 2>/dev/null
        emit_event "status_overrides_revert" "\"reason\":\"nginx_t_failed\""
    fi
}

main() {
    local START_TS
    START_TS="$(date +%s)"
    log_info "=== Per-Tenant Server-Side Pre-Rendering ==="
    echo ""
    emit_event "start" "\"force\":$FORCE_RENDER,\"tenant\":\"$(json_escape "${FILTER_TENANT:-}")\",\"routes\":\"$(json_escape "${FILTER_ROUTES:-}")\""

    if ! docker ps --format '{{.Names}}' | grep -Fqx -- "$NGINX_CONTAINER"; then
        log_err "Container $NGINX_CONTAINER is not running"
        exit 1
    fi

    if [ ! -f "$WORKER_SCRIPT" ]; then
        log_err "Worker script not found: $WORKER_SCRIPT"
        exit 1
    fi

    acquire_lock
    capture_publish_epoch

    local TENANTS
    TENANTS=$(get_tenants)

    if [ -z "$TENANTS" ]; then
        if [ "$FORCE_RENDER" -eq 1 ] \
            && [ -z "$FILTER_TENANT" ] \
            && [ -z "$FILTER_ROUTES" ] \
            && [ "$USE_SITEMAP_PLAN" -eq 1 ]; then
            if [ "$DRY_RUN" -eq 1 ]; then
                log_ok "Dry run: authoritative empty generation would remove every retired tenant snapshot"
                exit 0
            fi
            mkdir -p "$OUTPUT_DIR"
            printf '%s\n' '{"urls":[]}' > "$OUTPUT_DIR/manifest.json"
            : > "$OUTPUT_DIR/.prerender-successes.txt"
            : > "$OUTPUT_DIR/.prerender-failures.txt"
            printf '%s\n' '{"success":0,"failed":0,"entries":[]}' > "$OUTPUT_DIR/.prerender-results.json"
            printf '%s\n' '{}' > "$OUTPUT_DIR/.prerender-status-overrides.json"
            log_warn "No active tenant targets; publishing a validated empty authoritative generation"
            inject_rendered_pages 0 1
            emit_event "success" '"rendered":0,"authoritative_empty_generation":true'
            log_ok "Retired tenant snapshot trees and status overrides were removed"
            exit 0
        fi
        log_err "No active tenant frontend targets found"
        exit 1
    fi

    mkdir -p "$OUTPUT_DIR"

    local APP_HOST MANIFEST_FILE
    APP_HOST=$(get_frontend_host)
    MANIFEST_FILE="$OUTPUT_DIR/manifest.json"

    log_info "Planning cache refresh..."
    EXISTING_CACHE_PATHS=$(load_existing_cache_paths)
    STALE_CACHE_PATHS=$(load_stale_cache_paths)
    RECENT_FAILURE_PATHS=$(load_recent_failure_paths)
    CURRENT_ASSETS=$(load_current_assets)

    if [ -z "$CURRENT_ASSETS" ]; then
        log_err "Could not read current frontend assets from $NGINX_CONTAINER"
        exit 1
    fi

    SELECTED_COUNT=0
    TOTAL_COUNT=0
    if ! build_manifest "$TENANTS" "$APP_HOST" "$MANIFEST_FILE"; then
        log_err "Could not build a tenant-safe render manifest"
        exit 1
    fi

    log_info "Planned $SELECTED_COUNT page(s) to refresh out of $TOTAL_COUNT candidate page(s)"
    if [ -n "$RECENT_FAILURE_PATHS" ] && [ "$FORCE_RENDER" -ne 1 ] && [ -z "$FILTER_TENANT" ] && [ -z "$FILTER_ROUTES" ]; then
        log_warn "Skipping recent failed route(s) for ${PRERENDER_FAILURE_BACKOFF_SECONDS}s backoff; use --force or --tenant/--routes to retry immediately"
    fi

    if [ "$SELECTED_COUNT" -eq 0 ]; then
        log_ok "Pre-render cache is already current"
        exit 0
    fi

    if [ "$DRY_RUN" -eq 1 ]; then
        log_ok "Dry run complete; no pages rendered"
        exit 0
    fi

    log_info "Starting Playwright render container with concurrency $PRERENDER_CONCURRENCY..."

    mkdir -p "$WORK_DIR"
    cp "$WORKER_SCRIPT" "$WORK_DIR/worker.mjs"

    # The public ?nexus_prerender_bypass=1 parameter selects the live SPA but
    # is intentionally not sufficient to cross the global maintenance gate.
    # Copy the root-only runtime credential into an isolated mode-0700
    # directory and mount it read-only; it never enters the render output or
    # Docker environment/inspect metadata.
    local -a MAINTENANCE_SECRET_MOUNT=()
    if docker exec "$NGINX_CONTAINER" test -s "$PRERENDER_DIR/.maintenance-render.token" 2>/dev/null; then
        docker cp \
            "${NGINX_CONTAINER}:${PRERENDER_DIR}/.maintenance-render.token" \
            "$MAINTENANCE_SECRET_FILE" >/dev/null
        chmod 0600 "$MAINTENANCE_SECRET_FILE"
        MAINTENANCE_SECRET_MOUNT=(
            -v "$MAINTENANCE_SECRET_FILE:/run/secrets/nexus-prerender-maintenance:ro"
        )
    fi

    # The global name is not authority to remove a container. This only reaps a
    # worker carrying the exact owner token held by this process.
    remove_worker_if_owned "$LOCK_OWNER_TOKEN" kill

    set +e
    docker run --rm -i \
        --name "$PRERENDER_DOCKER_NAME" \
        --label "$PRERENDER_DOCKER_OWNER_LABEL=$LOCK_OWNER_TOKEN" \
        --init \
        --cap-drop ALL \
        --security-opt no-new-privileges:true \
        --network host \
        --memory "$PRERENDER_MEMORY_LIMIT" \
        --cpus "$PRERENDER_CPU_LIMIT" \
        --pids-limit "$PRERENDER_PIDS_LIMIT" \
        --shm-size "$PRERENDER_SHM_SIZE" \
        -v "$WORK_DIR:/work" \
        -v "$OUTPUT_DIR:/output" \
        "${MAINTENANCE_SECRET_MOUNT[@]}" \
        -w /work \
        -e "PRERENDER_CONCURRENCY=$PRERENDER_CONCURRENCY" \
        -e "PRERENDER_VIEWPORT=${PRERENDER_VIEWPORT:-desktop}" \
        -e "PRERENDER_ALLOW_PRIVATE_HOSTS=$PRERENDER_ALLOW_PRIVATE_HOSTS" \
        -e "PLAYWRIGHT_NPM_VERSION=$PLAYWRIGHT_NPM_VERSION" \
        "$PLAYWRIGHT_IMAGE" \
        bash -c 'set -euo pipefail; installed=$(node -p "require(\"./node_modules/playwright/package.json\").version" 2>/dev/null || true); if [ "$installed" != "$PLAYWRIGHT_NPM_VERSION" ]; then npm init -y >/dev/null 2>&1 && npm install --no-save "playwright@$PLAYWRIGHT_NPM_VERSION" >/dev/null 2>&1; fi; exec node worker.mjs' \
        < "$MANIFEST_FILE"
    local EXIT_CODE=$?
    set -e

    if [ $EXIT_CODE -ne 0 ]; then
        log_warn "Playwright worker exited with code $EXIT_CODE (successful pages will still be injected)"
    fi

    if ! assert_job_lease; then
        log_err "Prerender job lease was lost after rendering; refusing every cache mutation"
        exit 75
    fi
    if ! validate_rendered_bundles "$MANIFEST_FILE"; then
        log_err "Rendered bundle ownership/checksum validation failed; refusing every cache mutation"
        emit_event "fail" '"reason":"bundle_validation_failed","published":0'
        exit 1
    fi
    update_failure_registry

    local INVALID_COUNT
    INVALID_COUNT=$(validate_output_assets "$CURRENT_ASSETS")
    if [ "$INVALID_COUNT" -gt 0 ]; then
        log_warn "$INVALID_COUNT rendered page(s) reference assets outside the active manifest"
    fi

    local FILE_COUNT AUTHORITATIVE_RESET=0 RESET_VALID=1
    FILE_COUNT=$(find "$OUTPUT_DIR" -name index.html -type f 2>/dev/null | wc -l | tr -d ' ')
    if [ "$FORCE_RENDER" -eq 1 ] \
        && [ -z "$FILTER_TENANT" ] \
        && [ -z "$FILTER_ROUTES" ] \
        && [ "$USE_SITEMAP_PLAN" -eq 1 ]; then
        AUTHORITATIVE_RESET=1
        if [ "$EXIT_CODE" -ne 0 ] \
            || [ "$FILE_COUNT" -ne "$SELECTED_COUNT" ]; then
            RESET_VALID=0
            log_err "Authoritative reset validation failed; retaining the complete previous snapshot generation"
        fi
    fi

    if [ "$AUTHORITATIVE_RESET" -eq 1 ] && [ "$RESET_VALID" -ne 1 ]; then
        local REJECTED_DURATION
        REJECTED_DURATION=$(($(date +%s) - START_TS))
        emit_event "fail" "\"reason\":\"authoritative_validation_failed\",\"rendered\":$FILE_COUNT,\"published\":0,\"selected\":$SELECTED_COUNT,\"duration_s\":$REJECTED_DURATION,\"worker_exit\":$EXIT_CODE,\"previous_generation_retained\":true"
        exit 1
    fi

    if [ "$FILE_COUNT" -gt 0 ] && [ "$RESET_VALID" -eq 1 ]; then
        if [ "$AUTHORITATIVE_RESET" -eq 1 ]; then
            log_info "Publishing the validated authoritative generation into $NGINX_CONTAINER..."
        else
            log_info "Injecting rendered pages into $NGINX_CONTAINER..."
        fi
        inject_rendered_pages "$FILE_COUNT" "$AUTHORITATIVE_RESET"
        # Whole-host authoritative replacement already removes every obsolete
        # route and installs its metadata inside the rollback transaction.
        # Running a second deletion/status phase after commit could mark the
        # job failed while leaving an unrollbackable new generation live.
    elif [ "$FILE_COUNT" -eq 0 ]; then
        log_warn "No rendered pages were valid enough to inject"
    fi

    local DURATION
    DURATION=$(($(date +%s) - START_TS))

    if [ "$FILE_COUNT" -eq 0 ]; then
        emit_event "fail" "\"reason\":\"no_valid_output\",\"selected\":$SELECTED_COUNT,\"duration_s\":$DURATION,\"worker_exit\":$EXIT_CODE"
        exit 1
    fi

    if [ $EXIT_CODE -ne 0 ] || [ "$FILE_COUNT" -lt "$SELECTED_COUNT" ]; then
        log_warn "Pre-rendering completed with partial output: $FILE_COUNT/$SELECTED_COUNT page(s) refreshed"
        emit_event "partial" "\"rendered\":$FILE_COUNT,\"selected\":$SELECTED_COUNT,\"invalid\":$INVALID_COUNT,\"duration_s\":$DURATION,\"worker_exit\":$EXIT_CODE"
        exit 2
    fi

    log_ok "Pre-rendering complete"
    emit_event "success" "\"rendered\":$FILE_COUNT,\"asset_warnings\":$INVALID_COUNT,\"duration_s\":$DURATION"
}

# Allow this script to be sourced for testing without invoking main(). When
# executed directly, BASH_SOURCE[0] equals $0 and main runs normally.
if [ "${BASH_SOURCE[0]:-$0}" = "${0}" ]; then
    main "$@"
fi
