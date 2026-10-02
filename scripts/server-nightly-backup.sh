#!/usr/bin/env bash
# Copyright © 2024–2026 Jasper Ford
# SPDX-License-Identifier: AGPL-3.0-or-later
# Author: Jasper Ford
# See NOTICE file for attribution and acknowledgements.
#
# Nightly Production Backup — database + Docker volumes
# Runs ON the production server (not from dev machine) — install via cron:
#
#   sudo crontab -e
#   0 2 * * * bash /opt/nexus-php/scripts/server-nightly-backup.sh >> /opt/nexus-php/backups/backup.log 2>&1
#
# What gets backed up:
#   nexus_db_YYYY-MM-DD.sql.gz        — full MariaDB dump
#   nexus_uploads_YYYY-MM-DD.tar.gz   — user-uploaded images/files (nexus-php-uploads volume)
#   nexus_storage_YYYY-MM-DD.tar.gz   — Laravel storage/ (nexus-php-storage volume)
#
# Retention: 7 daily backups per type. Older files are deleted automatically.
# The copies kept ON this server stay plain (fast restore, backup:verify).
#
# Offsite copy (rclone, F-123): ONLY age-encrypted files ever leave the server.
#   Each file is encrypted to every public key in /opt/nexus-php/.backup-age-recipients
#   (override: BACKUP_AGE_RECIPIENTS_FILE), one "age1..." key per line, at least
#   two. Any ONE matching private key opens a file, so losing one key is not
#   losing the backups. The server holds public keys only, plus the restore
#   drill's own key (see restore-drill.sh).
#   Uploaded: nexus_db_DATE.sql.gz.age, nexus_uploads_DATE.tar.gz.age,
#   nexus_storage_DATE.tar.gz.age and a tiny nexus_keycheck_DATE.txt.age the
#   owner opens with scripts/backup-decrypt.sh to prove a stored key still works.
#   Also uploaded: nexus_config_DATE.tar.gz.age — the server's .env (APP_KEY and
#   every credential), encrypted only; without APP_KEY a restored database's
#   encrypted columns cannot be read.
#   No keys, fewer than two OWNER keys (the drill key does not count), age
#   missing, no remote (unless BACKUP_OFFSITE_REQUIRED=0) or a failed upload ⇒
#   nothing is uploaded, the run exits 1 and a Telegram alert is sent
#   (scripts/backup-alert.sh). There is no plaintext fallback. Any other failure
#   of the job alerts too, and leaves only *.partial files behind.
#   Remote is auto-detected ("gdrive:nexus-backups") or set via RCLONE_REMOTE.

set -euo pipefail
# E-035 F-203: every backup holds the whole platform (database, uploads incl.
# vetting documents, storage). Create files owner-only so no other local account
# on the host can read them.
umask 077

# Paths are overridable so scripts/test/test-backup-offsite-encryption.sh can
# run this script in a sandbox; production uses the defaults.
BACKUP_DIR="${BACKUP_DIR:-/opt/nexus-php/backups}"
UPLOADS_VOLUME="${UPLOADS_VOLUME:-nexus-php-uploads}"
STORAGE_VOLUME="${STORAGE_VOLUME:-nexus-php-storage}"
ENV_FILE="${ENV_FILE:-/opt/nexus-php/.env}"
DB_CONTAINER="${DB_CONTAINER:-nexus-php-db}"
KEEP_DAYS="${KEEP_DAYS:-7}"
DATE="${BACKUP_DATE:-$(date +%Y-%m-%d)}"
# Auto-detect the rclone gdrive remote if not set explicitly.
if [[ -z "${RCLONE_REMOTE:-}" ]] && command -v rclone &>/dev/null; then
    if rclone listremotes 2>/dev/null | grep -q "^gdrive:"; then
        RCLONE_REMOTE="gdrive:nexus-backups"
    fi
fi
RCLONE_REMOTE="${RCLONE_REMOTE:-}"
# Production default: no offsite remote is a FAILURE, not a quiet skip — a
# rebuilt server gets its cron back from the deploy but not its Drive sign-in.
# Set BACKUP_OFFSITE_REQUIRED=0 only for a deliberate local-only run.
BACKUP_OFFSITE_REQUIRED="${BACKUP_OFFSITE_REQUIRED:-1}"
AGE_RECIPIENTS_FILE="${BACKUP_AGE_RECIPIENTS_FILE:-/opt/nexus-php/.backup-age-recipients}"
DRILL_IDENTITY_FILE="${DRILL_IDENTITY_FILE:-/opt/nexus-php/.backup-drill-key}"
MIN_OWNER_KEYS=2
OFFSITE_DIR="${BACKUP_DIR}/offsite"

# shellcheck source=backup-alert.sh
source "$(dirname "${BASH_SOURCE[0]}")/backup-alert.sh"

log()     { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1"; }
success() { log "✓ $1"; }
# Any failure of the nightly job is reported, not just the offsite step.
# Unverified artefacts only ever exist as *.partial, so a failure can never
# leave a broken file under a name backup:verify or the drill would accept.
fail()    {
    trap - ERR
    log "✗ ERROR: $1"
    rm -f "$BACKUP_DIR"/*.partial
    rm -rf "$OFFSITE_DIR"
    backup_alert "NEXUS NIGHTLY BACKUP FAILED" "$1. Tonight's backup was not completed." || true
    exit 1
}
# set -E + ERR trap: a command that fails outside an explicit check (docker,
# tar, mkdir…) is reported through fail() instead of exiting silently.
set -E
trap 'fail "unexpected error on line $LINENO"' ERR

log "=== Nightly backup starting ==="
mkdir -p "$BACKUP_DIR"
# E-035 F-203/F-205: files are 0600 (umask 077 above, chmod 600 below); the
# directory is 0755 so the www-data scheduler's backup:verify can list it and
# read file dates. Names and dates are not sensitive; contents are.
chmod 755 "$BACKUP_DIR"
rm -f "$BACKUP_DIR"/*.partial

# ---------------------------------------------------------------------------
# 1. Database
# ---------------------------------------------------------------------------
DB_BACKUP="${BACKUP_DIR}/nexus_db_${DATE}.sql.gz"

# grep -m1, not `| head -1` (pipefail + SIGPIPE when both spellings exist);
# keep everything after the first `=`; strip quotes and CR.
env_value() { grep -m1 -E "^$1=" "$ENV_FILE" | cut -d= -f2- | tr -d "\"\r"; }
DB_NAME=$(env_value 'DB_(DATABASE|NAME)' || true)
DB_USER=$(env_value 'DB_(USERNAME|USER)' || true)
DB_PASS=$(env_value 'DB_(PASSWORD|PASS)' || true)

if [[ -z "${DB_NAME:-}" || -z "${DB_USER:-}" || -z "${DB_PASS:-}" ]]; then
    fail "Could not read DB credentials from $ENV_FILE"
fi

log "Dumping database: $DB_NAME → $DB_BACKUP"
MYSQL_PWD="$DB_PASS" docker exec -e MYSQL_PWD "$DB_CONTAINER" \
    mariadb-dump -u "$DB_USER" "$DB_NAME" \
    | gzip > "$DB_BACKUP.partial" \
    || fail "Database dump failed"

[[ -s "$DB_BACKUP.partial" ]] || fail "Database backup is empty"
# A dump cut short (database restarted mid-dump, disk full) must never become
# tonight's backup: it would restore as a database with tables missing.
gzip -t "$DB_BACKUP.partial" 2>/dev/null || fail "Database backup is not a valid gzip file"
DUMP_TAIL="$(gunzip -c "$DB_BACKUP.partial" | tail -n 3)"   # captured: no grep -q in a pipe
grep -q "Dump completed" <<<"$DUMP_TAIL" \
    || fail "Database backup is incomplete (no 'Dump completed' line at the end)"
mv "$DB_BACKUP.partial" "$DB_BACKUP"
success "Database backup — $(du -sh "$DB_BACKUP" | cut -f1)"

# ---------------------------------------------------------------------------
# 2–3. Uploads and Laravel storage volumes
# ---------------------------------------------------------------------------
# backup_volume VOLUME OUTFILE LABEL — tar the volume via a helper container,
# then prove the archive is complete and holds at least one file.
backup_volume() {
    local volume="$1" out="$2" label="$3" name listing files
    name="$(basename "$out")"
    # `docker run -v NAME:` silently CREATES an empty volume when NAME is
    # wrong; refuse instead of backing up nothing.
    docker volume inspect "$volume" >/dev/null 2>&1 \
        || fail "$label volume '$volume' does not exist"
    log "Backing up $label volume ($volume) → $out"
    docker run --rm \
        -v "${volume}:/data:ro" \
        -v "${BACKUP_DIR}:/out" \
        alpine \
        tar czf "/out/${name}.partial" -C /data . \
        || fail "$label backup failed (tar)"
    [[ -s "$out.partial" ]] || fail "$label backup is empty"
    listing="$(tar -tzf "$out.partial")" || fail "$label backup is not a complete archive"
    files="$(grep -vc '/$' <<<"$listing" || true)"
    [[ "${files:-0}" -gt 0 ]] || fail "$label backup contains no files (wrong or empty volume '$volume'?)"
    mv "$out.partial" "$out"
    success "$label backup — $(du -sh "$out" | cut -f1), ${files} files"
}

UPLOADS_BACKUP="${BACKUP_DIR}/nexus_uploads_${DATE}.tar.gz"
STORAGE_BACKUP="${BACKUP_DIR}/nexus_storage_${DATE}.tar.gz"
backup_volume "$UPLOADS_VOLUME" "$UPLOADS_BACKUP" "Uploads"
backup_volume "$STORAGE_VOLUME" "$STORAGE_BACKUP" "Storage"

# The two tarballs above are written by a helper container, which ignores this
# script's umask, so tighten them here — and any backup left world-readable by an
# earlier run (E-035 F-203).
find "$BACKUP_DIR" -maxdepth 1 -type f -exec chmod 600 {} +

# ---------------------------------------------------------------------------
# 4. Rotation — keep last KEEP_DAYS per type
# ---------------------------------------------------------------------------
log "Rotating old backups (keeping last $KEEP_DAYS days each)..."
for pattern in "nexus_db_*.sql.gz" "nexus_uploads_*.tar.gz" "nexus_storage_*.tar.gz"; do
    find "$BACKUP_DIR" -maxdepth 1 -name "$pattern" -mtime +"$KEEP_DAYS" -delete
done
REMAINING=$(find "$BACKUP_DIR" -maxdepth 1 -name "nexus_*.gz" | wc -l)
log "Rotation done — $REMAINING file(s) retained"

# ---------------------------------------------------------------------------
# 5. Offsite copy — encrypted with age, or not at all (F-123)
# ---------------------------------------------------------------------------
offsite_fail() {
    trap - ERR
    rm -rf "$OFFSITE_DIR"
    log "✗ OFFSITE COPY NOT MADE: $1"
    log "  The local backups above are fine; Google Drive did NOT get tonight's copy."
    backup_alert "NEXUS NIGHTLY BACKUP — OFFSITE COPY FAILED" \
        "$1. The backups on the server were made, but nothing was sent to Google Drive tonight. Nothing unencrypted was uploaded." \
        || true
    exit 1
}

encrypt_for_offsite() {
    local src="$1" out
    out="$OFFSITE_DIR/$(basename "$1").age"
    age -R "$AGE_RECIPIENTS_FILE" -o "$out" "$src" || offsite_fail "encrypting $(basename "$src") failed"
    # Belt and braces: the uploaded file must carry the age header and must
    # not be readable as the gzip it came from.
    [ "$(head -c 21 "$out")" = "age-encryption.org/v1" ] \
        || offsite_fail "$(basename "$out") does not look age-encrypted"
    if gzip -t "$out" 2>/dev/null; then
        offsite_fail "$(basename "$out") is still readable as gzip"
    fi
}

if [[ -z "$RCLONE_REMOTE" ]]; then
    if [[ "$BACKUP_OFFSITE_REQUIRED" == "1" ]]; then
        offsite_fail "no offsite remote configured (rclone remote 'gdrive:' not found — has the Drive sign-in been set up on this server?)"
    fi
    log "Offsite copy disabled for this run (BACKUP_OFFSITE_REQUIRED=0)"
else
    command -v rclone &>/dev/null || offsite_fail "RCLONE_REMOTE is set but rclone is not installed"
    command -v age &>/dev/null    || offsite_fail "age is not installed (apt-get install -y age)"
    [[ -r "$AGE_RECIPIENTS_FILE" ]] || offsite_fail "no encryption keys: $AGE_RECIPIENTS_FILE is missing"

    # Count the OWNER's keys: the drill key lives on this server and dies with
    # it, so it cannot be one of the two keys that make a loss survivable.
    DRILL_PUB=""
    if [[ -r "$DRILL_IDENTITY_FILE" ]]; then
        DRILL_PUB="$(age-keygen -y "$DRILL_IDENTITY_FILE" 2>/dev/null || true)"
    fi
    ALL_KEYS="$(grep -E '^age1[0-9a-z]+$' "$AGE_RECIPIENTS_FILE" || true)"
    OWNER_KEYS="$(grep -vxF "${DRILL_PUB:-none}" <<<"$ALL_KEYS" | grep -c . || true)"
    (( OWNER_KEYS >= MIN_OWNER_KEYS )) \
        || offsite_fail "only ${OWNER_KEYS} owner encryption key(s) in $AGE_RECIPIENTS_FILE (not counting the drill key); at least ${MIN_OWNER_KEYS} are required so one lost key cannot lose the backups"

    rm -rf "$OFFSITE_DIR"
    mkdir -m 700 "$OFFSITE_DIR"
    log "Encrypting offsite copies to ${OWNER_KEYS} owner key(s)${DRILL_PUB:+ + the drill key}..."

    KEYCHECK="${OFFSITE_DIR}/nexus_keycheck_${DATE}.txt"
    {
        echo "Project NEXUS backup key check"
        echo "backup date: $DATE"
        echo "host: $(hostname 2>/dev/null || echo unknown)"
        echo "If you can read this, your key opens the $DATE backups."
    } > "$KEYCHECK"

    # The server's configuration (.env): holds APP_KEY, without which the
    # encrypted database columns (2FA secrets, encrypted identities, tokens)
    # cannot be read after a restore, plus every other credential. It goes
    # offsite ENCRYPTED only, and no plain copy is kept in the backups folder.
    CONFIG_ARCHIVE="${OFFSITE_DIR}/nexus_config_${DATE}.tar.gz"
    grep -q '^APP_KEY=.\+' "$ENV_FILE" || offsite_fail "$ENV_FILE has no APP_KEY — refusing to back up an incomplete configuration"
    tar czf "$CONFIG_ARCHIVE" -C "$(dirname "$ENV_FILE")" "$(basename "$ENV_FILE")" \
        || offsite_fail "could not archive $ENV_FILE"

    for f in "$DB_BACKUP" "$UPLOADS_BACKUP" "$STORAGE_BACKUP" "$CONFIG_ARCHIVE" "$KEYCHECK"; do
        encrypt_for_offsite "$f"
    done
    rm -f "$KEYCHECK" "$CONFIG_ARCHIVE"
    success "Encrypted: $(cd "$OFFSITE_DIR" && ls | paste -sd' ' -)"

    log "Uploading encrypted copies to $RCLONE_REMOTE ..."
    # copy, not sync: only *.age files are ever selected, and nothing here can
    # mirror the plain local folder to Drive.
    rclone copy "$OFFSITE_DIR" "$RCLONE_REMOTE" \
        --include "nexus_*.age" \
        --transfers=4 \
        --log-level INFO \
        || offsite_fail "upload to $RCLONE_REMOTE failed"
    rm -rf "$OFFSITE_DIR"
    success "Offsite upload complete (encrypted)"

    # Offsite retention: same KEEP_DAYS as local, and only our own encrypted
    # files. Plain files left on Drive by earlier versions are not touched —
    # removing those is a deliberate owner action.
    rclone delete "$RCLONE_REMOTE" \
        --include "nexus_*.age" \
        --min-age "${KEEP_DAYS}d" \
        --max-depth 1 \
        --log-level INFO \
        || log "WARNING: pruning old encrypted copies on $RCLONE_REMOTE failed (tonight's upload is fine)"
fi

# ---------------------------------------------------------------------------
# 6. Summary
# ---------------------------------------------------------------------------
trap - ERR
TOTAL=$(du -sh "$BACKUP_DIR" | cut -f1)
log "=== Nightly backup finished — total backup dir: $TOTAL ==="
