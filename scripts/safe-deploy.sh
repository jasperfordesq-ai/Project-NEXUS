#!/bin/bash
# =============================================================================
# Project NEXUS - Legacy Deploy Compatibility Wrapper
# =============================================================================
# Production deploys should use:
#   sudo bash scripts/deploy/bluegreen-deploy.sh deploy --detach
#
# This wrapper remains for old docs, muscle memory, and non-blue-green
# environments. On a production blue-green server it auto-detects the Apache
# route switch file and execs into scripts/deploy/bluegreen-deploy.sh before
# any maintenance-mode deploy path can run.
#
# Usage: sudo bash scripts/safe-deploy.sh [auto|quick|full|rollback|status|logs] [--no-migrate] [--detach] [--skip-prerender|--force-prerender] [--prerender-tenant slug] [--prerender-routes /about,/privacy]
#
# Modes:
#   auto      - Legacy fallback only: inspect git diff and pick quick/full
#   quick     - Legacy fallback only: rebuild frontend + restart PHP
#   full      - Legacy fallback only: rebuild ALL containers --no-cache
#   rollback  - Legacy fallback rollback
#   status    - Show current deployment status (no changes)
#   logs      - Tail the latest deploy log (follow mode: logs -f)
#
# Legacy auto-detection triggers full rebuild when any of these change:
#   composer.json, composer.lock, package.json, package-lock.json,
#   Dockerfile, Dockerfile.prod, react-frontend/Dockerfile.prod
#   All other changes → quick (PHP code is volume-mounted, not baked into image)
#
# Flags:
#   --migrate     - Run `php artisan migrate --force` (now the default; flag is a no-op)
#   --no-migrate  - Skip migrations for this deploy (rare; use only for emergency rollbacks)
#   --no-cache - Force Docker builds without layer caching (default for full mode)
#   --detach   - Run deploy in background, detached from terminal/SSH.
#   --skip-prerender  - Skip post-deploy per-tenant pre-rendering
#   --force-prerender - Re-render all tenant public pages even if no relevant files changed
#   --prerender-tenant slug - Limit post-deploy pre-rendering to one tenant
#   --prerender-routes csv  - Limit post-deploy pre-rendering to comma-separated routes
# =============================================================================

set -eo pipefail

# Resolve own directory and deploy dir
SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_DIR="$(cd "$SELF_DIR/.." && pwd)"
export DEPLOY_DIR

DEPLOY_SCRIPTS="$SELF_DIR/deploy"

# Source core libs
. "$DEPLOY_SCRIPTS/lib/common.sh"
. "$DEPLOY_SCRIPTS/lib/state.sh"

cd "$DEPLOY_DIR" || {
    echo "ERROR: Cannot cd to $DEPLOY_DIR"
    exit 1
}

# Create log directory
mkdir -p "$LOG_DIR"

# Parse mode and flags
MODE="${1:-quick}"
# Migrations run automatically by default. Pass --no-migrate to skip
# (e.g. emergency rollback). This is the canonical behaviour — schema
# changes belong in the same deploy unit as the code that depends on them.
LARAVEL_MIGRATE="${LARAVEL_MIGRATE:-1}"
DETACH=0
FORCE_NO_CACHE=0
SKIP_PRERENDER="${SKIP_PRERENDER:-0}"
FORCE_PRERENDER="${FORCE_PRERENDER:-0}"
PRERENDER_TENANT="${PRERENDER_TENANT:-}"
PRERENDER_ROUTES="${PRERENDER_ROUTES:-}"

shift 2>/dev/null || true
while [ "$#" -gt 0 ]; do
    case "$1" in
        --migrate) LARAVEL_MIGRATE=1 ;;        # accepted as no-op (default)
        --no-migrate) LARAVEL_MIGRATE=0 ;;     # opt out (rare)
        --detach|-d) DETACH=1 ;;
        --no-cache) FORCE_NO_CACHE=1 ;;
        --skip-prerender) SKIP_PRERENDER=1 ;;
        --force-prerender) FORCE_PRERENDER=1 ;;
        --prerender-tenant) PRERENDER_TENANT="${2:-}"; shift ;;
        --prerender-routes) PRERENDER_ROUTES="${2:-}"; shift ;;
    esac
    shift 2>/dev/null || true
done

# Handle logs and status subcommands (read-only, no lock/cleanup needed)
if [ "$MODE" = "logs" ]; then
    exec bash "$DEPLOY_SCRIPTS/subcommands/logs.sh" "$@"
fi

if [ "$MODE" = "status" ]; then
    exec bash "$DEPLOY_SCRIPTS/subcommands/status.sh"
fi

# ===========================================================================
# Blue-green delegation
# When NEXUS_APACHE_ROUTES_FILE is configured, delegate deploy/rollback to
# bluegreen-deploy.sh (zero-downtime, no maintenance window) instead of the
# maintenance-mode path below. Flags are forwarded transparently.
#
# IMPORTANT: sudo strips environment variables, so NEXUS_APACHE_ROUTES_FILE
# will not be present even if the caller has it set. We auto-detect it here
# by checking the canonical production path. If the file exists on disk, the
# blue-green path is used regardless of whether the env var was passed in.
# ===========================================================================
if [ -z "${NEXUS_APACHE_ROUTES_FILE:-}" ]; then
    _CANDIDATE="/etc/apache2/conf-enabled/nexus-active-upstreams.conf"
    if [ -f "$_CANDIDATE" ]; then
        export NEXUS_APACHE_ROUTES_FILE="$_CANDIDATE"
        echo "[INFO] Auto-detected NEXUS_APACHE_ROUTES_FILE=$NEXUS_APACHE_ROUTES_FILE (sudo stripped env)"
    fi
    unset _CANDIDATE
fi

# Safety net: if a blue-green state file exists but the routes file is gone
# (e.g. after a server migration or manual Apache change), refuse to fall
# through to the maintenance-mode path. That path would recreate legacy
# containers against live traffic and cause an outage.
_BG_STATE_CHECK="$DEPLOY_DIR/.bluegreen-active"
if [ -z "${NEXUS_APACHE_ROUTES_FILE:-}" ] && [ -f "$_BG_STATE_CHECK" ]; then
    echo "[FAIL] FATAL: blue-green state file found at $_BG_STATE_CHECK"
    echo "[FAIL] but NEXUS_APACHE_ROUTES_FILE is not set and the routes file does not"
    echo "[FAIL] exist at /etc/apache2/conf-enabled/nexus-active-upstreams.conf."
    echo "[FAIL] The maintenance-mode deploy path cannot run safely on a blue-green server."
    echo "[FAIL] Run: sudo bash scripts/setup-bluegreen.sh"
    exit 1
fi
unset _BG_STATE_CHECK

if [ -n "${NEXUS_APACHE_ROUTES_FILE:-}" ] && \
   [ -f "$SELF_DIR/deploy/bluegreen-deploy.sh" ]; then
    BG_CMD="deploy"
    [ "$MODE" = "rollback" ] && BG_CMD="rollback"
    BG_ARGS=("$BG_CMD")
    [ "$DETACH"          = "1" ] && BG_ARGS+=(--detach)
    [ "$LARAVEL_MIGRATE" = "1" ] && BG_ARGS+=(--migrate)
    [ "$SKIP_PRERENDER"  = "1" ] && BG_ARGS+=(--skip-prerender)
    [ "$FORCE_PRERENDER" = "1" ] && BG_ARGS+=(--force-prerender)
    [ -n "$PRERENDER_TENANT" ]   && BG_ARGS+=(--prerender-tenant "$PRERENDER_TENANT")
    [ -n "$PRERENDER_ROUTES" ]   && BG_ARGS+=(--prerender-routes "$PRERENDER_ROUTES")
    echo "[INFO] safe-deploy.sh is a compatibility wrapper; delegating to bluegreen-deploy.sh (zero-downtime)"
    exec bash "$SELF_DIR/deploy/bluegreen-deploy.sh" "${BG_ARGS[@]}"
fi

# Handle --detach: re-exec in background and return immediately
# Skip if we're already the detached child (marker is set)
if [ "$DETACH" = "1" ] && [ -z "${__NEXUS_DEPLOY_DETACHED__:-}" ]; then
    CHILD_ARGS=""
    [ "$LARAVEL_MIGRATE" = "1" ] && CHILD_ARGS="$CHILD_ARGS --migrate"
    [ "$FORCE_NO_CACHE" = "1" ] && CHILD_ARGS="$CHILD_ARGS --no-cache"
    [ "$SKIP_PRERENDER" = "1" ] && CHILD_ARGS="$CHILD_ARGS --skip-prerender"
    [ "$FORCE_PRERENDER" = "1" ] && CHILD_ARGS="$CHILD_ARGS --force-prerender"
    [ -n "$PRERENDER_TENANT" ] && CHILD_ARGS="$CHILD_ARGS --prerender-tenant $PRERENDER_TENANT"
    [ -n "$PRERENDER_ROUTES" ] && CHILD_ARGS="$CHILD_ARGS --prerender-routes $PRERENDER_ROUTES"
    bash "$DEPLOY_SCRIPTS/subcommands/detach.sh" "$MODE" $CHILD_ARGS
    exit 0
fi

# Set up LOG_FILE
TIMESTAMP=$(date +%Y-%m-%d_%H-%M-%S)
if [ -n "${__NEXUS_DEPLOY_DETACHED__:-}" ]; then
    # Detached child: stdout/stderr already go to the log file via detach redirect.
    # Point LOG_FILE at /dev/null so tee doesn't double-write.
    LOG_FILE="/dev/null"
else
    LOG_FILE="$LOG_DIR/deploy-$TIMESTAMP.log"
fi
export LOG_FILE MODE LARAVEL_MIGRATE FORCE_NO_CACHE SKIP_PRERENDER FORCE_PRERENDER PRERENDER_TENANT PRERENDER_ROUTES

echo "============================================" | tee "$LOG_FILE"
echo "  Project NEXUS - Safe Production Deploy"    | tee -a "$LOG_FILE"
echo "  Started: $(date '+%Y-%m-%d %H:%M:%S')"      | tee -a "$LOG_FILE"
echo "============================================" | tee -a "$LOG_FILE"
echo "" | tee -a "$LOG_FILE"

# Initialise cross-phase state and reset flags
state_init
state_set DEPLOY_SUCCESS 0
state_set MAINTENANCE_ENABLED_BY_US 0

# Source lock/cleanup (uses common.sh + state.sh already loaded)
. "$DEPLOY_SCRIPTS/lib/lock.sh"

check_lock
create_lock
trap cleanup EXIT

# Helper: run a phase subprocess; on failure, print banner + exit 1 (cleanup trap fires)
run_phase() {
    local phase_script="$1"
    shift
    bash "$phase_script" "$@"
}

# Run pre-deploy validation (except for rollback)
if [ "$MODE" != "rollback" ]; then
    run_phase "$DEPLOY_SCRIPTS/phases/validate-env.sh"
fi

# Enable maintenance mode before any changes
run_phase "$DEPLOY_SCRIPTS/phases/maintenance-on.sh"

# Auto-detect mode: fetch origin/main and inspect what changed
if [ "$MODE" = "auto" ]; then
    echo "" | tee -a "$LOG_FILE"
    echo "  Auto-detecting deploy mode..." | tee -a "$LOG_FILE"
    git fetch origin main --quiet 2>&1 | tee -a "$LOG_FILE"
    CHANGED=$(git diff HEAD origin/main --name-only 2>/dev/null || echo "")
    FULL_TRIGGERS="composer.json composer.lock package.json package-lock.json Dockerfile Dockerfile.prod react-frontend/Dockerfile.prod react-frontend/package.json react-frontend/package-lock.json"
    NEEDS_FULL=0
    for trigger in $FULL_TRIGGERS; do
        if echo "$CHANGED" | grep -qF "$trigger"; then
            echo "  Trigger: $trigger changed → full rebuild required" | tee -a "$LOG_FILE"
            NEEDS_FULL=1
            break
        fi
    done
    if [ "$NEEDS_FULL" = "1" ]; then
        MODE="full"
        echo "  Mode selected: FULL (dependency/Dockerfile changes detected)" | tee -a "$LOG_FILE"
    else
        MODE="quick"
        echo "  Mode selected: QUICK (code-only changes, PHP is volume-mounted)" | tee -a "$LOG_FILE"
    fi
    echo "" | tee -a "$LOG_FILE"
fi

# Execute deployment based on mode
case "$MODE" in
    # ── Legacy single-color build/rollback REMOVED 2026-08-09 ──────────────
    # These three modes ran build-quick.sh / build-full.sh / rollback.sh, each
    # of which began by copying compose.prod.yml over compose.yml to recreate
    # the legacy `nexus-php-*` containers under maintenance mode. That stack
    # has not run in production since 2026-05 (verified via `docker ps`: only
    # nexus-blue-* / nexus-green-* exist, and nexus-php-queue exited 3 months
    # ago), so compose.prod.yml and those three phase scripts were deleted.
    #
    # Reaching here means blue-green delegation above did NOT fire — either
    # the Apache routes file is missing or bluegreen-deploy.sh is absent.
    # Refuse loudly rather than half-run a path whose compose file is gone:
    # a partial legacy deploy against live traffic is an outage.
    quick|full|rollback)
        log_err "The legacy '$MODE' deploy path has been removed."
        log_err "It depended on compose.prod.yml, which no longer exists."
        log_info "Production deploys: sudo bash scripts/deploy/bluegreen-deploy.sh deploy --detach"
        log_info "Production rollback: sudo bash scripts/deploy/bluegreen-deploy.sh rollback --detach"
        log_info "If blue-green is not set up on this host: sudo bash scripts/setup-bluegreen.sh"
        exit 1
        ;;
    *)
        log_err "Invalid mode: $MODE"
        log_info "Production usage: sudo bash scripts/deploy/bluegreen-deploy.sh deploy --detach"
        log_info "Legacy wrapper usage: sudo bash scripts/safe-deploy.sh [auto|quick|full|rollback|status|logs] [--no-migrate] [--skip-prerender|--force-prerender] [--prerender-tenant slug] [--prerender-routes /about,/privacy]"
        exit 1
        ;;
esac

# Run Laravel artisan migrate if requested (--migrate flag or LARAVEL_MIGRATE=1)
if [ "$LARAVEL_MIGRATE" = "1" ]; then
    run_phase "$DEPLOY_SCRIPTS/phases/migrate-laravel.sh"
fi

# Verify production images (catches dev-on-prod bug) — hard failure
run_phase "$DEPLOY_SCRIPTS/phases/verify-images.sh"

# Capture the pre-deploy commit before write-build-version updates
# .last-successful-deploy. The pre-render phase uses this for change detection.
PRERENDER_BASE_COMMIT="$(cat "$LAST_DEPLOY_FILE" 2>/dev/null || true)"
export PRERENDER_BASE_COMMIT

# Run smoke tests
if run_phase "$DEPLOY_SCRIPTS/phases/smoke-tests.sh"; then
    # Write build version
    run_phase "$DEPLOY_SCRIPTS/phases/write-build-version.sh"

    # Disable maintenance mode FIRST — deploy succeeded, go live
    # IMPORTANT: Must happen BEFORE Cloudflare purge, otherwise CF caches
    # the 503 maintenance response right after purge, then keeps serving it
    # even after maintenance is disabled.
    run_phase "$DEPLOY_SCRIPTS/phases/maintenance-off.sh"

    # Purge Cloudflare cache AFTER maintenance is off
    CF_PURGE_OK=true
    bash "$DEPLOY_SCRIPTS/phases/purge-cloudflare.sh" || CF_PURGE_OK=false

    # Plan and refresh only missing/stale/scoped tenant public pages with real data
    run_phase "$DEPLOY_SCRIPTS/phases/prerender-tenants.sh"

    # Purge again after pre-rendering. The first purge clears old edge content
    # for the worker; this one clears any old HTML cached while the prerender
    # volume was being refreshed.
    bash "$DEPLOY_SCRIPTS/phases/purge-cloudflare.sh" || CF_PURGE_OK=false

    # Remove dangling Docker images (prevents disk bloat over time)
    run_phase "$DEPLOY_SCRIPTS/phases/prune-images.sh"

    DEPLOYED_COMMIT=$(git log -1 --format='%h')
    DEPLOYED_SUBJECT=$(git log -1 --format='%s')
    DEPLOYED_TIME=$(date -u '+%Y-%m-%d %H:%M:%S UTC')
    CF_STATUS=$( [ "$CF_PURGE_OK" = "true" ] && echo "Purged (all domains)" || echo "PARTIAL — check logs (exchangemembers.com 403)" )

    echo "" | tee -a "$LOG_FILE"
    echo "============================================" | tee -a "$LOG_FILE"
    echo "  Deployment Successful!" | tee -a "$LOG_FILE"
    echo "============================================" | tee -a "$LOG_FILE"
    echo "  Commit:    $DEPLOYED_COMMIT — $DEPLOYED_SUBJECT" | tee -a "$LOG_FILE"
    echo "  Live at:   $DEPLOYED_TIME" | tee -a "$LOG_FILE"
    echo "  CF Purge:  $CF_STATUS" | tee -a "$LOG_FILE"
    echo "============================================" | tee -a "$LOG_FILE"
    echo "" | tee -a "$LOG_FILE"
    log_info "Log saved to: $LOG_FILE"

    # Schedule post-deploy health check (background, non-blocking)
    run_phase "$DEPLOY_SCRIPTS/phases/schedule-health-check.sh"

    # Post-deploy notification (non-blocking)
    bash "$DEPLOY_SCRIPTS/phases/notify-deploy.sh" success \
        "$(git -C "$DEPLOY_DIR" log -1 --format='%h' 2>/dev/null || true)" \
        "$(git -C "$DEPLOY_DIR" log -1 --format='%s' 2>/dev/null || true)" \
        "" 2>/dev/null || true

    state_clear
    exit 0
else
    echo "" | tee -a "$LOG_FILE"
    log_err "Deployment completed but smoke tests failed"
    log_err "MAINTENANCE MODE IS STILL ON — platform is NOT live"
    # Intentionally keep maintenance on — don't let the trap auto-disable it
    state_set MAINTENANCE_ENABLED_BY_US 0
    log_warn "The platform remains in maintenance mode for safety."
    log_warn "Fix the issue, then either:"
    log_warn "  1. Re-deploy:   sudo bash scripts/deploy/bluegreen-deploy.sh deploy --detach"
    log_warn "  2. Rollback:    sudo bash scripts/deploy/bluegreen-deploy.sh rollback --detach"
    log_warn "  3. Force live:  sudo bash scripts/maintenance.sh off"
    log_info "Log saved to: $LOG_FILE"

    # Failure notification (non-blocking)
    bash "$DEPLOY_SCRIPTS/phases/notify-deploy.sh" failure \
        "$(git -C "$DEPLOY_DIR" log -1 --format='%h' 2>/dev/null || true)" \
        "$(git -C "$DEPLOY_DIR" log -1 --format='%s' 2>/dev/null || true)" \
        "" 2>/dev/null || true

    exit 1
fi
