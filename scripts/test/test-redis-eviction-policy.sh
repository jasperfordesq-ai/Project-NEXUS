#!/usr/bin/env bash
# Copyright © 2024–2026 Jasper Ford
# SPDX-License-Identifier: AGPL-3.0-or-later
# Author: Jasper Ford
# See NOTICE file for attribution and acknowledgements.
#
# The shared Redis holds the queue (delayed jobs included), Horizon's records,
# the cache and every lock. Production ran `allkeys-lru` — a full Redis silently
# deletes ANY key — from 2026-05-01 to 2026-10-09, because the policy was fixed
# in a compose file whose container was never recreated, and that file was then
# deleted. This pins both halves:
#   1. the compose files: production Redis is defined (compose.redis.yml), on the
#      network and volume the blue/green colours use, and every Redis we run is
#      `noeviction`;
#   2. secure_redis_eviction_policy() in scripts/deploy/phases/validate-env.sh,
#      which every deploy runs: it re-asserts noeviction, reports usage and
#      evictions, and stops the deploy only if the policy cannot be set.
# Stubbed docker; no container, no network.
#   bash scripts/test/test-redis-eviction-policy.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WORK="$(mktemp -d -t nexus-redis-policy-XXXXXX)"
trap 'rm -rf "$WORK"' EXIT
FAILURES=0
pass() { echo "  ok   $1"; }
failt() { echo "  FAIL $1" >&2; FAILURES=$((FAILURES + 1)); }

# ---------------------------------------------------------------------------
echo "part 1: compose files"

PROD="$REPO_ROOT/compose.redis.yml"
if [ -f "$PROD" ]; then
    pass "compose.redis.yml exists"
    grep -q '^name: nexus-php$' "$PROD" && pass "project is nexus-php (recreates the live container, not a second one)" || failt "project name is not nexus-php"
    grep -q 'container_name: nexus-php-redis' "$PROD" && pass "container is nexus-php-redis" || failt "container_name is not nexus-php-redis"
    grep -q -- '--maxmemory-policy noeviction' "$PROD" && pass "production policy is noeviction" || failt "production policy is not noeviction"
    grep -q -- '--maxmemory [0-9]' "$PROD" && pass "production has a memory limit" || failt "production has no --maxmemory"
    grep -q -- '--appendonly yes' "$PROD" && pass "production keeps the append-only file" || failt "production lost --appendonly yes"
    grep -q '^      - nexus-php-internal$' "$PROD" && pass "on nexus-php-internal" || failt "not on nexus-php-internal"
    grep -q '^      - nexus-php-redis-data:/data$' "$PROD" && pass "uses the existing nexus-php-redis-data volume" || failt "does not mount nexus-php-redis-data"
    if awk '/^networks:/{n=1} n&&/external: true/{f=1} END{exit !f}' "$PROD" \
        && awk '/^volumes:/{v=1} v&&/external: true/{f=1} END{exit !f}' "$PROD"; then
        pass "network and volume are external (never created or removed by this file)"
    else
        failt "network or volume is not external"
    fi
    grep -qE '^\s+ports:' "$PROD" && failt "production Redis publishes a host port" || pass "no host port published"
else
    failt "compose.redis.yml is missing — production Redis has no definition"
fi

# The colours must point at the container this file defines, on its network.
BG="$REPO_ROOT/compose.bluegreen.yml"
grep -q 'REDIS_HOST=nexus-php-redis' "$BG" && pass "compose.bluegreen.yml uses REDIS_HOST=nexus-php-redis" || failt "compose.bluegreen.yml no longer names nexus-php-redis"
grep -q '^  nexus-php-internal:' "$BG" && pass "compose.bluegreen.yml joins nexus-php-internal" || failt "compose.bluegreen.yml network changed"

# No Redis we run may evict. Lines only, comments ignored.
offenders="$(cd "$REPO_ROOT" && grep -nE '^[^#]*--maxmemory-policy[[:space:]]+(allkeys|volatile)-' compose*.yml || true)"
if [ -z "$offenders" ]; then
    pass "no compose file uses an evicting policy"
else
    failt "evicting policy found: $offenders"
fi
for f in compose.yml compose.ci.yml; do
    grep -q -- '--maxmemory-policy noeviction' "$REPO_ROOT/$f" && pass "$f uses noeviction (matches production)" || failt "$f does not use noeviction"
done

grep -q '^    secure_redis_eviction_policy$' "$REPO_ROOT/scripts/deploy/bluegreen-deploy.sh" \
    && pass "bluegreen-deploy.sh runs the check on every deploy" \
    || failt "bluegreen-deploy.sh does not call secure_redis_eviction_policy"

# ---------------------------------------------------------------------------
echo "part 2: the deploy check"

STATE="$WORK/state"; mkdir -p "$STATE" "$WORK/bin"
cat > "$WORK/bin/docker" <<'STUB'
#!/usr/bin/env bash
# Minimal stand-in for `docker exec <c> redis-cli ...`, driven by files in $STUB_STATE.
S="$STUB_STATE"
echo "$*" >> "$S/calls"
[ "$1" = "exec" ] && [ "$3" = "redis-cli" ] || { echo "unexpected: $*" >&2; exit 99; }
shift 3
[ -f "$S/down" ] && { echo "Could not connect to Redis" >&2; exit 1; }
case "$1 ${2:-} ${3:-}" in
    "ping  ") printf 'PONG\r\n' ;;
    "CONFIG GET maxmemory-policy") printf 'maxmemory-policy\r\n%s\r\n' "$(cat "$S/policy")" ;;
    "CONFIG GET maxmemory") printf 'maxmemory\r\n%s\r\n' "$(cat "$S/max")" ;;
    "CONFIG SET maxmemory-policy")
        [ -f "$S/setfails" ] && { printf '(error) ERR denied\r\n'; exit 1; }
        printf '%s' "$4" > "$S/policy"; printf 'OK\r\n' ;;
    "INFO  ")
        printf '# Memory\r\nused_memory:%s\r\nused_memory_human:x\r\n# Stats\r\nevicted_keys:%s\r\nevicted_clients:0\r\n' \
            "$(cat "$S/used")" "$(cat "$S/evicted")" ;;
    *) echo "unexpected redis-cli: $*" >&2; exit 98 ;;
esac
STUB
chmod +x "$WORK/bin/docker"

reset_state() {
    rm -f "$STATE"/*
    printf '%s' "$1" > "$STATE/policy"
    printf '%s' "${2:-419430400}" > "$STATE/max"
    printf '%s' "${3:-2901208}" > "$STATE/used"
    printf '%s' "${4:-0}" > "$STATE/evicted"
}

run_check() {
    # A subshell, so the function's `exit 1` cannot end this test. Detached
    # mode makes the deploy's log helpers echo rather than tee to a LOG_FILE.
    ( export PATH="$WORK/bin:$PATH" STUB_STATE="$STATE" DEPLOY_DIR="$WORK" __NEXUS_BLUEGREEN_DETACHED__=1
      # shellcheck source=../deploy/phases/validate-env.sh
      . "$REPO_ROOT/scripts/deploy/phases/validate-env.sh"
      secure_redis_eviction_policy ) > "$WORK/out.log" 2>&1
}
log_has() { grep -q -- "$1" "$WORK/out.log"; }
show_log() { sed 's/^/        /' "$WORK/out.log" >&2; }

echo "case 1: already noeviction, nearly empty — quiet, nothing changed"
reset_state noeviction
if run_check; then pass "check succeeded"; else failt "check failed"; show_log; fi
grep -q 'CONFIG SET' "$STATE/calls" && failt "changed a policy that was already right" || pass "no CONFIG SET issued"
log_has 'noeviction; 2 MB of 400 MB used (0%), 0 key(s) discarded' && pass "reports usage and evictions" || { failt "summary line missing"; show_log; }
log_has 'WARN' && { failt "warned with nothing wrong"; show_log; } || pass "no warning"

echo "case 2: allkeys-lru (the state found on 2026-10-09) is corrected and reported"
reset_state allkeys-lru
if run_check; then pass "check succeeded"; else failt "check failed"; show_log; fi
[ "$(cat "$STATE/policy")" = "noeviction" ] && pass "policy is now noeviction" || failt "policy left as $(cat "$STATE/policy")"
log_has "was 'allkeys-lru'; set to noeviction" && pass "says what it was and what it set" || { failt "correction not logged"; show_log; }
log_has 'compose.redis.yml' && pass "points at the lasting fix" || failt "does not mention compose.redis.yml"

echo "case 3: volatile-lru is corrected too"
reset_state volatile-lru
run_check || { failt "check failed"; show_log; }
[ "$(cat "$STATE/policy")" = "noeviction" ] && pass "volatile-lru replaced" || failt "volatile-lru left in place"

echo "case 4: a policy that cannot be set stops the deploy"
reset_state allkeys-lru; : > "$STATE/setfails"
if run_check; then failt "check passed although the policy could not be set"; show_log; else pass "check exited non-zero"; fi
log_has 'could not be set to noeviction' && pass "says why it stopped" || { failt "no reason given"; show_log; }

echo "case 5: evictions since Redis started are reported"
reset_state noeviction 419430400 2901208 12
run_check || { failt "check failed"; show_log; }
log_has 'discarded 12 key(s)' && pass "eviction count reported" || { failt "evictions not reported"; show_log; }

echo "case 6: more than half full is a warning, not a stop"
reset_state noeviction 104857600 62914560 0
if run_check; then pass "check succeeded"; else failt "a full-ish Redis stopped the deploy"; show_log; fi
log_has 'Redis is 60% full' && pass "warns at 60%" || { failt "no fullness warning"; show_log; }

echo "case 7: no memory limit is reported"
reset_state noeviction 0
run_check || { failt "check failed"; show_log; }
log_has 'no memory limit' && pass "maxmemory 0 reported" || { failt "maxmemory 0 not reported"; show_log; }

echo "case 8: an unreachable Redis is reported, not fatal (as before this check)"
reset_state allkeys-lru; : > "$STATE/down"
if run_check; then pass "check succeeded"; else failt "unreachable Redis stopped the deploy"; show_log; fi
log_has 'unreachable' && pass "says it could not check" || { failt "silence when unreachable"; show_log; }
grep -q 'CONFIG' "$STATE/calls" && failt "tried CONFIG on an unreachable Redis" || pass "nothing attempted"

echo
if [ "$FAILURES" -eq 0 ]; then
    echo "PASS: Redis eviction policy"
else
    echo "FAIL: $FAILURES check(s) failed" >&2
    exit 1
fi
