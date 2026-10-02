#!/usr/bin/env bash
# Copyright © 2024–2026 Jasper Ford
# SPDX-License-Identifier: AGPL-3.0-or-later
# Author: Jasper Ford
# See NOTICE file for attribution and acknowledgements.
#
# F-123: the monthly restore drill must prove the ENCRYPTED OFFSITE copy can be
# restored, and must shout when it cannot.
#
# Runs scripts/restore-drill.sh against stub docker/rclone/curl and a real
# `age`. A wrong or missing key, an unencrypted or stale offsite file, an empty
# restore, or missing alert credentials must each fail the drill (exit 1) and,
# where credentials exist, send a Telegram alert. A good drill restores exactly
# the decrypted dump, sends a "passed" message and leaves no decrypted file.
#
# Run it in a throwaway container:
#   MSYS_NO_PATHCONV=1 docker run --rm -v "$PWD/scripts:/repo/scripts:ro" alpine:3.20 \
#     sh -c 'apk add -q bash age coreutils findutils && bash /repo/scripts/test/test-restore-drill-offsite.sh'

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="$REPO_ROOT/scripts/restore-drill.sh"
STUBS="$REPO_ROOT/scripts/test/backup-stubs"

for tool in age age-keygen gzip; do
    command -v "$tool" >/dev/null || { echo "SKIP-AS-FAIL: $tool not installed" >&2; exit 1; }
done

WORK="$(mktemp -d -t nexus-drill-test-XXXXXX)"
trap 'rm -rf "$WORK"' EXIT

FAILURES=0
pass() { echo "  ok   $1"; }
failt() { echo "  FAIL $1" >&2; FAILURES=$((FAILURES + 1)); }

age-keygen -o "$WORK/owner.txt" 2>/dev/null
age-keygen -o "$WORK/drill.txt" 2>/dev/null
age-keygen -o "$WORK/stranger.txt" 2>/dev/null
printf '%s\n%s\n' "$(age-keygen -y "$WORK/owner.txt")" "$(age-keygen -y "$WORK/drill.txt")" > "$WORK/recipients"

TODAY="$(date +%Y-%m-%d)"
OLD="$(date -d "@$(( $(date +%s) - 10 * 86400 ))" +%Y-%m-%d)"

printf -- '-- fake dump\nINSERT INTO users VALUES (1);\n-- Dump completed on %s\n' "$TODAY" | gzip > "$WORK/dump.sql.gz"

setup_case() {
    CASE="$WORK/$1"
    mkdir -p "$CASE/backups" "$CASE/remote/gdrive/nexus-backups" "$CASE/bin" "$CASE/tmp"
    REMOTE="$CASE/remote/gdrive/nexus-backups"
    printf 'DB_DATABASE=nexus\nDB_USERNAME=nexus\nDB_PASSWORD=secret\n' > "$CASE/.env"
    printf 'TELEGRAM_BOT_TOKEN=123:abc\nTELEGRAM_CHAT_ID=42\n' > "$CASE/alerts.env"
    for s in docker rclone curl; do
        cp "$STUBS/$s" "$CASE/bin/$s"
        chmod +x "$CASE/bin/$s"
    done
    : > "$CASE/curl.log"
    : > "$CASE/restored.sql"
}

put_encrypted() { age -R "$WORK/recipients" -o "$REMOTE/nexus_db_$1.sql.gz.age" "$WORK/dump.sql.gz"; }

run_drill() {
    env PATH="$CASE/bin:$PATH" \
        BACKUP_DIR="$CASE/backups" \
        ENV_FILE="$CASE/.env" \
        DRILL_TMP_PARENT="$CASE/tmp" \
        BACKUP_ALERT_ENV="$CASE/alerts.env" \
        DRILL_IDENTITY_FILE="$WORK/drill.txt" \
        FAKE_REMOTE_ROOT="$CASE/remote" \
        CURL_STUB_LOG="$CASE/curl.log" \
        DOCKER_STUB_RESTORE_FILE="$CASE/restored.sql" \
        "$@" \
        bash "$SCRIPT" > "$CASE/out.log" 2>&1
}

expect_fail() {  # $1 label, $2 text expected in the alert
    if [ "$DRILL_RC" -eq 0 ]; then failt "$1: drill exited 0"; tail -5 "$CASE/out.log" >&2; else pass "$1: drill exits non-zero"; fi
    if grep -q "RESTORE DRILL FAILED" "$CASE/curl.log" && grep -qi -- "$2" "$CASE/curl.log"; then
        pass "$1: Telegram failure alert mentions '$2'"
    else
        failt "$1: no Telegram failure alert mentioning '$2'"; cat "$CASE/curl.log" >&2
    fi
    [ -z "$(ls -A "$CASE/tmp")" ] && pass "$1: no downloaded/decrypted file left behind" || failt "$1: files left in drill temp dir"
}

# ---------------------------------------------------------------------------
echo "case 1: newest offsite copy is encrypted and opens with the drill key"
setup_case happy
put_encrypted "$OLD"
put_encrypted "$TODAY"
printf 'plain old file\n' | gzip > "$REMOTE/nexus_db_2026-04-01.sql.gz"
DRILL_RC=0; run_drill || DRILL_RC=$?
[ "$DRILL_RC" -eq 0 ] && pass "drill exits 0" || { failt "drill exited $DRILL_RC"; tail -20 "$CASE/out.log" >&2; }
gunzip -c "$WORK/dump.sql.gz" | cmp -s - "$CASE/restored.sql" && pass "restored exactly the decrypted dump" || failt "restored content differs from the dump"
grep -q "RESTORE DRILL PASSED" "$CASE/curl.log" && pass "Telegram 'passed' message sent" || failt "no Telegram 'passed' message"
grep -q "nexus_db_${TODAY}.sql.gz.age" "$CASE/out.log" && pass "drilled the newest file" || failt "did not drill the newest file"
grep -qi "unencrypted" "$CASE/curl.log" && pass "reports old unencrypted files still on Drive" || failt "did not report old unencrypted files on Drive"
[ -z "$(ls -A "$CASE/tmp")" ] && pass "no decrypted file left behind" || failt "decrypted file left behind"

# ---------------------------------------------------------------------------
echo "case 2: the drill key cannot open the file (wrong or lost key)"
setup_case wrong_key
put_encrypted "$TODAY"
DRILL_RC=0; run_drill DRILL_IDENTITY_FILE="$WORK/stranger.txt" || DRILL_RC=$?
expect_fail "wrong key" "decrypt"

echo "case 3: drill key file missing"
setup_case no_key
put_encrypted "$TODAY"
DRILL_RC=0; run_drill DRILL_IDENTITY_FILE="$WORK/nope.txt" || DRILL_RC=$?
expect_fail "missing key" "key"

echo "case 4: only unencrypted backups on Drive"
setup_case only_plain
cp "$WORK/dump.sql.gz" "$REMOTE/nexus_db_${TODAY}.sql.gz"
DRILL_RC=0; run_drill || DRILL_RC=$?
expect_fail "only plain" "no encrypted"

echo "case 5: a file named .age that is really plain gzip"
setup_case fake_age
cp "$WORK/dump.sql.gz" "$REMOTE/nexus_db_${TODAY}.sql.gz.age"
DRILL_RC=0; run_drill || DRILL_RC=$?
expect_fail "fake .age" "not encrypted"

echo "case 6: newest offsite copy is 10 days old"
setup_case stale
put_encrypted "$OLD"
DRILL_RC=0; run_drill || DRILL_RC=$?
expect_fail "stale" "days old"

echo "case 7: restore produced no rows"
setup_case empty_restore
put_encrypted "$TODAY"
DRILL_RC=0; run_drill STUB_ROW_COUNT=0 || DRILL_RC=$?
expect_fail "empty restore" "missing"

echo "case 8: no offsite remote configured"
setup_case no_remote
DRILL_RC=0; run_drill STUB_RCLONE_REMOTES="" || DRILL_RC=$?
expect_fail "no remote" "remote"

# ---------------------------------------------------------------------------
echo "case 9: good drill but no alert credentials — must still fail, loudly"
setup_case no_alerts
put_encrypted "$TODAY"
DRILL_RC=0; run_drill BACKUP_ALERT_ENV="$CASE/none.env" || DRILL_RC=$?
[ "$DRILL_RC" -ne 0 ] && pass "drill exits non-zero when it cannot report" || failt "drill exited 0 with no way to report"
grep -q "CANNOT SEND ALERT" "$CASE/out.log" && pass "says it cannot send alerts" || failt "silent about missing alert credentials"

echo "case 9b: good drill but Telegram REJECTS the message (e.g. revoked bot token)"
setup_case alert_rejected
put_encrypted "$TODAY"
DRILL_RC=0; run_drill STUB_CURL_HTTP_STATUS=401 || DRILL_RC=$?
[ "$DRILL_RC" -ne 0 ] && pass "drill exits non-zero when Telegram rejects its message" || failt "drill exited 0 although the alert was rejected"
grep -q "Telegram send failed" "$CASE/out.log" && pass "says the Telegram send failed" || failt "silent about the rejected alert"

echo "case 10: DRILL_SOURCE=local still drills the plain local dump (dev use)"
setup_case local_mode
cp "$WORK/dump.sql.gz" "$CASE/backups/nexus_db_${TODAY}.sql.gz"
DRILL_RC=0; run_drill DRILL_SOURCE=local BACKUP_ALERT_ENV="$CASE/none.env" || DRILL_RC=$?
[ "$DRILL_RC" -eq 0 ] && pass "local drill exits 0" || { failt "local drill exited $DRILL_RC"; tail -20 "$CASE/out.log" >&2; }

echo
if [ "$FAILURES" -gt 0 ]; then
    echo "FAILED: $FAILURES check(s)" >&2
    exit 1
fi
echo "PASS: restore drill proves the encrypted offsite copy"
