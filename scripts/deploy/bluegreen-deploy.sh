#!/usr/bin/env bash
# Copyright © 2024–2026 Jasper Ford
# SPDX-License-Identifier: AGPL-3.0-or-later
# Author: Jasper Ford
# See NOTICE file for attribution and acknowledgements.
#
# Zero-downtime blue/green deploy orchestrator for the production VM.
# This script intentionally does not use GitHub Actions or GitHub CLI.

set -euo pipefail

SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_DIR="$(cd "$SELF_DIR/../.." && pwd)"
export DEPLOY_DIR

. "$SELF_DIR/lib/common.sh"
. "$SELF_DIR/lib/state.sh"
. "$SELF_DIR/lib/lock.sh"
. "$SELF_DIR/lib/db-backup.sh"

mkdir -p "$LOG_DIR"
TIMESTAMP="$(date +%Y-%m-%d_%H-%M-%S)"
LOG_FILE="${NEXUS_BLUEGREEN_LOG_FILE:-$LOG_DIR/bluegreen-deploy-$TIMESTAMP.log}"
export LOG_FILE

# A deploy with both legacy SQL and Laravel migrations needs one authoritative
# snapshot before the first schema mutation, not one snapshot per migrator.
MIGRATION_SNAPSHOT_TAKEN=0

STATE_FILE="${NEXUS_BLUEGREEN_STATE_FILE:-$DEPLOY_DIR/.bluegreen-active}"
STATUS_FILE="${NEXUS_BLUEGREEN_STATUS_FILE:-$DEPLOY_DIR/.bluegreen-status}"

# 🔴 Records that web-uk is LIVE — that at least one accessible hostname has been
# confirmed served by it. Written once, at the first confirmation, and never
# removed by a deploy.
#
# WHY THIS FILE EXISTS. `DEPLOY_WEBUK` came only from the current invocation's flag
# or environment. Nothing remembered it. So after a cutover, one ordinary
# `bash scripts/deploy.sh` — no flag, exactly what a routine deploy looks like —
# wrote the Apache routes file WITHOUT `Define NEXUS_WEBUK_PORT`, the vhost's
# `<IfDefine !NEXUS_WEBUK_PORT>` arm took over, and every accessible hostname
# silently went back to serving the Blade frontend. At HTTP 200. And the
# post-cutover check waved it through, because Blade does not answer `/version`
# at all, so "no response" was treated as "not cut over yet".
#
# Once this marker exists: an absent `/version` is a hard failure, and a deploy
# that would drop web-uk must say `--without-webuk` out loud.
WEBUK_LIVE_MARKER="${NEXUS_WEBUK_LIVE_MARKER:-$DEPLOY_DIR/.webuk-live}"
LATEST_LOG_FILE="${NEXUS_BLUEGREEN_LATEST_LOG_FILE:-$DEPLOY_DIR/.bluegreen-latest-log}"
RELEASES_DIR="${NEXUS_RELEASES_DIR:-$(dirname "$DEPLOY_DIR")/nexus-releases}"
APACHE_ROUTES_FILE="${NEXUS_APACHE_ROUTES_FILE:-}"

# Auto-detect routes file — sudo strips environment variables, so we cannot
# rely on NEXUS_APACHE_ROUTES_FILE being present. Check the canonical path.
if [ -z "$APACHE_ROUTES_FILE" ]; then
    _CANDIDATE="/etc/apache2/conf-enabled/nexus-active-upstreams.conf"
    if [ -f "$_CANDIDATE" ]; then
        APACHE_ROUTES_FILE="$_CANDIDATE"
        export NEXUS_APACHE_ROUTES_FILE="$_CANDIDATE"
    fi
    unset _CANDIDATE
fi

APACHE_CONFIGTEST="${NEXUS_APACHE_CONFIGTEST:-apachectl configtest}"
APACHE_RELOAD="${NEXUS_APACHE_RELOAD:-systemctl reload apache2}"
ACTIVE_COLOR_DEFAULT="${NEXUS_ACTIVE_COLOR_DEFAULT:-blue}"
# Migrations run automatically by default. Pass --no-migrate to skip
# (e.g. for emergency rollback deploys where the schema must stay).
# This is the canonical behaviour — migrations are part of the deploy unit.
LARAVEL_MIGRATE=1
DETACH=0
SKIP_PRERENDER=0
FORCE_PRERENDER=0
PRERENDER_TENANT=""
PRERENDER_ROUTES=""
PREPARED_COMMIT=""
PREPARED_RELEASE_DIR=""
CURRENT_ACTIVE=""
CURRENT_TARGET=""
CURRENT_COMMIT=""

BLUE_API_PORT="${NEXUS_BLUE_API_PORT:-8090}"
BLUE_FRONTEND_PORT="${NEXUS_BLUE_FRONTEND_PORT:-3000}"
GREEN_API_PORT="${NEXUS_GREEN_API_PORT:-8190}"
GREEN_FRONTEND_PORT="${NEXUS_GREEN_FRONTEND_PORT:-3400}"

# web-uk accessible frontend. 🔴 OPT-IN ONLY: unset, nothing about web-uk runs and
# the existing deploy path is byte-for-byte unaffected. Its compose service lives in
# a SEPARATE overlay file because its required-secret declarations would otherwise
# make the whole compose file fail to interpolate on any host without those secrets,
# breaking every deploy. See compose.webuk.bluegreen.yml.
DEPLOY_WEBUK="${NEXUS_DEPLOY_WEBUK:-0}"
# Distinguishes "--without-webuk was given" from "no flag was given", which both
# leave DEPLOY_WEBUK=0. See enforce_webuk_live_marker().
WEBUK_EXPLICITLY_DISABLED=0
BLUE_WEBUK_PORT="${NEXUS_BLUE_WEBUK_PORT:-3500}"
GREEN_WEBUK_PORT="${NEXUS_GREEN_WEBUK_PORT:-3600}"
WEBUK_COMPOSE_OVERLAY="compose.webuk.bluegreen.yml"

usage() {
    cat <<'USAGE'
Usage:
  sudo bash scripts/deploy/bluegreen-deploy.sh deploy
  sudo bash scripts/deploy/bluegreen-deploy.sh deploy --detach
  sudo bash scripts/deploy/bluegreen-deploy.sh deploy --migrate
  sudo bash scripts/deploy/bluegreen-deploy.sh deploy --skip-prerender
  sudo bash scripts/deploy/bluegreen-deploy.sh deploy --force-prerender
  sudo bash scripts/deploy/bluegreen-deploy.sh rollback
  sudo bash scripts/deploy/bluegreen-deploy.sh status
  sudo bash scripts/deploy/bluegreen-deploy.sh logs
  sudo bash scripts/deploy/bluegreen-deploy.sh logs -f
  sudo bash scripts/deploy/bluegreen-deploy.sh monitor
  sudo bash scripts/deploy/bluegreen-deploy.sh confirm-webuk-live [hostname]

confirm-webuk-live:
  Run straight after the Apache reload that switches a hostname to web-uk.
  It probes the public hostname and records web-uk as live only if web-uk
  actually answers. That recording is what makes a later deploy REFUSE to
  drop web-uk without being told to. Until it exists, an ordinary deploy
  would put the hostname back to the Blade frontend with nothing failing.
  Defaults to accessible.project-nexus.ie.

Apache route switch file:
  Auto-detected at /etc/apache2/conf-enabled/nexus-active-upstreams.conf
  Override with NEXUS_APACHE_ROUTES_FILE only for non-standard server layouts.

Optional:
  NEXUS_APACHE_CONFIGTEST="apachectl configtest"
  NEXUS_APACHE_RELOAD="systemctl reload apache2"
USAGE
}

parse_flags() {
    shift || true
    while [ "$#" -gt 0 ]; do
        case "$1" in
            --migrate) LARAVEL_MIGRATE=1 ;;        # accepted as no-op (default)
            --no-migrate) LARAVEL_MIGRATE=0 ;;     # opt out (rare)
            --detach|-d) DETACH=1 ;;
            # 🔴 A FLAG, NOT AN ENV VAR, and the reason matters. scripts/deploy.sh
            # runs this over SSH under `sudo`, and forwards no environment at all —
            # so `NEXUS_DEPLOY_WEBUK=1 bash scripts/deploy.sh` deployed WITHOUT
            # web-uk, succeeded, and reported success. A flag survives sudo, appears
            # in the deploy log, and cannot be silently dropped.
            #
            # NEXUS_DEPLOY_WEBUK still works for running this script directly on the
            # server, where the environment is not crossing a boundary.
            --with-webuk) DEPLOY_WEBUK=1 ;;
            # Tracked separately from DEPLOY_WEBUK=0, which is also the DEFAULT.
            # "not asked for" and "explicitly refused" must be distinguishable, or
            # the live-marker guard below cannot tell a routine flagless deploy from
            # a deliberate retreat to Blade.
            --without-webuk) DEPLOY_WEBUK=0; WEBUK_EXPLICITLY_DISABLED=1 ;;
            --skip-prerender) SKIP_PRERENDER=1 ;;
            --force-prerender) FORCE_PRERENDER=1 ;;
            --prerender-tenant) PRERENDER_TENANT="${2:-}"; shift ;;
            --prerender-routes) PRERENDER_ROUTES="${2:-}"; shift ;;
            *)
                log_err "Unknown flag: $1"
                usage
                exit 2
                ;;
        esac
        shift
    done
}

# 🔴 Refuse to silently un-deploy a live web-uk.
#
# Called after flag parsing, on every subcommand. If the marker says web-uk is
# serving real traffic and this invocation was not told to include it, the deploy
# STOPS. It does not helpfully assume, because "helpfully assume" is how a routine
# deploy would have taken the accessible frontend back to Blade without a word.
#
# Two ways past it, both deliberate and both visible in the log:
#   --with-webuk     carry on with web-uk, the normal case after cutover
#   --without-webuk  yes, really remove it (a deliberate retreat to Blade)
enforce_webuk_live_marker() {
    [ -f "$WEBUK_LIVE_MARKER" ] || return 0
    [ "$DEPLOY_WEBUK" = "1" ] && return 0
    [ "$WEBUK_EXPLICITLY_DISABLED" = "1" ] && {
        log_warn "web-uk is LIVE but --without-webuk was given: the accessible hostnames will fall back to the Blade frontend."
        log_warn "Marker kept at $WEBUK_LIVE_MARKER. Remove it by hand once Blade is intended to be permanent again."
        return 0
    }

    log_err "REFUSING TO DEPLOY: web-uk is live, but this deploy was not told to include it."
    log_err ""
    log_err "  Marker: $WEBUK_LIVE_MARKER"
    log_err ""
    log_err "Deploying without it would rewrite the Apache routes file with no"
    log_err "Define NEXUS_WEBUK_PORT, so every accessible hostname would quietly go"
    log_err "back to serving the Blade frontend — at HTTP 200, with nothing failing."
    log_err ""
    log_err "  Keep web-uk:    add --with-webuk"
    log_err "  Really drop it: add --without-webuk"
    exit 2
}

# 🔴 Arm the live marker at CUTOVER time, which is the only moment that works.
#
# The marker is normally latched by post_cutover_smoke, but that runs during a
# deploy — and the Apache switch happens AFTER the deploy, by hand. So on the
# real cutover the probe correctly saw Blade, correctly declined to latch, and
# left the protection dormant for the whole window between the switch and the
# next deploy. That window is exactly when a flagless deploy would silently undo
# the switch. Observed on 2026-08-12: the switch went live with no marker.
#
# This latches from the same evidence post_cutover_smoke uses — a live probe of a
# real public hostname — so it CANNOT be used to assert something untrue. There is
# deliberately no --force: if the host is not serving web-uk, refusing is correct.
cmd_confirm_webuk_live() {
    local host="${1:-accessible.project-nexus.ie}"
    local version

    log_info "Probing https://$host/version"
    version="$(curl -sf -H 'Cache-Control: no-cache' \
        "https://$host/version?_t=$(date +%s)" 2>/dev/null || true)"

    if [ -z "$version" ]; then
        log_err "No response from https://$host/version"
        log_err "Blade does not serve /version at all, so an empty response means this"
        log_err "hostname is NOT yet served by web-uk. Nothing recorded."
        return 1
    fi

    if ! echo "$version" | grep -q '"service":"nexus-webuk"'; then
        log_err "https://$host is not served by web-uk."
        log_err "Response: $version"
        log_err "Nothing recorded."
        return 1
    fi

    log_ok "Confirmed: $host is served by web-uk"
    log_info "  $version"

    if [ -f "$WEBUK_LIVE_MARKER" ]; then
        log_ok "Marker already present at $WEBUK_LIVE_MARKER — nothing to do."
        sed -n '1,5p' "$WEBUK_LIVE_MARKER" 2>/dev/null || true
        return 0
    fi

    # The commit comes out of the probe response itself, not from local git or a
    # deploy variable — it is what the host is actually SERVING, which is the only
    # commit worth recording here.
    local serving_commit
    serving_commit="$(echo "$version" | sed -n 's/.*"release":"\([^"]*\)".*/\1/p')"

    if printf 'confirmed_at=%s\nhost=%s\ncommit=%s\nconfirmed_by=confirm-webuk-live\n' \
        "$(date -Iseconds)" "$host" "${serving_commit:-unknown}" \
        > "$WEBUK_LIVE_MARKER" 2>/dev/null; then
        log_ok "web-uk recorded as LIVE ($WEBUK_LIVE_MARKER)"
        log_info "From now on a deploy must pass --with-webuk, or it refuses."
        return 0
    fi

    log_err "Could not write $WEBUK_LIVE_MARKER — the live-marker protections are NOT armed."
    log_err "Run this with sudo."
    return 1
}

write_deploy_status() {
    local status="$1"
    local phase="$2"
    local active="${3:-$(read_active_color 2>/dev/null || echo unknown)}"
    local target="${4:-}"
    local commit="${5:-}"

    cat > "$STATUS_FILE" <<STATUS
status=$status
phase=$phase
active=$active
target=$target
commit=$commit
log=$LOG_FILE
updated_at=$(date -Iseconds)
STATUS
    printf '%s\n' "$LOG_FILE" > "$LATEST_LOG_FILE"
}

phase() {
    local label="$1"
    local active="${2:-$(read_active_color 2>/dev/null || echo unknown)}"
    local target="${3:-}"
    local commit="${4:-}"
    write_deploy_status "running" "$label" "$active" "$target" "$commit"
    log_step "=== $label ==="
}

deploy_exit_trap() {
    local code=$?
    local _end_ts duration_s
    _end_ts="$(date +%s)"
    duration_s=$(( _end_ts - ${DEPLOY_START_TS:-_end_ts} ))

    if [ "$code" -eq 0 ]; then
        write_deploy_status "success" "complete" "${CURRENT_TARGET:-$(read_active_color 2>/dev/null || echo unknown)}" "${CURRENT_TARGET:-}" "${CURRENT_COMMIT:-}"
    else
        write_deploy_status "failed" "failed" "${CURRENT_ACTIVE:-$(read_active_color 2>/dev/null || echo unknown)}" "${CURRENT_TARGET:-}" "${CURRENT_COMMIT:-}"
    fi

    # Append telemetry record (deploys.jsonl) — change-failure-rate / MTTR source
    local _status _subcommand _color
    [ "$code" -eq 0 ] && _status="success" || _status="failed"
    _subcommand="${CURRENT_SUBCOMMAND:-deploy}"
    _color="${CURRENT_TARGET:-}"
    bash "$SELF_DIR/phases/record-deploy-metrics.sh" \
        "$_status" "$_subcommand" \
        "${CURRENT_COMMIT:-}" "${CURRENT_PREV_COMMIT:-}" \
        "$_color" "$duration_s" \
        2>/dev/null || true

    # Post-deploy notification (non-blocking)
    bash "$SELF_DIR/phases/notify-deploy.sh" \
        "$_status" \
        "${CURRENT_COMMIT:0:12}" \
        "$(git -C "$DEPLOY_DIR" log -1 --format='%s' "${CURRENT_COMMIT:-HEAD}" 2>/dev/null || true)" \
        "${CURRENT_TARGET:-}" \
        "${duration_s}s" \
        2>/dev/null || true
    cleanup
    exit "$code"
}

detach_if_requested() {
    local mode="$1"
    shift || true

    if [ "$DETACH" != "1" ] || [ -n "${__NEXUS_BLUEGREEN_DETACHED__:-}" ]; then
        return 0
    fi

    # Synchronous pre-flight lock check: if another deploy is running we
    # want the caller to see [FAIL] on stderr immediately, not buried in a
    # detached log file after we falsely report "started in background".
    check_lock
    if [ -d "$LOCK_DIR" ]; then
        local recorded_pid age
        recorded_pid="$(cat "$LOCK_DIR/pid" 2>/dev/null || echo unknown)"
        age=$(( $(date +%s) - $(stat -c %Y "$LOCK_DIR" 2>/dev/null || echo 0) ))
        log_err "Another deployment is already running (PID: $recorded_pid, age: $((age / 60))m). Refusing to detach a new one."
        log_info "Tail the active deploy: sudo bash scripts/deploy/bluegreen-deploy.sh logs -f"
        exit 2
    fi

    # 🔴 EVERY behaviour-changing flag must be forwarded to the detached child, and
    # this list has now been WRONG TWICE in the same way.
    #
    # The child is a fresh `bash "$0"` with a hand-built argument list, so any flag
    # missing here is silently discarded — the parent parsed it, echoed it, and the
    # process that actually deploys never saw it.
    #
    # Measured on 2026-08-12: `--with-webuk` was absent, so
    # `bash scripts/deploy.sh --with-webuk` printed "web-uk: --with-webuk", survived
    # ssh and sudo (the thing that was fixed the day before), and then the server log
    # said "web-uk: NOT included". A rehearsal would have been reported as successful
    # with web-uk never built.
    #
    # `--no-migrate` was missing too, and that one is worse: LARAVEL_MIGRATE defaults
    # to 1, so a detached `--no-migrate` deploy ran migrations anyway — the exact
    # opposite of what was asked, on the flag documented for emergency rollbacks.
    #
    # `test-bluegreen-webuk-contract.sh` now asserts that every flag `parse_flags`
    # accepts is either forwarded here or explicitly listed as deliberately not
    # forwarded, so this cannot drift a third time.
    local child_args=("$mode")
    if [ "$LARAVEL_MIGRATE" = "1" ]; then
        child_args+=("--migrate")
    else
        child_args+=("--no-migrate")
    fi
    [ "$DEPLOY_WEBUK" = "1" ] && child_args+=("--with-webuk")
    [ "$WEBUK_EXPLICITLY_DISABLED" = "1" ] && child_args+=("--without-webuk")
    [ "$SKIP_PRERENDER" = "1" ] && child_args+=("--skip-prerender")
    [ "$FORCE_PRERENDER" = "1" ] && child_args+=("--force-prerender")
    [ -n "$PRERENDER_TENANT" ] && child_args+=("--prerender-tenant" "$PRERENDER_TENANT")
    [ -n "$PRERENDER_ROUTES" ] && child_args+=("--prerender-routes" "$PRERENDER_ROUTES")
    # NOT forwarded, deliberately: --detach / -d (the child must not re-detach; it
    # already carries __NEXUS_BLUEGREEN_DETACHED__=1) and -h/--help/help.

    LOG_FILE="$LOG_DIR/bluegreen-deploy-$TIMESTAMP.log"
    export LOG_FILE __NEXUS_BLUEGREEN_DETACHED__=1
    printf '%s\n' "$LOG_FILE" > "$LATEST_LOG_FILE"
    write_deploy_status "starting" "detached deploy queued" "$(read_active_color)" "" ""

    nohup bash "$0" "${child_args[@]}" > "$LOG_FILE" 2>&1 &
    local pid=$!

    log_ok "Blue/green deploy started in background (PID $pid)"
    log_info "Log: $LOG_FILE"
    log_info "Watch: sudo bash scripts/deploy/bluegreen-deploy.sh monitor"
    log_info "Tail:  sudo bash scripts/deploy/bluegreen-deploy.sh logs -f"
    exit 0
}

read_active_color() {
    local color
    if [ -f "$STATE_FILE" ]; then
        color="$(tr -d '[:space:]' < "$STATE_FILE")"
    else
        color="$ACTIVE_COLOR_DEFAULT"
    fi

    case "$color" in
        blue|green) echo "$color" ;;
        *)
            log_warn "Invalid active color '$color'; defaulting to $ACTIVE_COLOR_DEFAULT"
            echo "$ACTIVE_COLOR_DEFAULT"
            ;;
    esac
}

inactive_color() {
    local active="$1"
    case "$active" in
        blue) echo "green" ;;
        green) echo "blue" ;;
        *)
            log_err "Invalid active color: $active"
            return 1
            ;;
    esac
}

ports_for_color() {
    local color="$1"
    if [ "$color" = "blue" ]; then
        echo "$BLUE_API_PORT $BLUE_FRONTEND_PORT"
    else
        echo "$GREEN_API_PORT $GREEN_FRONTEND_PORT"
    fi
}

# 🔴 DELIBERATELY SEPARATE from ports_for_color(). That function returns exactly two
# values and eight call sites destructure exactly two with
# `read -r api_port frontend_port`. Appending a third field would be SILENTLY
# DISCARDED at seven of them and would corrupt the eighth. Never merge these.
webuk_port_for_color() {
    local color="$1"
    if [ "$color" = "blue" ]; then
        echo "$BLUE_WEBUK_PORT"
    else
        echo "$GREEN_WEBUK_PORT"
    fi
}

webuk_enabled() {
    [ "$DEPLOY_WEBUK" = "1" ]
}

# Compose invocation including the web-uk overlay only when opted in.
compose_files_for_release() {
    local release_dir="$1"
    printf -- "-f
%s/compose.bluegreen.yml
" "$release_dir"
    if webuk_enabled; then
        if [ ! -f "$release_dir/$WEBUK_COMPOSE_OVERLAY" ]; then
            log_err "NEXUS_DEPLOY_WEBUK=1 but $WEBUK_COMPOSE_OVERLAY is missing from the release."
            log_err "Push the web-uk deployment overlay before enabling it."
            exit 1
        fi
        printf -- "-f
%s/%s
" "$release_dir" "$WEBUK_COMPOSE_OVERLAY"
    fi
}

require_route_switching() {
    if [ -z "$APACHE_ROUTES_FILE" ]; then
        log_err "NEXUS_APACHE_ROUTES_FILE is not set."
        log_info "Set it to the Apache/Plesk include that controls app/API upstream ports."
        exit 2
    fi
}

compose_for_release() {
    local release_dir="$1"
    shift
    # The web-uk overlay is appended ONLY when NEXUS_DEPLOY_WEBUK=1, so an
    # ordinary deploy issues exactly the docker compose command it always did.
    #
    # 🔴 COMMAND substitution, not PROCESS substitution, and the status is checked.
    # This was `while read … < <(compose_files_for_release …)`, where the function's
    # `exit 1` for a missing overlay terminated only the subshell: the loop had
    # already consumed the lines printed before the guard, finished with status 0,
    # and `set -e` saw nothing. The deploy then carried on and died later on
    # "no such service: webuk" — so the operator got a Docker error instead of
    # "push the web-uk deployment overlay before enabling it". The contract test
    # passed throughout, because it called the function in a command substitution,
    # where `exit 1` DOES set the status. It asserted a property the real call site
    # did not have.
    local -a files=()
    local file_list=""
    if ! file_list="$(compose_files_for_release "$release_dir")"; then
        log_err "Could not determine the compose file list for $release_dir. Refusing to continue."
        exit 1
    fi
    while IFS= read -r line; do
        [ -n "$line" ] && files+=("$line")
    done <<< "$file_list"

    if [ "${#files[@]}" -eq 0 ]; then
        log_err "Compose file list came back empty for $release_dir. Refusing to run docker compose with no -f."
        exit 1
    fi
    docker compose \
        --env-file "$DEPLOY_DIR/.env" \
        -p "nexus-$NEXUS_COLOR" \
        "${files[@]}" \
        "$@"
}

container_name() {
    local color="$1"
    local service="$2"
    case "$service" in
        app) echo "nexus-$color-php-app" ;;
        frontend) echo "nexus-$color-react" ;;
        queue) echo "nexus-$color-php-queue" ;;
        scheduler) echo "nexus-$color-php-scheduler" ;;
        webuk) echo "nexus-$color-webuk" ;;
        *)
            log_err "Unknown service: $service"
            return 1
            ;;
    esac
}

wait_for_container_health() {
    local container="$1"
    local deadline=$((SECONDS + 180))
    local grace_until=$((SECONDS + 30))
    local status

    while [ "$SECONDS" -lt "$deadline" ]; do
        status="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container" 2>/dev/null || echo missing)"
        case "$status" in
            healthy|running)
                log_ok "$container is $status"
                return 0
                ;;
            unhealthy|exited|dead)
                # During the first 30s we forgive "unhealthy" — fresh containers
                # often report stale status from before the new instance had a
                # chance to run its first health probe. After grace, treat it
                # as a real failure.
                if [ "$SECONDS" -lt "$grace_until" ]; then
                    sleep 3
                    continue
                fi
                log_err "$container is $status"
                docker logs --tail 80 "$container" 2>/dev/null || true
                return 1
                ;;
            missing)
                # Docker may briefly report missing during a recreate.
                : # fall through to sleep
                ;;
        esac
        sleep 3
    done

    log_err "$container did not become healthy before timeout"
    docker logs --tail 80 "$container" 2>/dev/null || true
    return 1
}

wait_for_color() {
    local color="$1"
    wait_for_container_health "$(container_name "$color" app)"
    wait_for_container_health "$(container_name "$color" frontend)"
    if webuk_enabled; then
        # 🔴 A genuine readiness wait, and it can fail in TWO ways — worth knowing
        # because they point at different causes. Redis unreachable at STARTUP means
        # the process never binds its port (listen is awaited behind the session
        # store), so this fails by connection-refused. Redis lost AFTER a good start
        # means /health answers 503. Either way the container never turns healthy, so
        # this times out and the deploy aborts before the traffic switch.
        wait_for_container_health "$(container_name "$color" webuk)"
    fi
}

prepare_release() {
    phase "Prepare Release Worktree" "${CURRENT_ACTIVE:-}" "${CURRENT_TARGET:-}" "${CURRENT_COMMIT:-}"

    mkdir -p "$RELEASES_DIR"
    git fetch origin main

    local commit release_dir
    commit="$(git rev-parse origin/main)"
    release_dir="$RELEASES_DIR/$commit"

    if [ ! -e "$release_dir/.git" ]; then
        log_info "Creating release worktree: $release_dir"
        git worktree prune
        git worktree add --detach "$release_dir" "$commit"
    else
        log_info "Release worktree already exists: $release_dir"
    fi

    if [ ! -f "$release_dir/compose.bluegreen.yml" ] || [ ! -f "$release_dir/Dockerfile.bluegreen" ]; then
        log_err "Release does not contain blue/green deployment files."
        log_err "Push this deployment upgrade first, then run the blue/green deploy."
        exit 1
    fi

    PREPARED_COMMIT="$commit"
    PREPARED_RELEASE_DIR="$release_dir"
    CURRENT_COMMIT="$commit"
}

color_release_file() {
    local color="$1"
    echo "$DEPLOY_DIR/.bluegreen-$color-release"
}

write_color_release() {
    local color="$1"
    local commit="$2"
    local release_dir="$3"
    printf '%s|%s\n' "$commit" "$release_dir" > "$(color_release_file "$color")"
}

read_color_release() {
    local color="$1"
    local file
    file="$(color_release_file "$color")"
    if [ ! -f "$file" ]; then
        return 1
    fi
    cat "$file"
}

optimize_candidate_laravel() {
    local color="$1"
    local app_container
    app_container="$(container_name "$color" app)"

    phase "Candidate Laravel Cache ($color)" "${CURRENT_ACTIVE:-}" "$color" "${CURRENT_COMMIT:-}"
    repair_laravel_runtime_ownership "$app_container"
    docker_exec_app_user "$app_container" php /var/www/html/artisan config:clear
    docker_exec_app_user "$app_container" php /var/www/html/artisan route:clear
    docker_exec_app_user "$app_container" php /var/www/html/artisan event:clear
    docker_exec_app_user "$app_container" php /var/www/html/artisan view:clear
    docker_exec_app_user "$app_container" php /var/www/html/artisan optimize
    # Signal any already-running workers for this color to gracefully reload
    docker_exec_app_user "$app_container" php /var/www/html/artisan queue:restart 2>/dev/null || true
    docker_exec_app_user "$app_container" php /var/www/html/artisan storage:link || true
    repair_laravel_runtime_ownership "$app_container"
    log_ok "Candidate Laravel caches rebuilt"
}

run_candidate_raw_sql_migrations() {
    # Platform-level raw SQL files live in /var/www/html/migrations/*.sql, not
    # Laravel's database/migrations/. Laravel's `migrate --pretend` gate does
    # not see them, so historically these had to be applied by hand at deploy
    # time. safe_migrate.php tracks applied files via the `migrations` table's
    # migration_name column and runs only the pending ones — same logic, but
    # automated and idempotent.
    #
    # Safe to run on every deploy: if all files are already recorded, this
    # exits in milliseconds with "No pending migrations."
    local color="$1"
    local app_container
    app_container="$(container_name "$color" app)"

    if [ "$LARAVEL_MIGRATE" != "1" ]; then
        return 0
    fi

    log_step "=== Candidate Raw SQL Migrations ($color) ==="

    if ! docker exec "$app_container" test -f /var/www/html/scripts/safe_migrate.php 2>/dev/null; then
        log_info "safe_migrate.php not present in candidate — skipping raw SQL migrations"
        return 0
    fi

    local pending_output
    pending_output="$(docker_exec_app_user "$app_container" php /var/www/html/scripts/safe_migrate.php --pending 2>&1 || true)"
    # safe_migrate.php uses these phrasings interchangeably:
    #   "All migrations are up to date."
    #   "No pending migrations"
    if echo "$pending_output" | grep -qiE 'all migrations are up to date|no pending|all migrations applied'; then
        log_ok "No pending raw SQL migrations"
        return 0
    fi

    log_warn "Pending raw SQL migrations detected; applying with safe_migrate.php"
    log_info "Taking pre-migration database snapshot before legacy raw SQL..."
    if ! db_backup_with_offsite "$app_container"; then
        log_err "Pre-migration backup failed — refusing to run legacy raw SQL migrations"
        return 1
    fi
    MIGRATION_SNAPSHOT_TAKEN=1
    # safe_migrate.php prompts "Type 'yes' to proceed" on PRODUCTION env. The
    # `yes` command emits "y" — wrong answer. Pipe the literal string "yes\n".
    # --skip-backup: mysqldump is not present in the PHP container so the
    # backup step always fails; skip it rather than prompting interactively.
    # Trust the exit code; the runner's output formatting (ANSI colours, box
    # drawing) is unstable for string-matching.
    local migrate_log
    migrate_log="$(docker_exec_app_user "$app_container" sh -c "printf 'yes\\n' | php /var/www/html/scripts/safe_migrate.php --run-pending --skip-backup 2>&1; echo EXIT=\$?" || true)"
    echo "$migrate_log" | tail -40 >&2
    local migrate_exit
    migrate_exit="$(echo "$migrate_log" | awk -F= '/^EXIT=/{print $2}' | tail -1)"
    if [ "${migrate_exit:-1}" -ne 0 ]; then
        log_err "Raw SQL migration run exited with status ${migrate_exit:-?} — aborting before cutover"
        return 1
    fi
    # Sanity check the result by re-querying --pending. If it still reports
    # pending, the runner silently failed (e.g. user-abort from a bad
    # confirmation answer); treat that as a hard failure.
    local post_check
    post_check="$(docker_exec_app_user "$app_container" php /var/www/html/scripts/safe_migrate.php --pending 2>&1 || true)"
    if ! echo "$post_check" | grep -qiE 'all migrations are up to date|no pending|all migrations applied'; then
        log_err "Raw SQL migrations still pending after --run-pending — aborting before cutover"
        return 1
    fi
    log_ok "Raw SQL migrations applied"
}

run_candidate_migrations() {
    local color="$1"
    local app_container
    app_container="$(container_name "$color" app)"

    if [ "$LARAVEL_MIGRATE" != "1" ]; then
        log_info "Skipping database migrations (--no-migrate)"
        return 0
    fi

    # Apply platform-level raw SQL files first (idempotent, see above), then
    # run Laravel's own migrations.
    run_candidate_raw_sql_migrations "$color" || return 1

    log_step "=== Candidate Laravel Migrations ($color) ==="
    write_deploy_status "running" "Candidate Laravel Migrations ($color)" "${CURRENT_ACTIVE:-}" "$color" "${CURRENT_COMMIT:-}"

    # Skip backup + migrate entirely when nothing is pending — no point dumping
    # the DB just to verify the schema is already current.
    local pending
    pending="$(db_pending_migration_count "$app_container")"
    if [ "${pending:-0}" -eq 0 ]; then
        log_ok "No pending migrations — skipping backup and migrate"
        return 0
    fi

    log_warn "$pending pending migration(s) detected. Running expand/contract-safe migrations online."
    if [ "$MIGRATION_SNAPSHOT_TAKEN" != "1" ]; then
        log_info "Taking pre-migration database snapshot..."
        if ! db_backup_with_offsite "$app_container"; then
            log_err "Pre-migration backup failed — aborting migration to prevent unrecoverable data loss"
            return 1
        fi
        MIGRATION_SNAPSHOT_TAKEN=1
    else
        log_ok "Pre-migration snapshot already taken before legacy raw SQL"
    fi

    repair_laravel_runtime_ownership "$app_container"
    docker_exec_app_user "$app_container" php /var/www/html/artisan migrate --force --isolated
    repair_laravel_runtime_ownership "$app_container"

    local pending_after
    pending_after="$(db_pending_migration_count "$app_container")"
    if [ "${pending_after:-0}" -ne 0 ]; then
        log_err "$pending_after migration(s) still pending after migrate --isolated"
        log_err "Another migration runner may have held Laravel's migration lock. Aborting before cutover."
        return 1
    fi

    log_ok "Laravel migrations completed"
}

free_target_color_ports() {
    local color="$1"
    local release_dir="$2"

    log_step "=== Free Inactive Color ($color) ==="
    write_deploy_status "running" "Free Inactive Color ($color)" "${CURRENT_ACTIVE:-}" "$color" "${CURRENT_COMMIT:-}"
    compose_for_release "$release_dir" down --remove-orphans >/dev/null 2>&1 || true

    if [ "$color" = "blue" ]; then
        # First-generation production containers used the blue ports without
        # color names. Once green is active, stop them so blue can be rebuilt.
        docker stop nexus-php-app nexus-react-prod >/dev/null 2>&1 || true
    fi

    log_ok "Inactive $color ports are available"
}

write_apache_routes() {
    local color="$1"
    local api_port frontend_port tmp_file backup_file
    read -r api_port frontend_port < <(ports_for_color "$color")
    tmp_file="$(mktemp)"
    backup_file="$(mktemp)"

    cat > "$tmp_file" <<ROUTES
# Managed by scripts/deploy/bluegreen-deploy.sh
# Active color: $color
Define NEXUS_API_PORT $api_port
Define NEXUS_FRONTEND_PORT $frontend_port
ROUTES

    # 🔴 Only defined when web-uk is deployed. The accessible vhost include
    # wraps its use in <IfDefine NEXUS_WEBUK_PORT> with an <IfDefine !...>
    # fallback to the PHP port, so a ROLLBACK to a release predating web-uk
    # does not reference an undefined variable, fail configtest, and thereby
    # abort the rollback itself.
    if webuk_enabled; then
        printf 'Define NEXUS_WEBUK_PORT %s\n' "$(webuk_port_for_color "$color")" >> "$tmp_file"
    fi

    if [ -f "$APACHE_ROUTES_FILE" ]; then
        cp "$APACHE_ROUTES_FILE" "$backup_file"
    else
        : > "$backup_file"
    fi

    install -m 0644 "$tmp_file" "$APACHE_ROUTES_FILE"
    rm -f "$tmp_file"

    log_info "Testing Apache configuration..."
    write_deploy_status "running" "Apache configtest for $color" "${CURRENT_ACTIVE:-}" "$color" "${CURRENT_COMMIT:-}"
    if ! bash -lc "$APACHE_CONFIGTEST"; then
        log_err "Apache configtest failed; restoring previous route file"
        if [ -s "$backup_file" ]; then
            install -m 0644 "$backup_file" "$APACHE_ROUTES_FILE"
        else
            rm -f "$APACHE_ROUTES_FILE"
        fi
        rm -f "$backup_file"
        return 1
    fi
    log_info "Gracefully reloading Apache..."
    write_deploy_status "running" "Apache graceful reload to $color" "${CURRENT_ACTIVE:-}" "$color" "${CURRENT_COMMIT:-}"
    if ! bash -lc "$APACHE_RELOAD"; then
        log_err "Apache reload failed; restoring previous route file"
        if [ -s "$backup_file" ]; then
            install -m 0644 "$backup_file" "$APACHE_ROUTES_FILE"
            bash -lc "$APACHE_CONFIGTEST" >/dev/null 2>&1 || true
        else
            rm -f "$APACHE_ROUTES_FILE"
        fi
        rm -f "$backup_file"
        return 1
    fi
    rm -f "$backup_file"

    echo "$color" > "$STATE_FILE"
    log_ok "Traffic switched to $color ($api_port/$frontend_port)"
}

smoke_color() {
    local color="$1"
    local api_port frontend_port html bootstrap
    read -r api_port frontend_port < <(ports_for_color "$color")

    log_step "=== Candidate Smoke Tests ($color) ==="
    write_deploy_status "running" "Candidate Smoke Tests ($color)" "${CURRENT_ACTIVE:-}" "$color" "${CURRENT_COMMIT:-}"

    curl -sf "http://127.0.0.1:$api_port/up" >/dev/null
    log_ok "API health passed on $api_port"

    bootstrap="$(curl -sf -H "X-Tenant-Slug: hour-timebank" "http://127.0.0.1:$api_port/api/v2/tenant/bootstrap" || true)"
    if ! echo "$bootstrap" | grep -q '"hour-timebank"'; then
        log_err "Tenant bootstrap failed on candidate API"
        return 1
    fi
    log_ok "Tenant bootstrap passed"

    local webauthn_challenge
    webauthn_challenge="$(curl -sf -X POST "http://127.0.0.1:$api_port/api/webauthn/auth-challenge" \
        -H 'Host: api.project-nexus.ie' \
        -H 'Origin: https://hour-timebank.ie' \
        -H 'X-Tenant-Slug: hour-timebank' \
        -H 'Accept: application/json' \
        -H 'Content-Type: application/json' \
        --data '{}' || true)"
    if ! echo "$webauthn_challenge" | grep -q '"challenge_id"'; then
        log_err "WebAuthn auth challenge failed on candidate API"
        return 1
    fi
    log_ok "WebAuthn auth challenge passed"

    html="$(curl -sf "http://127.0.0.1:$frontend_port/" || true)"
    if ! echo "$html" | grep -q 'id="root"'; then
        log_err "Frontend did not serve the React root"
        return 1
    fi
    log_ok "Frontend passed on $frontend_port"

    if webuk_enabled; then
        local webuk_port webuk_version
        webuk_port="$(webuk_port_for_color "$color")"

        if ! curl -sf "http://127.0.0.1:$webuk_port/health" | grep -q 'OK'; then
            # 🔴 This said "503 means the Redis session store is not ready" and sent
            # an operator hunting for a response that never comes. Measured in the
            # local rehearsal: with Redis unreachable the process never listens at
            # all, so the real symptom is CONNECTION REFUSED.
            log_err "web-uk health failed on $webuk_port."
            log_err "Connection refused usually means it never started listening — most often the"
            log_err "Redis session store is unreachable (WEBUK_SESSION_REDIS_URL). Check:"
            log_err "  docker logs $(container_name "$color" webuk) --tail 50"
            return 1
        fi
        log_ok "web-uk health passed on $webuk_port"

        # 🔴 Identity, not just liveness. This is the ONLY way to prove the
        # candidate is web-uk at the expected release rather than something else
        # answering on that port.
        webuk_version="$(curl -sf "http://127.0.0.1:$webuk_port/version" || true)"
        if ! echo "$webuk_version" | grep -q '"service":"nexus-webuk"'; then
            log_err "web-uk /version did not identify itself as nexus-webuk on $webuk_port"
            return 1
        fi
        if ! echo "$webuk_version" | grep -q "\"color\":\"$color\""; then
            log_err "web-uk /version reports the wrong colour on $webuk_port (expected $color)"
            log_err "Response: $webuk_version"
            return 1
        fi
        log_ok "web-uk identity passed: nexus-webuk, colour $color"

        # A real page, so a broken template or missing locale catalogue fails the
        # gate rather than reaching members.
        #
        # 🔴 RETRIED, and the reason is measured rather than assumed. On 2026-08-12
        # this check failed a deploy while web-uk was genuinely fine: the same URL
        # returned 200 with 24 KB and 189 `govuk` matches a minute later.
        #
        # The cause is that web-uk's readiness and web-uk's USEFULNESS are different
        # things. Its healthcheck only proves the Redis session store connected — so
        # the container reports "healthy" seconds after starting, while its first
        # request still has to dial the same-colour Laravel container, resolve the
        # tenant, and compile Nunjucks templates for the first time. A single-shot
        # curl against a cold Node process races that.
        #
        # A bounded retry is the honest fix: it still fails a genuinely broken build,
        # it just stops failing a working one. It does NOT paper over a real fault —
        # 30 seconds is far longer than a warm render, so a page that never appears
        # still aborts the deploy before the traffic switch.
        local webuk_page_ok=0 webuk_status="" webuk_body=""
        for attempt in $(seq 1 10); do
            webuk_status="$(curl -s -o /tmp/webuk-smoke.html -w '%{http_code}' \
                "http://127.0.0.1:$webuk_port/hour-timebank/accessible/" 2>/dev/null || echo 000)"
            if [ "$webuk_status" = "200" ] && grep -q 'govuk' /tmp/webuk-smoke.html 2>/dev/null; then
                webuk_page_ok=1
                [ "$attempt" -gt 1 ] && log_info "web-uk page rendered on attempt $attempt"
                break
            fi
            sleep 3
        done

        if [ "$webuk_page_ok" != "1" ]; then
            # 🔴 Say WHY. The previous message was "did not render an accessible page"
            # and nothing else, because `curl -sf` prints nothing on an error status —
            # so the log could not distinguish "Laravel unreachable" from "template
            # broken" from "wrong tenant". Both are one-line fixes to diagnose now.
            webuk_body="$(head -c 300 /tmp/webuk-smoke.html 2>/dev/null || true)"
            log_err "web-uk did not render an accessible page on $webuk_port after 10 attempts (~30s)"
            log_err "Last HTTP status: ${webuk_status:-none}"
            log_err "First 300 bytes of the response:"
            printf '%s\n' "$webuk_body" | sed 's/^/    /'
            log_err "Check: docker logs $(container_name "$color" webuk) --tail 50"
            rm -f /tmp/webuk-smoke.html
            return 1
        fi
        rm -f /tmp/webuk-smoke.html
        log_ok "web-uk rendered an accessible page"
    fi
}

deploy_candidate() {
    local color="$1"
    local release_dir="$2"
    local commit="$3"
    local api_port frontend_port
    read -r api_port frontend_port < <(ports_for_color "$color")

    phase "Build Candidate ($color)" "${CURRENT_ACTIVE:-}" "$color" "$commit"
    log_info "Release: ${commit:0:12}"
    log_info "Inactive ports: API=$api_port frontend=$frontend_port"
    # 🔴 Stated explicitly, both ways. The whole defect this replaces was that
    # web-uk's ABSENCE was silent, so the log must answer "was it included?"
    # without anyone having to infer it from what is missing.
    if webuk_enabled; then
        log_info "web-uk: INCLUDED in this deploy (port $(webuk_port_for_color "$color"))"
    else
        log_info "web-uk: NOT included (pass --with-webuk to include it)"
    fi

    export NEXUS_COLOR="$color"
    export NEXUS_API_PORT="$api_port"
    export NEXUS_FRONTEND_PORT="$frontend_port"
    if webuk_enabled; then
        NEXUS_WEBUK_PORT="$(webuk_port_for_color "$color")"
        export NEXUS_WEBUK_PORT
    fi
    export NEXUS_ENV_FILE="$DEPLOY_DIR/.env"
    export BUILD_COMMIT="${commit:0:12}"

    free_target_color_ports "$color" "$release_dir"

    # Stage CHANGELOG.md into react-frontend/ so it's inside the Docker build
    # context (compose.bluegreen.yml uses `context: ./react-frontend`, which
    # excludes the repo-root CHANGELOG.md by default). The in-app /changelog
    # page renders this file at runtime; copy-changelog.mjs picks it up here.
    if [ -f "$release_dir/CHANGELOG.md" ]; then
        cp "$release_dir/CHANGELOG.md" "$release_dir/react-frontend/CHANGELOG.md"
        log_info "Staged CHANGELOG.md into react-frontend/ for in-app /changelog"
    fi

    local -a services=(app frontend)
    if webuk_enabled; then
        services+=(webuk)
        log_info "web-uk ENABLED for this deploy: port=$(webuk_port_for_color "$color")"
    fi

    compose_for_release "$release_dir" build --no-cache "${services[@]}"
    compose_for_release "$release_dir" up -d --no-build "${services[@]}"
    wait_for_color "$color"
    optimize_candidate_laravel "$color"
    verify_candidate_images "$color"
    write_candidate_build_version "$color" "$release_dir" "$commit"
    check_candidate_migration_safety "$color" "$release_dir"
    run_candidate_migrations "$color"
    verify_candidate_build_version "$color"
}

verify_candidate_images() {
    local color="$1"
    phase "Candidate Image Verification ($color)" "${CURRENT_ACTIVE:-}" "$color" "${CURRENT_COMMIT:-}"
    NEXUS_VERIFY_COLOR="$color" BUILD_COMMIT="${CURRENT_COMMIT:0:12}" \
        bash "$SELF_DIR/phases/verify-images.sh"
}

write_candidate_build_version() {
    local color="$1"
    local release_dir="$2"
    local commit="$3"
    phase "Bake Build Version ($color)" "${CURRENT_ACTIVE:-}" "$color" "${CURRENT_COMMIT:-}"
    NEXUS_BUILD_VERSION_COLOR="$color" \
    NEXUS_BUILD_VERSION_RELEASE_DIR="$release_dir" \
    NEXUS_BUILD_VERSION_COMMIT="$commit" \
    NEXUS_BUILD_VERSION_UPDATE_LAST_DEPLOY=0 \
    MODE=bluegreen \
        bash "$SELF_DIR/phases/write-build-version.sh"
}

check_candidate_migration_safety() {
    local color="$1"
    local release_dir="$2"
    phase "Migration Safety Gate ($color)" "${CURRENT_ACTIVE:-}" "$color" "${CURRENT_COMMIT:-}"
    NEXUS_RELEASE_DIR="$release_dir" \
    NEXUS_CANDIDATE_CONTAINER="$(container_name "$color" app)" \
        bash "$SELF_DIR/phases/check-migration-safety.sh"
}

# Hits the candidate's local API port directly (bypassing Apache + Cloudflare)
# and asserts /version.php returns the commit we just built. Catches the case
# where the right image was tagged but a stale layer was reused.
verify_candidate_build_version() {
    local color="$1"
    local api_port _
    read -r api_port _ < <(ports_for_color "$color")
    phase "Verify Candidate Build Version ($color)" "${CURRENT_ACTIVE:-}" "$color" "${CURRENT_COMMIT:-}"
    local response served_commit
    response="$(curl -sf "http://127.0.0.1:$api_port/version.php" 2>/dev/null || true)"
    if [ -z "$response" ]; then
        log_err "Candidate /version.php did not respond on port $api_port"
        return 1
    fi
    served_commit="$(echo "$response" | sed -n 's/.*"commit"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"
    if [ "$served_commit" != "$CURRENT_COMMIT" ]; then
        log_err "Candidate served commit '$served_commit' but expected '$CURRENT_COMMIT'"
        log_err "The image was built or tagged with the wrong commit. Aborting before cutover."
        return 1
    fi
    log_ok "Candidate /version.php confirms commit $served_commit"
}

wait_for_container_stopped() {
    local container="$1"
    local timeout_s="${2:-180}"
    local deadline=$((SECONDS + timeout_s))
    local status

    while [ "$SECONDS" -lt "$deadline" ]; do
        status="$(docker inspect -f '{{.State.Status}}' "$container" 2>/dev/null || echo missing)"
        case "$status" in
            exited|dead|created|missing)
                log_ok "$container is stopped"
                return 0
                ;;
        esac
        sleep 3
    done

    log_warn "$container did not stop within ${timeout_s}s"
    return 1
}

terminate_horizon_container() {
    local container="$1"
    local output

    # Horizon records the root-owned PID 1 in Redis and horizon:terminate uses
    # posix_kill() against that PID from inside the container. Running this via
    # docker_exec_app_user (www-data) cannot signal the root-owned process; the
    # command prints "Failed to kill process" but still exits zero. Execute this
    # one process-control command as the container's default/root user and treat
    # Horizon's soft failure message as a real failure.
    if ! output="$(docker exec "$container" php /var/www/html/artisan horizon:terminate 2>&1)"; then
        log_warn "horizon:terminate command failed in $container"
        [ -n "$output" ] && printf '%s\n' "$output" >&2
        return 1
    fi

    if printf '%s\n' "$output" | grep -q 'Failed to kill process'; then
        log_warn "Horizon could not signal its master process in $container"
        printf '%s\n' "$output" >&2
        return 1
    fi

    return 0
}

start_worker_services_for_color() {
    local color="$1"
    local release_dir="$2"
    local commit="$3"
    shift 3
    local services=("$@")
    local api_port frontend_port
    read -r api_port frontend_port < <(ports_for_color "$color")

    export NEXUS_COLOR="$color"
    export NEXUS_API_PORT="$api_port"
    export NEXUS_FRONTEND_PORT="$frontend_port"
    if webuk_enabled; then
        NEXUS_WEBUK_PORT="$(webuk_port_for_color "$color")"
        export NEXUS_WEBUK_PORT
    fi
    export NEXUS_ENV_FILE="$DEPLOY_DIR/.env"
    export BUILD_COMMIT="${commit:0:12}"

    phase "Start Workers ($color: ${services[*]})" "${CURRENT_ACTIVE:-}" "$color" "$commit"

    # Remove any stale worker containers (e.g. left in Exited state by a prior
    # aborted deploy or built against an image tag that no longer exists).
    # `compose up -d` won't recreate a container that's just stopped — it tries
    # to `docker start` it, which fails if the image is gone, leaving a stuck
    # "Exited" container that blocks the new one. `docker rm -f` is idempotent.
    local service
    for service in "${services[@]}"; do
        docker rm -f "$(container_name "$color" "$service")" >/dev/null 2>&1 || true
    done

    # --force-recreate guarantees a clean container even if compose decides the
    # config is unchanged. Without it, an existing healthy-but-stale container
    # could be reused.
    compose_for_release "$release_dir" up -d --force-recreate "${services[@]}"
    for service in "${services[@]}"; do
        wait_for_container_health "$(container_name "$color" "$service")"
    done
    log_ok "Worker services are healthy for $color: ${services[*]}"
}

start_queue_for_color() {
    start_worker_services_for_color "$1" "$2" "$3" queue
}

start_scheduler_for_color() {
    start_worker_services_for_color "$1" "$2" "$3" scheduler
}

start_workers_for_color() {
    start_worker_services_for_color "$1" "$2" "$3" queue scheduler
}

restart_existing_workers_for_color() {
    local color="$1"
    local queue scheduler
    local saw_color_container=0
    queue="$(container_name "$color" queue)"
    scheduler="$(container_name "$color" scheduler)"

    phase "Restart Workers ($color)" "${CURRENT_ACTIVE:-}" "${CURRENT_TARGET:-}" "${CURRENT_COMMIT:-}"

    if docker ps -a --format '{{.Names}}' | grep -qx "$queue"; then
        saw_color_container=1
        docker update --restart=unless-stopped "$queue" >/dev/null 2>&1 || true
        docker start "$queue" >/dev/null 2>&1 || true
    fi
    if docker ps -a --format '{{.Names}}' | grep -qx "$scheduler"; then
        saw_color_container=1
        docker update --restart=unless-stopped "$scheduler" >/dev/null 2>&1 || true
        docker start "$scheduler" >/dev/null 2>&1 || true
    fi

    if [ "$saw_color_container" = "0" ]; then
        # Legacy single-color names from before blue/green.
        docker update --restart=unless-stopped nexus-php-queue nexus-php-scheduler >/dev/null 2>&1 || true
        docker start nexus-php-queue nexus-php-scheduler >/dev/null 2>&1 || true
    fi

    log_ok "Existing workers restarted for $color where available"
}

stop_queue_for_color() {
    local color="$1"
    local queue
    queue="$(container_name "$color" queue)"

    if ! docker ps -a --format '{{.Names}}' | grep -qx "$queue"; then
        return 0
    fi

    docker update --restart=no "$queue" >/dev/null 2>&1 || true
    if docker ps --format '{{.Names}}' | grep -qx "$queue"; then
        log_info "Gracefully terminating Horizon in $queue"
        if terminate_horizon_container "$queue"; then
            wait_for_container_stopped "$queue" 120 || docker stop -t 120 "$queue" >/dev/null 2>&1 || true
        else
            log_warn "Falling back to Docker's graceful stop for $queue"
            docker stop -t 120 "$queue" >/dev/null 2>&1 || true
        fi
    fi
}

stop_scheduler_for_color() {
    local color="$1"
    local scheduler
    scheduler="$(container_name "$color" scheduler)"

    if ! docker ps -a --format '{{.Names}}' | grep -qx "$scheduler"; then
        return 0
    fi

    docker update --restart=no "$scheduler" >/dev/null 2>&1 || true
    if docker ps --format '{{.Names}}' | grep -qx "$scheduler"; then
        docker_exec_app_user "$scheduler" php /var/www/html/artisan schedule:interrupt >/dev/null 2>&1 || true
        docker stop -t 90 "$scheduler" >/dev/null 2>&1 || true
    fi
}

stop_workers_for_color() {
    local color="$1"
    phase "Stop Old Workers ($color)" "${CURRENT_ACTIVE:-}" "${CURRENT_TARGET:-}" "${CURRENT_COMMIT:-}"
    stop_queue_for_color "$color"
    stop_scheduler_for_color "$color"
    # Legacy single-color names from before blue/green
    docker update --restart=no nexus-php-queue nexus-php-scheduler >/dev/null 2>&1 || true
    if docker ps --format '{{.Names}}' | grep -qx "nexus-php-queue"; then
        if terminate_horizon_container nexus-php-queue; then
            wait_for_container_stopped nexus-php-queue 120 || docker stop -t 120 nexus-php-queue >/dev/null 2>&1 || true
        else
            docker stop -t 120 nexus-php-queue >/dev/null 2>&1 || true
        fi
    fi
    if docker ps --format '{{.Names}}' | grep -qx "nexus-php-scheduler"; then
        docker_exec_app_user nexus-php-scheduler php /var/www/html/artisan schedule:interrupt >/dev/null 2>&1 || true
        docker stop -t 90 nexus-php-scheduler >/dev/null 2>&1 || true
    fi
    log_ok "Old workers stopped"
}

post_cutover_smoke() {
    phase "Public Post-Cutover Smoke Tests" "${CURRENT_ACTIVE:-}" "${CURRENT_TARGET:-}" "${CURRENT_COMMIT:-}"

    curl -sf https://api.project-nexus.ie/up >/dev/null
    log_ok "Public API health passed"

    # CRITICAL: prove the cutover is real. Without this, a misconfigured Apache
    # include or a Cloudflare cache hit can keep the OLD color live and every
    # other smoke test still passes. Compare the live commit to CURRENT_COMMIT.
    local response served_commit
    # Cache-Control: no-store on /version.php is set by httpdocs/version.php, but
    # add a no-cache header anyway in case Cloudflare edge ignores it.
    response="$(curl -sf -H 'Cache-Control: no-cache' -H 'Pragma: no-cache' \
        "https://api.project-nexus.ie/version.php?_t=$(date +%s)" 2>/dev/null || true)"
    if [ -z "$response" ]; then
        log_err "Public /version.php did not respond"
        return 1
    fi
    served_commit="$(echo "$response" | sed -n 's/.*"commit"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"
    if [ "$served_commit" != "$CURRENT_COMMIT" ]; then
        log_err "Public API serves commit '$served_commit' but cutover targeted '$CURRENT_COMMIT'"
        log_err "Apache route file may not have switched, or Cloudflare is caching /version.php."
        return 1
    fi
    log_ok "Public /version.php confirms live commit is $served_commit"

    # 🔴 The equivalent proof for the accessible frontend, and the reason
    # web-uk needed a /version at all. Without it, a vhost that was never
    # switched keeps serving the Blade accessible frontend at HTTP 200 and every
    # other check here still passes — the failure is invisible.
    if webuk_enabled; then
        local accessible_version
        accessible_version="$(curl -sf -H 'Cache-Control: no-cache' \
            "https://accessible.project-nexus.ie/version?_t=$(date +%s)" 2>/dev/null || true)"
        if [ -z "$accessible_version" ]; then
            # 🔴 THIS ARM USED TO PASS UNCONDITIONALLY, AND THAT MADE THE WHOLE CHECK
            # USELESS FOR ITS OWN PURPOSE. Blade does not serve /version at all — so
            # "the hostname silently fell back to Blade", the exact scenario /version
            # was invented to detect, produces an empty response and landed here.
            #
            # Before the first confirmed cutover, empty genuinely is expected: no
            # vhost include exists yet. After it, empty means the frontend that was
            # serving members is gone. The marker is what tells the two apart.
            if [ -f "$WEBUK_LIVE_MARKER" ]; then
                log_err "https://accessible.project-nexus.ie/version did NOT respond, and web-uk is LIVE."
                log_err "Marker: $WEBUK_LIVE_MARKER"
                log_err ""
                log_err "Blade does not serve /version, so silence is the signature of a"
                log_err "fallback to Blade — not of a missing vhost. Most likely the Apache"
                log_err "routes file lost Define NEXUS_WEBUK_PORT, or the web-uk container"
                log_err "is not running on the active colour."
                return 1
            fi
            log_warn "Public accessible /version did not respond."
            log_warn "Expected while the vhost include has not been installed yet (cutover step 2)."
            log_warn "Once a hostname is confirmed served by web-uk, this becomes a hard failure."
        elif ! echo "$accessible_version" | grep -q '"service":"nexus-webuk"'; then
            log_err "https://accessible.project-nexus.ie is NOT served by web-uk."
            log_err "It is most likely still served by the Blade accessible frontend."
            log_err "Response: $accessible_version"
            return 1
        else
            log_ok "Public accessible host confirmed as web-uk"
            # 🔴 First confirmation LATCHES. From here on, a flagless deploy refuses
            # rather than silently dropping web-uk, and an empty /version is a hard
            # failure rather than "not cut over yet". Written only on a positive
            # observation of a real public hostname — never inferred from a flag.
            if [ ! -f "$WEBUK_LIVE_MARKER" ]; then
                if printf 'confirmed_at=%s\nhost=accessible.project-nexus.ie\ncommit=%s\n' \
                    "$(date -Iseconds)" "${BUILD_COMMIT:-unknown}" > "$WEBUK_LIVE_MARKER" 2>/dev/null; then
                    log_ok "web-uk recorded as LIVE ($WEBUK_LIVE_MARKER)"
                    log_info "Future deploys must pass --with-webuk, or refuse."
                else
                    # Not fatal: the cutover itself succeeded. But say so loudly,
                    # because without the marker the protections above stay dormant.
                    log_warn "Could not write $WEBUK_LIVE_MARKER — the live-marker protections are NOT armed."
                fi
            fi
        fi
    fi

    local bootstrap
    bootstrap="$(curl -sf -H "X-Tenant-Slug: hour-timebank" https://api.project-nexus.ie/api/v2/tenant/bootstrap || true)"
    if ! echo "$bootstrap" | grep -q '"hour-timebank"'; then
        log_err "Public tenant bootstrap failed"
        return 1
    fi
    log_ok "Public tenant bootstrap passed"

    local webauthn_challenge
    webauthn_challenge="$(curl -sf -X POST https://api.project-nexus.ie/api/webauthn/auth-challenge \
        -H 'Origin: https://hour-timebank.ie' \
        -H 'X-Tenant-Slug: hour-timebank' \
        -H 'Accept: application/json' \
        -H 'Content-Type: application/json' \
        --data '{}' || true)"
    if ! echo "$webauthn_challenge" | grep -q '"challenge_id"'; then
        log_err "Public WebAuthn auth challenge failed"
        return 1
    fi
    log_ok "Public WebAuthn auth challenge passed"

    curl -sf https://app.project-nexus.ie/ >/dev/null
    log_ok "Public React frontend passed"
}

run_prerender_for_color() {
    local color="$1"
    local release_dir="$2"
    local frontend_container
    frontend_container="$(container_name "$color" frontend)"

    if [ "$SKIP_PRERENDER" = "1" ]; then
        log_info "Skipping per-tenant pre-rendering (--skip-prerender set)"
        return 0
    fi

    phase "Per-Tenant Pre-Rendering ($color)" "${CURRENT_ACTIVE:-}" "$color" "${CURRENT_COMMIT:-}"

    if [ ! -f "$release_dir/scripts/deploy/phases/prerender-tenants.sh" ]; then
        log_warn "Pre-render phase not found; run manually if needed"
        return 0
    fi

    export PRERENDER_BASE_COMMIT="${PRERENDER_BASE_COMMIT:-}"
    if [ -z "$PRERENDER_BASE_COMMIT" ] && [ -f "$LAST_PRERENDER_FILE" ]; then
        PRERENDER_BASE_COMMIT="$(cat "$LAST_PRERENDER_FILE" 2>/dev/null || true)"
    elif [ -z "$PRERENDER_BASE_COMMIT" ] && [ -f "$LAST_DEPLOY_FILE" ]; then
        PRERENDER_BASE_COMMIT="$(cat "$LAST_DEPLOY_FILE" 2>/dev/null || true)"
    fi

    FRONTEND_CONTAINER="$frontend_container" \
    NGINX_CONTAINER="$frontend_container" \
    PRERENDER_DEPLOY_DIR="$release_dir" \
    PRERENDER_CODE_DIR="$release_dir" \
    PRERENDER_CONFIG_DIR="$DEPLOY_DIR" \
    FORCE_PRERENDER="$FORCE_PRERENDER" \
    PRERENDER_TENANT="$PRERENDER_TENANT" \
    PRERENDER_ROUTES="$PRERENDER_ROUTES" \
    bash "$release_dir/scripts/deploy/phases/prerender-tenants.sh" || true
}

run_script_with_log() {
    local script="$1"
    shift || true

    if [ -n "${__NEXUS_DEPLOY_DETACHED__:-}" ] || [ -n "${__NEXUS_BLUEGREEN_DETACHED__:-}" ]; then
        bash "$script" "$@"
    else
        bash "$script" "$@" 2>&1 | tee -a "$LOG_FILE"
    fi
}

purge_cloudflare_cache() {
    local label="$1"

    if [ -f "$DEPLOY_DIR/scripts/deploy/phases/purge-cloudflare.sh" ]; then
        phase "$label" "${CURRENT_ACTIVE:-}" "${CURRENT_TARGET:-}" "${CURRENT_COMMIT:-}"
        run_script_with_log "$DEPLOY_DIR/scripts/deploy/phases/purge-cloudflare.sh" || \
            log_warn "Cloudflare purge had errors — run manually: sudo bash scripts/purge-cloudflare-cache.sh"
    else
        log_warn "purge-cloudflare.sh phase not found — Cloudflare cache NOT purged"
    fi
}

schedule_followup_health_check() {
    if [ -f "$DEPLOY_DIR/scripts/deploy/phases/schedule-health-check.sh" ]; then
        bash "$DEPLOY_DIR/scripts/deploy/phases/schedule-health-check.sh" || true
    fi
}

cmd_status() {
    local active api_port frontend_port
    active="$(read_active_color)"
    read -r api_port frontend_port < <(ports_for_color "$active")
    log_info "Active color: $active"
    log_info "Active ports: API=$api_port frontend=$frontend_port"
    # 🔴 `status` is the one command an operator runs to ask "is web-uk live?", and it
    # used to answer from THIS invocation's flag — which `status` is never given. So
    # after a successful cutover it reported "not enabled" while web-uk was serving
    # members. Report the recorded fact and the observed container, not the flag.
    local webuk_port webuk_state
    webuk_port="$(webuk_port_for_color "$active")"
    webuk_state="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' \
        "$(container_name "$active" webuk)" 2>/dev/null || echo missing)"

    if [ -f "$WEBUK_LIVE_MARKER" ]; then
        log_info "web-uk: LIVE (confirmed serving a public hostname) port=$webuk_port container=$webuk_state"
        sed -n '1,5p' "$WEBUK_LIVE_MARKER" 2>/dev/null || true
        if [ "$webuk_state" = "missing" ]; then
            log_err "web-uk is recorded as LIVE but no container exists on the active colour ($active)."
            log_err "The accessible hostnames are very likely being served by Blade right now."
        fi
    elif webuk_enabled; then
        log_info "web-uk: included in this invocation, not yet confirmed live. port=$webuk_port container=$webuk_state"
    elif [ "$webuk_state" != "missing" ]; then
        # Running but never confirmed on a public hostname — the deliberate state
        # during rehearsal, when it is deployed with nothing routed to it.
        log_info "web-uk: running but routed nowhere (rehearsal state). port=$webuk_port container=$webuk_state"
    else
        log_info "web-uk: not deployed (pass --with-webuk to include it)"
    fi
    if [ -f "$STATUS_FILE" ]; then
        log_info "Latest deployment status:"
        sed -n '1,20p' "$STATUS_FILE"
    else
        log_warn "No blue/green deployment status file yet"
    fi
    if [ -n "$APACHE_ROUTES_FILE" ] && [ -f "$APACHE_ROUTES_FILE" ]; then
        log_info "Apache route file: $APACHE_ROUTES_FILE"
        sed -n '1,20p' "$APACHE_ROUTES_FILE"
    else
        log_warn "NEXUS_APACHE_ROUTES_FILE not configured or file does not exist"
    fi
}

latest_log_path() {
    if [ -f "$LATEST_LOG_FILE" ]; then
        cat "$LATEST_LOG_FILE"
    else
        ls -t "$LOG_DIR"/bluegreen-deploy-*.log 2>/dev/null | head -n 1 || true
    fi
}

cmd_logs() {
    local follow="${1:-}"
    local log_path
    log_path="$(latest_log_path)"
    if [ -z "$log_path" ] || [ ! -f "$log_path" ]; then
        log_err "No blue/green deploy log found"
        exit 1
    fi

    log_info "Log: $log_path"
    if [ "$follow" = "-f" ] || [ "$follow" = "--follow" ]; then
        tail -n 80 -f "$log_path"
    else
        tail -n 120 "$log_path"
    fi
}

cmd_monitor() {
    local log_path status
    while true; do
        echo ""
        echo "===== Project NEXUS Blue/Green Deploy Monitor $(date -Iseconds) ====="
        if [ -f "$STATUS_FILE" ]; then
            cat "$STATUS_FILE"
            status="$(grep '^status=' "$STATUS_FILE" | cut -d= -f2- || true)"
        else
            echo "status=unknown"
            status="unknown"
        fi

        echo ""
        echo "Containers:"
        docker ps --format '{{.Names}}\t{{.Status}}' | grep -E 'nexus-(blue|green)|nexus-php-(db|redis)|nexus-meilisearch' || true

        log_path="$(latest_log_path)"
        if [ -n "$log_path" ] && [ -f "$log_path" ]; then
            echo ""
            echo "Recent log lines: $log_path"
            tail -n 18 "$log_path"
        fi

        case "$status" in
            success|failed)
                exit 0
                ;;
        esac
        sleep 5
    done
}

cmd_deploy() {
    DEPLOY_START_TS="$(date +%s)"
    CURRENT_SUBCOMMAND="deploy"
    CURRENT_PREV_COMMIT="$(cat "$LAST_DEPLOY_FILE" 2>/dev/null || echo "")"
    require_route_switching
    state_init
    state_set DEPLOY_SUCCESS 0
    state_set MAINTENANCE_ENABLED_BY_US 0
    check_lock
    create_lock
    # Translate signals into non-zero exits BEFORE the EXIT trap captures $?.
    # Without this, `kill <pid>` on a deploy that's mid-sleep causes $? to be
    # the sleep's 0, so the EXIT trap mis-records the run as "success".
    trap 'log_warn "Deploy received signal — aborting"; exit 143' TERM INT HUP
    trap deploy_exit_trap EXIT

    # Validate environment before doing anything irreversible
    . "$SELF_DIR/phases/validate-env.sh"
    validate_required_env_vars
    validate_dockerfiles

    local active target commit release_dir release_meta
    active="$(read_active_color)"
    target="$(inactive_color "$active")"
    CURRENT_ACTIVE="$active"
    CURRENT_TARGET="$target"

    log_info "Current active color: $active"
    log_info "Deploy target color: $target"
    write_deploy_status "running" "starting deploy" "$active" "$target" ""

    prepare_release
    commit="$PREPARED_COMMIT"
    release_dir="$PREPARED_RELEASE_DIR"
    CURRENT_COMMIT="$commit"

    deploy_candidate "$target" "$release_dir" "$commit"
    smoke_color "$target"

    # Journey gate: run the proven @smoke browser journeys against the freshly
    # built candidate BEFORE touching workers or switching traffic. If a core
    # user journey is broken on this build, abort now — the active color $active
    # and its workers are completely untouched, so live users see nothing. The
    # gate self-skips (warn, pass) until E2E_GATE_USER_* creds are set in .env,
    # so it never surprise-blocks a deploy before it is explicitly configured.
    if [ -f "$SELF_DIR/phases/candidate-journeys.sh" ]; then
        read -r _gate_api_port _gate_frontend_port < <(ports_for_color "$target")
        if ! bash "$SELF_DIR/phases/candidate-journeys.sh" "$_gate_api_port" "$_gate_frontend_port" "$target"; then
            log_err "Candidate journey gate failed — aborting before cutover. Active color $active is unaffected."
            write_deploy_status "failed" "candidate journey gate failed" "$active" "$target" "$commit"
            stop_workers_for_color "$target"
            exit 1
        fi
    fi

    # Drain active workers before starting target workers. Queue jobs may wait
    # briefly in Redis, but Horizon shuts down gracefully and the scheduler never
    # runs in both colors at once. The target scheduler starts only after public
    # smoke passes so inactive code does not run scheduled tasks.
    stop_workers_for_color "$active"
    if ! start_queue_for_color "$target" "$release_dir" "$commit"; then
        log_err "Could not start $target queue — aborting before web cutover. Active color $active is unaffected."
        stop_workers_for_color "$target"
        restart_existing_workers_for_color "$active"
        exit 1
    fi

    # Pre-cutover snapshot warmup: copy existing prerendered HTML from the
    # currently-active color into the target color so bots see continuity at
    # the moment of traffic switch instead of falling back to the SPA shell
    # while the detached post-cutover prerender catches up. This is also the
    # shared status-map handoff; failure must stop the cutover.
    if [ "$SKIP_PRERENDER" != "1" ] && [ -f "$SELF_DIR/phases/warmup-prerender-snapshots.sh" ]; then
        phase "Pre-Cutover Snapshot Warmup" "$active" "$target" "$commit"
        if ! ACTIVE_COLOR="$active" TARGET_COLOR="$target" \
            bash "$SELF_DIR/phases/warmup-prerender-snapshots.sh"; then
            log_err "Prerender snapshot/status handoff failed; aborting before cutover"
            stop_workers_for_color "$target"
            restart_existing_workers_for_color "$active"
            exit 1
        fi
    fi

    write_apache_routes "$target"
    if ! post_cutover_smoke; then
        log_err "Public smoke failed after cutover; reverting traffic to $active"
        write_apache_routes "$active"
        stop_workers_for_color "$target"
        restart_existing_workers_for_color "$active"
        exit 1
    fi

    if ! start_scheduler_for_color "$target" "$release_dir" "$commit"; then
        log_err "Could not start $target scheduler after cutover; reverting traffic to $active"
        write_apache_routes "$active"
        stop_workers_for_color "$target"
        restart_existing_workers_for_color "$active"
        exit 1
    fi

    # Purge once after traffic switch so the prerender worker and users do not
    # keep seeing old edge responses while the new color is active.
    purge_cloudflare_cache "Cloudflare Cache Purge"
    write_color_release "$target" "$commit" "$release_dir"

    # Install/refresh the host cron for the prerender job processor. Without
    # this, prerender_jobs rows queued by observers/scheduler sit forever
    # because only the host can docker-exec the worker.
    if [ -f "$SELF_DIR/phases/install-prerender-cron.sh" ]; then
        phase "Install Prerender Cron" "${CURRENT_ACTIVE:-}" "${CURRENT_TARGET:-}" "${CURRENT_COMMIT:-}"
        bash "$SELF_DIR/phases/install-prerender-cron.sh" || \
            log_warn "Prerender cron install had errors — jobs may not drain"
    fi

    # Install/refresh the host cron for the nightly DB backup. Self-healing: a
    # fresh host (or one where the cron was lost) can't silently ship without
    # backups. Complements the scheduled backup:verify alarm, which DETECTS a
    # lapsed backup; this PREVENTS the lapse.
    if [ -f "$SELF_DIR/phases/install-backup-cron.sh" ]; then
        phase "Install Backup Cron" "${CURRENT_ACTIVE:-}" "${CURRENT_TARGET:-}" "${CURRENT_COMMIT:-}"
        bash "$SELF_DIR/phases/install-backup-cron.sh" || \
            log_warn "Backup cron install had errors — nightly backups may not run"
    fi

    # Rotate the bot-only access log so it doesn't grow unbounded (busy sites
    # see MB/day of crawler hits). Idempotent.
    if [ -f "$SELF_DIR/phases/install-prerender-logrotate.sh" ]; then
        bash "$SELF_DIR/phases/install-prerender-logrotate.sh" || \
            log_warn "Prerender logrotate install had errors"
    fi

    # Detach the prerender + its post-purge from the deploy critical path.
    # Re-rendering every public route across every active tenant takes 20-40
    # minutes (every snapshot's asset hashes are stale after each build), and
    # holding the deploy lock for that long means quick deploys are impossible.
    # The phase script itself is responsible for the lock-or-cancel behavior:
    # if a newer deploy starts before this finishes, that deploy's prerender
    # will SIGTERM this one and take over.
    if [ "$SKIP_PRERENDER" = "1" ]; then
        log_info "Skipping per-tenant pre-rendering (--skip-prerender set)"
    else
        local prerender_log
        prerender_log="$LOG_DIR/prerender-detached-${commit:0:12}-$(date +%Y%m%d-%H%M%S).log"
        log_info "Launching pre-render in background; deploy lock will release shortly"
        log_info "Prerender log: $prerender_log"
        log_info "Tail with: sudo tail -f $prerender_log"

        (
            # Subshell inherits env + functions. Stdio fully redirected so
            # nothing keeps the deploy script's pipes open. The deploy has
            # already succeeded by this point — prerender failures must not
            # propagate as a deploy failure.
            set +e
            local _active="${active:-}"
            export DEPLOY_DIR LOG_DIR LAST_PRERENDER_FILE LAST_DEPLOY_FILE
            export SKIP_PRERENDER FORCE_PRERENDER PRERENDER_TENANT PRERENDER_ROUTES
            CURRENT_ACTIVE="$_active"
            CURRENT_TARGET="$target"
            CURRENT_COMMIT="$commit"
            LOG_FILE="$prerender_log"
            echo "[$(date -Is)] Prerender background start (target=$target commit=$commit pid=$$)"
            run_prerender_for_color "$target" "$release_dir"
            echo "[$(date -Is)] Prerender background end (exit=$?)"

            # IndexNow ping — submits the freshly-prerendered URLs to Bing /
            # Yandex / Seznam / Yep. Runs after prerender so the URLs we ping
            # are the ones bots will actually find rendered. Failure here is
            # never a deploy blocker.
            if [ -f "$release_dir/scripts/seo-ping.sh" ]; then
                echo "[$(date -Is)] SEO ping (IndexNow) start"
                bash "$release_dir/scripts/seo-ping.sh" || echo "[$(date -Is)] SEO ping had errors (non-blocking)"
                echo "[$(date -Is)] SEO ping end"
            fi
        ) </dev/null >>"$prerender_log" 2>&1 &
        disown "$!" 2>/dev/null || true
    fi
    schedule_followup_health_check
    git rev-parse origin/main > "$LAST_DEPLOY_FILE" 2>/dev/null || true
    # Prune old release worktrees — keep the 3 most recent commits (current + 2 rollback candidates)
    if [ -d "$RELEASES_DIR" ]; then
        local keep_commits
        keep_commits="$(git log --format='%H' -n 3 origin/main 2>/dev/null || true)"
        for rel_dir in "$RELEASES_DIR"/*/; do
            local rel_commit
            rel_commit="$(basename "$rel_dir")"
            if [ -z "$rel_commit" ] || [ "$rel_commit" = "*" ]; then continue; fi
            if ! echo "$keep_commits" | grep -qF "$rel_commit"; then
                log_info "Pruning old release worktree: $rel_commit"
                git worktree remove --force "$rel_dir" 2>/dev/null || rm -rf "$rel_dir" || true
            fi
        done
        git worktree prune 2>/dev/null || true
    fi
    state_set DEPLOY_SUCCESS 1

    # Write build version file — records commit/timestamp into httpdocs/.build-version
    phase "Write Build Version" "${CURRENT_TARGET:-}" "${CURRENT_TARGET:-}" "${CURRENT_COMMIT:-}"
    NEXUS_BUILD_VERSION_COLOR="$target" \
    NEXUS_BUILD_VERSION_RELEASE_DIR="$release_dir" \
    NEXUS_BUILD_VERSION_COMMIT="$commit" \
    NEXUS_BUILD_VERSION_UPDATE_LAST_DEPLOY=1 \
    MODE=bluegreen \
        bash "$SELF_DIR/phases/write-build-version.sh"

    # Prune dangling Docker images to reclaim disk space
    phase "Docker Image Cleanup" "${CURRENT_TARGET:-}" "${CURRENT_TARGET:-}" "${CURRENT_COMMIT:-}"
    bash "$SELF_DIR/phases/prune-images.sh"

    # Prune deploy log files older than 30 days to prevent disk accumulation
    find "$LOG_DIR" -name "bluegreen-deploy-*.log" -mtime +30 -delete 2>/dev/null || true
}

cmd_rollback() {
    DEPLOY_START_TS="$(date +%s)"
    CURRENT_SUBCOMMAND="rollback"
    CURRENT_PREV_COMMIT="$(cat "$LAST_DEPLOY_FILE" 2>/dev/null || echo "")"
    require_route_switching
    state_init
    state_set DEPLOY_SUCCESS 0
    state_set MAINTENANCE_ENABLED_BY_US 0
    check_lock
    create_lock
    # Translate signals into non-zero exits BEFORE the EXIT trap captures $?.
    # Without this, `kill <pid>` on a deploy that's mid-sleep causes $? to be
    # the sleep's 0, so the EXIT trap mis-records the run as "success".
    trap 'log_warn "Deploy received signal — aborting"; exit 143' TERM INT HUP
    trap deploy_exit_trap EXIT

    local active target release_meta commit release_dir target_has_release
    active="$(read_active_color)"
    target="$(inactive_color "$active")"
    CURRENT_ACTIVE="$active"
    CURRENT_TARGET="$target"
    target_has_release=0

    log_warn "Rolling back from $active to $target"
    write_deploy_status "running" "starting rollback" "$active" "$target" ""
    smoke_color "$target"

    # Verify rollback target is healthy before switching traffic
    log_info "Verifying rollback target ($target) is healthy before cutover..."
    ROLLBACK_APP="nexus-${target}-php-app"
    if ! docker inspect --format='{{.State.Health.Status}}' "$ROLLBACK_APP" 2>/dev/null | grep -q "healthy"; then
        log_err "Rollback target $ROLLBACK_APP is not healthy — aborting rollback to prevent double-failure"
        log_err "Run: docker ps -a | grep nexus-${target} to investigate"
        exit 1
    fi
    log_ok "Rollback target $ROLLBACK_APP is healthy — proceeding with traffic switch"

    # Match deploy worker ordering: drain the active workers before starting
    # the rollback workers so Horizon is graceful and the scheduler is singular.
    stop_workers_for_color "$active"
    if release_meta="$(read_color_release "$target")"; then
        target_has_release=1
        commit="${release_meta%%|*}"
        release_dir="${release_meta#*|}"
        CURRENT_COMMIT="$commit"
        if ! start_queue_for_color "$target" "$release_dir" "$commit"; then
            log_err "Rollback queue start failed — keeping current active color $active"
            stop_workers_for_color "$target"
            restart_existing_workers_for_color "$active"
            exit 1
        fi
    else
        log_warn "No release metadata found for $target workers; trying legacy queue container"
        docker update --restart=unless-stopped nexus-php-queue >/dev/null 2>&1 || true
        docker start nexus-php-queue >/dev/null 2>&1 || true
    fi

    write_apache_routes "$target"
    if ! post_cutover_smoke; then
        log_err "Rollback public smoke failed; restoring web traffic to $active"
        write_apache_routes "$active"
        stop_workers_for_color "$target"
        restart_existing_workers_for_color "$active"
        exit 1
    fi

    if [ "$target_has_release" = "1" ]; then
        if ! start_scheduler_for_color "$target" "$release_dir" "$commit"; then
            log_err "Rollback scheduler start failed; restoring web traffic to $active"
            write_apache_routes "$active"
            stop_workers_for_color "$target"
            restart_existing_workers_for_color "$active"
            exit 1
        fi
    else
        docker update --restart=unless-stopped nexus-php-scheduler >/dev/null 2>&1 || true
        docker start nexus-php-scheduler >/dev/null 2>&1 || true
    fi

    # Purge Cloudflare cache after rollback traffic switch — prevents CF from
    # continuing to serve cached responses from the broken new deployment
    purge_cloudflare_cache "Cloudflare Cache Purge"
    state_set DEPLOY_SUCCESS 1
}

case "${1:-}" in
    # 🔴 enforce_webuk_live_marker runs BEFORE detaching, so the refusal is seen by
    # the person who typed the command rather than buried in a detached log. It is
    # deliberately NOT inside parse_flags: that function is sourced in isolation by
    # scripts/test/test-bluegreen-webuk-contract.sh, and calling an undefined
    # function there printed an error the test happily ignored.
    deploy) parse_flags "$@"; enforce_webuk_live_marker; detach_if_requested deploy "$@"; cmd_deploy ;;
    rollback) parse_flags "$@"; enforce_webuk_live_marker; detach_if_requested rollback "$@"; cmd_rollback ;;
    status) cmd_status ;;
    # Run this immediately after the Apache reload that cuts a hostname over.
    # It probes the public host and records web-uk as live ONLY if web-uk really
    # answers, which is what arms the "do not silently un-deploy it" refusal.
    confirm-webuk-live) shift; cmd_confirm_webuk_live "${1:-}" ;;
    logs) shift; cmd_logs "${1:-}" ;;
    monitor) cmd_monitor ;;
    -h|--help|help|"") usage ;;
    *)
        usage
        exit 2
        ;;
esac
