#!/usr/bin/env bash
# Copyright © 2024–2026 Jasper Ford
# SPDX-License-Identifier: AGPL-3.0-or-later
# Author: Jasper Ford
# See NOTICE file for attribution and acknowledgements.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TMP_DIR="$(mktemp -d -t nexus-prerender-plan-XXXXXX)"
trap 'rm -rf "$TMP_DIR"' EXIT

export PRERENDER_CONFIG_DIR="$TMP_DIR"
export PRERENDER_CODE_DIR="$REPO_ROOT"
export PRERENDER_OUTPUT_DIR="$TMP_DIR/output"
export NGINX_CONTAINER="test-prerender-nginx"

# shellcheck source=../prerender-tenants.sh
source "$REPO_ROOT/scripts/prerender-tenants.sh"
# The production script installs its own cleanup trap when sourced. This test
# owns only its temp directory and must never invoke Docker during teardown.
trap - EXIT INT TERM
trap 'rm -rf "$TMP_DIR"' EXIT

FORCE_RENDER=1
FILTER_TENANT=""
FILTER_ROUTES=""
EXISTING_CACHE_PATHS=""
STALE_CACHE_PATHS=""
RECENT_FAILURE_PATHS=""

PLAN_JSON='{"tenants":[{"tenant_id":2,"slug":"alpha","host":"app.example.test","prefix":"/alpha","routes":["/","/about","/blog/alpha-post","/page/custom-alpha"]},{"tenant_id":3,"slug":"bravo","host":"bravo.example.test","prefix":"","routes":["/","/about","/blog/bravo-post"]}]}'
MANIFEST="$TMP_DIR/manifest.json"

build_manifest_from_plan "$PLAN_JSON" "$MANIFEST"

python3 - "$MANIFEST" "$SELECTED_COUNT" "$TOTAL_COUNT" <<'PY'
import json
import sys

path, selected, total = sys.argv[1:]
with open(path, encoding='utf-8') as source:
    manifest = json.load(source)

entries = manifest['urls']
assert int(selected) == 7, selected
assert int(total) == 7, total
assert len(entries) == 7

by_tenant = {}
for entry in entries:
    by_tenant.setdefault(entry['tenantSlug'], set()).add(entry['route'])
    assert '//' not in entry['cachePath'], entry['cachePath']
    assert entry['tenantId'] in {'2', '3'}

assert by_tenant['alpha'] == {'/', '/about', '/blog/alpha-post', '/page/custom-alpha'}, by_tenant
assert by_tenant['bravo'] == {'/', '/about', '/blog/bravo-post'}, by_tenant
assert any(e['cachePath'] == 'app.example.test/alpha/index.html' for e in entries), entries
assert any(e['cachePath'] == 'bravo.example.test/index.html' for e in entries), entries
PY

if build_manifest_from_plan '{broken json' "$TMP_DIR/invalid.json"; then
    echo "FAIL: invalid tenant plan was accepted" >&2
    exit 1
fi

if build_manifest_from_plan \
    '{"tenants":[{"tenant_id":2,"slug":"alpha","host":"app.example.test","prefix":"/alpha","routes":["/"]},{"tenant_id":3,"slug":"bravo","host":"127.0.0.1","prefix":"","routes":["/"]}]}' \
    "$TMP_DIR/private-host.json"; then
    echo "FAIL: a partial plan containing a private target was accepted" >&2
    exit 1
fi

if build_manifest_from_plan \
    '{"tenants":[{"tenant_id":2,"slug":"alpha","host":"app.example.test","prefix":"/wrong-tenant","routes":["/"]}]}' \
    "$TMP_DIR/wrong-prefix.json"; then
    echo "FAIL: a plan with mismatched tenant prefix was accepted" >&2
    exit 1
fi

PRERENDER_ALLOW_PRIVATE_HOSTS=1
export PRERENDER_ALLOW_PRIVATE_HOSTS
if ! build_manifest_from_plan \
    '{"tenants":[{"tenant_id":2,"slug":"alpha","host":"localhost","prefix":"/alpha","routes":["/"]}]}' \
    "$TMP_DIR/local-dev.json"; then
    echo "FAIL: explicit local-development private-host opt-in was ignored" >&2
    exit 1
fi
PRERENDER_ALLOW_PRIVATE_HOSTS=0
export PRERENDER_ALLOW_PRIVATE_HOSTS

echo "PASS: tenant-aware manifest ingestion preserves tenant routes and rejects unsafe partial plans"

# ---------------------------------------------------------------------------
# Regression (2026-09-16): the platform master (tenant id 1) must be rendered
# at the APP HOST root, never at its own `tenants.domain` (project-nexus.ie is
# the sales site, whose snapshots nothing reads). The static floor used by
# every processor job (`--tenant X --routes ...`) went through
# build_manifest_static, which placed master at its own domain — and
# get_tenants() excluded id 1 outright, so a targeted master render found no
# tenant at all.
# ---------------------------------------------------------------------------

MASTER_ROWS="$(printf '1\tmaster\tproject-nexus.ie\t__NEXUS_EMPTY__\n2\talpha\t__NEXUS_EMPTY__\t__NEXUS_EMPTY__\n')"
PUBLIC_ROUTES=(/ /about)
build_manifest_static "$MASTER_ROWS" "app.example.test" "$TMP_DIR/static-master.json"

python3 - "$TMP_DIR/static-master.json" <<'PY'
import json, sys
with open(sys.argv[1], encoding='utf-8') as source:
    entries = json.load(source)['urls']
master = [e for e in entries if e['tenantId'] == '1']
assert len(master) == 2, entries
assert all(e['host'] == 'app.example.test' for e in master), master
assert not any(e['host'] == 'project-nexus.ie' for e in entries), entries
assert any(e['cachePath'] == 'app.example.test/index.html' for e in master), master
assert any(e['cachePath'] == 'app.example.test/about/index.html' for e in master), master
assert any(e['cachePath'] == 'app.example.test/alpha/index.html' for e in entries), entries
PY

# get_tenants() must not exclude the master. Capture the SQL it hands to the
# database container through a docker stub on PATH.
STUB_BIN="$TMP_DIR/stub-bin"
mkdir -p "$STUB_BIN"
cat > "$STUB_BIN/docker" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$*"
STUB
chmod +x "$STUB_BIN/docker"
QUERY_SENT="$(PATH="$STUB_BIN:$PATH" FILTER_TENANT="" get_tenants)"
case "$QUERY_SENT" in
    *"FROM tenants t"*) ;;
    *) echo "FAIL: get_tenants did not issue its tenant query via docker: $QUERY_SENT" >&2; exit 1 ;;
esac
case "$QUERY_SENT" in
    *"t.id <> 1"*|*"t.id != 1"*)
        echo "FAIL: get_tenants still excludes the platform master (id 1): $QUERY_SENT" >&2
        exit 1 ;;
esac

echo "PASS: master tenant is rendered at the app host root and is not excluded from get_tenants"

# ---------------------------------------------------------------------------
# Regression (2026-09-29): list_contains() must never report a present path as
# absent. It used to be `printf '%s\n' "$HAYSTACK" | grep -Fxq "$NEEDLE"` under
# `set -o pipefail`. `grep -q` exits at the first match; when printf still has
# bytes to write it dies of SIGPIPE, the pipeline returns 141, and the path is
# reported MISSING although it exists. Measured on production that day against
# the live 593-path snapshot list: 5-51 false "missing" results per pass, all
# exit 141, concentrated in the hosts that sort first. The deploy render then
# re-rendered that random handful (31-46 pages per deploy) as if missing, which
# is the only reason two of the nine home pages looked "refreshed" after the
# 29 Sep deploys while the other seven did not.
#
# A haystack well past any pipe's capacity, with the needle on the FIRST line,
# makes the old implementation lose that race every time, so this is a real
# red/green check rather than a probabilistic one.
# ---------------------------------------------------------------------------

BIG_HAYSTACK="$(
    printf 'aaa.example.test/index.html\n'
    for i in $(seq 1 20000); do
        printf 'zzz.example.test/blog/a-long-post-slug-for-pipe-capacity-%05d/index.html\n' "$i"
    done
    printf 'zzz.example.test/last/index.html'
)"

for needle in 'aaa.example.test/index.html' \
              'zzz.example.test/blog/a-long-post-slug-for-pipe-capacity-00001/index.html' \
              'zzz.example.test/last/index.html'; do
    for attempt in 1 2 3; do
        if ! list_contains "$needle" "$BIG_HAYSTACK"; then
            echo "FAIL: list_contains reported a present path as absent (attempt $attempt): $needle" >&2
            exit 1
        fi
    done
done

# Controls: exact whole-line match only, literal (not glob), empty never matches.
for absent in 'aaa.example.test' \
              'aaa.example.test/index.htm' \
              'example.test/index.html' \
              '*' \
              'aaa.example.test/*' \
              ''; do
    if list_contains "$absent" "$BIG_HAYSTACK"; then
        echo "FAIL: list_contains matched something that is not a whole line: '$absent'" >&2
        exit 1
    fi
done
if list_contains 'aaa.example.test/index.html' ''; then
    echo "FAIL: list_contains matched against an empty list" >&2
    exit 1
fi

# The planner decision itself: a snapshot that exists must not be selected as
# missing, and one that does not exist must be.
FORCE_RENDER=0
FILTER_TENANT=""
FILTER_ROUTES=""
EXISTING_CACHE_PATHS="$BIG_HAYSTACK"
STALE_CACHE_PATHS=""
RECENT_FAILURE_PATHS=""
if should_render_cache_path 'aaa.example.test/index.html'; then
    echo "FAIL: an existing snapshot was planned for re-render as if it were missing" >&2
    exit 1
fi
if ! should_render_cache_path 'aaa.example.test/about/index.html'; then
    echo "FAIL: a genuinely missing snapshot was not planned for render" >&2
    exit 1
fi
RECENT_FAILURE_PATHS="aaa.example.test/about/index.html"
if should_render_cache_path 'aaa.example.test/about/index.html'; then
    echo "FAIL: a missing snapshot inside its failure backoff was planned anyway" >&2
    exit 1
fi
RECENT_FAILURE_PATHS=""

echo "PASS: list_contains is exact and never loses a present path to SIGPIPE"
