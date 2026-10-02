#!/usr/bin/env bash
# Copyright © 2024–2026 Jasper Ford
# SPDX-License-Identifier: AGPL-3.0-or-later
# Author: Jasper Ford
# See NOTICE file for attribution and acknowledgements.
#
# F-123: the deploy must install the monthly restore drill's cron as well as the
# nightly backup's. Until this test, nothing installed the drill, so whether it
# ran on production was unknown.
#
# Runs scripts/deploy/phases/install-backup-cron.sh as root in a sandbox (cron
# files redirected to a temp dir). Run it in a throwaway container:
#   MSYS_NO_PATHCONV=1 docker run --rm -v "$PWD/scripts:/repo/scripts:ro" alpine:3.20 \
#     sh -c 'apk add -q bash coreutils && bash /repo/scripts/test/test-install-backup-cron.sh'

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="$REPO_ROOT/scripts/deploy/phases/install-backup-cron.sh"
[ "$(id -u)" = "0" ] || { echo "must run as root (in a container)" >&2; exit 1; }

WORK="$(mktemp -d -t nexus-backup-cron-XXXXXX)"
trap 'rm -rf "$WORK"' EXIT
FAILURES=0
pass() { echo "  ok   $1"; }
failt() { echo "  FAIL $1" >&2; FAILURES=$((FAILURES + 1)); }

DEPLOY="$WORK/opt/nexus-php"
mkdir -p "$DEPLOY/scripts" "$DEPLOY/backups" "$WORK/cron.d"
: > "$DEPLOY/scripts/server-nightly-backup.sh"
: > "$DEPLOY/scripts/restore-drill.sh"
: > "$DEPLOY/backups/nexus_db_2026-10-01.sql.gz"   # existing dump ⇒ no seeding run

run_install() {
    env DEPLOY_DIR="$DEPLOY" \
        BACKUP_CRON_FILE="$WORK/cron.d/nexus-db-backup" \
        DRILL_CRON_FILE="$WORK/cron.d/nexus-restore-drill" \
        bash "$SCRIPT" > "$WORK/out.log" 2>&1
}

echo "case 1: fresh host — both cron files installed"
run_install || { failt "installer exited non-zero"; cat "$WORK/out.log" >&2; }
[ -f "$WORK/cron.d/nexus-db-backup" ] && pass "nightly backup cron installed" || failt "nightly backup cron missing"
drill="$WORK/cron.d/nexus-restore-drill"
if [ -f "$drill" ]; then
    pass "restore drill cron installed"
    grep -qxF "0 4 1 * * root bash $DEPLOY/scripts/restore-drill.sh >> $DEPLOY/logs/restore-drill.log 2>&1" "$drill" \
        && pass "drill runs 04:00 on the 1st, as root, logging to logs/restore-drill.log" \
        || { failt "drill cron line wrong"; cat "$drill" >&2; }
    [ "$(stat -c %a "$drill")" = "644" ] && pass "drill cron file is 0644" || failt "drill cron file mode $(stat -c %a "$drill")"
    [ -z "$(tail -c1 "$drill")" ] && pass "drill cron file ends with a newline" || failt "drill cron file has no trailing newline"
else
    failt "restore drill cron missing"
fi

echo "case 2: second deploy — idempotent, both still present"
before="$(cat "$WORK/cron.d/"* | sha256sum)"
run_install || failt "second run exited non-zero"
[ "$(cat "$WORK/cron.d/"* | sha256sum)" = "$before" ] && pass "unchanged on re-run" || failt "cron files changed on re-run"

echo "case 3: drift — a hand-edited drill cron is corrected"
echo "# edited" > "$drill"
run_install || failt "third run exited non-zero"
grep -q "restore-drill.sh" "$drill" && pass "drill cron restored after drift" || failt "drift not corrected"

echo
if [ "$FAILURES" -gt 0 ]; then echo "FAILED: $FAILURES check(s)" >&2; exit 1; fi
echo "PASS: deploy installs both backup crons"
