#!/usr/bin/env bash
# Copyright © 2024–2026 Jasper Ford
# SPDX-License-Identifier: AGPL-3.0-or-later
# Author: Jasper Ford
# See NOTICE file for attribution and acknowledgements.
#
# Contract test for scripts/git-hooks/pre-commit: every PHP process the hook
# starts in the app container runs as www-data, never as root.
#
# Why: the container bind-mounts the working tree. Until 2026-10-07 gate (B)
# ran the staged PHPUnit files as root, and Storage::fake('local') left
# root-owned directories under storage/framework/testing/disks/local (plus a
# root-owned .phpunit.cache). Every later run as www-data — the documented way —
# then failed those tests with "Failed to open directory: Permission denied".
# It happened three times in one day.
#
# No Docker needed: a stub `docker` earlier on PATH records every call, and the
# hook runs inside a throwaway git repository with one staged test file and one
# staged app/ PHP file, so gates (B) and (C) both fire.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
HOOK="$REPO_ROOT/scripts/git-hooks/pre-commit"
TMP_DIR="$(mktemp -d -t nexus-precommit-user-XXXXXX)"
trap 'rm -rf "$TMP_DIR"' EXIT

mkdir -p "$TMP_DIR/bin" "$TMP_DIR/repo"
CALLS="$TMP_DIR/docker-calls.txt"

# --- stub `docker` ------------------------------------------------------------
# One line per call, arguments space-joined. `docker ps` names the container so
# gate (C) runs; the `find … -user root` probe prints a path only when
# ROOT_OWNED=1, which drives the hand-back branch.
cat > "$TMP_DIR/bin/docker" <<'STUB'
#!/usr/bin/env bash
echo "$*" >> "$DOCKER_CALLS"
case "$1" in
    ps) echo nexus-php-app; exit 0 ;;
esac
for arg in "$@"; do
    case "$arg" in
        *"-user root"*) [ "${ROOT_OWNED:-0}" = 1 ] && echo storage/framework/testing/disks/local/x; exit 0 ;;
    esac
done
exit 0
STUB
chmod +x "$TMP_DIR/bin/docker"
export PATH="$TMP_DIR/bin:$PATH"
export DOCKER_CALLS="$CALLS"

cd "$TMP_DIR/repo"
git init -q
git config user.email test@example.invalid
git config user.name test
git config core.autocrlf false
mkdir -p tests/Unit app
printf '<?php\n' > tests/Unit/ExampleTest.php
printf '<?php\n' > app/Example.php
git add tests/Unit/ExampleTest.php app/Example.php

FAILURES=0
fail() { echo "FAIL: $1"; FAILURES=$((FAILURES + 1)); }

run_hook() {
    : > "$CALLS"
    ROOT_OWNED="$1" sh "$HOOK" >"$TMP_DIR/out.txt" 2>&1 || {
        cat "$TMP_DIR/out.txt"
        fail "hook exited non-zero with ROOT_OWNED=$1"
    }
}

check_calls() {
    local label="$1"
    # Not vacuous: both PHP gates must actually have reached the container.
    grep -q 'vendor/bin/phpunit --no-coverage' "$CALLS" || fail "$label: gate (B) never ran phpunit"
    grep -q 'audit-native-push-producers.php' "$CALLS" || fail "$label: gate (C) never ran the push audit"

    # Every exec that starts PHP names www-data.
    while IFS= read -r call; do
        case "$call" in
            exec*" php "*)
                case "$call" in
                    *"-u www-data "*) ;;
                    *) fail "$label: PHP started without -u www-data: $call" ;;
                esac ;;
        esac
    done < "$CALLS"

    # Root is used only for the ownership probe and the hand-back, never for PHP.
    if grep -E '(^| )-u root ' "$CALLS" | grep -qE ' php( |$)'; then
        fail "$label: a root exec started PHP"
    fi
}

# Clean tree: probe runs, nothing handed back.
run_hook 0
check_calls "clean"
grep -q 'chown' "$CALLS" && fail "clean: chown ran although nothing was root-owned"

# Damaged tree: root-owned scratch is handed back to www-data BEFORE phpunit.
run_hook 1
check_calls "root-owned"
CHOWN_LINE=$(grep -n 'chown -R www-data:www-data .phpunit.cache storage/framework/testing' "$CALLS" | cut -d: -f1 || true)
PHPUNIT_LINE=$(grep -n 'vendor/bin/phpunit --no-coverage' "$CALLS" | cut -d: -f1 || true)
if [ -z "$CHOWN_LINE" ]; then
    fail "root-owned: scratch dirs were not handed back to www-data"
elif [ -n "$PHPUNIT_LINE" ] && [ "$CHOWN_LINE" -gt "$PHPUNIT_LINE" ]; then
    fail "root-owned: hand-back ran after phpunit"
fi

if [ "$FAILURES" -ne 0 ]; then
    echo "pre-commit www-data contract: $FAILURES failure(s)"
    exit 1
fi
echo "pre-commit www-data contract: OK (PHP runs as www-data; root-owned test scratch is handed back first)"
