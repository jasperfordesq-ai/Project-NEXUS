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
#
# Optional offsite sync (rclone):
#   Install rclone, configure a remote called "nexus-backups", then set:
#   RCLONE_REMOTE="nexus-backups:nexus-backups" in this script or the environment.

set -euo pipefail
# E-035 F-203: every backup holds the whole platform (database, uploads incl.
# vetting documents, storage). Create files owner-only so no other local account
# on the host can read them.
umask 077

BACKUP_DIR="/opt/nexus-php/backups"
ENV_FILE="/opt/nexus-php/.env"
DB_CONTAINER="nexus-php-db"
KEEP_DAYS=7
DATE=$(date +%Y-%m-%d)
# Auto-detect rclone gdrive remote if not set explicitly.
# setup-rclone-gdrive.sh sets this in the cron environment; this fallback
# handles manual runs and future invocations without the cron env var.
if [[ -z "${RCLONE_REMOTE:-}" ]] && command -v rclone &>/dev/null; then
    if rclone listremotes 2>/dev/null | grep -q "^gdrive:"; then
        RCLONE_REMOTE="gdrive:nexus-backups"
    fi
fi
RCLONE_REMOTE="${RCLONE_REMOTE:-}"

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
# 5. Optional: sync to offsite rclone remote
# ---------------------------------------------------------------------------
if [[ -n "$RCLONE_REMOTE" ]]; then
    if command -v rclone &>/dev/null; then
        log "Syncing to $RCLONE_REMOTE ..."
        rclone sync "$BACKUP_DIR" "$RCLONE_REMOTE" \
            --include "nexus_*.gz" \
            --transfers=4 \
            --log-level INFO
        success "Offsite sync complete"
    else
        log "WARNING: RCLONE_REMOTE set but rclone not installed — skipping offsite sync"
    fi
fi

# ---------------------------------------------------------------------------
# 6. Summary
# ---------------------------------------------------------------------------
TOTAL=$(du -sh "$BACKUP_DIR" | cut -f1)
log "=== Nightly backup finished — total backup dir: $TOTAL ==="
