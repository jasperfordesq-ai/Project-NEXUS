#!/usr/bin/env bash
# Copyright © 2024–2026 Jasper Ford
# SPDX-License-Identifier: AGPL-3.0-or-later
# Author: Jasper Ford
# See NOTICE file for attribution and acknowledgements.
#
# Monthly restore drill — verifies that the OFFSITE backup can actually be restored.
#
# Backups you've never restored aren't backups, and an encrypted backup whose
# key has gone missing is no backup at all. By default (DRILL_SOURCE=offsite)
# this script:
#   1. Finds the newest encrypted DB backup on the offsite remote
#      (nexus_db_*.sql.gz.age, written by server-nightly-backup.sh) and refuses
#      if there is none, if it is older than DRILL_MAX_AGE_DAYS, or if the file
#      is not really age-encrypted.
#   2. Downloads it and decrypts it with the drill's own key
#      (/opt/nexus-php/.backup-drill-key, root-only; its public half is one of
#      the recipients in /opt/nexus-php/.backup-age-recipients). If that key is
#      lost or wrong, the drill fails — within a month, not in a disaster.
#   3. Loads it into a throwaway MariaDB container (nexus-restore-drill).
#   4. Asserts row counts on a few critical tables are sane against the live DB.
#   5. Tears everything down, deletes the downloaded and decrypted files, and
#      sends a Telegram message either way (scripts/backup-alert.sh). A drill that
#      cannot send its message fails: a silent drill is the failure mode this
#      replaces.
#
# The drill key proves the pipeline and the server's key. It cannot prove the
# OWNER's keys still exist — that is the owner's key check
# (scripts/backup-decrypt.sh on the nexus_keycheck_*.txt.age file).
#
# Cron (installed by scripts/deploy/phases/install-backup-cron.sh):
#   0 4 1 * * root bash /opt/nexus-php/scripts/restore-drill.sh >> /opt/nexus-php/logs/restore-drill.log 2>&1
#
# Local dev drill (plain local dump, no offsite, alerts optional):
#   1. Dump the local DB the same way the nightly backup does:
#        DB_PASS=$(grep -E '^DB_(PASSWORD|PASS)=' .env | head -1 | cut -d= -f2 | tr -d '"')
#        mkdir -p /tmp/drill/backups
#        MYSQL_PWD="$DB_PASS" docker exec -e MYSQL_PWD nexus-php-db \
#          mariadb-dump -u nexus nexus | gzip > /tmp/drill/backups/nexus_db_$(date +%F).sql.gz
#   2. Run the drill against the local source container + that backup:
#        DRILL_SOURCE=local BACKUP_DIR=/tmp/drill/backups SOURCE_DB_CONTAINER=nexus-php-db \
#        ENV_FILE="$(pwd)/.env" DRILL_CONTAINER=nexus-restore-drill-local DRILL_PORT=33307 \
#          bash scripts/restore-drill.sh
#
# Tests: scripts/test/test-restore-drill-offsite.sh
#
# Exit codes:
#   0 — drill passed and was reported
#   1 — drill failed (or could not be reported), alert immediately

set -Eeuo pipefail
umask 077

DRILL_SOURCE="${DRILL_SOURCE:-offsite}"
BACKUP_DIR="${BACKUP_DIR:-/opt/nexus-php/backups}"
ENV_FILE="${ENV_FILE:-/opt/nexus-php/.env}"
SOURCE_DB_CONTAINER="${SOURCE_DB_CONTAINER:-nexus-php-db}"
DRILL_CONTAINER="${DRILL_CONTAINER:-nexus-restore-drill}"
DRILL_PORT="${DRILL_PORT:-33307}"
DRILL_IDENTITY_FILE="${DRILL_IDENTITY_FILE:-/opt/nexus-php/.backup-drill-key}"
DRILL_MAX_AGE_DAYS="${DRILL_MAX_AGE_DAYS:-3}"
DRILL_TMP_PARENT="${DRILL_TMP_PARENT:-/opt/nexus-php/backups}"
DRILL_PASS="$(head -c 16 /dev/urandom | base64 | tr -d '/+=')"
# Offsite drills must be able to report; local dev drills need not.
if [ "$DRILL_SOURCE" = "offsite" ]; then
    DRILL_REQUIRE_ALERTS="${DRILL_REQUIRE_ALERTS:-1}"
else
    DRILL_REQUIRE_ALERTS="${DRILL_REQUIRE_ALERTS:-0}"
fi
if [[ -z "${RCLONE_REMOTE:-}" ]] && command -v rclone &>/dev/null; then
    if rclone listremotes 2>/dev/null | grep -q "^gdrive:"; then
        RCLONE_REMOTE="gdrive:nexus-backups"
    fi
fi
RCLONE_REMOTE="${RCLONE_REMOTE:-}"

# shellcheck source=backup-alert.sh
source "$(dirname "${BASH_SOURCE[0]}")/backup-alert.sh"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
log()     { echo -e "${CYAN}→${NC} [$(date '+%H:%M:%S')] $1"; }
success() { echo -e "${GREEN}✓${NC} $1"; }
warn()    { echo -e "${YELLOW}⚠${NC} $1"; }

WORK_DIR=""
DRILLED="(none)"
NOTES=""

cleanup() {
    docker rm -f "$DRILL_CONTAINER" >/dev/null 2>&1 || true
    if [ -n "$WORK_DIR" ]; then rm -rf "$WORK_DIR"; fi
}

report() {  # $1 title, $2 body
    if ! backup_alert "$1" "$2"; then
        if [ "$DRILL_REQUIRE_ALERTS" = "1" ]; then
            echo -e "${RED}✗${NC} The drill result could not be reported, so the drill counts as FAILED." >&2
            return 1
        fi
    fi
    return 0
}

fail() {
    trap - ERR
    echo -e "${RED}✗${NC} $1"
    cleanup
    report "NEXUS RESTORE DRILL FAILED" \
        "$1

Backup drilled: ${DRILLED}
The offsite backup could NOT be shown to restore. Treat this as urgent: until it passes, assume the Google Drive copies cannot be used.${NOTES}" || true
    exit 1
}
trap 'fail "unexpected error on line $LINENO"' ERR
trap cleanup EXIT

# check_archive uploads|storage — download that night's encrypted volume
# archive, decrypt it straight into `tar -t` (no plaintext copy on disk) and
# require a complete, non-empty archive.
ARCHIVES=""
check_archive() {
    local kind="$1" name listing entries
    name="nexus_${kind}_${BACKUP_DATE}.tar.gz.age"
    listing="$(rclone lsf "$RCLONE_REMOTE" --include "$name" --max-depth 1)" \
        || fail "could not list $RCLONE_REMOTE for the $kind backup"
    grep -qxF "$name" <<<"$listing" \
        || fail "$kind backup $name (same night as the database) is missing on $RCLONE_REMOTE"
    rclone copyto "$RCLONE_REMOTE/$name" "$WORK_DIR/$name" || fail "download of $kind backup $name failed"
    [ "$(head -c 21 "$WORK_DIR/$name")" = "age-encryption.org/v1" ] \
        || fail "$kind backup $name on Google Drive is not encrypted (no age header)"
    entries="$(age -d -i "$DRILL_IDENTITY_FILE" "$WORK_DIR/$name" | tar -tzf - | wc -l)" \
        || fail "$kind backup $name could not be decrypted, or is not a complete archive"
    rm -f "$WORK_DIR/$name"
    [ "${entries:-0}" -gt 0 ] || fail "$kind backup $name is an empty archive"
    ARCHIVES="${ARCHIVES}
${kind}: ${name}, unlocked, ${entries} entries, archive complete"
    success "$kind: $name — ${entries} entries, archive complete"
}

# The public keys the nightly backup encrypts to, shortened, so the monthly
# message lets the owner see their own keys are still on the list.
RECIPIENTS_FILE="${BACKUP_AGE_RECIPIENTS_FILE:-/opt/nexus-php/.backup-age-recipients}"
recipient_summary() {
    if [ -r "$RECIPIENTS_FILE" ]; then
        grep -E '^age1' "$RECIPIENTS_FILE" | cut -c1-16 | sed 's/$/…/' | paste -sd' ' -
    else
        echo "(cannot read $RECIPIENTS_FILE)"
    fi
}

echo ""
echo "════════════════════════════════════════════════════════════"
echo "  RESTORE DRILL ($DRILL_SOURCE) — $(date '+%Y-%m-%d %H:%M:%S')"
echo "════════════════════════════════════════════════════════════"

mkdir -p "$DRILL_TMP_PARENT"
WORK_DIR="$(mktemp -d "$DRILL_TMP_PARENT/.restore-drill-XXXXXX")"

# 1. Find a backup to restore
if [ "$DRILL_SOURCE" = "offsite" ]; then
    [ -n "$RCLONE_REMOTE" ] || fail "no offsite remote configured (rclone remote 'gdrive:' not found)"
    command -v rclone >/dev/null 2>&1 || fail "rclone is not installed"
    command -v age >/dev/null 2>&1 || fail "age is not installed (apt-get install -y age)"
    [ -r "$DRILL_IDENTITY_FILE" ] || fail "drill key $DRILL_IDENTITY_FILE is missing or unreadable"

    log "Locating newest encrypted backup on $RCLONE_REMOTE..."
    LATEST="$(rclone lsf "$RCLONE_REMOTE" --include "nexus_db_*.sql.gz.age" --max-depth 1 | sort | tail -1)" \
        || fail "could not list $RCLONE_REMOTE"
    [ -n "$LATEST" ] || fail "no encrypted database backup (nexus_db_*.sql.gz.age) found on $RCLONE_REMOTE"
    DRILLED="$LATEST"

    # Every file in the folder that is not encrypted (.age, or an older .gpg),
    # whatever wrote it: nightly, pre-migration or one-off.
    if REMOTE_FILES="$(rclone lsf "$RCLONE_REMOTE" --files-only --max-depth 1)"; then
        PLAIN_LEFT="$(grep -vcE '\.(age|gpg)$' <<<"$REMOTE_FILES" || true)"
        [ -n "$REMOTE_FILES" ] || PLAIN_LEFT=0
    else
        PLAIN_LEFT="?"
    fi
    if [ "$PLAIN_LEFT" != "0" ]; then
        NOTES="
Note: ${PLAIN_LEFT} unencrypted file(s) are still in the Google Drive backups folder. Remove them once encrypted backups are proven."
        warn "${PLAIN_LEFT} old unencrypted file(s) still on $RCLONE_REMOTE"
    fi

    BACKUP_DATE="$(printf '%s' "$LATEST" | sed -n 's/^nexus_db_\([0-9]\{4\}-[0-9]\{2\}-[0-9]\{2\}\)\.sql\.gz\.age$/\1/p')"
    [ -n "$BACKUP_DATE" ] || fail "cannot read a date from $LATEST"
    AGE_DAYS=$(( ( $(date +%s) - $(date -d "$BACKUP_DATE" +%s) ) / 86400 ))
    if [ "$AGE_DAYS" -gt "$DRILL_MAX_AGE_DAYS" ]; then
        fail "newest encrypted backup $LATEST is ${AGE_DAYS} days old (limit ${DRILL_MAX_AGE_DAYS}) — the nightly offsite copy has stopped"
    fi
    log "Drilling: $LATEST (${AGE_DAYS} day(s) old)"

    rclone copyto "$RCLONE_REMOTE/$LATEST" "$WORK_DIR/$LATEST" || fail "download of $LATEST failed"
    [ "$(head -c 21 "$WORK_DIR/$LATEST")" = "age-encryption.org/v1" ] \
        || fail "$LATEST on Google Drive is not encrypted (no age header)"

    age -d -i "$DRILL_IDENTITY_FILE" -o "$WORK_DIR/drill.sql.gz" "$WORK_DIR/$LATEST" 2>"$WORK_DIR/age.err" \
        || fail "could not decrypt $LATEST with the drill key ($(head -c 200 "$WORK_DIR/age.err"))"
    rm -f "$WORK_DIR/$LATEST" "$WORK_DIR/age.err"
    BACKUP_FILE="$WORK_DIR/drill.sql.gz"
    success "Downloaded and decrypted with the drill key"

    # The uploads and storage archives from the SAME night must also unlock and
    # be complete archives — otherwise a restore would bring back the database
    # without members' files.
    check_archive uploads
    check_archive storage
else
    log "Locating most recent local backup..."
    BACKUP_FILE="$(ls -t "$BACKUP_DIR"/nexus_db_*.sql.gz 2>/dev/null | head -1 || true)"
    if [ -z "$BACKUP_FILE" ]; then
        BACKUP_FILE="$(ls -t "$BACKUP_DIR"/pre-migrate-*.sql.gz 2>/dev/null | head -1 || true)"
    fi
    [ -n "$BACKUP_FILE" ] || fail "No backups found in $BACKUP_DIR"
    DRILLED="$(basename "$BACKUP_FILE") (local)"
    log "Drilling: $DRILLED ($(du -sh "$BACKUP_FILE" | cut -f1))"
fi

# 2. Verify integrity before bothering to spin up MariaDB
gzip -t "$BACKUP_FILE" 2>/dev/null || fail "Backup gzip integrity failed"
gunzip -c "$BACKUP_FILE" | tail -3 | grep -q "Dump completed" \
    || warn "Dump-completed marker not found (older backups predate this check)"
success "Backup integrity OK"

# 3. Spin up a throwaway MariaDB container
log "Starting throwaway MariaDB container ($DRILL_CONTAINER)..."
docker rm -f "$DRILL_CONTAINER" >/dev/null 2>&1 || true  # in case a prior drill left one behind
docker run -d --rm \
    --name "$DRILL_CONTAINER" \
    -e MARIADB_ROOT_PASSWORD="$DRILL_PASS" \
    -e MARIADB_DATABASE=nexus \
    -p "127.0.0.1:${DRILL_PORT}:3306" \
    --health-cmd="mariadb-admin ping -h 127.0.0.1 -u root -p${DRILL_PASS}" \
    --health-interval=5s \
    --health-timeout=3s \
    --health-retries=20 \
    mariadb:10.11 \
    >/dev/null || fail "could not start the throwaway database"

# Wait for healthy
state="missing"
for _ in {1..40}; do
    state="$(docker inspect -f '{{.State.Health.Status}}' "$DRILL_CONTAINER" 2>/dev/null || echo missing)"
    [ "$state" = "healthy" ] && break
    sleep 2
done
[ "$state" = "healthy" ] || fail "Throwaway DB never became healthy"
success "Throwaway DB up"

# 4. Restore
log "Restoring dump into throwaway DB..."
gunzip -c "$BACKUP_FILE" \
    | MYSQL_PWD="$DRILL_PASS" docker exec -i -e MYSQL_PWD "$DRILL_CONTAINER" \
        mariadb -u root nexus \
    || fail "Restore failed"
rm -f "$BACKUP_FILE"
success "Restore complete"

# 5. Sanity check — assert critical tables exist + row counts are sane vs live
# grep -m1, not `| head -1`: with pipefail an .env holding both spellings of a
# key can SIGPIPE grep, which the ERR trap would report as a failed drill.
env_value() { grep -m1 -E "^$1=" "$ENV_FILE" | cut -d= -f2- | tr -d "\"\r"; }
DB_USER="$(env_value 'DB_(USERNAME|USER)')"
DB_PASS="$(env_value 'DB_(PASSWORD|PASS)')"
DB_NAME="$(env_value 'DB_(DATABASE|NAME)')"

count_drill() {
    MYSQL_PWD="$DRILL_PASS" docker exec -e MYSQL_PWD "$DRILL_CONTAINER" \
        mariadb -N -B -u root "$DB_NAME" -e "SELECT COUNT(*) FROM \`$1\`" 2>/dev/null || echo 0
}
count_live() {
    MYSQL_PWD="$DB_PASS" docker exec -e MYSQL_PWD "$SOURCE_DB_CONTAINER" \
        mariadb -N -B -u "$DB_USER" "$DB_NAME" -e "SELECT COUNT(*) FROM \`$1\`" 2>/dev/null || echo 0
}

VERIFY_FAILED=0
COUNTS=""
for table in tenants users laravel_migrations; do
    live="$(count_live "$table")"
    drill="$(count_drill "$table")"
    COUNTS="${COUNTS}
${table}: restored ${drill}, live ${live}"
    # Drill must be > 0 and <= live (live grows between backups + drill runs)
    if [ "${drill:-0}" -le 0 ]; then
        warn "$table: drill count $drill (expected > 0)"
        VERIFY_FAILED=1
    elif [ "${drill:-0}" -gt "${live:-0}" ]; then
        warn "$table: drill ($drill) > live ($live) — backup may be stale or live got truncated"
    else
        success "$table: drill=$drill live=$live"
    fi
done

if [ "$VERIFY_FAILED" -eq 1 ]; then
    fail "Restore drill FAILED — the backup restored but data is missing${COUNTS}"
fi

cleanup
trap - ERR
report "NEXUS RESTORE DRILL PASSED" \
    "Backup drilled: ${DRILLED}
It was downloaded, decrypted and loaded into a throwaway database.${COUNTS}
${ARCHIVES}

Backups are locked to these keys (check yours are listed): $(recipient_summary)

This proves the server's drill key. It does not prove your own keys: open the nexus_keycheck file with scripts/backup-decrypt.sh to check those.${NOTES}" \
    || { echo -e "${RED}✗${NC} Restore succeeded but the result could not be reported."; exit 1; }
success "Restore drill PASSED — the offsite backup is restorable"
echo ""
