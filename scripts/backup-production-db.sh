#!/usr/bin/env bash
# Copyright © 2024–2026 Jasper Ford
# SPDX-License-Identifier: AGPL-3.0-or-later
# Author: Jasper Ford
# See NOTICE file for attribution and acknowledgements.
#
# Production Database Backup
# Usage: bash scripts/backup-production-db.sh
#
# Required env vars (or defaults from production .env):
#   PROD_SSH_KEY   - Path to SSH private key
#   PROD_SSH_HOST  - SSH user@host

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
NC='\033[0m'

success() { echo -e "${GREEN}✓ $1${NC}"; }
error()   { echo -e "${RED}✗ $1${NC}"; }
info()    { echo -e "${CYAN}→ $1${NC}"; }
warn()    { echo -e "${YELLOW}⚠ $1${NC}"; }

# Load local secrets if present. .secrets.local/deploy.env is gitignored
# and contains PROD_SSH_HOST + PROD_SSH_KEY for this developer's machine.
# shellcheck disable=SC1091
[ -f "$(dirname "$0")/../.secrets.local/deploy.env" ] && . "$(dirname "$0")/../.secrets.local/deploy.env"

if [ -z "${PROD_SSH_HOST:-}" ] || [ -z "${PROD_SSH_KEY:-}" ]; then
    echo "ERROR: PROD_SSH_HOST and PROD_SSH_KEY must be set." >&2
    echo "       Either create .secrets.local/deploy.env or export them." >&2
    exit 1
fi

SSH_KEY="$PROD_SSH_KEY"
SSH_HOST="$PROD_SSH_HOST"
SSH_OPTS="-i ${SSH_KEY} -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new"
DB_NAME="${PROD_DB_NAME:-nexus}"
DB_CONTAINER="nexus-php-db"

echo ""
echo "╔═══════════════════════════════════════════════════════════╗"
echo "║         PRODUCTION DATABASE BACKUP                        ║"
echo "╚═══════════════════════════════════════════════════════════╝"
echo ""

# E-035 F-203: run a shell snippet on the server as root with MYSQL_PWD read
# THERE from /opt/nexus-php/.env. The snippet travels on ssh's stdin and the
# password reaches the container through the environment (`docker exec -e
# MYSQL_PWD`, no value), so it is never on a command line on either machine
# and never copied to this one.
remote_db() {
    { printf '%s\n' 'MYSQL_PWD=$(sed -n "s/^DB_PASS=//p" /opt/nexus-php/.env | head -n 1); export MYSQL_PWD'
      printf '%s\n' "$1"; } | ssh $SSH_OPTS "$SSH_HOST" "sudo sh -s"
}

# Read credentials from server
info "Reading production credentials..."
if [[ -n "${PROD_DB_PASS:-}" ]]; then
    warn "PROD_DB_PASS is ignored: the password is read on the server and never leaves it"
fi
if [[ -n "${PROD_DB_USER:-}" ]]; then
    DB_USER="$PROD_DB_USER"
else
    DB_USER=$(ssh $SSH_OPTS "$SSH_HOST" "sudo grep '^DB_USER=' /opt/nexus-php/.env | cut -d= -f2")
fi

if [[ -z "$DB_USER" ]] || ! ssh $SSH_OPTS "$SSH_HOST" "sudo grep -q '^DB_PASS=.' /opt/nexus-php/.env"; then
    error "Could not read DB credentials"
    exit 1
fi
success "Credentials found on the server"

# Create backup
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_NAME="manual_backup_${TIMESTAMP}.sql"
BACKUP_PATH="/opt/nexus-php/backups/${BACKUP_NAME}"

info "Creating backup..."
remote_db "set -e; umask 077; mkdir -p /opt/nexus-php/backups; chmod 755 /opt/nexus-php/backups
docker exec -e MYSQL_PWD ${DB_CONTAINER} mariadb-dump -u '${DB_USER}' ${DB_NAME} > ${BACKUP_PATH}" || {
    error "Backup failed!"
    exit 1
}

# Verify
BACKUP_SIZE=$(ssh $SSH_OPTS "$SSH_HOST" "sudo ls -lh ${BACKUP_PATH} | awk '{print \$5}'")
TAIL_CHECK=$(ssh $SSH_OPTS "$SSH_HOST" "sudo tail -1 ${BACKUP_PATH}")

if echo "$TAIL_CHECK" | grep -q "Dump completed"; then
    success "Backup verified (dump completed marker found)"
else
    error "Backup may be incomplete — missing 'Dump completed' marker"
    exit 1
fi

echo ""
echo "╔═══════════════════════════════════════════════════════════╗"
echo "║  BACKUP COMPLETE                                          ║"
echo "╠═══════════════════════════════════════════════════════════╣"
echo "║  File: ${BACKUP_PATH}"
echo "║  Size: ${BACKUP_SIZE}"
echo "║                                                           ║"
echo "║  Restore command:                                         ║"
echo "║  sudo cat ${BACKUP_PATH} \\"
echo "║    | sudo docker exec -i ${DB_CONTAINER} mariadb \\"
echo "║      -u '${DB_USER}' -p'<PASS>' ${DB_NAME}"
echo "╚═══════════════════════════════════════════════════════════╝"
echo ""

# List recent backups
info "Recent backups on server:"
ssh $SSH_OPTS "$SSH_HOST" "sudo ls -lht /opt/nexus-php/backups/ | head -10"
echo ""
