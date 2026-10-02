#!/usr/bin/env bash
# Copyright © 2024–2026 Jasper Ford
# SPDX-License-Identifier: AGPL-3.0-or-later
# Author: Jasper Ford
# See NOTICE file for attribution and acknowledgements.
#
# F-541: the production settings file (/opt/nexus-php/.env) holds every
# platform secret, and it and seven .env.bak-* copies were readable by every
# local account (664/644). Every deploy now re-asserts owner-only (600) on the
# file and its backup copies, and stops if it cannot.
#
# Runs secure_env_file_permissions() from scripts/deploy/phases/validate-env.sh
# against a sandbox DEPLOY_DIR. Needs bash + GNU coreutils (stat -c); no root.
#   bash scripts/test/test-env-file-permissions.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WORK="$(mktemp -d -t nexus-env-perms-XXXXXX)"
trap 'chmod -R u+rwx "$WORK" 2>/dev/null; rm -rf "$WORK"' EXIT
FAILURES=0
pass() { echo "  ok   $1"; }
failt() { echo "  FAIL $1" >&2; FAILURES=$((FAILURES + 1)); }
mode() { stat -c %a "$1"; }

# Some filesystems (Windows/NTFS under Git Bash) ignore chmod. There the
# result would be meaningless, so say so and exit 2 (unavailable, never a pass).
probe="$WORK/probe"; : > "$probe"; chmod 640 "$probe" 2>/dev/null || true
if [ "$(mode "$probe")" != "640" ]; then
    echo "UNAVAILABLE: this filesystem ignores chmod; run on Linux (CI or a container)" >&2
    exit 2
fi
rm -f "$probe"

SECRET='not-a-real-secret-f541-sentinel'
DEPLOY="$WORK/opt/nexus-php"
mkdir -p "$DEPLOY"

run_check() {
    # A subshell, so the function's `exit 1` cannot end this test.
    # Detached mode makes the deploy's log helpers echo instead of tee-ing to
    # a LOG_FILE, exactly as `bluegreen-deploy.sh deploy --detach` runs them.
    ( export DEPLOY_DIR="$DEPLOY" __NEXUS_BLUEGREEN_DETACHED__=1
      # shellcheck source=../deploy/phases/validate-env.sh
      . "$REPO_ROOT/scripts/deploy/phases/validate-env.sh"
      secure_env_file_permissions ) > "$WORK/out.log" 2>&1
}

echo "case 1: open files are tightened to 600"
printf 'APP_KEY=%s\n' "$SECRET" > "$DEPLOY/.env"; chmod 664 "$DEPLOY/.env"
printf 'APP_KEY=%s\n' "$SECRET" > "$DEPLOY/.env.bak-legal-20260812"; chmod 644 "$DEPLOY/.env.bak-legal-20260812"
printf 'APP_KEY=%s\n' "$SECRET" > "$DEPLOY/.env.bak-20261002T170033Z-before-jira"; chmod 600 "$DEPLOY/.env.bak-20261002T170033Z-before-jira"
printf 'APP_KEY=\n' > "$DEPLOY/.env.example"; chmod 644 "$DEPLOY/.env.example"
if run_check; then pass "check succeeded"; else failt "check exited non-zero"; cat "$WORK/out.log" >&2; fi
[ "$(mode "$DEPLOY/.env")" = "600" ] && pass ".env is 600" || failt ".env is $(mode "$DEPLOY/.env")"
[ "$(mode "$DEPLOY/.env.bak-legal-20260812")" = "600" ] && pass "old backup copy is 600" || failt "old backup copy is $(mode "$DEPLOY/.env.bak-legal-20260812")"
[ "$(mode "$DEPLOY/.env.bak-20261002T170033Z-before-jira")" = "600" ] && pass "already-600 copy left at 600" || failt "already-600 copy changed"
[ "$(mode "$DEPLOY/.env.example")" = "644" ] && pass ".env.example (no secrets) untouched" || failt ".env.example changed to $(mode "$DEPLOY/.env.example")"
grep -q 'tightened' "$WORK/out.log" && pass "the log says what was tightened" || { failt "log does not say a file was tightened"; cat "$WORK/out.log" >&2; }
grep -q '664' "$WORK/out.log" && pass "the log shows the old mode" || failt "old mode not logged"
grep -qF "$SECRET" "$WORK/out.log" && failt "the log printed file contents" || pass "file contents never printed"

echo "case 2: second run is quiet and changes nothing"
run_check || failt "second run exited non-zero"
grep -q 'tightened' "$WORK/out.log" && failt "second run claimed to tighten something" || pass "nothing tightened on re-run"
grep -q 'owner-only' "$WORK/out.log" && pass "second run confirms owner-only" || failt "no confirmation logged"

echo "case 3: a missing .env is not this check's job (validate_environment reports it)"
mv "$DEPLOY/.env" "$WORK/env.saved"
run_check && pass "no .env: check does not fail" || failt "no .env: check failed"
mv "$WORK/env.saved" "$DEPLOY/.env"

echo "case 4: a file that cannot be tightened stops the deploy"
# Simulate chmod failing, which on the real host means a file the deploy
# cannot protect (wrong owner, read-only mount).
chmod 664 "$DEPLOY/.env"
mkdir -p "$WORK/bin"
printf '#!/usr/bin/env bash\nexit 1\n' > "$WORK/bin/chmod"; chmod +x "$WORK/bin/chmod"
if ( export PATH="$WORK/bin:$PATH"; run_check ); then
    failt "check passed although chmod failed"
else
    pass "check failed when the file could not be tightened"
fi
grep -q '.env' "$WORK/out.log" && pass "the failure names the file" || failt "failure does not name the file"
rm -rf "$WORK/bin"

if [ "$FAILURES" -ne 0 ]; then
    echo "$FAILURES failure(s)" >&2
    exit 1
fi
echo "all env-file permission checks passed"
