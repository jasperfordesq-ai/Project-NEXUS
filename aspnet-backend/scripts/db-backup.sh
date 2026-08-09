#!/bin/bash
# =============================================================================
# Nexus Backend - Database Backup Script (Linux/macOS)
# =============================================================================
# Creates a timestamped PostgreSQL dump of the nexus_dev database
# Requires: Docker Compose running (docker compose up -d)
# Output: backups/db/nexus_dev_YYYYMMDD_HHMMSS.sql
# =============================================================================

set -e

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_FILE="$SCRIPT_DIR/../compose.yml"
CONTAINER_NAME="nexus-backend-db"
DB_NAME="nexus_dev"
DB_USER="postgres"
BACKUP_DIR="$SCRIPT_DIR/../backups/db"

# Create backup directory if it doesn't exist
mkdir -p "$BACKUP_DIR"

# Generate timestamp
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="nexus_dev_${TIMESTAMP}.sql"

echo ""
echo "================================================================"
echo "  Nexus Backend - Database Backup"
echo "================================================================"
echo ""
echo "Container: $CONTAINER_NAME"
echo "Database:  $DB_NAME"
echo "Output:    backups/db/$BACKUP_FILE"
echo ""

# Check if container is running
if ! docker ps --filter "name=$CONTAINER_NAME" --format "{{.Names}}" | grep -q "$CONTAINER_NAME"; then
    echo "ERROR: Container $CONTAINER_NAME is not running."
    echo "Run: docker compose -f compose.yml up -d"
    exit 1
fi

# Execute pg_dump inside the container
echo "Creating backup..."
docker compose -f "$COMPOSE_FILE" exec -T db pg_dump -U "$DB_USER" -d "$DB_NAME" --clean --if-exists > "$BACKUP_DIR/$BACKUP_FILE"

# Get file size
SIZE=$(stat -f%z "$BACKUP_DIR/$BACKUP_FILE" 2>/dev/null || stat -c%s "$BACKUP_DIR/$BACKUP_FILE" 2>/dev/null)

echo ""
echo "SUCCESS: Backup created"
echo "File: backups/db/$BACKUP_FILE"
echo "Size: $SIZE bytes"
echo ""
