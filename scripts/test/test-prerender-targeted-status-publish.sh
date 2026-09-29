#!/usr/bin/env bash
# Copyright © 2024–2026 Jasper Ford
# SPDX-License-Identifier: AGPL-3.0-or-later
# Author: Jasper Ford
# See NOTICE file for attribution and acknowledgements.

# F-245: a community entering or leaving maintenance must be publishable by a
# TARGETED (single-community) run. Until 2026-09-29 the targeted publisher
# refused any status-bearing snapshot, so every maintenance flip had to run
# the platform-wide authoritative reset, which cancels every community's
# render jobs.
#
# Invariant under test: a maintenance (503) page is never served as HTTP 200.
# The 503 map entry goes live before the maintenance HTML, and is removed
# only after the ordinary HTML has replaced it. Whatever happens, the final
# map equals the live `_status` sidecars, and other communities' entries are
# untouched.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TEST_ROOT="$(mktemp -d -t nexus-prerender-targeted-XXXXXX)"
trap 'rm -rf "$TEST_ROOT"' EXIT

export PRERENDER_CONFIG_DIR="$TEST_ROOT/config"
export PRERENDER_CODE_DIR="$REPO_ROOT"
export PRERENDER_OUTPUT_DIR="$TEST_ROOT/output"
export PRERENDER_PUBLISH_TEST_MODE=1
export PRERENDER_STATUS_OVERRIDE_LIST="$TEST_ROOT/prerender-status-overrides.list"
export NGINX_CONTAINER="test-prerender-nginx"
mkdir -p "$PRERENDER_CONFIG_DIR"

# Filesystem-only harness: no-op ACL shim, as in
# test-prerender-authoritative-publish.sh.
mkdir -p "$TEST_ROOT/bin"
printf '%s\n' '#!/bin/sh' 'exit 0' > "$TEST_ROOT/bin/setfacl"
chmod 0755 "$TEST_ROOT/bin/setfacl"
export PATH="$TEST_ROOT/bin:$PATH"

# shellcheck source=../prerender-tenants.sh
source "$REPO_ROOT/scripts/prerender-tenants.sh"
trap - EXIT INT TERM
trap 'rm -rf "$TEST_ROOT"' EXIT

PRERENDER_DIR="$TEST_ROOT/cache"
OUTPUT_DIR="$TEST_ROOT/output"
mkdir -p "$PRERENDER_DIR"
PRERENDER_PUBLISH_EPOCH="0123456789abcdef0123456789abcdef"
printf '%s\n' "$PRERENDER_PUBLISH_EPOCH" > "$PRERENDER_DIR/.publish-epoch"

docker() {
    local operation="${1:-}"
    shift || true
    case "$operation" in
        exec)
            local -a environment=()
            while [ "${1:-}" = "-e" ]; do
                environment+=("$2")
                shift 2
            done
            [ "${1:-}" = "$NGINX_CONTAINER" ] || return 90
            shift
            env "${environment[@]}" "$@"
            ;;
        cp)
            local source="$1"
            local destination="${2#*:}"
            mkdir -p "$destination"
            if [[ "$source" == */. ]]; then
                cp -a "${source%/.}/." "$destination/"
            else
                cp -a "$source" "$destination"
            fi
            ;;
        *)
            echo "Unexpected fake docker operation: $operation" >&2
            return 91
            ;;
    esac
}

# write_route ROOT ROUTE_DIR BODY [STATUS]
write_route() {
    local root="$1" route_dir="$2" body="$3" status="${4:-}"
    mkdir -p "$root/$route_dir"
    printf '%s\n' "$body" > "$root/$route_dir/index.html"
    local hash bytes
    hash="$(sha256sum "$root/$route_dir/index.html" | cut -d' ' -f1)"
    bytes="$(wc -c < "$root/$route_dir/index.html" | tr -d ' ')"
    printf '%s  %s' "$hash" "$bytes" > "$root/$route_dir/index.html.sha256"
    printf '{"tenantId":1,"tenantSlug":"alpha","host":"%s"}\n' "${route_dir%%/*}" \
        > "$root/$route_dir/_tenant.json"
    if [ -n "$status" ]; then
        printf '%s' "$status" > "$root/$route_dir/_status"
    fi
}

# stage ROUTE_DIR... — write the success manifest for the staged routes.
stage() {
    : > "$OUTPUT_DIR/.prerender-successes.txt"
    local route_dir
    for route_dir in "$@"; do
        printf '%s/index.html\n' "$route_dir" >> "$OUTPUT_DIR/.prerender-successes.txt"
    done
}

reset_output() {
    rm -rf "$OUTPUT_DIR"
    mkdir -p "$OUTPUT_DIR"
}

fail() { echo "FAIL: $*" >&2; exit 1; }

# publish COUNT — run a targeted publication; its exit status is left in
# PUBLISH_STATUS. errexit is ignored inside anything called from an `||`,
# `if` or `!` context — including a subshell that sets -e again — so a failed
# `docker exec` inside inject_rendered_pages would go unnoticed. Always call
# this as a plain statement, as production calls inject_rendered_pages.
PUBLISH_STATUS=0
publish() {
    set +e
    (set -e; inject_rendered_pages "$1" 0)
    PUBLISH_STATUS=$?
    set -e
}

# Live state: alpha (a custom-domain community) is normal; bravo, another
# community, is in maintenance and must keep its 503 entry throughout.
write_route "$PRERENDER_DIR" "alpha.example.test" "live-alpha"
write_route "$PRERENDER_DIR" "alpha.example.test/about" "live-alpha-about"
write_route "$PRERENDER_DIR" "bravo.example.test" "bravo-maintenance" 503
printf '%s\n' '# Authoritative prerender generation - generated transactionally' \
    '    "bravo.example.test/" "503";' > "$PRERENDER_STATUS_OVERRIDE_LIST"

# 1. alpha enters maintenance through a targeted run.
reset_output
write_route "$OUTPUT_DIR" "alpha.example.test" "alpha-maintenance" 503
write_route "$OUTPUT_DIR" "alpha.example.test/about" "alpha-maintenance" 503
stage "alpha.example.test" "alpha.example.test/about"
publish 2
[ "$PUBLISH_STATUS" -eq 0 ] || fail "targeted publish refused a community entering maintenance"

grep -Fqx 'alpha-maintenance' "$PRERENDER_DIR/alpha.example.test/index.html" \
    || fail "maintenance HTML not published"
[ "$(cat "$PRERENDER_DIR/alpha.example.test/_status")" = "503" ] || fail "_status sidecar not published"
grep -Fq '"alpha.example.test/" "503";' "$PRERENDER_STATUS_OVERRIDE_LIST" || fail "alpha root not mapped to 503"
grep -Fq '"alpha.example.test/about" "503";' "$PRERENDER_STATUS_OVERRIDE_LIST" || fail "alpha /about not mapped to 503"
grep -Fq '"alpha.example.test/about/" "503";' "$PRERENDER_STATUS_OVERRIDE_LIST" || fail "alpha /about/ not mapped to 503"
grep -Fq '"bravo.example.test/" "503";' "$PRERENDER_STATUS_OVERRIDE_LIST" || fail "other community's 503 entry lost"

# 2. alpha leaves maintenance through a targeted run.
reset_output
write_route "$OUTPUT_DIR" "alpha.example.test" "alpha-back"
write_route "$OUTPUT_DIR" "alpha.example.test/about" "alpha-back-about"
stage "alpha.example.test" "alpha.example.test/about"
publish 2
[ "$PUBLISH_STATUS" -eq 0 ] || fail "targeted publish refused a community leaving maintenance"

grep -Fqx 'alpha-back' "$PRERENDER_DIR/alpha.example.test/index.html" || fail "ordinary HTML not published"
[ ! -e "$PRERENDER_DIR/alpha.example.test/_status" ] || fail "stale _status sidecar left behind"
if grep -Fq 'alpha.example.test' "$PRERENDER_STATUS_OVERRIDE_LIST"; then
    fail "alpha still mapped to 503 after leaving maintenance"
fi
grep -Fq '"bravo.example.test/" "503";' "$PRERENDER_STATUS_OVERRIDE_LIST" || fail "other community's 503 entry lost"

# 3. A failure part-way through. Routes commit in sorted order, so /about
# commits and the incomplete root bundle then fails. The map must end up
# matching what is actually live: the committed maintenance page is 503 and
# the uncommitted ordinary page stays 200.
reset_output
write_route "$OUTPUT_DIR" "alpha.example.test" "alpha-maintenance" 503
write_route "$OUTPUT_DIR" "alpha.example.test/about" "alpha-maintenance-about" 503
rm -f "$OUTPUT_DIR/alpha.example.test/index.html.sha256"
stage "alpha.example.test" "alpha.example.test/about"
publish 2 2>/dev/null
[ "$PUBLISH_STATUS" -ne 0 ] || fail "incomplete bundle was accepted"
grep -Fqx 'alpha-maintenance-about' "$PRERENDER_DIR/alpha.example.test/about/index.html"     || fail "first route not committed"
grep -Fq '"alpha.example.test/about" "503";' "$PRERENDER_STATUS_OVERRIDE_LIST"     || fail "committed maintenance page left mapped as 200"
grep -Fqx 'alpha-back' "$PRERENDER_DIR/alpha.example.test/index.html" || fail "uncommitted route changed"
if grep -Fq '"alpha.example.test/" "503";' "$PRERENDER_STATUS_OVERRIDE_LIST"; then
    fail "uncommitted ordinary page left mapped as 503"
fi
grep -Fq '"bravo.example.test/" "503";' "$PRERENDER_STATUS_OVERRIDE_LIST" || fail "other community's 503 entry lost"

# 4. Only the maintenance status is publishable; anything else is refused
# before a single live byte changes.
rm -rf "$PRERENDER_DIR"/.incoming-*
cp "$PRERENDER_STATUS_OVERRIDE_LIST" "$TEST_ROOT/map-before"
reset_output
write_route "$OUTPUT_DIR" "alpha.example.test" "not-found" 404
stage "alpha.example.test"
publish 1 2>/dev/null
[ "$PUBLISH_STATUS" -ne 0 ] || fail "a 404 status sidecar was published"
grep -Fqx 'alpha-back' "$PRERENDER_DIR/alpha.example.test/index.html" || fail "refused route changed"
cmp -s "$TEST_ROOT/map-before" "$PRERENDER_STATUS_OVERRIDE_LIST" || fail "refused publish changed the status map"

echo "PASS: targeted publication installs and removes maintenance snapshots without a platform-wide reset"
