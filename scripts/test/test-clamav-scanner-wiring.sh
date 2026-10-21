#!/usr/bin/env bash
# Copyright © 2024–2026 Jasper Ford
# SPDX-License-Identifier: AGPL-3.0-or-later
# Author: Jasper Ford
# See NOTICE file for attribution and acknowledgements.
#
# Hosted podcast audio must pass a virus scan before it can be published. Until
# 2026-10-21 production had no scanner, so every hosted upload was recorded
# `scan_unavailable` and its Publish button answered 409 for ever. This pins:
#   1. compose.clamav.yml: the shared scanner, on the colours' network, with no
#      host port, a pinned image, and size limits above the largest upload (so
#      clamd never passes a large file as OK without scanning it);
#   2. compose.bluegreen.yml: app, queue and scheduler all get CLAMAV_ADDRESS;
#   3. ensure_clamav_scanner() in scripts/deploy/phases/validate-env.sh, which
#      every deploy runs: `up -d clamav` only, never --remove-orphans, never fatal.
# Stubbed docker; no container, no network.
#   bash scripts/test/test-clamav-scanner-wiring.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WORK="$(mktemp -d -t nexus-clamav-wiring-XXXXXX)"
trap 'rm -rf "$WORK"' EXIT
FAILURES=0
pass() { echo "  ok   $1"; }
failt() { echo "  FAIL $1" >&2; FAILURES=$((FAILURES + 1)); }

# ---------------------------------------------------------------------------
echo "part 1: compose files"

CF="$REPO_ROOT/compose.clamav.yml"
if [ -f "$CF" ]; then
    pass "compose.clamav.yml exists"
    grep -q '^name: nexus-php$' "$CF" && pass "project is nexus-php" || failt "project name is not nexus-php"
    grep -q 'container_name: nexus-php-clamav' "$CF" && pass "container is nexus-php-clamav" || failt "container_name is not nexus-php-clamav"
    grep -qE '^    image: clamav/clamav:[0-9]+\.[0-9]+\.[0-9]+$' "$CF" && pass "image pinned to an exact version" || failt "image is not pinned to an exact version"
    grep -q '^      - nexus-php-internal$' "$CF" && pass "on nexus-php-internal" || failt "not on nexus-php-internal"
    awk '/^networks:/{n=1} n&&/external: true/{f=1} END{exit !f}' "$CF" && pass "network is external" || failt "network is not external"
    grep -qE '^\s+ports:' "$CF" && failt "scanner publishes a host port" || pass "no host port published"
    for key in MaxFileSize MaxScanSize StreamMaxLength; do
        size="$(sed -n "s/^      - CLAMD_CONF_${key}=\([0-9]*\)M$/\1/p" "$CF")"
        if [ -n "$size" ] && [ "$size" -ge 250 ]; then
            pass "$key ${size}M covers the 250 MB default upload limit"
        else
            failt "$key missing or below 250M (clamd passes oversize files as OK unscanned)"
        fi
    done
    grep -q 'memory: [0-9]G' "$CF" && pass "memory limit set" || failt "no memory limit"
else
    failt "compose.clamav.yml is missing — production has no virus scanner"
fi

BG="$REPO_ROOT/compose.bluegreen.yml"
count="$(grep -c 'CLAMAV_ADDRESS=${CLAMAV_ADDRESS:-tcp://nexus-php-clamav:3310}' "$BG" || true)"
[ "$count" = "3" ] && pass "app, queue and scheduler all point at nexus-php-clamav" || failt "expected CLAMAV_ADDRESS on 3 services in compose.bluegreen.yml, found $count"

grep -q '^    ensure_clamav_scanner "\$release_dir"$' "$REPO_ROOT/scripts/deploy/bluegreen-deploy.sh" \
    && pass "bluegreen-deploy.sh starts the scanner on every deploy" \
    || failt "bluegreen-deploy.sh does not call ensure_clamav_scanner"

# ---------------------------------------------------------------------------
echo "part 2: the deploy step"

STATE="$WORK/state"; mkdir -p "$STATE" "$WORK/bin" "$WORK/release"
cp "$CF" "$WORK/release/compose.clamav.yml" 2>/dev/null || true
cat > "$WORK/bin/docker" <<'STUB'
#!/usr/bin/env bash
echo "$*" >> "$STUB_STATE/calls"
[ -f "$STUB_STATE/fail" ] && { echo "Error response from daemon" >&2; exit 1; }
exit 0
STUB
chmod +x "$WORK/bin/docker"

run_step() {
    ( export PATH="$WORK/bin:$PATH" STUB_STATE="$STATE" DEPLOY_DIR="$WORK" __NEXUS_BLUEGREEN_DETACHED__=1
      # shellcheck source=../deploy/phases/validate-env.sh
      . "$REPO_ROOT/scripts/deploy/phases/validate-env.sh"
      ensure_clamav_scanner "$1" ) > "$WORK/out.log" 2>&1
}
log_has() { grep -q -- "$1" "$WORK/out.log"; }
show_log() { sed 's/^/        /' "$WORK/out.log" >&2; }

echo "case 1: starts only the clamav service from the release being deployed"
rm -f "$STATE"/*
if run_step "$WORK/release"; then pass "step succeeded"; else failt "step failed"; show_log; fi
grep -qx "compose -f $WORK/release/compose.clamav.yml up -d clamav" "$STATE/calls" \
    && pass "ran: compose -f <release>/compose.clamav.yml up -d clamav" \
    || { failt "unexpected docker call: $(cat "$STATE/calls" 2>/dev/null)"; }
grep -q -- '--remove-orphans' "$STATE/calls" && failt "used --remove-orphans (would delete nexus-php-db)" || pass "never --remove-orphans"

echo "case 2: a docker failure is reported, not fatal"
rm -f "$STATE"/*; : > "$STATE/fail"
if run_step "$WORK/release"; then pass "deploy continues"; else failt "a scanner failure stopped the deploy"; show_log; fi
log_has 'Could not start nexus-php-clamav' && pass "says it could not start" || { failt "failure not reported"; show_log; }

echo "case 3: a release without the file is reported, nothing run"
rm -f "$STATE"/*
mkdir -p "$WORK/empty"
run_step "$WORK/empty" || { failt "step failed"; show_log; }
[ -f "$STATE/calls" ] && failt "ran docker without a compose file" || pass "no docker call"
log_has 'compose.clamav.yml not found' && pass "says the file is missing" || { failt "silence when missing"; show_log; }

echo "case 4: NEXUS_SKIP_CLAMAV=1 skips it, loudly"
rm -f "$STATE"/*
( export NEXUS_SKIP_CLAMAV=1; run_step "$WORK/release" ) || { failt "step failed"; show_log; }
[ -f "$STATE/calls" ] && failt "ran docker although skipped" || pass "no docker call"
log_has 'NEXUS_SKIP_CLAMAV=1' && pass "says it was skipped" || { failt "skip not reported"; show_log; }

echo
if [ "$FAILURES" -eq 0 ]; then
    echo "PASS: ClamAV scanner wiring"
else
    echo "FAIL: $FAILURES check(s) failed" >&2
    exit 1
fi
