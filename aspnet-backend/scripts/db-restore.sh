#!/bin/bash
# =============================================================================
# Nexus Backend - Database Restore Script (Linux/macOS)
# =============================================================================
# Restores a PostgreSQL dump to the nexus_dev database
# Requires: Docker Compose running (docker compose up -d)
# CAUTION: This will OVERWRITE all existing data!
# =============================================================================

set -e

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_FILE="$SCRIPT_DIR/../compose.yml"
CONTAINER_NAME="nexus-backend-db"
DB_NAME="nexus_dev"
DB_USER="postgres"
BACKUP_DIR="$SCRIPT_DIR/../backups/db"

# Check if backup file was provided
if [ -z "$1" ]; then
    echo ""
    echo "================================================================"
    echo "  Nexus Backend - Database Restore"
    echo "================================================================"
    echo ""
    echo "Usage: ./db-restore.sh <backup-file>"
    echo ""
    echo "Available backups:"
    echo ""
    if ls "$BACKUP_DIR"/*.sql 1>/dev/null 2>&1; then
        for f in "$BACKUP_DIR"/*.sql; do
            echo "  - $(basename "$f")"
        done
    else
        echo "  (no backups found)"
    fi
    echo ""
    echo "Example: ./db-restore.sh nexus_dev_20260203_120000.sql"
    echo ""
    exit 1
fi

BACKUP_FILE="$1"

# Check if file exists (with or without path)
if [ -f "$BACKUP_FILE" ]; then
    FULL_PATH="$BACKUP_FILE"
elif [ -f "$BACKUP_DIR/$BACKUP_FILE" ]; then
    FULL_PATH="$BACKUP_DIR/$BACKUP_FILE"
else
    echo ""
    echo "ERROR: Backup file not found: $BACKUP_FILE"
    echo ""
    exit 1
fi

echo ""
echo "================================================================"
echo "  Nexus Backend - Database Restore"
echo "================================================================"
echo ""
echo "Container: $CONTAINER_NAME"
echo "Database:  $DB_NAME"
echo "Backup:    $FULL_PATH"
echo ""
echo "WARNING: This will OVERWRITE all existing data in $DB_NAME!"
echo ""
read -p "Type YES to confirm: " CONFIRM

if [ "$CONFIRM" != "YES" ]; then
    echo ""
    echo "Restore cancelled."
    exit 0
fi

# Check if container is running
if ! docker ps --filter "name=$CONTAINER_NAME" --format "{{.Names}}" | grep -q "$CONTAINER_NAME"; then
    echo ""
    echo "ERROR: Container $CONTAINER_NAME is not running."
    echo "Run: docker compose -f compose.yml up -d"
    exit 1
fi

echo ""
echo "Restoring database..."
docker compose -f "$COMPOSE_FILE" exec -T db psql -U "$DB_USER" -d "$DB_NAME" < "$FULL_PATH"

echo ""
echo "SUCCESS: Database restored from $(basename "$BACKUP_FILE")"
echo ""
echo "NOTE: You may need to restart the API container:"
echo "  docker compose restart api"
echo ""
