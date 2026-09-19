#!/usr/bin/env bash
# Copyright © 2024–2026 Jasper Ford
# SPDX-License-Identifier: AGPL-3.0-or-later
# Author: Jasper Ford
# See NOTICE file for attribution and acknowledgements.
#
# Regression (2026-09-19): the claim-output validator rejected a WHOLE-TENANT
# job. `prerender_jobs.routes IS NULL` is exported as `JOB_ROUTES=''`, and the
# guard tested it with `printf '%s' "$value" | grep -Eq '^[...]*$'`. An empty
# value makes printf write zero bytes, so grep reads zero lines, matches
# nothing, and exits 1 — the `*` saying "empty is allowed" could never be
# reached. The processor logged "FATAL: unsafe routes in claim output" and
# exited 1.
#
# The damage was not a lost tick: the claim transaction had ALREADY marked the
# row `running`, so each whole-tenant job was claimed and then orphaned with no
# worker behind it. An active job excludes its tenant from both freshness
# sweeps, so those tenants stopped being re-rendered for crawlers — the very
# freeze e085e25dc was written to end. Observed live on production at 12:46,
# 12:47 and 12:48 UTC on 2026-09-19, one orphan per tick, immediately after the
# starvation fix made jobs #7125, #7126 and #8035 claimable for the first time.
#
# The processor must accept an empty routes value and run the tenant WITHOUT
# --routes (a whole-tenant render). Scenario 2 is the control: a genuinely
# unsafe value must still be rejected, so scenario 1 cannot pass by the guard
# having been removed.
#
# Runs the real script from a temp copy so that $SCRIPT_DIR resolves next to a
# stub prerender-tenants.sh instead of the real renderer.
#
# 🔴 Needs flock/setsid/timeout, so it does NOT run on the Windows host. Run it
# in the container:
#   MSYS_NO_PATHCONV=1 docker exec nexus-php-app \
#     bash /var/www/html/scripts/test/test-prerender-processor-empty-routes.sh

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TMP_DIR="$(mktemp -d -t nexus-prerender-routes-XXXXXX)"
PASS=0
FAIL=0

cleanup() { rm -rf "$TMP_DIR"; }
trap cleanup EXIT

assert() {
    if [ "$2" = "1" ]; then echo "  PASS: $1"; PASS=$((PASS + 1)); else echo "  FAIL: $1"; FAIL=$((FAIL + 1)); fi
}

mkdir -p "$TMP_DIR/scripts" "$TMP_DIR/bin"
cp "$REPO_ROOT/scripts/prerender-job-processor.sh" "$TMP_DIR/scripts/"
PROCESSOR="$TMP_DIR/scripts/prerender-job-processor.sh"
WORKER_ARGS_LOG="$TMP_DIR/worker-args.log"

# Stub renderer: records the argv it was given and succeeds.
cat > "$TMP_DIR/scripts/prerender-tenants.sh" <<'WORKER'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "${WORKER_ARGS_LOG:?}"
echo "Planned 0 page(s) to refresh out of 0 candidate page(s)"
exit 0
WORKER
chmod +x "$TMP_DIR/scripts/prerender-tenants.sh"

# Docker stub. `docker ps` reports the app container up; `--claim-next` returns
# the claim output under test; every other exec (heartbeat, finalise) no-ops.
cat > "$TMP_DIR/bin/docker" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "${STUB_LOG:?}"
case "${1:-}" in
    ps) echo "stub-php-app" ;;
    exec)
        if printf '%s' "$*" | grep -q -- '--claim-next'; then
            cat "${CLAIM_FIXTURE:?}"
        fi
        ;;
esac
exit 0
STUB
chmod +x "$TMP_DIR/bin/docker"

export STUB_LOG="$TMP_DIR/docker.log"
export WORKER_ARGS_LOG
export PATH="$TMP_DIR/bin:$PATH"
export DEPLOY_DIR="$TMP_DIR"
export APP_CONTAINER="stub-php-app"
export PRERENDER_DOCKER_EXEC_TIMEOUT_SECONDS=5
export PRERENDER_MAX_RUN_SECONDS=300   # the processor's own floor; the stub renderer returns at once

write_claim() {
    # $1 = the routes value to place inside JOB_ROUTES='...'
    export CLAIM_FIXTURE="$TMP_DIR/claim.txt"
    {
        echo "JOB_ID=7126"
        echo "JOB_CLAIMED_BY='stub:1:aaaaaaaabbbbbbbbccccccccdddddddd'"
        echo "JOB_TENANT_SLUG='master'"
        echo "JOB_ROUTES='$1'"
        echo "JOB_FORCE=1"
        echo "JOB_DRY_RUN=0"
    } > "$CLAIM_FIXTURE"
}

echo "Scenario 1: whole-tenant job (empty routes) is accepted and rendered without --routes"
: > "$STUB_LOG"; : > "$WORKER_ARGS_LOG"
write_claim ""
OUT="$(bash "$PROCESSOR" 2>&1)"
RESULT=$?
if [ "$RESULT" -eq 0 ] \
    && ! printf '%s' "$OUT" | grep -q 'unsafe routes' \
    && grep -q -- '--tenant master' "$WORKER_ARGS_LOG" \
    && ! grep -q -- '--routes' "$WORKER_ARGS_LOG"; then
    assert "empty routes: accepted, whole-tenant render launched, no --routes passed" 1
else
    echo "    exit=$RESULT"; echo "    output: $OUT"
    echo "    worker argv:"; sed 's/^/      /' "$WORKER_ARGS_LOG"
    assert "empty routes: accepted, whole-tenant render launched, no --routes passed" 0
fi

echo "Scenario 2 (control): a genuinely unsafe routes value is still rejected"
: > "$STUB_LOG"; : > "$WORKER_ARGS_LOG"
write_claim '/about;rm -rf /`id`'
OUT="$(bash "$PROCESSOR" 2>&1)"
RESULT=$?
if [ "$RESULT" -eq 1 ] \
    && printf '%s' "$OUT" | grep -q 'unsafe routes' \
    && [ ! -s "$WORKER_ARGS_LOG" ]; then
    assert "unsafe routes: rejected, no render launched" 1
else
    echo "    exit=$RESULT"; echo "    output: $OUT"
    echo "    worker argv:"; sed 's/^/      /' "$WORKER_ARGS_LOG"
    assert "unsafe routes: rejected, no render launched" 0
fi

echo "Scenario 3 (control): an ordinary route list is still accepted and passed through"
: > "$STUB_LOG"; : > "$WORKER_ARGS_LOG"
write_claim '/,/about'
OUT="$(bash "$PROCESSOR" 2>&1)"
RESULT=$?
if [ "$RESULT" -eq 0 ] \
    && grep -q -- '--routes /,/about' "$WORKER_ARGS_LOG"; then
    assert "route list: accepted and forwarded verbatim" 1
else
    echo "    exit=$RESULT"; echo "    output: $OUT"
    echo "    worker argv:"; sed 's/^/      /' "$WORKER_ARGS_LOG"
    assert "route list: accepted and forwarded verbatim" 0
fi

echo ""
echo "Result: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
