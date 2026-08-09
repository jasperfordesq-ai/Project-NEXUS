#!/usr/bin/env bash
# Copyright © 2024–2026 Jasper Ford
# SPDX-License-Identifier: AGPL-3.0-or-later
# Author: Jasper Ford
# See NOTICE file for attribution and acknowledgements.
#
# Monthly restore drill — verifies that backups can actually be restored.
#
# Backups you've never restored aren't backups. This script:
#   1. Picks the most recent nightly DB backup (nexus_db_*.sql.gz).
#   2. Loads it into a throwaway Postgres container (nexus-restore-drill).
#   3. Asserts row counts on a few critical tables look sane vs the live DB.
#   4. Tears the throwaway container down.
#
# Recommended cron (run on production server, monthly):
#   sudo crontab -e
#   0 4 1 * * bash /opt/nexus-backend/scripts/restore-drill.sh \
#               >> /opt/nexus-backend/logs/restore-drill.log 2>&1
#
# Exit codes:
#   0 — drill passed, backups are restorable
#   1 — drill failed, alert immediately

set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/opt/nexus-backend/backups}"
SOURCE_DB_CONTAINER="${SOURCE_DB_CONTAINER:-nexus-backend-db}"
SOURCE_DB_USER="${SOURCE_DB_USER:-postgres}"
SOURCE_DB_NAME="${SOURCE_DB_NAME:-nexus_dev}"
DRILL_CONTAINER="${DRILL_CONTAINER:-nexus-restore-drill}"
DRILL_PORT="${DRILL_PORT:-55433}"
DRILL_DB="nexus_drill"
DRILL_USER="postgres"
DRILL_PASS="$(head -c 16 /dev/urandom | base64 | tr -d '/+=')"
PG_IMAGE="${PG_IMAGE:-postgres:16.4-bookworm}"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
log()     { echo -e "${CYAN}→${NC} [$(date '+%H:%M:%S')] $1"; }
success() { echo -e "${GREEN}✓${NC} $1"; }
warn()    { echo -e "${YELLOW}⚠${NC} $1"; }
fail()    { echo -e "${RED}✗${NC} $1"; cleanup; exit 1; }

cleanup() {
    docker rm -f "$DRILL_CONTAINER" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo ""
echo "════════════════════════════════════════════════════════════"
echo "  RESTORE DRILL — $(date '+%Y-%m-%d %H:%M:%S')"
echo "════════════════════════════════════════════════════════════"

# 1. Find a backup
log "Locating most recent backup..."
BACKUP_FILE="$(ls -t "$BACKUP_DIR"/nexus_db_*.sql.gz 2>/dev/null | head -1 || true)"
[ -z "$BACKUP_FILE" ] && fail "No backups found in $BACKUP_DIR (expected nexus_db_*.sql.gz)"
log "Drilling: $(basename "$BACKUP_FILE") ($(du -sh "$BACKUP_FILE" | cut -f1))"

# 2. Verify gzip + dump completion before bothering to spin up Postgres
gzip -t "$BACKUP_FILE" 2>/dev/null || fail "Backup gzip integrity failed"
gunzip -c "$BACKUP_FILE" | tail -5 | grep -q "PostgreSQL database dump complete" \
    || warn "Dump-completed marker not found (older backups may predate this check)"
success "Backup integrity OK"

# 3. Spin up throwaway Postgres
log "Starting throwaway Postgres container ($DRILL_CONTAINER)..."
cleanup
docker run -d --rm \
    --name "$DRILL_CONTAINER" \
    -e "POSTGRES_PASSWORD=$DRILL_PASS" \
    -e "POSTGRES_DB=$DRILL_DB" \
    -p "127.0.0.1:${DRILL_PORT}:5432" \
    --health-cmd="pg_isready -U $DRILL_USER -d $DRILL_DB" \
    --health-interval=3s \
    --health-timeout=3s \
    --health-retries=20 \
    "$PG_IMAGE" \
    >/dev/null

state="missing"
for _ in {1..40}; do
    state="$(docker inspect -f '{{.State.Health.Status}}' "$DRILL_CONTAINER" 2>/dev/null || echo missing)"
    [ "$state" = "healthy" ] && break
    sleep 2
done
[ "$state" = "healthy" ] || fail "Throwaway DB never became healthy"
success "Throwaway DB up"

# 4. Restore. The dump uses --clean --if-exists; harmless on a fresh DB.
log "Restoring dump into throwaway DB..."
gunzip -c "$BACKUP_FILE" \
    | docker exec -i -e "PGPASSWORD=$DRILL_PASS" "$DRILL_CONTAINER" \
        psql -v ON_ERROR_STOP=1 -U "$DRILL_USER" -d "$DRILL_DB" >/dev/null \
    || fail "Restore failed (psql returned non-zero)"
success "Restore complete"

# 5. Sanity: row counts on critical tables, drill must be > 0 and <= live (live grows)
count_drill() {
    docker exec -e "PGPASSWORD=$DRILL_PASS" "$DRILL_CONTAINER" \
        psql -tAX -U "$DRILL_USER" -d "$DRILL_DB" -c \
        "SELECT COUNT(*) FROM \"$1\"" 2>/dev/null || echo 0
}
count_live() {
    docker exec "$SOURCE_DB_CONTAINER" \
        psql -tAX -U "$SOURCE_DB_USER" -d "$SOURCE_DB_NAME" -c \
        "SELECT COUNT(*) FROM \"$1\"" 2>/dev/null || echo 0
}

VERIFY_FAILED=0
# EF Core uses __EFMigrationsHistory; Tenants/Users are critical V2 tables.
for table in "Tenants" "Users" "__EFMigrationsHistory"; do
    live="$(count_live "$table" | tr -d '[:space:]')"
    drill="$(count_drill "$table" | tr -d '[:space:]')"
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
    fail "Restore drill FAILED — backups exist but data is missing"
fi

success "Restore drill PASSED — backups are restorable"
echo ""
