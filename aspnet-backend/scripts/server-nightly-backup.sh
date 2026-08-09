#!/usr/bin/env bash
# Copyright © 2024–2026 Jasper Ford
# SPDX-License-Identifier: AGPL-3.0-or-later
# Author: Jasper Ford
# See NOTICE file for attribution and acknowledgements.
#
# Nightly Production Backup — Postgres + Docker volumes (uploads).
# Runs ON the production server — install via cron:
#
#   sudo crontab -e
#   0 2 * * * bash /opt/nexus-backend/scripts/server-nightly-backup.sh >> /opt/nexus-backend/backups/backup.log 2>&1
#
# What gets backed up:
#   nexus_db_YYYY-MM-DD.sql.gz       — pg_dump (--clean --if-exists) of nexus_dev
#   nexus_uploads_YYYY-MM-DD.tar.gz  — nexus-backend-uploads volume
#
# Retention: 7 daily backups per type. Older files are deleted automatically.
#
# Optional offsite sync (rclone):
#   Configure a remote (e.g. "gdrive:") then export RCLONE_REMOTE=gdrive:nexus-backups
#   in cron env, or this script auto-detects gdrive: if present.

set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/opt/nexus-backend/backups}"
DB_CONTAINER="${DB_CONTAINER:-nexus-backend-db}"
DB_NAME="${POSTGRES_DB:-nexus_dev}"
DB_USER="${POSTGRES_USER:-postgres}"
UPLOADS_VOLUME="${UPLOADS_VOLUME:-nexus-backend-uploads}"
KEEP_DAYS="${KEEP_DAYS:-7}"
DATE=$(date +%Y-%m-%d)

if [[ -z "${RCLONE_REMOTE:-}" ]] && command -v rclone &>/dev/null; then
    if rclone listremotes 2>/dev/null | grep -q "^gdrive:"; then
        RCLONE_REMOTE="gdrive:nexus-backend-backups"
    fi
fi
RCLONE_REMOTE="${RCLONE_REMOTE:-}"

log()     { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1"; }
success() { log "✓ $1"; }
fail()    { log "✗ ERROR: $1"; exit 1; }

log "=== Nightly backup starting ==="
mkdir -p "$BACKUP_DIR"

# 1. Database (pg_dump, --clean --if-exists for idempotent restore)
DB_BACKUP="${BACKUP_DIR}/nexus_db_${DATE}.sql.gz"
log "Dumping database: $DB_NAME → $DB_BACKUP"
docker exec -i "$DB_CONTAINER" \
    pg_dump -U "$DB_USER" -d "$DB_NAME" --clean --if-exists \
    | gzip > "$DB_BACKUP"

[[ ! -s "$DB_BACKUP" ]] && fail "Database backup is empty"
# Sanity: dump should end with a PostgreSQL completion marker
gunzip -c "$DB_BACKUP" | tail -3 | grep -q "PostgreSQL database dump complete" \
    || fail "Database dump did not complete cleanly"
success "Database backup — $(du -sh "$DB_BACKUP" | cut -f1)"

# 2. Uploads volume
UPLOADS_BACKUP="${BACKUP_DIR}/nexus_uploads_${DATE}.tar.gz"
if docker volume inspect "$UPLOADS_VOLUME" >/dev/null 2>&1; then
    log "Backing up uploads volume → $UPLOADS_BACKUP"
    docker run --rm \
        -v "${UPLOADS_VOLUME}:/data:ro" \
        -v "${BACKUP_DIR}:/out" \
        alpine \
        tar czf "/out/nexus_uploads_${DATE}.tar.gz" -C /data . || fail "Uploads tar failed"
    [[ ! -s "$UPLOADS_BACKUP" ]] && fail "Uploads backup is empty"
    success "Uploads backup — $(du -sh "$UPLOADS_BACKUP" | cut -f1)"
else
    log "Uploads volume $UPLOADS_VOLUME not found — skipping"
fi

# 3. Rotation
log "Rotating old backups (keeping last $KEEP_DAYS days each)..."
for pattern in "nexus_db_*.sql.gz" "nexus_uploads_*.tar.gz"; do
    find "$BACKUP_DIR" -name "$pattern" -mtime +"$KEEP_DAYS" -delete
done
REMAINING=$(find "$BACKUP_DIR" -name "nexus_*.gz" | wc -l)
log "Rotation done — $REMAINING file(s) retained"

# 4. Optional offsite sync
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

TOTAL=$(du -sh "$BACKUP_DIR" | cut -f1)
log "=== Nightly backup finished — total backup dir: $TOTAL ==="
