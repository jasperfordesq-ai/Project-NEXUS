#!/bin/bash
# =============================================================================
# Project NEXUS — Prerender Job Processor (host-side)
# =============================================================================
# Two-step orchestration to keep all DB + log parsing in PHP (testable) while
# the actual Playwright invocation stays on the host (needs docker).
#
#   1. `php artisan prerender:process-queue --claim-next --shell-export`
#       runs inside the PHP container. Atomically claims the oldest queued
#       row and transitions it to claimed→running, emitting KEY=VALUE lines
#       we `eval` here.
#
#   2. We invoke `scripts/prerender-tenants.sh` on the host with the captured
#       args, tee the output to a temp log, then call
#       `php artisan prerender:process-queue --finalise-id=...` which parses
#       counters from the log and writes them back to the row + broadcasts.
#
# Cron entry (every minute):
#   * * * * * root /bin/bash /opt/nexus-php/scripts/prerender-job-processor.sh \
#               >> /opt/nexus-php/logs/prerender-job-processor.log 2>&1
# =============================================================================

set -euo pipefail

DEPLOY_DIR="${DEPLOY_DIR:-/opt/nexus-php}"
PROCESSOR_LOCK="${PROCESSOR_LOCK:-$DEPLOY_DIR/.prerender-job-processor.lock}"
SCRIPT_DIR="${SCRIPT_DIR:-$DEPLOY_DIR/scripts}"
CONTAINER_RESOLVER="${NEXUS_CONTAINER_RESOLVER:-$SCRIPT_DIR/resolve-active-container.sh}"
PRERENDER_HEARTBEAT_INTERVAL_SECONDS="${PRERENDER_HEARTBEAT_INTERVAL_SECONDS:-30}"
PRERENDER_MAX_RUN_SECONDS="${PRERENDER_MAX_RUN_SECONDS:-43200}"
PRERENDER_DOCKER_EXEC_TIMEOUT_SECONDS="${PRERENDER_DOCKER_EXEC_TIMEOUT_SECONDS:-30}"

log() { echo "[$(date -Is)] $*"; }

if [[ ! "$PRERENDER_HEARTBEAT_INTERVAL_SECONDS" =~ ^[0-9]+$ ]] \
    || [ "$PRERENDER_HEARTBEAT_INTERVAL_SECONDS" -lt 5 ] \
    || [ "$PRERENDER_HEARTBEAT_INTERVAL_SECONDS" -gt 300 ]; then
    log "FATAL: PRERENDER_HEARTBEAT_INTERVAL_SECONDS must be an integer from 5 to 300"
    exit 64
fi
if [[ ! "$PRERENDER_MAX_RUN_SECONDS" =~ ^[0-9]+$ ]] \
    || [ "$PRERENDER_MAX_RUN_SECONDS" -lt 300 ]; then
    log "FATAL: PRERENDER_MAX_RUN_SECONDS must be an integer >= 300"
    exit 64
fi
if [[ ! "$PRERENDER_DOCKER_EXEC_TIMEOUT_SECONDS" =~ ^[0-9]+$ ]] \
    || [ "$PRERENDER_DOCKER_EXEC_TIMEOUT_SECONDS" -lt 5 ] \
    || [ "$PRERENDER_DOCKER_EXEC_TIMEOUT_SECONDS" -gt 120 ]; then
    log "FATAL: PRERENDER_DOCKER_EXEC_TIMEOUT_SECONDS must be an integer from 5 to 120"
    exit 64
fi
if ! command -v timeout >/dev/null 2>&1; then
    log "FATAL: GNU timeout is required to enforce the prerender run limit"
    exit 69
fi
if ! command -v setsid >/dev/null 2>&1; then
    log "FATAL: setsid is required to fence the complete prerender process tree"
    exit 69
fi

docker_exec_bounded() {
    local container="$1"
    shift
    timeout --foreground --signal=TERM --kill-after=5s \
        "${PRERENDER_DOCKER_EXEC_TIMEOUT_SECONDS}s" \
        docker exec "$container" timeout --foreground --signal=TERM --kill-after=5s \
            "${PRERENDER_DOCKER_EXEC_TIMEOUT_SECONDS}s" "$@"
}

# Pick the active php-app container (blue/green). Override with APP_CONTAINER.
APP_CONTAINER="${APP_CONTAINER:-}"
if [ -z "$APP_CONTAINER" ]; then
    if [ ! -r "$CONTAINER_RESOLVER" ]; then
        log "FATAL: active-container resolver unavailable at $CONTAINER_RESOLVER"
        exit 69
    fi
    # shellcheck source=resolve-active-container.sh
    source "$CONTAINER_RESOLVER"
    if ! APP_CONTAINER="$(resolve_active_nexus_container php-app)"; then
        log "FATAL: could not resolve the active PHP container"
        exit 69
    fi
fi

# Acquire flock — exit silently if another tick is mid-flight.
exec 9>"$PROCESSOR_LOCK"
if ! flock -n 9; then
    exit 0
fi

if ! docker ps --format '{{.Names}}' | grep -Fqx -- "$APP_CONTAINER"; then
    log "WARN: app container $APP_CONTAINER not running"
    exit 0
fi

# Step 1: claim. Empty output = empty queue (silent exit). A failed artisan
# invocation is an operational error, not an empty queue; keep it visible so
# jobs do not sit stale behind a silently broken processor.
set +e
CLAIM_OUT=$(docker_exec_bounded "$APP_CONTAINER" php artisan prerender:process-queue --claim-next --shell-export 2>&1)
CLAIM_EXIT=$?
set -e
if [ "$CLAIM_EXIT" -ne 0 ]; then
    log "FATAL: queue claim failed (exit $CLAIM_EXIT): $CLAIM_OUT"
    exit "$CLAIM_EXIT"
fi
if [ -z "$CLAIM_OUT" ]; then
    exit 0
fi

# Validate output before eval — every line must match KEY=VALUE with safe chars.
if [ "$(printf '%s\n' "$CLAIM_OUT" | sed '/^[[:space:]]*$/d' | wc -l)" -ne 6 ]; then
    log "FATAL: unexpected claim output: $CLAIM_OUT"
    exit 1
fi
while IFS= read -r line; do
    case "$line" in
        JOB_ID=*)
            [[ "${line#JOB_ID=}" =~ ^[0-9]+$ ]] || { log "FATAL: unsafe job id in claim output"; exit 1; }
            ;;
        JOB_CLAIMED_BY=\'*\')
            value="${line#JOB_CLAIMED_BY=\'}"
            value="${value%\'}"
            [[ "$value" =~ ^[A-Za-z0-9_.:-]+$ ]] || { log "FATAL: unsafe claim owner in claim output"; exit 1; }
            ;;
        JOB_TENANT_SLUG=\'*\')
            value="${line#JOB_TENANT_SLUG=\'}"
            value="${value%\'}"
            [[ "$value" =~ ^[A-Za-z0-9_-]*$ ]] || { log "FATAL: unsafe tenant slug in claim output"; exit 1; }
            ;;
        JOB_ROUTES=\'*\')
            value="${line#JOB_ROUTES=\'}"
            value="${value%\'}"
            printf '%s' "$value" | grep -Eq '^[A-Za-z0-9._~/%:@!$()*+,;=-]*$' || { log "FATAL: unsafe routes in claim output"; exit 1; }
            ;;
        JOB_FORCE=*)
            [[ "${line#JOB_FORCE=}" =~ ^[01]$ ]] || { log "FATAL: unsafe force flag in claim output"; exit 1; }
            ;;
        JOB_DRY_RUN=*)
            [[ "${line#JOB_DRY_RUN=}" =~ ^[01]$ ]] || { log "FATAL: unsafe dry-run flag in claim output"; exit 1; }
            ;;
        *)
            log "FATAL: unexpected claim output: $CLAIM_OUT"
            exit 1
            ;;
    esac
done <<< "$CLAIM_OUT"
for required_key in JOB_ID JOB_CLAIMED_BY JOB_TENANT_SLUG JOB_ROUTES JOB_FORCE JOB_DRY_RUN; do
    if ! printf '%s\n' "$CLAIM_OUT" | grep -Eq "^${required_key}="; then
        log "FATAL: missing ${required_key} in claim output"
        exit 1
    fi
done
# shellcheck disable=SC1090
eval "$CLAIM_OUT"

log "Claimed job #$JOB_ID (tenant='$JOB_TENANT_SLUG' routes='$JOB_ROUTES' force=$JOB_FORCE dry_run=$JOB_DRY_RUN)"

# Step 2: build argv for prerender-tenants.sh.
ARGS=()
[ -n "$JOB_TENANT_SLUG" ] && ARGS+=(--tenant "$JOB_TENANT_SLUG")
[ -n "$JOB_ROUTES" ]      && ARGS+=(--routes "$JOB_ROUTES")
[ "$JOB_FORCE"   = "1" ]  && ARGS+=(--force)
[ "$JOB_DRY_RUN" = "1" ]  && ARGS+=(--dry-run)

TMP_LOG="$(mktemp /tmp/prerender-job-${JOB_ID}-XXXX.log)"
START_TS=$(date +%s)
WORKER_PID=""
WORKER_PGID=""
LEASE_LOST=0

terminate_worker() {
    if [ -n "$WORKER_PGID" ] && kill -0 -- "-$WORKER_PGID" 2>/dev/null; then
        # The timeout wrapper and the entire renderer tree run in their own
        # session/process group. Killing only timeout leaves bash, Docker, and
        # Chromium descendants orphaned and able to publish after lease loss.
        kill -TERM -- "-$WORKER_PGID" 2>/dev/null || true
        local waited=0
        while kill -0 -- "-$WORKER_PGID" 2>/dev/null && [ "$waited" -lt 30 ]; do
            sleep 1
            waited=$((waited + 1))
        done
        if kill -0 -- "-$WORKER_PGID" 2>/dev/null; then
            kill -KILL -- "-$WORKER_PGID" 2>/dev/null || true
        fi
    fi
}

handle_signal() {
    log "WARN: processor interrupted; terminating worker for job #$JOB_ID"
    terminate_worker
    wait "$WORKER_PID" 2>/dev/null || true
    local interrupted_duration=$(( $(date +%s) - START_TS ))
    docker_exec_bounded "$APP_CONTAINER" php artisan prerender:process-queue \
        --finalise-id="$JOB_ID" \
        --status="failed" \
        --exit-code="143" \
        --duration="$interrupted_duration" \
        --claimed-by="$JOB_CLAIMED_BY" \
        --error="prerender processor interrupted" \
        >/dev/null 2>&1 || true
    rm -f "$TMP_LOG"
    exit 143
}
trap handle_signal INT TERM

set +e
PRERENDER_JOB_ID="$JOB_ID" PRERENDER_JOB_CLAIMED_BY="$JOB_CLAIMED_BY" \
setsid timeout --foreground --signal=TERM --kill-after=30s "${PRERENDER_MAX_RUN_SECONDS}s" \
    bash "$SCRIPT_DIR/prerender-tenants.sh" "${ARGS[@]}" >"$TMP_LOG" 2>&1 &
WORKER_PID=$!
WORKER_PGID=$WORKER_PID
set -e

NEXT_HEARTBEAT=$((START_TS + PRERENDER_HEARTBEAT_INTERVAL_SECONDS))
while kill -0 "$WORKER_PID" 2>/dev/null; do
    sleep 1
    NOW_TS=$(date +%s)
    if [ "$NOW_TS" -lt "$NEXT_HEARTBEAT" ]; then
        continue
    fi

    set +e
    HEARTBEAT_OUT=$(docker_exec_bounded "$APP_CONTAINER" php artisan prerender:process-queue \
        --heartbeat-id="$JOB_ID" \
        --claimed-by="$JOB_CLAIMED_BY" 2>&1)
    HEARTBEAT_EXIT=$?
    set -e
    if [ "$HEARTBEAT_EXIT" -ne 0 ]; then
        LEASE_LOST=1
        log "ERROR: lease heartbeat rejected for job #$JOB_ID; stopping stale worker: $HEARTBEAT_OUT"
        terminate_worker
        break
    fi
    NEXT_HEARTBEAT=$((NOW_TS + PRERENDER_HEARTBEAT_INTERVAL_SECONDS))
done

set +e
wait "$WORKER_PID"
EXIT_CODE=$?
set -e
trap - INT TERM

ERROR_REASON=""
if [ "$LEASE_LOST" -eq 1 ]; then
    EXIT_CODE=75
    ERROR_REASON="prerender lease ownership was lost"
elif [ "$EXIT_CODE" -eq 124 ]; then
    ERROR_REASON="prerender run exceeded ${PRERENDER_MAX_RUN_SECONDS}s"
fi

DURATION=$(( $(date +%s) - START_TS ))
case "$EXIT_CODE" in
    0) STATUS="succeeded" ;;
    2) STATUS="partial"   ;;
    *) STATUS="failed"    ;;
esac

# Step 3: ship the log file to the container so artisan can ingest its tail
# (and auto-parse counters). The PHP container has nexus-php-logs mounted at
# /var/log — write there directly.
CONTAINER_LOG="/var/log/prerender-job-${JOB_ID}.log"
if ! docker cp "$TMP_LOG" "${APP_CONTAINER}:${CONTAINER_LOG}" >/dev/null; then
    log "ERROR: could not copy worker log into $APP_CONTAINER"
    docker_exec_bounded "$APP_CONTAINER" php artisan prerender:process-queue \
        --finalise-id="$JOB_ID" \
        --status="failed" \
        --exit-code="70" \
        --duration="$DURATION" \
        --claimed-by="$JOB_CLAIMED_BY" \
        --error="worker log transfer failed" \
        || log "WARN: fallback finalise failed for job #$JOB_ID"
    rm -f "$TMP_LOG"
    exit 70
fi

ERROR_ARGS=()
if [ "$STATUS" = "failed" ]; then
    ERROR_ARGS+=(--error="${ERROR_REASON:-prerender-tenants.sh exited with code $EXIT_CODE}")
fi

docker_exec_bounded "$APP_CONTAINER" php artisan prerender:process-queue \
    --finalise-id="$JOB_ID" \
    --status="$STATUS" \
    --exit-code="$EXIT_CODE" \
    --duration="$DURATION" \
    --claimed-by="$JOB_CLAIMED_BY" \
    --log-file="$CONTAINER_LOG" \
    "${ERROR_ARGS[@]}" || log "WARN: finalise failed for job #$JOB_ID"

docker exec "$APP_CONTAINER" rm -f "$CONTAINER_LOG" >/dev/null 2>&1 || true
rm -f "$TMP_LOG"

log "Finished job #$JOB_ID status=$STATUS duration=${DURATION}s exit=$EXIT_CODE"
