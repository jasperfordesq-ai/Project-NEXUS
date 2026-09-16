#!/usr/bin/env bash
# Copyright © 2024–2026 Jasper Ford
# SPDX-License-Identifier: AGPL-3.0-or-later
# Author: Jasper Ford
# See NOTICE file for attribution and acknowledgements.
#
# Focused regression tests for the fenced pre-render lock and worker ownership.
# Run: bash scripts/test/test-prerender-lock-takeover.sh

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="$REPO_ROOT/scripts/prerender-tenants.sh"
PASS=0
FAIL=0

assert() {
    local DESCRIPTION="$1"
    local RESULT="$2"
    if [ "$RESULT" = "1" ]; then
        echo "  PASS: $DESCRIPTION"
        PASS=$((PASS + 1))
    else
        echo "  FAIL: $DESCRIPTION"
        FAIL=$((FAIL + 1))
    fi
}

STUB_DIR="$(mktemp -d -t nexus-test-stubs-XXXXXX)"
STUB_LOG="$(mktemp -t nexus-stub-docker-XXXXXX.log)"
cat > "$STUB_DIR/docker" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "${STUB_LOG:?}"
case "${1:-}" in
    inspect)
        printf '%s\n' "${STUB_DOCKER_OWNER_TOKEN:-}"
        ;;
    kill|rm|stop)
        ;;
    *)
        printf 'STUB-DOCKER-UNEXPECTED: %s\n' "$*" >> "${STUB_LOG:?}"
        ;;
esac
STUB
chmod +x "$STUB_DIR/docker"
export PATH="$STUB_DIR:$PATH"
export STUB_LOG

trap 'rm -rf "$STUB_DIR" "$STUB_LOG" 2>/dev/null || true' EXIT

start_owner() {
    local LOCK_FILE_VALUE="$1"
    local LOCK_DIR_VALUE="$2"
    local TOKEN="$3"
    local READY_FILE="$4"
    local START_OFFSET="${5:-0}"

    bash -c '
        set -euo pipefail
        lock_file="$1"
        lock_dir="$2"
        token="$3"
        ready_file="$4"
        start_offset="$5"
        exec 9>"$lock_file"
        flock 9
        stat_line="$(cat "/proc/$$/stat")"
        stat_tail="${stat_line##*) }"
        read -r -a stat_fields <<< "$stat_tail"
        start_time="${stat_fields[19]}"
        start_time=$((start_time + start_offset))
        mkdir -p "$lock_dir"
        printf "%s\n" "$$" > "$lock_dir/pid"
        printf "%s\n" "$start_time" > "$lock_dir/start_time"
        printf "%s\n" "$token" > "$lock_dir/token"
        : > "$ready_file"
        trap "exit 0" TERM INT
        while :; do
            read -r -t 1 _ || true
        done
    ' "$SCRIPT" "$LOCK_FILE_VALUE" "$LOCK_DIR_VALUE" "$TOKEN" "$READY_FILE" "$START_OFFSET" &
    OWNER_PID=$!

    local WAITED=0
    while [ ! -f "$READY_FILE" ] && [ "$WAITED" -lt 50 ]; do
        sleep 0.1
        WAITED=$((WAITED + 1))
    done
    [ -f "$READY_FILE" ]
}

echo "Scenario 1: fresh lock writes complete fenced identity"
(
    TMP="$(mktemp -d -t nexus-prerender-test-XXXXXX)"
    export PRERENDER_CONFIG_DIR="$TMP"
    export PRERENDER_CODE_DIR="$REPO_ROOT"
    export NGINX_CONTAINER="test-nginx"
    export STUB_DOCKER_OWNER_TOKEN=""
    # shellcheck disable=SC1090
    source "$SCRIPT" --dry-run >/dev/null
    set +e

    acquire_lock
    TOKEN="$(cat "$LOCK_TOKEN_FILE" 2>/dev/null)"
    START="$(cat "$LOCK_START_FILE" 2>/dev/null)"
    if [ "$(cat "$LOCK_PID_FILE" 2>/dev/null)" = "$$" ] \
        && [[ "$TOKEN" =~ ^[0-9a-f]{48}$ ]] \
        && [[ "$START" =~ ^[0-9]+$ ]]; then
        echo PASS_SCENARIO
    fi
    cleanup
    trap - EXIT INT TERM
    rm -rf "$TMP"
) | grep -q PASS_SCENARIO && assert "fresh owner records pid, start time, and random token" 1 \
    || assert "fresh owner records pid, start time, and random token" 0

echo "Scenario 2: stale metadata is reclaimed without killing a differently-owned worker"
(
    TMP="$(mktemp -d -t nexus-prerender-test-XXXXXX)"
    export PRERENDER_CONFIG_DIR="$TMP"
    export PRERENDER_CODE_DIR="$REPO_ROOT"
    export NGINX_CONTAINER="test-nginx"
    export STUB_DOCKER_OWNER_TOKEN="bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
    : > "$STUB_LOG"
    mkdir -p "$TMP/.prerender-lock"
    printf '%s\n' "999999999" > "$TMP/.prerender-lock/pid"
    printf '%s\n' "1" > "$TMP/.prerender-lock/start_time"
    printf '%s\n' "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" > "$TMP/.prerender-lock/token"
    # shellcheck disable=SC1090
    source "$SCRIPT" --dry-run >/dev/null
    set +e

    acquire_lock
    if [ "$(cat "$LOCK_PID_FILE" 2>/dev/null)" = "$$" ] \
        && ! grep -Eq '^(kill|stop|rm) ' "$STUB_LOG"; then
        echo PASS_SCENARIO
    fi
    cleanup
    trap - EXIT INT TERM
    rm -rf "$TMP"
) | grep -q PASS_SCENARIO && assert "stale lock reclaims safely and preserves another worker" 1 \
    || assert "stale lock reclaims safely and preserves another worker" 0

echo "Scenario 3: verified live owner is cancelled and its labelled worker removed"
(
    TMP="$(mktemp -d -t nexus-prerender-test-XXXXXX)"
    export PRERENDER_CONFIG_DIR="$TMP"
    export PRERENDER_CODE_DIR="$REPO_ROOT"
    export NGINX_CONTAINER="test-nginx"
    export LOCK_TAKEOVER_GRACE_SECONDS=2
    PRIOR_TOKEN="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    export STUB_DOCKER_OWNER_TOKEN="$PRIOR_TOKEN"
    : > "$STUB_LOG"
    READY="$TMP/ready"
    start_owner "$TMP/.prerender-lock.flock" "$TMP/.prerender-lock" "$PRIOR_TOKEN" "$READY"
    VICTIM_PID="$OWNER_PID"
    # shellcheck disable=SC1090
    source "$SCRIPT" --dry-run >/dev/null
    set +e

    acquire_lock
    if ! kill -0 "$VICTIM_PID" 2>/dev/null \
        && [ "$(cat "$LOCK_PID_FILE" 2>/dev/null)" = "$$" ] \
        && grep -Fq "kill $PRERENDER_DOCKER_NAME" "$STUB_LOG"; then
        echo PASS_SCENARIO
    fi
    kill -KILL "$VICTIM_PID" 2>/dev/null || true
    cleanup
    trap - EXIT INT TERM
    rm -rf "$TMP"
) | grep -q PASS_SCENARIO && assert "verified owner and matching worker are superseded" 1 \
    || assert "verified owner and matching worker are superseded" 0

echo "Scenario 4: PID/start mismatch fails closed and never signals the process"
(
    TMP="$(mktemp -d -t nexus-prerender-test-XXXXXX)"
    export PRERENDER_CONFIG_DIR="$TMP"
    export PRERENDER_CODE_DIR="$REPO_ROOT"
    export NGINX_CONTAINER="test-nginx"
    export LOCK_TAKEOVER_GRACE_SECONDS=1
    PRIOR_TOKEN="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    export STUB_DOCKER_OWNER_TOKEN="$PRIOR_TOKEN"
    : > "$STUB_LOG"
    READY="$TMP/ready"
    start_owner "$TMP/.prerender-lock.flock" "$TMP/.prerender-lock" "$PRIOR_TOKEN" "$READY" 1
    VICTIM_PID="$OWNER_PID"
    # shellcheck disable=SC1090
    source "$SCRIPT" --dry-run >/dev/null
    set +e

    ( acquire_lock >/dev/null 2>&1 )
    RESULT=$?
    if [ "$RESULT" -ne 0 ] \
        && kill -0 "$VICTIM_PID" 2>/dev/null \
        && ! grep -Eq '^(kill|stop|rm) ' "$STUB_LOG"; then
        echo PASS_SCENARIO
    fi
    kill -TERM "$VICTIM_PID" 2>/dev/null || true
    wait "$VICTIM_PID" 2>/dev/null || true
    trap - EXIT INT TERM
    rm -rf "$TMP"
) | grep -q PASS_SCENARIO && assert "reused/mismatched PID is not killed" 1 \
    || assert "reused/mismatched PID is not killed" 0

echo "Scenario 5: cleanup cannot remove a replacement lock or foreign worker"
(
    TMP="$(mktemp -d -t nexus-prerender-test-XXXXXX)"
    export PRERENDER_CONFIG_DIR="$TMP"
    export PRERENDER_CODE_DIR="$REPO_ROOT"
    export NGINX_CONTAINER="test-nginx"
    export STUB_DOCKER_OWNER_TOKEN=""
    : > "$STUB_LOG"
    # shellcheck disable=SC1090
    source "$SCRIPT" --dry-run >/dev/null
    set +e

    acquire_lock
    FOREIGN_TOKEN="bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
    printf '%s\n' "$FOREIGN_TOKEN" > "$LOCK_TOKEN_FILE"
    export STUB_DOCKER_OWNER_TOKEN="$FOREIGN_TOKEN"
    cleanup
    if [ -d "$LOCK_DIR" ] && ! grep -Eq '^(kill|stop|rm) ' "$STUB_LOG"; then
        echo PASS_SCENARIO
    fi
    trap - EXIT INT TERM
    rm -rf "$TMP"
) | grep -q PASS_SCENARIO && assert "cleanup is fenced by lock and worker owner tokens" 1 \
    || assert "cleanup is fenced by lock and worker owner tokens" 0

echo "Scenario 6: a targeted run (--tenant/--routes) never supersedes a verified live owner"
# Regression (2026-09-16): the once-a-minute job processor invokes this script
# with --tenant/--routes. Lock-or-cancel treated every newcomer as a newer
# deploy, so a processor job killed the deploy's full render ~50 s in — after
# it had rendered the master tenant's pages but before it published them. Only
# an unfiltered (deploy-style) run may take the lock over; a targeted run that
# finds it held must step back without signalling anything.
(
    TMP="$(mktemp -d -t nexus-prerender-test-XXXXXX)"
    export PRERENDER_CONFIG_DIR="$TMP"
    export PRERENDER_CODE_DIR="$REPO_ROOT"
    export NGINX_CONTAINER="test-nginx"
    export LOCK_TAKEOVER_GRACE_SECONDS=1
    PRIOR_TOKEN="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    export STUB_DOCKER_OWNER_TOKEN="$PRIOR_TOKEN"
    : > "$STUB_LOG"
    READY="$TMP/ready"
    start_owner "$TMP/.prerender-lock.flock" "$TMP/.prerender-lock" "$PRIOR_TOKEN" "$READY"
    VICTIM_PID="$OWNER_PID"
    # shellcheck disable=SC1090
    source "$SCRIPT" --tenant alpha --routes /,/about --dry-run >/dev/null
    set +e

    ( acquire_lock >/dev/null 2>&1 )
    RESULT=$?
    if [ "$RESULT" -ne 0 ] \
        && kill -0 "$VICTIM_PID" 2>/dev/null \
        && ! grep -Eq '^(kill|stop|rm) ' "$STUB_LOG"; then
        echo PASS_SCENARIO
    fi
    kill -TERM "$VICTIM_PID" 2>/dev/null || true
    wait "$VICTIM_PID" 2>/dev/null || true
    trap - EXIT INT TERM
    rm -rf "$TMP"
) | grep -q PASS_SCENARIO && assert "targeted run steps back and leaves the live owner running" 1 \
    || assert "targeted run steps back and leaves the live owner running" 0

echo ""
echo "Result: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
