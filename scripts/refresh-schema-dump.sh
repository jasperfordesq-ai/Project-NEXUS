#!/bin/bash
# =============================================================================
# Project NEXUS — Refresh Schema Dump
# =============================================================================
# Regenerates database/schema/mysql-schema.sql from the current database.
# This file is committed to git so new contributors can set up a working
# database with a single `php artisan migrate`.
#
# Usage:
#   bash scripts/refresh-schema-dump.sh              # auto-detect environment
#   bash scripts/refresh-schema-dump.sh --local       # force local Docker mode
#   bash scripts/refresh-schema-dump.sh --production   # force production mode
#
# What it does:
#   1. Dumps the full schema (no data) via mysqldump
#   2. Appends migration registry data so fresh migrate skips applied migrations
#   3. Writes to database/schema/mysql-schema.sql
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DUMP_PATH="$PROJECT_ROOT/database/schema/mysql-schema.sql"

# ---------- Detect environment ----------
MODE="${1:-auto}"

if [[ "$MODE" == "--local" ]] || [[ "$MODE" == "auto" && -z "${DEPLOY_ENV:-}" ]]; then
    # Local Docker: read creds from the PHP container's environment
    DB_CONTAINER="nexus-php-db"
    DB_USER=$(docker exec nexus-php-app printenv DB_USER 2>/dev/null || echo "nexus")
    DB_PASS=$(docker exec nexus-php-app printenv DB_PASS 2>/dev/null || echo "nexus_secret")
    DB_NAME=$(docker exec nexus-php-app printenv DB_NAME 2>/dev/null || echo "nexus")

    export MYSQL_PWD="$DB_PASS"
    DUMP_CMD="docker exec -e MYSQL_PWD $DB_CONTAINER mysqldump -u $DB_USER"
    echo "[schema-dump] Using local Docker DB ($DB_CONTAINER)"
elif [[ "$MODE" == "--production" ]] || [[ "${DEPLOY_ENV:-}" == "production" ]]; then
    # Production: run inside the DB container directly
    DB_CONTAINER="nexus-php-db"
    DB_USER="${DB_USER:-nexus}"
    DB_PASS="${DB_PASS:-}"
    DB_NAME="${DB_NAME:-nexus}"

    if [[ -z "$DB_PASS" ]]; then
        echo "[schema-dump] ERROR: DB_PASS not set. Export it or pass --local." >&2
        exit 1
    fi

    export MYSQL_PWD="$DB_PASS"
    DUMP_CMD="docker exec -e MYSQL_PWD $DB_CONTAINER mysqldump -u $DB_USER"
    echo "[schema-dump] Using production DB ($DB_CONTAINER)"
else
    echo "[schema-dump] ERROR: Unknown mode '$MODE'. Use --local or --production." >&2
    exit 1
fi

# ---------- Generate dump ----------
echo "[schema-dump] Dumping schema (no data)..."
$DUMP_CMD \
    --no-data \
    --skip-add-locks \
    --skip-comments \
    --skip-set-charset \
    --routines \
    --no-tablespaces \
    "$DB_NAME" > "$DUMP_PATH" 2>/dev/null

# Trigger/routine definers are environment-specific accounts. Keeping a
# production definer in the committed baseline makes fresh imports fail with
# MariaDB error 1449 when that account does not exist (including CI). Omitting
# the clause makes each object use the schema-import account instead.
sed -E -i 's|/\*!50017 DEFINER=`[^`]+`@`[^`]+`\*/ ?||g' "$DUMP_PATH"
# Views now use SQL SECURITY INVOKER. Their creator is irrelevant to reads,
# and preserving that account in a portable schema dump breaks fresh installs
# where it does not exist (F-029).
sed -E -i 's#(/\*!50013 )DEFINER=`[^`]+`@`[^`]+` (SQL SECURITY INVOKER \*/)#\1\2#g' "$DUMP_PATH"

echo "" >> "$DUMP_PATH"
echo "-- Laravel migrations data (so fresh migrate knows what is already applied)" >> "$DUMP_PATH"

echo "[schema-dump] Appending laravel_migrations data..."
$DUMP_CMD \
    --no-create-info \
    --skip-add-locks \
    --skip-comments \
    --skip-set-charset \
    --no-tablespaces \
    "$DB_NAME" laravel_migrations >> "$DUMP_PATH" 2>/dev/null

echo "" >> "$DUMP_PATH"
echo "-- Legacy SQL migrations data (prevents replay after schema bootstrap)" >> "$DUMP_PATH"

echo "[schema-dump] Appending legacy migrations data..."
$DUMP_CMD \
    --no-create-info \
    --skip-add-locks \
    --skip-comments \
    --skip-set-charset \
    --no-tablespaces \
    "$DB_NAME" migrations >> "$DUMP_PATH" 2>/dev/null

LINES=$(wc -l < "$DUMP_PATH")
TABLES=$(grep -c "^CREATE TABLE" "$DUMP_PATH" || true)
MIGRATIONS=$(grep -c "^(" "$DUMP_PATH" 2>/dev/null || echo "?")

echo "[schema-dump] Done: $DUMP_PATH"
echo "[schema-dump]   $LINES lines, $TABLES tables, ~$MIGRATIONS migrations recorded"
echo "[schema-dump] Commit this file to keep the repo schema up to date."
