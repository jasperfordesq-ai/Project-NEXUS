#!/usr/bin/env bash
# Copyright © 2024–2026 Jasper Ford
# SPDX-License-Identifier: AGPL-3.0-or-later
set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$SCRIPT_DIR/../lib/common.sh"

# status must not write to a real log file
LOG_FILE="/dev/null"

get_last_successful_commit() {
    if [ -f "$LAST_DEPLOY_FILE" ]; then
        cat "$LAST_DEPLOY_FILE"
    else
        echo ""
    fi
}

show_status() {
    log_step "=== Deployment Status ==="

    # Check if a deploy is currently running
    if [ -f "$LOCK_FILE" ]; then
        local LOCK_PID
        LOCK_PID=$(cat "$LOCK_FILE" 2>/dev/null)
        if ps -p "$LOCK_PID" > /dev/null 2>&1; then
            log_warn "Deploy is RUNNING in background (PID: $LOCK_PID)"
            log_info "Follow live: sudo bash scripts/safe-deploy.sh logs -f"
        else
            log_info "No deploy in progress (stale lock file)"
        fi
    else
        log_info "No deploy in progress"
    fi

    echo "" | tee -a "$LOG_FILE"

    # Current commit
    cd "$DEPLOY_DIR"
    CURRENT_COMMIT=$(git rev-parse HEAD)
    log_info "Current commit: ${CURRENT_COMMIT:0:8}"
    git log -1 --format='  %h - %s (%ar)' | tee -a "$LOG_FILE"

    # Last successful deploy
    LAST_COMMIT=$(get_last_successful_commit)
    if [ -n "$LAST_COMMIT" ]; then
        log_info "Last successful: ${LAST_COMMIT:0:8}"
        git log -1 --format='  %h - %s (%ar)' "$LAST_COMMIT" | tee -a "$LOG_FILE"
    else
        log_warn "No previous successful deployment recorded"
    fi

    echo "" | tee -a "$LOG_FILE"

    # Container status
    log_info "Container status:"
    {
        printf "NAMES\tSTATUS\n"
        docker ps --format "{{.Names}}\t{{.Status}}" \
            | grep -E '^(nexus-php-app|nexus-php-db|nexus-php-redis|nexus-react-prod|nexus-meilisearch|nexus-(blue|green)-(php-app|react|php-queue|php-scheduler))\t' \
            || true
    } | column -t -s $'\t' | tee -a "$LOG_FILE"

    echo "" | tee -a "$LOG_FILE"

    # Pending migrations
    local MIGRATION_DIR="$DEPLOY_DIR/migrations"
    if [ -d "$MIGRATION_DIR" ]; then
        local DB_USER DB_PASS DB_NAME
        DB_USER=$(grep "^DB_USER=" "$DEPLOY_DIR/.env" 2>/dev/null | cut -d'=' -f2 | tr -d '"' || echo "nexus")
        DB_PASS=$(grep "^DB_PASS=" "$DEPLOY_DIR/.env" 2>/dev/null | cut -d'=' -f2 | tr -d '"')
        DB_NAME=$(grep "^DB_NAME=" "$DEPLOY_DIR/.env" 2>/dev/null | cut -d'=' -f2 | tr -d '"' || echo "nexus")
        local APPLIED
        APPLIED=$(MYSQL_PWD="$DB_PASS" docker exec -e MYSQL_PWD nexus-php-db mysql -u"$DB_USER" "$DB_NAME" \
            -N -e "SELECT migration_name FROM migrations WHERE migration_name IS NOT NULL;" 2>/dev/null || echo "")
        local PENDING_COUNT=0
        for SQL_FILE in "$MIGRATION_DIR"/*.sql; do
            [ -f "$SQL_FILE" ] || continue
            local BASENAME
            BASENAME=$(basename "$SQL_FILE")
            if ! echo "$APPLIED" | grep -qxF "$BASENAME"; then
                PENDING_COUNT=$((PENDING_COUNT + 1))
            fi
        done
        if [ $PENDING_COUNT -eq 0 ]; then
            log_ok "Migrations: all up to date"
        else
            log_warn "Migrations: $PENDING_COUNT pending"
        fi
    fi

    echo "" | tee -a "$LOG_FILE"

    # Maintenance mode check
    local MAINT_FILE=0
    local MAINT_DB="unknown"
    if docker ps --format "{{.Names}}" | grep -qx "$PHP_CONTAINER"; then
        docker exec "$PHP_CONTAINER" test -f "$MAINTENANCE_FILE" 2>/dev/null && MAINT_FILE=1
    fi
    local DB_USER DB_PASS DB_NAME
    DB_USER=$(grep "^DB_USER=" "$DEPLOY_DIR/.env" 2>/dev/null | cut -d'=' -f2 | tr -d '"' || echo "nexus")
    DB_PASS=$(grep "^DB_PASS=" "$DEPLOY_DIR/.env" 2>/dev/null | cut -d'=' -f2 | tr -d '"')
    DB_NAME=$(grep "^DB_NAME=" "$DEPLOY_DIR/.env" 2>/dev/null | cut -d'=' -f2 | tr -d '"' || echo "nexus")
    if [ -z "$DB_PASS" ]; then
        DB_PASS=$(grep "^DB_PASSWORD=" "$DEPLOY_DIR/.env" 2>/dev/null | cut -d'=' -f2 | tr -d '"' || echo "")
    fi
    if [ -n "$DB_PASS" ] && docker ps --format "{{.Names}}" | grep -qx "nexus-php-db"; then
        MAINT_DB=$(MYSQL_PWD="$DB_PASS" docker exec -e MYSQL_PWD nexus-php-db mysql -u"$DB_USER" "$DB_NAME" \
            -N -e "SELECT setting_value FROM tenant_settings WHERE setting_key='general.maintenance_mode' LIMIT 1;" 2>/dev/null || echo "unknown")
    fi

    if [ "$MAINT_FILE" = "1" ] || [ "$MAINT_DB" = "true" ]; then
        log_err "MAINTENANCE MODE IS ON (file: $([ "$MAINT_FILE" = "1" ] && echo "YES" || echo "no"), db: $MAINT_DB)"
        log_warn "Run: sudo bash scripts/maintenance.sh off"
    else
        log_ok "Maintenance mode: OFF (site is live)"
    fi

    echo "" | tee -a "$LOG_FILE"

    # Recent logs (last 5 lines)
    log_info "Recent API logs:"
    docker compose logs --tail=5 app 2>/dev/null | tee -a "$LOG_FILE" || log_warn "Could not fetch logs"
}

show_status
