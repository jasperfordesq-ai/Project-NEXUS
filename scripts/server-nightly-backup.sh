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
#   No keys, too few keys, age missing or a failed upload ⇒ nothing is uploaded,
#   the run exits 1 and a Telegram alert is sent (scripts/backup-alert.sh).
#   There is no plaintext fallback.
#   Remote is auto-detected ("gdrive:nexus-backups") or set via RCLONE_REMOTE.

set -euo pipefail
# E-035 F-203: every backup holds the whole platform (database, uploads incl.
# vetting documents, storage). Create files owner-only so no other local account
# on the host can read them.
umask 077

# Paths are overridable so scripts/test/test-backup-offsite-encryption.sh can
# run this script in a sandbox; production uses the defaults.
BACKUP_DIR="${BACKUP_DIR:-/opt/nexus-php/backups}"
ENV_FILE="${ENV_FILE:-/opt/nexus-php/.env}"
DB_CONTAINER="${DB_CONTAINER:-nexus-php-db}"
KEEP_DAYS="${KEEP_DAYS:-7}"
DATE="${BACKUP_DATE:-$(date +%Y-%m-%d)}"
# Auto-detect rclone gdrive remote if not set explicitly.
# setup-rclone-gdrive.sh sets this in the cron environment; this fallback
# handles manual runs and future invocations without the cron env var.
if [[ -z "${RCLONE_REMOTE:-}" ]] && command -v rclone &>/dev/null; then
    if rclone listremotes 2>/dev/null | grep -q "^gdrive:"; then
        RCLONE_REMOTE="gdrive:nexus-backups"
    fi
fi
RCLONE_REMOTE="${RCLONE_REMOTE:-}"
AGE_RECIPIENTS_FILE="${BACKUP_AGE_RECIPIENTS_FILE:-/opt/nexus-php/.backup-age-recipients}"
MIN_RECIPIENTS=2
OFFSITE_DIR="${BACKUP_DIR}/offsite"

# shellcheck source=backup-alert.sh
source "$(dirname "${BASH_SOURCE[0]}")/backup-alert.sh"

log()     { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1"; }
success() { log "✓ $1"; }
fail()    { log "✗ ERROR: $1"; exit 1; }

log "=== Nightly backup starting ==="
mkdir -p "$BACKUP_DIR"
# E-035 F-203/F-205: files are 0600 (umask 077 above, chmod 600 below); the
# directory is 0755 so the www-data scheduler's backup:verify can list it and
# read file dates. Names and dates are not sensitive; contents are.
chmod 755 "$BACKUP_DIR"

# ---------------------------------------------------------------------------
# 1. Database
# ---------------------------------------------------------------------------
DB_BACKUP="${BACKUP_DIR}/nexus_db_${DATE}.sql.gz"

DB_NAME=$(grep -E '^DB_(DATABASE|NAME)=' "$ENV_FILE" | head -1 | cut -d= -f2 | tr -d '"')
DB_USER=$(grep -E '^DB_(USERNAME|USER)='  "$ENV_FILE" | head -1 | cut -d= -f2 | tr -d '"')
DB_PASS=$(grep -E '^DB_(PASSWORD|PASS)='  "$ENV_FILE" | head -1 | cut -d= -f2 | tr -d '"')

[[ -z "${DB_NAME:-}" || -z "${DB_USER:-}" || -z "${DB_PASS:-}" ]] && \
    fail "Could not read DB credentials from $ENV_FILE"

log "Dumping database: $DB_NAME → $DB_BACKUP"
MYSQL_PWD="$DB_PASS" docker exec -e MYSQL_PWD "$DB_CONTAINER" \
    mariadb-dump -u "$DB_USER" "$DB_NAME" \
    | gzip > "$DB_BACKUP"

[[ ! -s "$DB_BACKUP" ]] && fail "Database backup is empty"
success "Database backup — $(du -sh "$DB_BACKUP" | cut -f1)"

# ---------------------------------------------------------------------------
# 2. Uploads volume  (nexus-php-uploads → httpdocs/uploads/)
# ---------------------------------------------------------------------------
UPLOADS_BACKUP="${BACKUP_DIR}/nexus_uploads_${DATE}.tar.gz"

log "Backing up uploads volume → $UPLOADS_BACKUP"
docker run --rm \
    -v nexus-php-uploads:/data:ro \
    -v "${BACKUP_DIR}:/out" \
    alpine \
    tar czf "/out/nexus_uploads_${DATE}.tar.gz" -C /data .

[[ ! -s "$UPLOADS_BACKUP" ]] && fail "Uploads backup is empty"
success "Uploads backup — $(du -sh "$UPLOADS_BACKUP" | cut -f1)"

# ---------------------------------------------------------------------------
# 3. Laravel storage volume  (nexus-php-storage → storage/)
# ---------------------------------------------------------------------------
STORAGE_BACKUP="${BACKUP_DIR}/nexus_storage_${DATE}.tar.gz"

log "Backing up storage volume → $STORAGE_BACKUP"
docker run --rm \
    -v nexus-php-storage:/data:ro \
    -v "${BACKUP_DIR}:/out" \
    alpine \
    tar czf "/out/nexus_storage_${DATE}.tar.gz" -C /data .

[[ ! -s "$STORAGE_BACKUP" ]] && fail "Storage backup is empty"
success "Storage backup — $(du -sh "$STORAGE_BACKUP" | cut -f1)"

# The two tarballs above are written by a helper container, which ignores this
# script's umask, so tighten them here — and any backup left world-readable by an
# earlier run (E-035 F-203).
find "$BACKUP_DIR" -maxdepth 1 -type f -exec chmod 600 {} +

# ---------------------------------------------------------------------------
# 4. Rotation — keep last KEEP_DAYS per type
# ---------------------------------------------------------------------------
log "Rotating old backups (keeping last $KEEP_DAYS days each)..."
for pattern in "nexus_db_*.sql.gz" "nexus_uploads_*.tar.gz" "nexus_storage_*.tar.gz"; do
    find "$BACKUP_DIR" -name "$pattern" -mtime +"$KEEP_DAYS" -delete
done
REMAINING=$(find "$BACKUP_DIR" -name "nexus_*.gz" | wc -l)
log "Rotation done — $REMAINING file(s) retained"

# ---------------------------------------------------------------------------
# 5. Offsite copy — encrypted with age, or not at all (F-123)
# ---------------------------------------------------------------------------
offsite_fail() {
    rm -rf "$OFFSITE_DIR"
    log "✗ OFFSITE COPY NOT MADE: $1"
    log "  The local backups above are fine; Google Drive did NOT get tonight's copy."
    backup_alert "NEXUS NIGHTLY BACKUP — OFFSITE COPY FAILED"         "$1. The backups on the server were made, but nothing was sent to Google Drive tonight. Nothing unencrypted was uploaded."         || true
    exit 1
}

encrypt_for_offsite() {
    local src="$1" out="$OFFSITE_DIR/$(basename "$1").age"
    age -R "$AGE_RECIPIENTS_FILE" -o "$out" "$src" || offsite_fail "encrypting $(basename "$src") failed"
    # Belt and braces: the uploaded file must carry the age header and must
    # not be readable as the gzip it came from.
    [ "$(head -c 21 "$out")" = "age-encryption.org/v1" ]         || offsite_fail "$(basename "$out") does not look age-encrypted"
    if gzip -t "$out" 2>/dev/null; then
        offsite_fail "$(basename "$out") is still readable as gzip"
    fi
}

if [[ -n "$RCLONE_REMOTE" ]]; then
    command -v rclone &>/dev/null || offsite_fail "RCLONE_REMOTE is set but rclone is not installed"
    command -v age &>/dev/null    || offsite_fail "age is not installed (apt-get install -y age)"
    [[ -r "$AGE_RECIPIENTS_FILE" ]] || offsite_fail "no encryption keys: $AGE_RECIPIENTS_FILE is missing"
    KEY_COUNT=$(grep -cE '^age1[0-9a-z]+$' "$AGE_RECIPIENTS_FILE" || true)
    (( KEY_COUNT >= MIN_RECIPIENTS ))         || offsite_fail "only ${KEY_COUNT} encryption key(s) in $AGE_RECIPIENTS_FILE; at least ${MIN_RECIPIENTS} are required so one lost key cannot lose the backups"

    rm -rf "$OFFSITE_DIR"
    mkdir -m 700 "$OFFSITE_DIR"
    log "Encrypting offsite copies to ${KEY_COUNT} key(s)..."

    KEYCHECK="${OFFSITE_DIR}/nexus_keycheck_${DATE}.txt"
    printf 'Project NEXUS backup key check
backup date: %s
host: %s
If you can read this, your key opens the %s backups.
'         "$DATE" "$(hostname 2>/dev/null || echo unknown)" "$DATE" > "$KEYCHECK"
    for f in "$DB_BACKUP" "$UPLOADS_BACKUP" "$STORAGE_BACKUP" "$KEYCHECK"; do
        encrypt_for_offsite "$f"
    done
    rm -f "$KEYCHECK"
    success "Encrypted: $(cd "$OFFSITE_DIR" && ls | tr '
' ' ')"

    log "Uploading encrypted copies to $RCLONE_REMOTE ..."
    # copy, not sync: only *.age files are ever selected, and nothing here can
    # mirror the plain local folder to Drive.
    rclone copy "$OFFSITE_DIR" "$RCLONE_REMOTE"         --include "nexus_*.age"         --transfers=4         --log-level INFO         || offsite_fail "upload to $RCLONE_REMOTE failed"
    rm -rf "$OFFSITE_DIR"
    success "Offsite upload complete (encrypted)"

    # Offsite retention: same KEEP_DAYS as local, and only our own encrypted
    # files. Plain files left on Drive by earlier versions are not touched —
    # removing those is a deliberate owner action.
    rclone delete "$RCLONE_REMOTE"         --include "nexus_*.age"         --min-age "${KEEP_DAYS}d"         --max-depth 1         --log-level INFO         || log "WARNING: pruning old encrypted copies on $RCLONE_REMOTE failed (tonight's upload is fine)"
fi

# ---------------------------------------------------------------------------
# 6. Summary
# ---------------------------------------------------------------------------
TOTAL=$(du -sh "$BACKUP_DIR" | cut -f1)
log "=== Nightly backup finished — total backup dir: $TOTAL ==="
