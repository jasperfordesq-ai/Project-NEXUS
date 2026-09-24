#!/usr/bin/env bash
# Copyright © 2024–2026 Jasper Ford
# SPDX-License-Identifier: AGPL-3.0-or-later
# Author: Jasper Ford
# See NOTICE file for attribution and acknowledgements.
#
# Production Migration Runner
# Usage: bash scripts/migrate-production.sh <migration-file.sql> [--dry-run]
#
# Required env vars (loaded from .secrets.local/deploy.env if present, or
# exported by the caller — there are NO hardcoded defaults in this script):
#   PROD_SSH_KEY   - Path to SSH private key
#   PROD_SSH_HOST  - SSH user@host
#   PROD_DB_USER   - Production DB username (default: read from server .env)
#   PROD_DB_PASS   - ignored (E-035 F-203): the password is read on the server and never leaves it
#   PROD_DB_NAME   - Production DB name (default: nexus)

set -euo pipefail

# ─── Colors ───────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

success() { echo -e "${GREEN}✓ $1${NC}"; }
error()   { echo -e "${RED}✗ $1${NC}"; }
warn()    { echo -e "${YELLOW}⚠ $1${NC}"; }
info()    { echo -e "${CYAN}→ $1${NC}"; }

# ─── Args ─────────────────────────────────────────────────────
MIGRATION_FILE="${1:-}"
DRY_RUN=false
if [[ "${2:-}" == "--dry-run" ]]; then
    DRY_RUN=true
fi

if [[ -z "$MIGRATION_FILE" ]]; then
    error "Usage: bash scripts/migrate-production.sh <migration-file.sql> [--dry-run]"
    exit 1
fi

MIGRATION_PATH="migrations/${MIGRATION_FILE}"
if [[ ! -f "$MIGRATION_PATH" ]]; then
    error "Migration file not found: $MIGRATION_PATH"
    exit 1
fi

# ─── SSH Config ───────────────────────────────────────────────
# Load local secrets if present (gitignored .secrets.local/deploy.env)
# shellcheck disable=SC1091
[ -f "$(dirname "$0")/../.secrets.local/deploy.env" ] && . "$(dirname "$0")/../.secrets.local/deploy.env"

if [ -z "${PROD_SSH_HOST:-}" ] || [ -z "${PROD_SSH_KEY:-}" ]; then
    error "PROD_SSH_HOST and PROD_SSH_KEY must be set."
    error "Either create .secrets.local/deploy.env or export them."
    exit 1
fi

SSH_KEY="$PROD_SSH_KEY"
SSH_HOST="$PROD_SSH_HOST"
SSH_OPTS="-i ${SSH_KEY} -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new"
DB_NAME="${PROD_DB_NAME:-nexus}"
DB_CONTAINER="nexus-php-db"

echo ""
echo "╔═══════════════════════════════════════════════════════════╗"
echo "║         PRODUCTION MIGRATION RUNNER                       ║"
echo "╚═══════════════════════════════════════════════════════════╝"
echo ""
info "Migration: ${MIGRATION_FILE}"
info "Target: ${SSH_HOST} → ${DB_CONTAINER}/${DB_NAME}"

if $DRY_RUN; then
    warn "DRY RUN MODE — no changes will be made"
fi
echo ""

# ─── Step 1: Read production DB credentials from server ───────
info "Step 1: Reading production credentials..."

# E-035 F-203: run a shell snippet on the server as root with MYSQL_PWD read
# THERE from /opt/nexus-php/.env. The snippet travels on ssh's stdin and the
# password reaches the container through the environment (`docker exec -e
# MYSQL_PWD`, no value), so it is never on a command line on either machine
# and never copied to this one.
remote_db() {
    { printf '%s\n' 'MYSQL_PWD=$(sed -n "s/^DB_PASS=//p" /opt/nexus-php/.env | head -n 1); export MYSQL_PWD'
      printf '%s\n' "$1"; } | ssh $SSH_OPTS "$SSH_HOST" "sudo sh -s"
}

if [[ -n "${PROD_DB_PASS:-}" ]]; then
    warn "PROD_DB_PASS is ignored: the password is read on the server and never leaves it"
fi
if [[ -n "${PROD_DB_USER:-}" ]]; then
    DB_USER="$PROD_DB_USER"
else
    DB_USER=$(ssh $SSH_OPTS "$SSH_HOST" "sudo grep '^DB_USER=' /opt/nexus-php/.env | cut -d= -f2")
fi
if [[ -z "$DB_USER" ]] || ! ssh $SSH_OPTS "$SSH_HOST" "sudo grep -q '^DB_PASS=.' /opt/nexus-php/.env"; then
    error "Could not read DB credentials from production server"
    exit 1
fi
success "Credentials found in production .env"

# ─── Step 2: Test connectivity ────────────────────────────────
info "Step 2: Testing database connectivity..."

CONN_TEST=$(remote_db "docker exec -e MYSQL_PWD ${DB_CONTAINER} mariadb -u '${DB_USER}' ${DB_NAME} \
     -e \"SELECT @@hostname AS host, DATABASE() AS db, NOW() AS time;\"" 2>&1) || {
    error "Cannot connect to production database"
    echo "$CONN_TEST"
    exit 1
}
success "Connected to production database"
echo "$CONN_TEST" | head -3

# ─── Step 3: Check if already applied ─────────────────────────
info "Step 3: Checking if migration already applied..."

ALREADY=$(remote_db "docker exec -e MYSQL_PWD ${DB_CONTAINER} mariadb -u '${DB_USER}' ${DB_NAME} \
     -N -e \"SELECT COUNT(*) FROM migrations WHERE migration_name = '${MIGRATION_FILE}';\"" 2>/dev/null || echo "0")
ALREADY=$(echo "$ALREADY" | tr -d '[:space:]')

if [[ "$ALREADY" -gt 0 ]]; then
    warn "Migration '${MIGRATION_FILE}' is already recorded in production. Skipping."
    exit 0
fi

success "Migration not yet applied"

if $DRY_RUN; then
    echo ""
    info "DRY RUN — Would execute:"
    echo "════════════════════════════════════════════"
    cat "$MIGRATION_PATH"
    echo ""
    echo "════════════════════════════════════════════"
    success "Dry run complete — no changes made"
    exit 0
fi

# ─── Step 4: Backup ───────────────────────────────────────────
info "Step 4: Creating pre-migration backup..."

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_NAME="pre_migration_${MIGRATION_FILE%.sql}_${TIMESTAMP}.sql"
BACKUP_PATH="/opt/nexus-php/backups/${BACKUP_NAME}"

remote_db "set -e; umask 077; mkdir -p /opt/nexus-php/backups; chmod 755 /opt/nexus-php/backups
docker exec -e MYSQL_PWD ${DB_CONTAINER} mariadb-dump -u '${DB_USER}' ${DB_NAME} > ${BACKUP_PATH}" || {
    error "Backup failed!"
    exit 1
}

BACKUP_SIZE=$(ssh $SSH_OPTS "$SSH_HOST" "sudo ls -lh ${BACKUP_PATH} | awk '{print \$5}'")
success "Backup created: ${BACKUP_PATH} (${BACKUP_SIZE})"
echo ""
warn "To restore: sudo cat ${BACKUP_PATH} | sudo docker exec -i ${DB_CONTAINER} mariadb -u '${DB_USER}' -p'<PASS>' ${DB_NAME}"
echo ""

# ─── Step 5: Copy + apply migration ──────────────────────────
info "Step 5: Copying migration to server..."
scp $SSH_OPTS "$MIGRATION_PATH" "${SSH_HOST}:/tmp/${MIGRATION_FILE}" || {
    error "Failed to copy migration file"
    exit 1
}
success "File copied to /tmp/${MIGRATION_FILE}"

info "Step 6: Applying migration..."
remote_db "set -e; docker exec -i -e MYSQL_PWD ${DB_CONTAINER} mariadb -u '${DB_USER}' ${DB_NAME} < /tmp/${MIGRATION_FILE}" || {
    error "Migration FAILED!"
    error "Restore from backup: sudo cat ${BACKUP_PATH} | sudo docker exec -i ${DB_CONTAINER} mariadb -u '${DB_USER}' -p'<PASS>' ${DB_NAME}"
    exit 1
}
success "Migration applied successfully"

# ─── Step 6: Record in tracking table ─────────────────────────
info "Step 7: Recording migration..."
remote_db "docker exec -e MYSQL_PWD ${DB_CONTAINER} mariadb -u '${DB_USER}' ${DB_NAME} \
     -e \"INSERT INTO migrations (migration_name, backups, executed_at) VALUES ('${MIGRATION_FILE}', '${MIGRATION_FILE}', NOW());\"" || {
    warn "Could not record migration in tracking table (non-fatal)"
}
success "Migration recorded"

# ─── Step 7: Verify ──────────────────────────────────────────
info "Step 8: Verifying..."
echo ""
remote_db "docker exec -e MYSQL_PWD ${DB_CONTAINER} mariadb -u '${DB_USER}' ${DB_NAME} \
     -e \"SELECT * FROM migrations ORDER BY id DESC LIMIT 5;\""

# Clean up temp file
ssh $SSH_OPTS "$SSH_HOST" "rm -f /tmp/${MIGRATION_FILE}" 2>/dev/null || true

echo ""
echo "╔═══════════════════════════════════════════════════════════╗"
echo "║  PRODUCTION MIGRATION COMPLETE                            ║"
echo "╠═══════════════════════════════════════════════════════════╣"
echo "║  Backup: ${BACKUP_PATH}"
echo "╚═══════════════════════════════════════════════════════════╝"
echo ""
