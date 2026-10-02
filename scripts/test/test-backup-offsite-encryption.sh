#!/usr/bin/env bash
# Copyright © 2024–2026 Jasper Ford
# SPDX-License-Identifier: AGPL-3.0-or-later
# Author: Jasper Ford
# See NOTICE file for attribution and acknowledgements.
#
# F-123: the nightly backup must never send a readable file offsite.
#
# Runs scripts/server-nightly-backup.sh against stub docker/rclone/curl and a
# real `age`, then inspects what reached the fake Google Drive folder:
#   - only age-encrypted files, never the plain .gz/.tar.gz;
#   - each file opens with EITHER configured key on its own (key redundancy);
#   - no recipients / one recipient / failed upload ⇒ nothing plain is sent,
#     the run exits non-zero and a Telegram alert is attempted;
#   - with no offsite remote configured the local backup still succeeds.
#
# Needs bash, age, age-keygen, tar, gzip, coreutils, findutils. Run it in a
# throwaway container rather than on the Windows host:
#   MSYS_NO_PATHCONV=1 docker run --rm -v "$PWD/scripts:/repo/scripts:ro" alpine:3.20 \
#     sh -c 'apk add -q bash age coreutils findutils && bash /repo/scripts/test/test-backup-offsite-encryption.sh'

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="$REPO_ROOT/scripts/server-nightly-backup.sh"
STUBS="$REPO_ROOT/scripts/test/backup-stubs"

for tool in age age-keygen tar gzip; do
    command -v "$tool" >/dev/null || { echo "SKIP-AS-FAIL: $tool not installed" >&2; exit 1; }
done

WORK="$(mktemp -d -t nexus-backup-enc-XXXXXX)"
trap 'rm -rf "$WORK"' EXIT

FAILURES=0
pass() { echo "  ok   $1"; }
failt() { echo "  FAIL $1" >&2; FAILURES=$((FAILURES + 1)); }

age-keygen -o "$WORK/key-a.txt" 2>/dev/null
age-keygen -o "$WORK/key-b.txt" 2>/dev/null
PUB_A="$(age-keygen -y "$WORK/key-a.txt")"
PUB_B="$(age-keygen -y "$WORK/key-b.txt")"

# Fresh sandbox per case: backup dir, fake .env, fake remote, logs.
setup_case() {
    CASE="$WORK/$1"
    mkdir -p "$CASE/backups" "$CASE/remote" "$CASE/bin"
    printf 'DB_DATABASE=nexus\nDB_USERNAME=nexus\nDB_PASSWORD=secret\n' > "$CASE/.env"
    printf 'TELEGRAM_BOT_TOKEN=123:abc\nTELEGRAM_CHAT_ID=42\n' > "$CASE/alerts.env"
    for s in docker rclone curl; do
        cp "$STUBS/$s" "$CASE/bin/$s"
        chmod +x "$CASE/bin/$s"
    done
    : > "$CASE/curl.log"
    : > "$CASE/rclone.log"
}

run_backup() {
    env PATH="$CASE/bin:$PATH" \
        BACKUP_DIR="$CASE/backups" \
        ENV_FILE="$CASE/.env" \
        BACKUP_DATE="2026-10-02" \
        BACKUP_ALERT_ENV="$CASE/alerts.env" \
        FAKE_REMOTE_ROOT="$CASE/remote" \
        RCLONE_STUB_LOG="$CASE/rclone.log" \
        CURL_STUB_LOG="$CASE/curl.log" \
        "$@" \
        bash "$SCRIPT" > "$CASE/out.log" 2>&1
}

REMOTE_DIR_NAME="gdrive/nexus-backups"
plain_names=(nexus_db_2026-10-02.sql.gz nexus_uploads_2026-10-02.tar.gz nexus_storage_2026-10-02.tar.gz)

# ---------------------------------------------------------------------------
echo "case 1: two recipients — only encrypted files reach Drive, each key opens them"
setup_case happy
printf '# key A\n%s\n# key B\n%s\n' "$PUB_A" "$PUB_B" > "$CASE/recipients"
if run_backup BACKUP_AGE_RECIPIENTS_FILE="$CASE/recipients"; then
    pass "backup exits 0"
else
    failt "backup exited non-zero"; cat "$CASE/out.log" >&2
fi
remote="$CASE/remote/$REMOTE_DIR_NAME"
if [ -n "$(find "$remote" -type f ! -name '*.age' 2>/dev/null)" ]; then
    failt "a non-.age file reached the remote: $(find "$remote" -type f ! -name '*.age')"
else
    pass "no plain file on the remote"
fi
for n in "${plain_names[@]}"; do
    enc="$remote/$n.age"
    if [ ! -s "$enc" ]; then failt "$n.age missing from remote"; continue; fi
    [ "$(head -c 21 "$enc")" = "age-encryption.org/v1" ] && pass "$n.age has an age header" || failt "$n.age is not age-encrypted"
    if gzip -t "$enc" 2>/dev/null; then failt "$n.age is readable as gzip"; fi
    for k in a b; do
        if age -d -i "$WORK/key-$k.txt" "$enc" | cmp -s - "$CASE/backups/$n"; then
            pass "key $k alone decrypts $n to the local copy"
        else
            failt "key $k could not decrypt $n to the local copy"
        fi
    done
done
canary="$remote/nexus_keycheck_2026-10-02.txt.age"
if [ -s "$canary" ] && age -d -i "$WORK/key-b.txt" "$canary" | grep -q "Project NEXUS backup key check"; then
    pass "key-check canary uploaded and opens with key B"
else
    failt "key-check canary missing or does not open"
fi
for n in "${plain_names[@]}"; do
    [ -s "$CASE/backups/$n" ] && pass "local copy $n kept, plain" || failt "local copy $n missing"
done
[ -d "$CASE/backups/offsite" ] && failt "encrypted staging folder left behind on the server" || pass "encrypted staging folder cleaned up"
grep -q -- "--include nexus_\*.age" "$CASE/rclone.log" && grep -q '^rclone delete .*--min-age' "$CASE/rclone.log" \
    && pass "remote prune is limited to nexus_*.age" || failt "remote prune not limited to nexus_*.age"
if grep -q '^rclone sync' "$CASE/rclone.log"; then failt "rclone sync still used (would mirror plain files)"; else pass "no rclone sync"; fi
[ ! -s "$CASE/curl.log" ] && pass "no alert on success" || failt "alert sent on success"

# ---------------------------------------------------------------------------
echo "case 2: recipients file missing — nothing uploaded, loud failure"
setup_case no_recipients
if run_backup BACKUP_AGE_RECIPIENTS_FILE="$CASE/does-not-exist"; then
    failt "backup exited 0 with no recipients configured"
else
    pass "backup exits non-zero"
fi
[ -z "$(find "$CASE/remote" -type f 2>/dev/null)" ] && pass "nothing reached the remote" || failt "files reached the remote without encryption keys"
[ -s "$CASE/backups/nexus_db_2026-10-02.sql.gz" ] && pass "local backup still made" || failt "local backup not made"
grep -q "OFFSITE" "$CASE/curl.log" && pass "Telegram alert attempted" || failt "no Telegram alert attempted"
grep -q "123:abc" "$CASE/curl.log" && ! grep -q "^curl .*123:abc" "$CASE/curl.log" \
    && pass "bot token passed on stdin, not the command line" || failt "bot token visible on curl command line"

# ---------------------------------------------------------------------------
echo "case 3: only one recipient — refused (no spare key)"
setup_case one_recipient
printf '%s\n' "$PUB_A" > "$CASE/recipients"
if run_backup BACKUP_AGE_RECIPIENTS_FILE="$CASE/recipients"; then
    failt "backup exited 0 with a single recipient"
else
    pass "backup exits non-zero"
fi
[ -z "$(find "$CASE/remote" -type f 2>/dev/null)" ] && pass "nothing reached the remote" || failt "files reached the remote with a single key"

# ---------------------------------------------------------------------------
echo "case 4: upload fails — loud failure, alert"
setup_case upload_fails
printf '%s\n%s\n' "$PUB_A" "$PUB_B" > "$CASE/recipients"
if run_backup BACKUP_AGE_RECIPIENTS_FILE="$CASE/recipients" STUB_RCLONE_FAIL_COPY=1; then
    failt "backup exited 0 although the upload failed"
else
    pass "backup exits non-zero"
fi
grep -q "OFFSITE" "$CASE/curl.log" && pass "Telegram alert attempted" || failt "no Telegram alert attempted"
[ -d "$CASE/backups/offsite" ] && failt "encrypted staging folder left behind after failure" || pass "encrypted staging folder cleaned up after failure"

# ---------------------------------------------------------------------------
echo "case 5: no offsite remote configured — local backup only, exit 0"
setup_case no_remote
if run_backup STUB_RCLONE_REMOTES="" BACKUP_AGE_RECIPIENTS_FILE="$CASE/does-not-exist"; then
    pass "backup exits 0"
else
    failt "backup exited non-zero with offsite disabled"; cat "$CASE/out.log" >&2
fi
[ -z "$(find "$CASE/remote" -type f 2>/dev/null)" ] && pass "nothing uploaded" || failt "uploaded with no remote"

echo
if [ "$FAILURES" -gt 0 ]; then
    echo "FAILED: $FAILURES check(s)" >&2
    exit 1
fi
echo "PASS: nightly offsite backups are encrypted"
