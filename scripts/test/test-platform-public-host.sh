#!/usr/bin/env bash
# Copyright © 2024–2026 Jasper Ford
# SPDX-License-Identifier: AGPL-3.0-or-later
# Author: Jasper Ford
# See NOTICE file for attribution and acknowledgements.
#
# The deploy's post-switch checks probe the public app and accessible hosts.
# Until 10 Nov 2026 those were written into bluegreen-deploy.sh as
# app.project-nexus.ie / accessible.project-nexus.ie. The app is moving to
# app.project-nexus.net (accessible: accessible-app.project-nexus.net); once
# the old address only redirects, a written-in probe would either pass on the
# redirect or fail the deploy on it. platform_public_host() reads the host from
# the server's .env (FRONTEND_URL / ACCESSIBLE_FRONTEND_URL) instead, so the
# checks follow the settings.
#
# Contract pinned here:
#   1. The host is taken from the setting: quotes, scheme, port, path,
#      capitals and a Windows line ending are ignored.
#   2. A missing, empty or malformed setting, or no .env at all, gives the
#      default — never an empty host and never shell-unsafe text.
#   3. post_cutover_smoke and confirm-webuk-live use it, not a written-in host.
#
# Run: bash scripts/test/test-platform-public-host.sh

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DEPLOY_SCRIPT="$REPO_ROOT/scripts/deploy/bluegreen-deploy.sh"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

FAILURES=0
pass() { printf 'PASS %s\n' "$1"; }
fail() { printf 'FAIL %s\n' "$1"; FAILURES=$((FAILURES + 1)); }

sed -n '/^platform_public_host() {/,/^}/p' "$DEPLOY_SCRIPT" > "$WORK/fn.sh"
if [ ! -s "$WORK/fn.sh" ]; then
    fail "platform_public_host() not found in bluegreen-deploy.sh"
    exit 1
fi
# shellcheck disable=SC1091
. "$WORK/fn.sh"
DEPLOY_DIR="$WORK"

check() {
    local env_text="$1" key="$2" default_host="$3" want="$4" label="$5" got
    printf '%s' "$env_text" > "$DEPLOY_DIR/.env"
    got="$(platform_public_host "$key" "$default_host")"
    if [ "$got" = "$want" ]; then pass "$label -> $got"; else fail "$label: got '$got', want '$want'"; fi
}

check 'FRONTEND_URL=https://app.project-nexus.net' FRONTEND_URL app.project-nexus.ie app.project-nexus.net "plain setting"
check 'FRONTEND_URL="https://App.Project-Nexus.net/"' FRONTEND_URL app.project-nexus.ie app.project-nexus.net "quotes, slash, capitals"
check "$(printf 'APP_URL=x\nFRONTEND_URL=https://app.project-nexus.net:443/path\n')" FRONTEND_URL app.project-nexus.ie app.project-nexus.net "port and path, not first line"
check "$(printf 'FRONTEND_URL=https://app.project-nexus.net\r\n')" FRONTEND_URL app.project-nexus.ie app.project-nexus.net "Windows line ending"
check 'ACCESSIBLE_FRONTEND_URL=https://accessible-app.project-nexus.net' ACCESSIBLE_FRONTEND_URL accessible.project-nexus.ie accessible-app.project-nexus.net "accessible setting"
check 'APP_URL=https://api.project-nexus.ie' ACCESSIBLE_FRONTEND_URL accessible.project-nexus.ie accessible.project-nexus.ie "setting absent -> default"
check 'ACCESSIBLE_FRONTEND_URL=' ACCESSIBLE_FRONTEND_URL accessible.project-nexus.ie accessible.project-nexus.ie "setting empty -> default"
check 'FRONTEND_URL=https://evil;rm -rf /' FRONTEND_URL app.project-nexus.ie app.project-nexus.ie "malformed -> default"
check 'FRONTEND_URL=https://localhost' FRONTEND_URL app.project-nexus.ie app.project-nexus.ie "single label -> default"

rm -f "$DEPLOY_DIR/.env"
got="$(platform_public_host FRONTEND_URL app.project-nexus.ie)"
if [ "$got" = app.project-nexus.ie ]; then pass "no .env file -> default"; else fail "no .env file: got '$got'"; fi

# 3. The probes use the helper rather than a written-in host.
smoke="$(sed -n '/^post_cutover_smoke() {/,/^}/p' "$DEPLOY_SCRIPT")"
if printf '%s' "$smoke" | grep -q 'https://app\.project-nexus\.ie/\|https://accessible\.project-nexus\.ie'; then
    fail "post_cutover_smoke still probes a written-in app or accessible host"
else
    pass "post_cutover_smoke has no written-in app/accessible host"
fi
if printf '%s' "$smoke" | grep -q 'platform_public_host FRONTEND_URL' \
    && printf '%s' "$smoke" | grep -q 'platform_public_host ACCESSIBLE_FRONTEND_URL'; then
    pass "post_cutover_smoke reads both hosts from the settings"
else
    fail "post_cutover_smoke does not read its hosts through platform_public_host"
fi
if sed -n '/^cmd_confirm_webuk_live() {/,/^}/p' "$DEPLOY_SCRIPT" | grep -q 'platform_public_host ACCESSIBLE_FRONTEND_URL'; then
    pass "confirm-webuk-live defaults to the accessible setting"
else
    fail "confirm-webuk-live does not default to the accessible setting"
fi

if [ "$FAILURES" -gt 0 ]; then
    printf '\n%d check(s) failed\n' "$FAILURES"
    exit 1
fi
printf '\nAll checks passed\n'
