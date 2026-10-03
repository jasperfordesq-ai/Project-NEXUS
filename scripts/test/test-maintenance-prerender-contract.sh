#!/usr/bin/env bash
# Copyright © 2024–2026 Jasper Ford
# SPDX-License-Identifier: AGPL-3.0-or-later
# Author: Jasper Ford
# See NOTICE file for attribution and acknowledgements.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MAINTENANCE="$ROOT_DIR/scripts/maintenance.sh"
AUTH_HELPER="$ROOT_DIR/react-frontend/runtime/maintenance-render-auth.sh"
DOCKERFILE="$ROOT_DIR/react-frontend/Dockerfile.bluegreen"
TEST_ROOT="$(mktemp -d -t nexus-maintenance-contract-XXXXXX)"
REAL_DOCKER="$(command -v docker)"
LOCK_OWNER_PID=""

cleanup() {
    if [ -n "$LOCK_OWNER_PID" ]; then
        kill "$LOCK_OWNER_PID" >/dev/null 2>&1 || true
        wait "$LOCK_OWNER_PID" 2>/dev/null || true
    fi
    rm -rf "$TEST_ROOT"
}
trap cleanup EXIT

bash -n "$MAINTENANCE"
sh -n "$AUTH_HELPER"

mkdir -p "$TEST_ROOT/bin"
cat > "$TEST_ROOT/resolver.sh" <<'EOF'
resolve_active_nexus_container() {
    printf '%s\n' "$1" >> "$RESOLVER_LOG"
    if [ "${RESOLVER_FAIL_ROLE:-}" = "$1" ]; then
        return 69
    fi
    case "$1" in
        php-app) printf '%s\n' nexus-green-php-app ;;
        react) printf '%s\n' nexus-green-react ;;
        *) return 64 ;;
    esac
}
EOF
cat > "$TEST_ROOT/bin/docker" <<'EOF'
#!/bin/sh
printf '%s\n' "$*" >> "$DOCKER_LOG"
if [ "${DOCKER_SCENARIO:-}" = sentinel-fail ]; then
    case "${1:-}" in
        ps)
            printf '%s\n' nexus-green-php-app nexus-green-react nexus-php-db
            exit 0
            ;;
        exec)
            case "$*" in
                *'nexus-maintenance-render-auth enable'*) exit 0 ;;
                *'nexus-maintenance-render-auth disable'*) exit 0 ;;
                *'.global-maintenance'*) exit 1 ;;
            esac
            ;;
    esac
fi
exit 99
EOF
chmod 0755 "$TEST_ROOT/bin/docker"

run_maintenance() {
    local fail_role="$1" lock_path="$2" output="$3"
    set +e
    env \
        PATH="$TEST_ROOT/bin:$PATH" \
        DOCKER_LOG="$TEST_ROOT/docker.log" \
        RESOLVER_LOG="$TEST_ROOT/resolver.log" \
        RESOLVER_FAIL_ROLE="$fail_role" \
        NEXUS_CONTAINER_RESOLVER="$TEST_ROOT/resolver.sh" \
        MAINTENANCE_TRANSITION_LOCK="$lock_path" \
        bash "$MAINTENANCE" on >"$output" 2>&1
    local status=$?
    set -e
    printf '%s\n' "$status"
}

# Resolution failures are terminal and occur before any container mutation.
: > "$TEST_ROOT/docker.log"
: > "$TEST_ROOT/resolver.log"
status="$(run_maintenance php-app "$TEST_ROOT/php-fail.lock" "$TEST_ROOT/php-fail.out")"
[ "$status" = "69" ]
[ ! -s "$TEST_ROOT/docker.log" ]
grep -Fxq php-app "$TEST_ROOT/resolver.log"
! grep -Fxq react "$TEST_ROOT/resolver.log"

: > "$TEST_ROOT/docker.log"
: > "$TEST_ROOT/resolver.log"
status="$(run_maintenance react "$TEST_ROOT/react-fail.lock" "$TEST_ROOT/react-fail.out")"
[ "$status" = "69" ]
[ ! -s "$TEST_ROOT/docker.log" ]
grep -Fxq php-app "$TEST_ROOT/resolver.log"
grep -Fxq react "$TEST_ROOT/resolver.log"

# A concurrent transition owns the non-blocking lock. The second invocation
# must fail with EX_TEMPFAIL (75) before touching Docker or serving state.
LOCK_PATH="$TEST_ROOT/serialized.lock"
READY="$TEST_ROOT/lock-ready"
(
    exec 8>"$LOCK_PATH"
    flock 8
    : > "$READY"
    sleep 30
) &
LOCK_OWNER_PID=$!
for _ in $(seq 1 100); do
    [ -f "$READY" ] && break
    sleep 0.02
done
[ -f "$READY" ]
: > "$TEST_ROOT/docker.log"
: > "$TEST_ROOT/resolver.log"
status="$(run_maintenance '' "$LOCK_PATH" "$TEST_ROOT/locked.out")"
[ "$status" = "75" ]
[ ! -s "$TEST_ROOT/docker.log" ]
grep -Fq 'Another maintenance transition is already running' "$TEST_ROOT/locked.out"
kill "$LOCK_OWNER_PID" >/dev/null 2>&1 || true
wait "$LOCK_OWNER_PID" 2>/dev/null || true
LOCK_OWNER_PID=""

# Credential activation alone is not enough: if the shared sentinel cannot be
# created and verified, the transition aborts and revokes the unused secret.
: > "$TEST_ROOT/docker.log"
set +e
env \
    PATH="$TEST_ROOT/bin:$PATH" \
    DOCKER_LOG="$TEST_ROOT/docker.log" \
    DOCKER_SCENARIO=sentinel-fail \
    PHP_CONTAINER=nexus-green-php-app \
    REACT_CONTAINER=nexus-green-react \
    MAINTENANCE_TRANSITION_LOCK="$TEST_ROOT/sentinel-fail.lock" \
    bash "$MAINTENANCE" on >"$TEST_ROOT/sentinel-fail.out" 2>&1
status=$?
set -e
[ "$status" = "1" ]
grep -Fq 'nexus-maintenance-render-auth enable' "$TEST_ROOT/docker.log"
grep -Fq 'nexus-maintenance-render-auth disable' "$TEST_ROOT/docker.log"
grep -Fq 'could not create and verify the crawler/snapshot maintenance gate' "$TEST_ROOT/sentinel-fail.out"
if grep -Fq 'touch /var/www/html/.maintenance' "$TEST_ROOT/docker.log"; then
    echo 'PHP maintenance mutation continued after sentinel failure' >&2
    exit 1
fi

# The production image must carry the audited helper, and maintenance must use
# it for both credential activation and revocation.
grep -Fq 'runtime/maintenance-render-auth.sh /usr/local/bin/nexus-maintenance-render-auth' "$DOCKERFILE"
[ "$(grep -Fc '/usr/local/bin/nexus-maintenance-render-auth enable' "$MAINTENANCE")" = "1" ]
[ "$(grep -Fc '/usr/local/bin/nexus-maintenance-render-auth disable' "$MAINTENANCE")" = "2" ]
grep -Fq 'could not create and verify the crawler/snapshot maintenance gate' "$MAINTENANCE"

# Exercise the real credential transaction in the same Alpine/nginx user and
# tool environment as production. Nginx signalling is stubbed; nginx response
# semantics are covered separately by test-prerender-nginx-runtime.sh.
"$REAL_DOCKER" run --rm \
    --tmpfs /state:rw,nosuid,nodev,size=2m \
    -v "$AUTH_HELPER:/usr/local/bin/nexus-maintenance-render-auth:ro" \
    nginx:1.30-alpine sh -ceu '
        apk add --no-cache acl apache2-utils >/dev/null
        cat > /tmp/fake-nginx <<"EOF"
#!/bin/sh
printf "%s\n" "$*" >> /state/nginx.calls
if [ -f /state/fail-reload ] && [ "${1:-}" = "-s" ]; then
    exit 1
fi
exit 0
EOF
        chmod 0755 /tmp/fake-nginx
        export TOKEN_PATH=/state/.maintenance-render.token
        export HTPASSWD_PATH=/state/.maintenance-render.htpasswd
        export AUTH_LIST_PATH=/state/.maintenance-render-auth.list
        export NGINX_BIN=/tmp/fake-nginx

        /usr/local/bin/nexus-maintenance-render-auth enable
        token="$(tr -d "\r\n" < "$TOKEN_PATH")"
        case "$token" in
            *[!A-Za-z0-9+/=]*|"") echo "invalid token format" >&2; exit 1 ;;
        esac
        [ "${#token}" -ge 48 ]
        encoded="$(printf "prerender:%s" "$token" | base64 | tr -d "\r\n")"
        [ "$(cat "$AUTH_LIST_PATH")" = "\"Basic $encoded\" 1;" ]
        htpasswd -vb "$HTPASSWD_PATH" prerender "$token" >/dev/null 2>&1
        [ "$(stat -c %a "$TOKEN_PATH")" = 600 ]
        [ "$(stat -c %a "$HTPASSWD_PATH")" = 640 ]
        [ "$(stat -c %a "$AUTH_LIST_PATH")" = 640 ]
        [ "$(stat -c %U:%G "$AUTH_LIST_PATH")" = root:nginx ]
        ! getfacl -cp "$AUTH_LIST_PATH" | grep -Eq "^user:[^:]"

        cp "$TOKEN_PATH" /tmp/token.before
        cp "$HTPASSWD_PATH" /tmp/htpasswd.before
        cp "$AUTH_LIST_PATH" /tmp/auth.before
        : > /state/fail-reload
        if /usr/local/bin/nexus-maintenance-render-auth enable >/dev/null 2>&1; then
            echo "credential transition succeeded despite reload failure" >&2
            exit 1
        fi
        rm -f /state/fail-reload
        cmp /tmp/token.before "$TOKEN_PATH"
        cmp /tmp/htpasswd.before "$HTPASSWD_PATH"
        cmp /tmp/auth.before "$AUTH_LIST_PATH"

        /usr/local/bin/nexus-maintenance-render-auth disable
        [ ! -e "$TOKEN_PATH" ]
        [ "$(cat "$AUTH_LIST_PATH")" = "# No private maintenance renderer credential is active." ]
        [ "$(cat "$HTPASSWD_PATH")" = "prerender:!" ]
        if htpasswd -vb "$HTPASSWD_PATH" prerender "$token" >/dev/null 2>&1; then
            echo "revoked credential still verifies" >&2
            exit 1
        fi

        rm -f "$AUTH_LIST_PATH"
        ln -s /etc/passwd "$AUTH_LIST_PATH"
        if /usr/local/bin/nexus-maintenance-render-auth enable >/dev/null 2>&1; then
            echo "symlinked credential state was accepted" >&2
            exit 1
        fi
        grep -Fq "root:x:0:0:" /etc/passwd
        ! find /state -maxdepth 1 -name ".maintenance-auth-txn.*" | grep -q .
    '

echo 'PASS: maintenance transitions serialize, resolve active containers fail-closed, and rotate/revoke private render credentials transactionally'
