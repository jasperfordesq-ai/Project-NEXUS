#!/usr/bin/env bash
# Copyright © 2024–2026 Jasper Ford
# SPDX-License-Identifier: AGPL-3.0-or-later
# Author: Jasper Ford
# See NOTICE file for attribution and acknowledgements.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CONF="$ROOT_DIR/react-frontend/nginx.bluegreen.conf"
TEST_ROOT="$(mktemp -d -t nexus-prerender-nginx-XXXXXX)"
CONTAINER="nexus-prerender-nginx-test-$$"
trap 'docker rm -f "$CONTAINER" >/dev/null 2>&1 || true; rm -rf "$TEST_ROOT"' EXIT

HTML="$TEST_ROOT/html"
PRERENDERED="$HTML/prerendered"
mkdir -p "$PRERENDERED/example.test/about" \
    "$PRERENDERED/example.test/gone" \
    "$HTML/locales/en" \
    "$TEST_ROOT/nginx"

printf '%s\n' 'SPA-SHELL' > "$HTML/index.html"
cp "$HTML/index.html" "$HTML/_spa.html"
printf '%s\n' '{"locale":"ok"}' > "$HTML/locales/en/common.json"
printf '%s\n' 'ROOT-SNAPSHOT' > "$PRERENDERED/example.test/index.html"
printf '%s\n' 'ABOUT-SNAPSHOT' > "$PRERENDERED/example.test/about/index.html"
printf '%s\n' '# ABOUT-MARKDOWN' > "$PRERENDERED/example.test/about/index.md"
printf '%s\n' 'GONE-SNAPSHOT' > "$PRERENDERED/example.test/gone/index.html"
printf '%s\n' 'v1' > "$PRERENDERED/.tenant-identity-v1"
printf '%s\n' \
    '"example.test/gone" "404";' \
    '"example.test/missing" "503";' \
    > "$PRERENDERED/.status-overrides.list"
# RFC 2307 SHA password for the literal password "secret".
printf '%s\n' 'prerender:{SHA}5en6G6MezRroT3XKqkdPOmY/BfQ=' \
    > "$PRERENDERED/.maintenance-render.htpasswd"
printf '%s\n' '"Basic cHJlcmVuZGVyOnNlY3JldA==" 1;' \
    > "$PRERENDERED/.maintenance-render-auth.list"
: > "$TEST_ROOT/nginx/trusted-bots.list"

docker run -d --rm \
    --name "$CONTAINER" \
    --add-host api:127.0.0.1 \
    -e NEXUS_API_UPSTREAM=api \
    -p 127.0.0.1::80 \
    -v "$CONF:/etc/nginx/templates/default.conf.template:ro" \
    -v "$HTML:/usr/share/nginx/html" \
    -v "$TEST_ROOT/nginx/trusted-bots.list:/etc/nginx/prerender-trusted-bot-ips.list:ro" \
    nginx:1.30-alpine >/dev/null

PORT="$(docker inspect --format '{{(index (index .NetworkSettings.Ports "80/tcp") 0).HostPort}}' "$CONTAINER")"
BASE="http://127.0.0.1:$PORT"
for _ in $(seq 1 40); do
    curl -fsS "$BASE/health" >/dev/null 2>&1 && break
    sleep 0.25
done
curl -fsS "$BASE/health" >/dev/null

request() {
    local expected_status="$1" expected_body="$2"
    shift 2
    local headers="$TEST_ROOT/headers" body="$TEST_ROOT/body" status
    status="$(curl -sS -D "$headers" -o "$body" -w '%{http_code}' "$@")"
    [ "$status" = "$expected_status" ] || {
        echo "Expected HTTP $expected_status, got $status for curl $*" >&2
        cat "$headers" >&2
        return 1
    }
    if [ -n "$expected_body" ]; then
        grep -Fq "$expected_body" "$body" || {
            echo "Expected body marker '$expected_body' for curl $*" >&2
            cat "$body" >&2
            return 1
        }
    fi
}

BOT='Googlebot/2.1'
AI_BOT='GPTBot/1.0'

request 200 SPA-SHELL -H 'Host: example.test' "$BASE/about"
request 200 '"locale":"ok"' -H 'Host: example.test' "$BASE/locales/en/common.json?v=test-build"
grep -Fqi 'content-type: application/json' "$TEST_ROOT/headers"
request 200 ROOT-SNAPSHOT -A "$BOT" -H 'Host: example.test' "$BASE/"
request 200 ABOUT-SNAPSHOT -A "$BOT" -H 'Host: example.test' "$BASE/about"
request 200 ABOUT-MARKDOWN -A "$AI_BOT" -H 'Host: example.test' "$BASE/about"
request 404 GONE-SNAPSHOT -A "$BOT" -H 'Host: example.test' "$BASE/gone"
grep -Fqi 'strict-transport-security:' "$TEST_ROOT/headers"
request 503 SPA-SHELL -A "$BOT" -H 'Host: example.test' "$BASE/missing"
request 200 SPA-SHELL -A "$BOT" -H 'Host: example.test' "$BASE/gone?nexus_prerender_bypass=1"

# The storage namespace and every operational sidecar are internal-only.
request 404 '' -H 'Host: example.test' "$BASE/prerendered/example.test/about/index.html"
request 404 '' -H 'Host: example.test' "$BASE/prerendered/example.test/about/_tenant.json"

# Before the first identity-bearing authoritative generation, crawlers receive
# the live SPA rather than legacy snapshots with unverifiable ownership.
rm -f "$PRERENDERED/.tenant-identity-v1"
request 200 SPA-SHELL -A "$BOT" -H 'Host: example.test' "$BASE/"
request 200 SPA-SHELL -A "$BOT" -H 'Host: example.test' "$BASE/about"
printf '%s\n' 'v1' > "$PRERENDERED/.tenant-identity-v1"

: > "$PRERENDERED/.global-maintenance"
request 503 '' -H 'Host: example.test' "$BASE/"
grep -Fqi 'x-nexus-maintenance: 1' "$TEST_ROOT/headers"
grep -Fqi 'content-security-policy:' "$TEST_ROOT/headers"
request 503 '' -H 'Host: example.test' "$BASE/about"
request 503 '' -H 'Host: example.test' "$BASE/index.html"
request 503 '' -H 'Host: example.test' "$BASE/about?nexus_prerender_bypass=1"
request 503 '' -u 'prerender:wrong' -H 'Host: example.test' "$BASE/about?nexus_prerender_bypass=1"
request 200 SPA-SHELL -u 'prerender:secret' -H 'Host: example.test' "$BASE/about?nexus_prerender_bypass=1"

echo 'PASS: nginx enforces tenant snapshot isolation, status codes, identity activation, and private maintenance rendering'
