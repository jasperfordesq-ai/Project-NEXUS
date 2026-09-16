#!/usr/bin/env bash
# Copyright © 2024–2026 Jasper Ford
# SPDX-License-Identifier: AGPL-3.0-or-later
# Author: Jasper Ford
# See NOTICE file for attribution and acknowledgements.
#
# Regression (2026-09-16): scripts/deploy.sh ran its crawler delivery probe
# seconds after the traffic switch — BEFORE the server's detached post-deploy
# render had published anything — so it reported the master tenant's front page
# BLANK on two consecutive deploys where the render then succeeded minutes
# later. A probe that always fires too early is a false alarm generator, and
# false alarms are how the two-month blank-shell outage went unnoticed.
#
# Contract pinned here:
#   1. scripts/wait-for-prerender-publish.sh polls the server for the detached
#      render log of the deployed commit and returns 0 once it records
#      "Prerender background end", 3 if no log ever appears (render not
#      launched), 2 on timeout — never signalling anything, never failing the
#      deploy.
#   2. deploy.sh starts the 30-minute error watch BEFORE waiting (the watch
#      timestamps from "now", so delaying it would lose the first minutes),
#      then waits, then probes, then collects the watch result.
#
# Run: bash scripts/test/test-deploy-probe-after-prerender.sh

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WAITER="$REPO_ROOT/scripts/wait-for-prerender-publish.sh"
DEPLOY="$REPO_ROOT/scripts/deploy.sh"
TMP_DIR="$(mktemp -d -t nexus-probe-order-XXXXXX)"
trap 'rm -rf "$TMP_DIR"' EXIT
PASS=0; FAIL=0
assert() { if [ "$2" = "1" ]; then echo "  PASS: $1"; PASS=$((PASS+1)); else echo "  FAIL: $1"; FAIL=$((FAIL+1)); fi; }

# ssh stub: replays one scripted remote answer per call, from a queue file.
mkdir -p "$TMP_DIR/bin"
cat > "$TMP_DIR/bin/ssh" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "${STUB_LOG:?}"
line="$(head -n 1 "${STUB_QUEUE:?}")"
if [ -n "$line" ]; then
    tail -n +2 "$STUB_QUEUE" > "$STUB_QUEUE.next" && mv "$STUB_QUEUE.next" "$STUB_QUEUE"
    printf '%s\n' "$line"
else
    printf '%s\n' "${STUB_DEFAULT:-RUNNING}"
fi
STUB
chmod +x "$TMP_DIR/bin/ssh"
export PATH="$TMP_DIR/bin:$PATH"
export STUB_LOG="$TMP_DIR/ssh.log" STUB_QUEUE="$TMP_DIR/queue"
export SSH_KEY="$TMP_DIR/fake.key" SSH_HOST="deploy@stub.invalid"
export PRERENDER_WAIT_POLL_SECONDS=0 PRERENDER_WAIT_TIMEOUT_SECONDS=5 PRERENDER_WAIT_NOLOG_GRACE_SECONDS=1

echo "Scenario 1: waits through 'no log yet' and 'running', returns 0 on 'background end'"
: > "$STUB_LOG"
printf '%s\n' NOLOG RUNNING RUNNING "Prerender background end (exit=0)" > "$STUB_QUEUE"
out="$(bash "$WAITER" 6bcc6ce8b31b0000000000000000000000000000 2>&1)"; rc=$?
calls=$(wc -l < "$STUB_LOG")
if [ "$rc" -eq 0 ] && [ "$calls" -eq 4 ] && echo "$out" | grep -q 'exit=0' \
    && grep -q 'prerender-detached-6bcc6ce8b31b-' "$STUB_LOG"; then
    assert "returns 0 after the 4th poll and looked for this commit's log" 1
else
    echo "    rc=$rc calls=$calls"; echo "$out" | sed 's/^/    /'; assert "returns 0 after the 4th poll and looked for this commit's log" 0
fi

echo "Scenario 2: render finished with a non-zero exit still counts as published-or-not-coming (0)"
: > "$STUB_LOG"; printf '%s\n' "Prerender background end (exit=1)" > "$STUB_QUEUE"
bash "$WAITER" 6bcc6ce8b31b0000000000000000000000000000 >/dev/null 2>&1; rc=$?
assert "non-zero render exit still ends the wait with 0" "$([ "$rc" -eq 0 ] && echo 1 || echo 0)"

echo "Scenario 3: no log ever appears → 3 (render was never launched), within the grace period"
: > "$STUB_LOG"; : > "$STUB_QUEUE"; export STUB_DEFAULT=NOLOG
start=$(date +%s); bash "$WAITER" 6bcc6ce8b31b0000000000000000000000000000 >/dev/null 2>&1; rc=$?; took=$(( $(date +%s) - start ))
assert "no-log returns 3 and gives up after the short grace, not the full timeout" "$([ "$rc" -eq 3 ] && [ "$took" -lt 5 ] && echo 1 || echo 0)"
unset STUB_DEFAULT

echo "Scenario 4: still running at the deadline → 2 (timeout), never kills or fails"
: > "$STUB_LOG"; : > "$STUB_QUEUE"; export STUB_DEFAULT=RUNNING PRERENDER_WAIT_TIMEOUT_SECONDS=1
bash "$WAITER" 6bcc6ce8b31b0000000000000000000000000000 >/dev/null 2>&1; rc=$?
assert "timeout returns 2" "$([ "$rc" -eq 2 ] && echo 1 || echo 0)"
if grep -Eq 'kill|rollback|SIGTERM' "$STUB_LOG"; then assert "waiter never signals the server" 0; else assert "waiter never signals the server" 1; fi
unset STUB_DEFAULT; export PRERENDER_WAIT_TIMEOUT_SECONDS=5

echo "Scenario 5: waiter refuses a malformed commit id (it is interpolated into a remote path)"
: > "$STUB_LOG"
bash "$WAITER" 'abc;rm -rf /' >/dev/null 2>&1; rc=$?
assert "malformed sha is rejected without contacting the server" "$([ "$rc" -eq 64 ] && [ ! -s "$STUB_LOG" ] && echo 1 || echo 0)"

echo "Scenario 6: deploy.sh ordering — watch starts, THEN wait, THEN probe, THEN watch result"
watch_start=$(grep -nE 'postdeploy-watch\.mjs.*&\s*$' "$DEPLOY" | head -1 | cut -d: -f1)
wait_line=$(grep -nE 'wait-for-prerender-publish\.sh' "$DEPLOY" | head -1 | cut -d: -f1)
probe_line=$(grep -nE 'check-prerender-delivery\.mjs' "$DEPLOY" | grep -v '^\s*#' | head -1 | cut -d: -f1)
collect_line=$(grep -nE '^\s*wait "\$WATCH_PID"' "$DEPLOY" | head -1 | cut -d: -f1)
if [ -n "$watch_start" ] && [ -n "$wait_line" ] && [ -n "$probe_line" ] && [ -n "$collect_line" ] \
    && [ "$watch_start" -lt "$wait_line" ] && [ "$wait_line" -lt "$probe_line" ] && [ "$probe_line" -lt "$collect_line" ]; then
    assert "deploy.sh: watch(bg) < wait-for-publish < probe < collect watch" 1
else
    echo "    watch_start=$watch_start wait=$wait_line probe=$probe_line collect=$collect_line"
    assert "deploy.sh: watch(bg) < wait-for-publish < probe < collect watch" 0
fi

echo ""
echo "Result: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
