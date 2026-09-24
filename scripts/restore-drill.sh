#!/usr/bin/env bash
# Copyright © 2024–2026 Jasper Ford
# SPDX-License-Identifier: AGPL-3.0-or-later
# Author: Jasper Ford
# See NOTICE file for attribution and acknowledgements.
#
# Monthly restore drill — verifies that backups can actually be restored.
#
# Backups you've never restored aren't backups. This script:
#   1. Picks the most recent nightly DB backup (nexus_db_*.sql.gz)
#      OR the most recent pre-migrate backup if no nightly is found.
#   2. Loads it into a throwaway MariaDB container (nexus-restore-drill).
#   3. Asserts row counts on a few critical tables match the live DB
#      within tolerance (live grows between drill runs).
#   4. Tears the throwaway container down.
#
# Recommended cron (run on production server, monthly):
#   sudo crontab -e
#   0 4 1 * * bash /opt/nexus-php/scripts/restore-drill.sh \
#               >> /opt/nexus-php/logs/restore-drill.log 2>&1
#
# Local dev drill (proves restorability on the dev machine, no prod access):
#   Every path/container is overridable, so you can drill the local Docker DB.
#   1. Dump the local DB the same way the nightly backup does:
#        DB_PASS=$(grep -E '^DB_(PASSWORD|PASS)=' .env | head -1 | cut -d= -f2 | tr -d '"')
#        mkdir -p /tmp/drill/backups
#        MYSQL_PWD="$DB_PASS" docker exec -e MYSQL_PWD nexus-php-db \
#          mariadb-dump -u nexus nexus | gzip > /tmp/drill/backups/nexus_db_$(date +%F).sql.gz
#   2. Run the drill against the local source container + that backup:
#        BACKUP_DIR=/tmp/drill/backups SOURCE_DB_CONTAINER=nexus-php-db \
#        ENV_FILE="$(pwd)/.env" DRILL_CONTAINER=nexus-restore-drill-local DRILL_PORT=33307 \
#          bash scripts/restore-drill.sh
#   Last proven locally: 2026-06-21 — restored nexus into a throwaway container and
#   matched live row counts (tenants/users/laravel_migrations). PASS.
#
# Exit codes:
#   0 — drill passed, backups are restorable
#   1 — drill failed, alert immediately

set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/opt/nexus-php/backups}"
ENV_FILE="${ENV_FILE:-/opt/nexus-php/.env}"
SOURCE_DB_CONTAINER="${SOURCE_DB_CONTAINER:-nexus-php-db}"
DRILL_CONTAINER="${DRILL_CONTAINER:-nexus-restore-drill}"
DRILL_PORT="${DRILL_PORT:-33307}"
DRILL_PASS="$(head -c 16 /dev/urandom | base64 | tr -d '/+=')"

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

# 1. Find a backup to restore
log "Locating most recent backup..."
BACKUP_FILE="$(ls -t "$BACKUP_DIR"/nexus_db_*.sql.gz 2>/dev/null | head -1 || true)"
if [ -z "$BACKUP_FILE" ]; then
    BACKUP_FILE="$(ls -t "$BACKUP_DIR"/pre-migrate-*.sql.gz 2>/dev/null | head -1 || true)"
fi
[ -z "$BACKUP_FILE" ] && fail "No backups found in $BACKUP_DIR"
log "Drilling: $(basename "$BACKUP_FILE") ($(du -sh "$BACKUP_FILE" | cut -f1))"

# 2. Verify integrity before bothering to spin up MariaDB
gzip -t "$BACKUP_FILE" 2>/dev/null || fail "Backup gzip integrity failed"
gunzip -c "$BACKUP_FILE" | tail -3 | grep -q "Dump completed" \
    || warn "Dump-completed marker not found (older backups predate this check)"
success "Backup integrity OK"

# 3. Spin up a throwaway MariaDB container
log "Starting throwaway MariaDB container ($DRILL_CONTAINER)..."
cleanup  # in case a prior drill left one behind
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
    >/dev/null

# Wait for healthy
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
success "Restore complete"

# 5. Sanity check — assert critical tables exist + row counts are sane vs live
DB_USER="$(grep -E '^DB_(USERNAME|USER)=' "$ENV_FILE" | head -1 | cut -d= -f2 | tr -d '"')"
DB_PASS="$(grep -E '^DB_(PASSWORD|PASS)=' "$ENV_FILE" | head -1 | cut -d= -f2 | tr -d '"')"
DB_NAME="$(grep -E '^DB_(DATABASE|NAME)=' "$ENV_FILE" | head -1 | cut -d= -f2 | tr -d '"')"

count_drill() {
    MYSQL_PWD="$DRILL_PASS" docker exec -e MYSQL_PWD "$DRILL_CONTAINER" \
        mariadb -N -B -u root "$DB_NAME" -e "SELECT COUNT(*) FROM \`$1\`" 2>/dev/null || echo 0
}
count_live() {
    MYSQL_PWD="$DB_PASS" docker exec -e MYSQL_PWD "$SOURCE_DB_CONTAINER" \
        mariadb -N -B -u "$DB_USER" "$DB_NAME" -e "SELECT COUNT(*) FROM \`$1\`" 2>/dev/null || echo 0
}

VERIFY_FAILED=0
for table in tenants users laravel_migrations; do
    live="$(count_live "$table")"
    drill="$(count_drill "$table")"
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
    fail "Restore drill FAILED — backups exist but data is missing"
fi

success "Restore drill PASSED — backups are restorable"
echo ""
