#!/usr/bin/env bash
# Copyright © 2024–2026 Jasper Ford
# SPDX-License-Identifier: AGPL-3.0-or-later
# Author: Jasper Ford
# See NOTICE file for attribution and acknowledgements.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TEST_ROOT="$(mktemp -d -t nexus-prerender-publish-XXXXXX)"
trap 'rm -rf "$TEST_ROOT"' EXIT

export PRERENDER_CONFIG_DIR="$TEST_ROOT/config"
export PRERENDER_CODE_DIR="$REPO_ROOT"
export PRERENDER_OUTPUT_DIR="$TEST_ROOT/output"
export PRERENDER_PUBLISH_TEST_MODE=1
export PRERENDER_STATUS_OVERRIDE_LIST="$TEST_ROOT/prerender-status-overrides.list"
printf '"alpha.example.test/old/" "404";\n' > "$PRERENDER_STATUS_OVERRIDE_LIST"
export NGINX_CONTAINER="test-prerender-nginx"
mkdir -p "$PRERENDER_CONFIG_DIR"

# The production nginx image provides POSIX ACLs. Git Bash on Windows does
# not, so this filesystem-only harness supplies a no-op shim while exercising
# the exact publication transaction body.
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
mkdir -p "$PRERENDER_DIR" "$OUTPUT_DIR"
PRERENDER_PUBLISH_EPOCH="0123456789abcdef0123456789abcdef"
printf '%s\n' "$PRERENDER_PUBLISH_EPOCH" > "$PRERENDER_DIR/.publish-epoch"

# Run the container-side publication script directly against temporary local
# directories. This keeps the regression test independent of Docker while
# preserving the exact `docker exec ... sh -c` transaction body.
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

write_snapshot() {
    local root="$1" host="$2" body="$3" tenant_id="${4:-1}" tenant_slug="${5:-alpha}"
    local sidecar_newline="${6:-1}"
    mkdir -p "$root/$host"
    printf '%s\n' "$body" > "$root/$host/index.html"
    local hash bytes
    hash="$(sha256sum "$root/$host/index.html" | cut -d' ' -f1)"
    bytes="$(wc -c < "$root/$host/index.html" | tr -d ' ')"
    # 🔴 Both shapes must publish. This fixture wrote the checksum sidecar WITH
    # a trailing newline while prerender-worker.mjs wrote it WITHOUT one, and
    # that single byte is why this test stayed green for two months while the
    # real authoritative publish could never complete even once: POSIX `read`
    # returns non-zero at EOF on an unterminated final line, so
    # `read -r recorded_hash recorded_bytes < "$checksum"` aborted the publisher
    # under `set -e` on the first page it validated, silently. Cover the
    # unterminated shape so a revert of that tolerance fails here.
    if [ "$sidecar_newline" = "1" ]; then
        printf '%s  %s\n' "$hash" "$bytes" > "$root/$host/index.html.sha256"
    else
        printf '%s  %s' "$hash" "$bytes" > "$root/$host/index.html.sha256"
    fi
    printf '{"tenantId":%s,"tenantSlug":"%s","host":"%s"}\n' \
        "$tenant_id" "$tenant_slug" "$host" > "$root/$host/_tenant.json"
}

# A complete generation replaces every old host tree, including hosts that no
# longer belong to an active tenant.
write_snapshot "$PRERENDER_DIR" "alpha.example.test" "old-alpha"
write_snapshot "$PRERENDER_DIR" "retired.example.test" "stale-retired"
mkdir -p "$PRERENDER_DIR/status-only.example.test"
printf '503\n' > "$PRERENDER_DIR/status-only.example.test/_status"
printf 'old metadata\n' > "$PRERENDER_DIR/.last-run.json"

# alpha carries a newline-terminated sidecar, bravo an unterminated one — the
# exact shape prerender-worker.mjs produced in production. Both must publish.
write_snapshot "$OUTPUT_DIR" "alpha.example.test" "new-alpha" 1 alpha 1
write_snapshot "$OUTPUT_DIR" "bravo.example.test" "new-bravo" 2 bravo 0
printf '503\n' > "$OUTPUT_DIR/bravo.example.test/_status"
printf '{"success":2}\n' > "$OUTPUT_DIR/.prerender-results.json"
printf '%s\n' '{"urls":[' \
    '{"cachePath":"alpha.example.test/index.html","tenantId":"1","tenantSlug":"alpha","host":"alpha.example.test"},' \
    '{"cachePath":"bravo.example.test/index.html","tenantId":"2","tenantSlug":"bravo","host":"bravo.example.test"}' \
    ']}' | tr -d '\n' > "$OUTPUT_DIR/manifest.json"
printf '\n' >> "$OUTPUT_DIR/manifest.json"
printf 'alpha.example.test/index.html\nbravo.example.test/index.html\n' \
    > "$OUTPUT_DIR/.prerender-successes.txt"

inject_rendered_pages 2 1

grep -Fqx 'new-alpha' "$PRERENDER_DIR/alpha.example.test/index.html"
grep -Fqx 'new-bravo' "$PRERENDER_DIR/bravo.example.test/index.html"
[ ! -e "$PRERENDER_DIR/retired.example.test" ]
[ ! -e "$PRERENDER_DIR/status-only.example.test" ]
grep -Fq '"success":2' "$PRERENDER_DIR/.last-run.json"
grep -Fq 'generated transactionally' "$PRERENDER_STATUS_OVERRIDE_LIST"
grep -Fq '"bravo.example.test/" "503";' "$PRERENDER_STATUS_OVERRIDE_LIST"
[ -f "$PRERENDER_DIR/.tenant-identity-v1" ]
[ -z "$(find "$PRERENDER_DIR" -maxdepth 1 -type d -name '.publish-backup-*' -print -quit)" ]
[ -z "$(find "$PRERENDER_DIR" -maxdepth 1 -type d -name '.incoming-*' -print -quit)" ]

# Equal counts are not enough. A staged {alpha,charlie} set must not replace
# the expected {alpha,bravo} set advertised by the worker success manifest.
rm -rf "$OUTPUT_DIR"
write_snapshot "$OUTPUT_DIR" "alpha.example.test" "wrong-alpha"
write_snapshot "$OUTPUT_DIR" "charlie.example.test" "unexpected-charlie"
printf 'alpha.example.test/index.html\nbravo.example.test/index.html\n' \
    > "$OUTPUT_DIR/.prerender-successes.txt"
set +e
(
    set -e
    inject_rendered_pages 2 1
)
status=$?
set -e
[ "$status" -ne 0 ]
grep -Fqx 'new-alpha' "$PRERENDER_DIR/alpha.example.test/index.html"
grep -Fqx 'new-bravo' "$PRERENDER_DIR/bravo.example.test/index.html"
[ ! -e "$PRERENDER_DIR/charlie.example.test" ]
[ -z "$(find "$PRERENDER_DIR" -maxdepth 1 -type d -name '.incoming-*' -print -quit)" ]

# Simulate a power interruption after a new host was published but before the
# transaction committed. The next authoritative attempt must recover the old
# host and metadata before doing anything else. Deliberately fail the new
# attempt's count validation so the recovered state remains observable.
rm -rf "$OUTPUT_DIR"
mkdir -p "$OUTPUT_DIR/alpha.example.test"
printf 'incomplete-next-generation\n' > "$OUTPUT_DIR/alpha.example.test/index.html"
printf 'alpha.example.test/index.html\n' > "$OUTPUT_DIR/.prerender-successes.txt"

BROKEN_TX="$PRERENDER_DIR/.publish-backup-interrupted"
mkdir -p "$BROKEN_TX/hosts/alpha.example.test" "$BROKEN_TX/metadata"
printf 'last-known-good\n' > "$BROKEN_TX/hosts/alpha.example.test/index.html"
printf 'old-metadata\n' > "$BROKEN_TX/metadata/last-run.json"
printf '"alpha.example.test/old/" "404";\n' > "$BROKEN_TX/metadata/nginx-status-overrides.list"
printf 'publishing\n' > "$BROKEN_TX/state"
printf 'alpha.example.test\n' > "$BROKEN_TX/new-hosts"
printf 'alpha.example.test\n' > "$BROKEN_TX/published-hosts"
: > "$BROKEN_TX/current-host"
printf 'interrupted-new\n' > "$PRERENDER_DIR/alpha.example.test/index.html"
printf 'interrupted-metadata\n' > "$PRERENDER_DIR/.last-run.json"
printf '"alpha.example.test/new/" "410";\n' > "$PRERENDER_STATUS_OVERRIDE_LIST"

set +e
(
    set -e
    inject_rendered_pages 2 1
)
status=$?
set -e

[ "$status" -ne 0 ]
grep -Fqx 'last-known-good' "$PRERENDER_DIR/alpha.example.test/index.html"
grep -Fqx 'old-metadata' "$PRERENDER_DIR/.last-run.json"
grep -Fq 'old/" "404"' "$PRERENDER_STATUS_OVERRIDE_LIST"
[ -z "$(find "$PRERENDER_DIR" -maxdepth 1 -type d -name '.publish-backup-*' -print -quit)" ]
[ -z "$(find "$PRERENDER_DIR" -maxdepth 1 -type d -name '.incoming-*' -print -quit)" ]

echo "PASS: authoritative publication swaps complete host trees and recovers interrupted transactions"
