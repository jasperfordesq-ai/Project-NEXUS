#!/usr/bin/env bash
# Copyright © 2024–2026 Jasper Ford
# SPDX-License-Identifier: AGPL-3.0-or-later
# Author: Jasper Ford
# See NOTICE file for attribution and acknowledgements.
#
# E-035 F-202 — the deploy must build the EXACT commit its CI check approved.
#
# Tests the seam, not just the halves: (1) scripts/deploy.sh pins the SHA it
# checked and carries it through the ssh command to the server, and (2)
# bluegreen-deploy.sh's prepare_release() builds that pinned commit even when
# origin/main has moved on, and refuses a malformed or off-branch value.
#
# Run: bash scripts/test/test-deploy-pinned-sha.sh

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DEPLOY_SH="$ROOT/scripts/deploy.sh"
BLUEGREEN="$ROOT/scripts/deploy/bluegreen-deploy.sh"

fail=0
pass() { echo "  PASS  $1"; }
bad()  { echo "  FAIL  $1"; fail=$((fail + 1)); }
check_contains() {
    local label="$1" file="$2" needle="$3"
    if grep -qF -- "$needle" "$file"; then pass "$label"; else bad "$label (missing: $needle)"; fi
}

echo "== deploy.sh carries the pinned commit to the server =="
check_contains "pins DEPLOY_SHA from HEAD"            "$DEPLOY_SH" 'DEPLOY_SHA="$(git rev-parse HEAD)"'
check_contains "validates DEPLOY_SHA is 40 hex"        "$DEPLOY_SH" '[[ "$DEPLOY_SHA" =~ ^[0-9a-f]{40}$ ]]'
check_contains "CI check is run against the pin"      "$DEPLOY_SH" 'predeploy-ci-check.sh --trigger --sha "$DEPLOY_SHA"'
check_contains "server refuses a pin off origin/main" "$DEPLOY_SH" 'git merge-base --is-ancestor $DEPLOY_SHA origin/main'
check_contains "server resets to the pin"             "$DEPLOY_SH" 'git reset --hard $DEPLOY_SHA'
check_contains "server hands the pin to blue/green"   "$DEPLOY_SH" 'sudo env NEXUS_DEPLOY_SHA=$DEPLOY_SHA bash scripts/deploy/bluegreen-deploy.sh'
if grep -qF 'git reset --hard origin/main && sudo bash scripts/deploy/bluegreen-deploy.sh' "$DEPLOY_SH"; then
    bad "the old unpinned 'reset --hard origin/main' deploy command is gone"
else
    pass "the old unpinned 'reset --hard origin/main' deploy command is gone"
fi

echo "== prepare_release() builds the pinned commit =="
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

FN="$WORK/fn.sh"
{
    sed -n '/^prepare_release() {/,/^}/p' "$BLUEGREEN"
    echo 'phase() { :; }'
    echo 'log_info() { echo "INFO: $*"; }'
    echo 'log_warn() { echo "WARN: $*"; }'
    echo 'log_err()  { echo "ERR: $*"; }'
} > "$FN"
if ! grep -q '^prepare_release() {' "$FN"; then
    bad "could not extract prepare_release() from bluegreen-deploy.sh"
    echo "RESULT: $fail failure(s)"; exit 1
fi

git init -q --bare "$WORK/origin.git"
git clone -q "$WORK/origin.git" "$WORK/src" 2>/dev/null
(
    cd "$WORK/src" || exit 1
    git config user.email t@example.test; git config user.name t
    git checkout -q -b main
    echo a > compose.bluegreen.yml; echo a > Dockerfile.bluegreen
    git add . && git commit -q -m A
    git push -q origin main
)
SHA_A="$(git -C "$WORK/src" rev-parse HEAD)"
(
    cd "$WORK/src" || exit 1
    echo b >> compose.bluegreen.yml && git commit -qam B && git push -q origin main
)
SHA_B="$(git -C "$WORK/src" rev-parse HEAD)"
git clone -q "$WORK/origin.git" "$WORK/server" 2>/dev/null
(
    cd "$WORK/server" || exit 1
    git config user.email t@example.test; git config user.name t
    echo local > local.txt && git add local.txt && git commit -q -m local-only
)
SHA_LOCAL="$(git -C "$WORK/server" rev-parse HEAD)"

run_case() { # $1 = NEXUS_DEPLOY_SHA value or "__unset__"; prints PREPARED_COMMIT or "EXIT:<n>"
    (
        cd "$WORK/server" || exit 99
        export RELEASES_DIR="$WORK/releases-$RANDOM"
        # shellcheck disable=SC1090
        source "$FN"
        if [ "$1" = "__unset__" ]; then unset NEXUS_DEPLOY_SHA; else export NEXUS_DEPLOY_SHA="$1"; fi
        ( prepare_release >/dev/null 2>&1; echo "PREPARED=${PREPARED_COMMIT:-}" ) | tail -1
        exit "${PIPESTATUS[0]}"
    ) 2>/dev/null
}

out="$(run_case "$SHA_A")"
[ "$out" = "PREPARED=$SHA_A" ] && pass "pinned older commit A is built although origin/main is B" || bad "pinned commit A built (got: $out)"

out="$(run_case "__unset__")"
[ "$out" = "PREPARED=$SHA_B" ] && pass "no pin → tip of origin/main (B), backwards compatible" || bad "no pin builds origin/main tip (got: $out)"

out="$(run_case "not-a-sha")"
[ "$out" != "PREPARED=not-a-sha" ] && [ "${out#PREPARED=}" = "" ] && pass "malformed pin is refused" || bad "malformed pin refused (got: $out)"

out="$(run_case "$SHA_LOCAL")"
[ "${out#PREPARED=}" = "" ] && pass "commit not on origin/main is refused" || bad "off-branch pin refused (got: $out)"

echo ""
if [ "$fail" -eq 0 ]; then echo "RESULT: all checks passed"; exit 0; fi
echo "RESULT: $fail failure(s)"; exit 1
