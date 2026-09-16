#!/usr/bin/env bash
# Copyright © 2024–2026 Jasper Ford
# SPDX-License-Identifier: AGPL-3.0-or-later
# Author: Jasper Ford
# See NOTICE file for attribution and acknowledgements.
#
# Regression (2026-09-16): the once-a-minute prerender job processor claimed a
# job and started `prerender-tenants.sh --tenant ...` while a deploy's full
# render held the render lock. Lock-or-cancel then killed the deploy's render
# ~50 s in — after the master tenant's pages had rendered, before they were
# published — so app.project-nexus.ie kept serving crawlers the empty shell.
#
# The processor must skip its tick, without claiming anything, while the render
# lock is held. A control run with the lock released proves the guard is the
# only reason nothing was claimed.
#
# Run: bash scripts/test/test-prerender-processor-render-lock.sh

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PROCESSOR="$REPO_ROOT/scripts/prerender-job-processor.sh"
TMP_DIR="$(mktemp -d -t nexus-prerender-guard-XXXXXX)"
STUB_LOG="$TMP_DIR/docker.log"
PASS=0
FAIL=0
HOLDER_PID=""

cleanup() {
    [ -n "$HOLDER_PID" ] && kill "$HOLDER_PID" "$(cat "$TMP_DIR/holder.pid" 2>/dev/null)" 2>/dev/null
    rm -rf "$TMP_DIR"
}
trap cleanup EXIT

assert() {
    if [ "$2" = "1" ]; then echo "  PASS: $1"; PASS=$((PASS + 1)); else echo "  FAIL: $1"; FAIL=$((FAIL + 1)); fi
}

# Docker stub: the app container "is running"; any exec is recorded and returns
# nothing, which the processor reads as an empty queue.
mkdir -p "$TMP_DIR/bin"
cat > "$TMP_DIR/bin/docker" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "${STUB_LOG:?}"
case "${1:-}" in
    ps) echo "stub-php-app" ;;
    *) ;;
esac
STUB
chmod +x "$TMP_DIR/bin/docker"
export STUB_LOG
export PATH="$TMP_DIR/bin:$PATH"
export DEPLOY_DIR="$TMP_DIR"
export APP_CONTAINER="stub-php-app"
export PRERENDER_DOCKER_EXEC_TIMEOUT_SECONDS=5

RENDER_LOCK="$TMP_DIR/.prerender-lock.flock"

echo "Scenario 1: render lock held — the processor skips its tick and claims nothing"
: > "$STUB_LOG"
# `flock FILE CMD` hands the lock fd to CMD, so killing flock alone would leave
# the sleeper holding it. Record the sleeper's pid (exec keeps bash's pid).
flock "$RENDER_LOCK" bash -c 'echo "$$" > "$1"; exec sleep 120' _ "$TMP_DIR/holder.pid" &
HOLDER_PID=$!
for _ in $(seq 1 50); do
    if ! flock -n "$RENDER_LOCK" true 2>/dev/null; then break; fi
    sleep 0.1
done
if flock -n "$RENDER_LOCK" true 2>/dev/null; then
    echo "  SETUP FAILURE: could not hold the render lock"; exit 1
fi
OUT="$(bash "$PROCESSOR" 2>&1)"
RESULT=$?
if [ "$RESULT" -eq 0 ] && ! grep -q -- '--claim-next' "$STUB_LOG" \
    && printf '%s' "$OUT" | grep -qi 'render lock'; then
    assert "held lock: exit 0, no claim attempted, reason logged" 1
else
    echo "    exit=$RESULT"; echo "    output: $OUT"; echo "    docker calls:"; sed 's/^/      /' "$STUB_LOG"
    assert "held lock: exit 0, no claim attempted, reason logged" 0
fi
kill "$HOLDER_PID" "$(cat "$TMP_DIR/holder.pid" 2>/dev/null)" 2>/dev/null
wait "$HOLDER_PID" 2>/dev/null; HOLDER_PID=""
for _ in $(seq 1 50); do
    if flock -n "$RENDER_LOCK" true 2>/dev/null; then break; fi
    sleep 0.1
done
if ! flock -n "$RENDER_LOCK" true 2>/dev/null; then
    echo "  SETUP FAILURE: could not release the render lock"; exit 1
fi

echo "Scenario 2 (control): lock released — the processor does attempt a claim"
: > "$STUB_LOG"
OUT="$(bash "$PROCESSOR" 2>&1)"
RESULT=$?
if [ "$RESULT" -eq 0 ] && grep -q -- '--claim-next' "$STUB_LOG"; then
    assert "released lock: claim attempted" 1
else
    echo "    exit=$RESULT"; echo "    output: $OUT"; echo "    docker calls:"; sed 's/^/      /' "$STUB_LOG"
    assert "released lock: claim attempted" 0
fi

echo ""
echo "Result: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
