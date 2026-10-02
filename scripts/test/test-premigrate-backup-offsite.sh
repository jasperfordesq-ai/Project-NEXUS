#!/usr/bin/env bash
# Copyright © 2024–2026 Jasper Ford
# SPDX-License-Identifier: AGPL-3.0-or-later
# Author: Jasper Ford
# See NOTICE file for attribution and acknowledgements.
#
# F-123: the pre-migration backup (scripts/deploy/lib/db-backup.sh, taken by a
# deploy that has pending migrations) goes to the same Drive folder as the
# nightly backup. It must never upload a readable dump: age-encrypt it to the
# same recipients, or skip the offsite copy. Its offsite clean-up must touch
# only its own files.
#
# Run in a throwaway container:
#   MSYS_NO_PATHCONV=1 docker run --rm -v "$PWD/scripts:/repo/scripts:ro" alpine:3.20 \
#     sh -c 'apk add -q bash age coreutils findutils && bash /repo/scripts/test/test-premigrate-backup-offsite.sh'

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LIB="$REPO_ROOT/scripts/deploy/lib/db-backup.sh"
STUBS="$REPO_ROOT/scripts/test/backup-stubs"
WORK="$(mktemp -d -t nexus-premigrate-XXXXXX)"
trap 'rm -rf "$WORK"' EXIT
FAILURES=0
pass() { echo "  ok   $1"; }
failt() { echo "  FAIL $1" >&2; FAILURES=$((FAILURES + 1)); }

age-keygen -o "$WORK/a.txt" 2>/dev/null
age-keygen -o "$WORK/b.txt" 2>/dev/null
printf '%s\n%s\n' "$(age-keygen -y "$WORK/a.txt")" "$(age-keygen -y "$WORK/b.txt")" > "$WORK/recipients"

# run_case NAME [VAR=value ...] — calls db_backup_with_offsite in a subshell
# with the deploy library's log helpers replaced by plain echo.
run_case() {
    CASE="$WORK/$1"; shift
    mkdir -p "$CASE/deploy" "$CASE/backups" "$CASE/remote/gdrive/nexus-backups" "$CASE/bin"
    REMOTE="$CASE/remote/gdrive/nexus-backups"
    printf 'DB_NAME=nexus\nDB_USER=nexus\nDB_PASS=secret\n' > "$CASE/deploy/.env"
    for s in docker rclone; do cp "$STUBS/$s" "$CASE/bin/$s"; chmod +x "$CASE/bin/$s"; done
    : > "$CASE/rclone.log"
    (
        export PATH="$CASE/bin:$PATH" FAKE_REMOTE_ROOT="$CASE/remote" RCLONE_STUB_LOG="$CASE/rclone.log"
        export DEPLOY_DIR="$CASE/deploy" DB_BACKUP_DIR="$CASE/backups" LOG_FILE="$CASE/deploy.log"
        for kv in "$@"; do export "${kv?}"; done
        log_info() { echo "INFO $*"; }; log_ok() { echo "OK $*"; }
        log_warn() { echo "WARN $*"; }; log_err() { echo "ERR $*"; }
        # shellcheck source=../deploy/lib/db-backup.sh
        . "$LIB"
        db_backup_with_offsite nexus-php-app
    ) > "$CASE/out.log" 2>&1
}

echo "case 1: recipients configured — only an encrypted copy goes offsite"
if run_case enc BACKUP_AGE_RECIPIENTS_FILE="$WORK/recipients"; then pass "backup returns 0"; else failt "backup failed"; cat "$CASE/out.log" >&2; fi
local_plain="$(ls "$CASE/backups"/pre-migrate-*.sql.gz 2>/dev/null | head -1 || true)"
[ -s "$local_plain" ] && pass "local plain copy kept" || failt "local copy missing"
[ -z "$(ls "$CASE/backups"/*.age 2>/dev/null || true)" ] && pass "no encrypted leftover on the server" || failt "encrypted file left on the server"
[ -z "$(find "$REMOTE" -type f ! -name '*.age')" ] && pass "nothing readable on the remote" || failt "plain file on the remote: $(ls "$REMOTE")"
enc="$(ls "$REMOTE"/pre-migrate-*.sql.gz.age 2>/dev/null | head -1 || true)"
if [ -n "$enc" ]; then
    for k in a b; do
        age -d -i "$WORK/$k.txt" "$enc" | cmp -s - "$local_plain" && pass "key $k alone opens the offsite copy" || failt "key $k cannot open the offsite copy"
    done
else
    failt "no encrypted copy on the remote"
fi

echo "case 2: no encryption configured — offsite copy skipped, never plaintext"
if run_case none BACKUP_AGE_RECIPIENTS_FILE="$WORK/missing"; then pass "backup still returns 0 (deploy not blocked)"; else failt "backup failed"; fi
[ -z "$(find "$REMOTE" -type f)" ] && pass "nothing uploaded" || failt "uploaded without encryption: $(ls "$REMOTE")"
grep -qi "not encrypted\|skipp" "$CASE/out.log" && pass "warns that the offsite copy was skipped" || failt "no warning about skipped offsite copy"

echo "case 3: recipients file holds a broken key line — no upload"
{ cat "$WORK/recipients"; echo "age1brokenkey"; } > "$WORK/recipients-bad"
run_case badkey BACKUP_AGE_RECIPIENTS_FILE="$WORK/recipients-bad" || true
[ -z "$(find "$REMOTE" -type f)" ] && pass "nothing uploaded" || failt "uploaded despite encryption failure: $(ls "$REMOTE")"

echo "case 3b: one owner key + the server's drill key — not enough, no upload"
age-keygen -o "$WORK/drill.txt" 2>/dev/null
printf '%s\n%s\n' "$(age-keygen -y "$WORK/a.txt")" "$(age-keygen -y "$WORK/drill.txt")" > "$WORK/recipients-drill"
run_case drillonly BACKUP_AGE_RECIPIENTS_FILE="$WORK/recipients-drill" DRILL_IDENTITY_FILE="$WORK/drill.txt" || true
[ -z "$(find "$REMOTE" -type f)" ] && pass "nothing uploaded" || failt "uploaded with only one owner key"

echo "case 4: offsite clean-up touches only pre-migrate files"
mkdir -p "$WORK/prune/remote/gdrive/nexus-backups"
for f in nexus_db_2026-01-01.sql.gz.age pre-migrate-20260101-000000.sql.gz.age old-april-file.sql.gz; do
    printf 'x' > "$WORK/prune/remote/gdrive/nexus-backups/$f"
    touch -d '2026-01-01 00:00' "$WORK/prune/remote/gdrive/nexus-backups/$f"
done
run_case prune BACKUP_AGE_RECIPIENTS_FILE="$WORK/recipients" || true
[ -e "$REMOTE/nexus_db_2026-01-01.sql.gz.age" ] && pass "nightly file left alone" || failt "deleted a nightly backup"
[ -e "$REMOTE/old-april-file.sql.gz" ] && pass "unrelated file left alone" || failt "deleted an unrelated file"
[ ! -e "$REMOTE/pre-migrate-20260101-000000.sql.gz.age" ] && pass "old pre-migrate copy pruned" || failt "old pre-migrate copy not pruned"

echo
if [ "$FAILURES" -gt 0 ]; then echo "FAILED: $FAILURES check(s)" >&2; exit 1; fi
echo "PASS: pre-migration backups never go offsite unencrypted"
