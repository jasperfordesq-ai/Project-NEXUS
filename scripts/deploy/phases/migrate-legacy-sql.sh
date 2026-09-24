#!/usr/bin/env bash
# Copyright © 2024–2026 Jasper Ford
# SPDX-License-Identifier: AGPL-3.0-or-later
set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$SCRIPT_DIR/../lib/common.sh"

backup_database_before_migrate() {
    local BACKUP_DIR="/opt/nexus-php/backups"
    mkdir -p "$BACKUP_DIR"

    local DB_PASS
    DB_PASS=$(grep "^DB_PASS=" "$DEPLOY_DIR/.env" 2>/dev/null | sed 's/^DB_PASS=//' | tr -d "\"'")

    local BACKUP_FILE="$BACKUP_DIR/pre-migrate-$(date +%Y%m%d-%H%M%S).sql.gz"
    log_info "Taking pre-migration database snapshot -> $BACKUP_FILE"

    if MYSQL_PWD="$DB_PASS" docker exec -e MYSQL_PWD nexus-php-db mysqldump -u nexus nexus 2>/dev/null | gzip > "$BACKUP_FILE"; then
        log_ok "Database backed up to $BACKUP_FILE ($(du -sh "$BACKUP_FILE" | cut -f1))"
        find "$BACKUP_DIR" -name "pre-migrate-*.sql.gz" -mtime +7 -delete
    else
        log_err "Database backup failed; aborting migration to prevent unrecoverable data loss"
        rm -f "$BACKUP_FILE"
        exit 1
    fi
}

run_pending_migrations() {
    log_step "=== Database Migrations ==="

    local MIGRATION_DIR="$DEPLOY_DIR/migrations"

    if [ ! -d "$MIGRATION_DIR" ]; then
        log_warn "migrations/ directory not found; skipping"
        return 0
    fi

    local DB_USER DB_PASS DB_NAME
    DB_USER=$(grep "^DB_USER=" "$DEPLOY_DIR/.env" 2>/dev/null | cut -d'=' -f2 | tr -d '"' || echo "nexus")
    DB_PASS=$(grep "^DB_PASS=" "$DEPLOY_DIR/.env" 2>/dev/null | cut -d'=' -f2 | tr -d '"')
    DB_NAME=$(grep "^DB_NAME=" "$DEPLOY_DIR/.env" 2>/dev/null | cut -d'=' -f2 | tr -d '"' || echo "nexus")

    MYSQL_PWD="$DB_PASS" docker exec -i -e MYSQL_PWD nexus-php-db mysql -u"$DB_USER" "$DB_NAME" 2>/dev/null <<'EOSQL'
CREATE TABLE IF NOT EXISTS migrations (
    id INT AUTO_INCREMENT PRIMARY KEY,
    migration_name VARCHAR(255) NOT NULL UNIQUE,
    backups VARCHAR(255) DEFAULT NULL,
    executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
EOSQL

    local APPLIED
    APPLIED=$(MYSQL_PWD="$DB_PASS" docker exec -e MYSQL_PWD nexus-php-db mysql -u"$DB_USER" "$DB_NAME" \
        -N -e "SELECT migration_name FROM migrations WHERE migration_name IS NOT NULL;" 2>/dev/null || echo "")

    local APPLIED_COUNT LARAVEL_MIGRATION_COUNT
    APPLIED_COUNT=$(MYSQL_PWD="$DB_PASS" docker exec -e MYSQL_PWD nexus-php-db mysql -u"$DB_USER" "$DB_NAME" \
        -N -e "SELECT COUNT(*) FROM migrations WHERE migration_name IS NOT NULL;" 2>/dev/null || echo "0")
    LARAVEL_MIGRATION_COUNT=$(MYSQL_PWD="$DB_PASS" docker exec -e MYSQL_PWD nexus-php-db mysql -u"$DB_USER" "$DB_NAME" \
        -N -e "SELECT COUNT(*) FROM laravel_migrations;" 2>/dev/null || echo "0")

    if [ "${APPLIED_COUNT:-0}" = "0" ] && [ "${LARAVEL_MIGRATION_COUNT:-0}" != "0" ]; then
        log_warn "Legacy migration registry is empty but Laravel schema bootstrap is present"
        log_warn "Marking committed legacy SQL files as already applied to prevent destructive replay"
        for SQL_FILE in "$MIGRATION_DIR"/*.sql; do
            [ -f "$SQL_FILE" ] || continue
            local BASENAME_ESCAPED
            BASENAME_ESCAPED=$(basename "$SQL_FILE" | sed "s/'/''/g")
            MYSQL_PWD="$DB_PASS" docker exec -e MYSQL_PWD nexus-php-db mysql -u"$DB_USER" "$DB_NAME" -e "
                INSERT IGNORE INTO migrations (migration_name, backups, executed_at)
                VALUES ('$BASENAME_ESCAPED', 'schema-dump-bootstrap', NOW());
            " 2>/dev/null
        done
        APPLIED=$(MYSQL_PWD="$DB_PASS" docker exec -e MYSQL_PWD nexus-php-db mysql -u"$DB_USER" "$DB_NAME" \
            -N -e "SELECT migration_name FROM migrations WHERE migration_name IS NOT NULL;" 2>/dev/null || echo "")
    fi

    local PENDING_COUNT=0
    local PENDING_FILES=()

    for SQL_FILE in "$MIGRATION_DIR"/*.sql; do
        [ -f "$SQL_FILE" ] || continue
        local BASENAME
        BASENAME=$(basename "$SQL_FILE")
        if ! echo "$APPLIED" | grep -qxF "$BASENAME"; then
            PENDING_FILES+=("$SQL_FILE")
            PENDING_COUNT=$((PENDING_COUNT + 1))
        fi
    done

    if [ $PENDING_COUNT -eq 0 ]; then
        log_ok "All migrations are up to date"
        return 0
    fi

    log_info "$PENDING_COUNT pending migration(s) to run:"
    for F in "${PENDING_FILES[@]}"; do
        echo "  - $(basename "$F")" | tee -a "$LOG_FILE"
    done
    echo "" | tee -a "$LOG_FILE"

    backup_database_before_migrate

    local RAN=0
    local FAILED=0

    for SQL_FILE in "${PENDING_FILES[@]}"; do
        local BASENAME BASENAME_ESCAPED
        BASENAME=$(basename "$SQL_FILE")
        BASENAME_ESCAPED=$(printf '%s' "$BASENAME" | sed "s/'/''/g")

        if grep -qiE '(DROP TABLE|DROP DATABASE|TRUNCATE)' "$SQL_FILE" 2>/dev/null; then
            log_err "$BASENAME contains DROP/TRUNCATE operations"
            FAILED=1
            break
        fi
        if grep -qiE 'DROP[[:space:]]+COLUMN|RENAME[[:space:]]+COLUMN|ALTER[[:space:]]+TABLE.+DROP' "$SQL_FILE" 2>/dev/null; then
            log_err "$BASENAME contains DROP COLUMN, RENAME COLUMN, or ALTER TABLE DROP"
            FAILED=1
            break
        fi

        log_info "Running: $BASENAME"
        if MYSQL_PWD="$DB_PASS" docker exec -i -e MYSQL_PWD nexus-php-db mysql -u"$DB_USER" "$DB_NAME" < "$SQL_FILE" 2>&1 | tee -a "$LOG_FILE"; then
            MYSQL_PWD="$DB_PASS" docker exec -e MYSQL_PWD nexus-php-db mysql -u"$DB_USER" "$DB_NAME" -e "
                INSERT IGNORE INTO migrations (migration_name, backups, executed_at)
                VALUES ('$BASENAME_ESCAPED', '$BASENAME_ESCAPED', NOW());
            " 2>/dev/null
            log_ok "Applied: $BASENAME"
            RAN=$((RAN + 1))
        else
            log_err "FAILED: $BASENAME"
            FAILED=1
            break
        fi
    done

    echo "" | tee -a "$LOG_FILE"
    if [ $FAILED -eq 1 ]; then
        log_err "Migration failed; deploy halted. $RAN migration(s) applied before failure."
        log_err "Fix the failed migration and re-run the deploy."
        return 1
    fi

    log_ok "$RAN migration(s) applied successfully"
    return 0
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
    run_pending_migrations
fi
