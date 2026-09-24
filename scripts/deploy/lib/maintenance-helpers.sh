#!/usr/bin/env bash
# Copyright © 2024–2026 Jasper Ford
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Maintenance-mode DB/Redis helpers + post-rebuild re-enable.

# Helper: set database maintenance_mode for all tenants during deploy
_deploy_db_maintenance_set() {
    local value="$1"
    local DB_USER DB_PASS DB_NAME
    DB_USER=$(grep "^DB_USER=" "$DEPLOY_DIR/.env" 2>/dev/null | cut -d'=' -f2 | tr -d '"' || echo "nexus")
    DB_PASS=$(grep "^DB_PASS=" "$DEPLOY_DIR/.env" 2>/dev/null | cut -d'=' -f2 | tr -d '"')
    DB_NAME=$(grep "^DB_NAME=" "$DEPLOY_DIR/.env" 2>/dev/null | cut -d'=' -f2 | tr -d '"' || echo "nexus")
    # Fallback: try DB_PASSWORD=
    if [ -z "$DB_PASS" ]; then
        DB_PASS=$(grep "^DB_PASSWORD=" "$DEPLOY_DIR/.env" 2>/dev/null | cut -d'=' -f2 | tr -d '"' || echo "")
    fi

    if [ -z "$DB_PASS" ]; then
        log_warn "Layer 2: No DB password — skipping database maintenance toggle"
        return
    fi

    if docker ps --format "{{.Names}}" | grep -qx "nexus-php-db"; then
        MYSQL_PWD="$DB_PASS" docker exec -e MYSQL_PWD nexus-php-db mysql -u"$DB_USER" "$DB_NAME" -e \
            "UPDATE tenant_settings SET setting_value = '$value' WHERE setting_key = 'general.maintenance_mode';" 2>/dev/null \
            && log_ok "Layer 2: Database maintenance_mode = '$value'" \
            || log_warn "Layer 2: Database update failed"
    else
        log_warn "Layer 2: nexus-php-db not running — skipping database maintenance toggle"
    fi
}

# Helper: flush Redis bootstrap cache so frontend sees maintenance changes immediately
_deploy_flush_bootstrap_cache() {
    if docker ps --format "{{.Names}}" | grep -qx "nexus-php-redis"; then
        local prefix
        prefix=$(grep "^CACHE_PREFIX=" "$DEPLOY_DIR/.env" 2>/dev/null | cut -d'=' -f2 | tr -d '"' || echo "nexus_laravel")
        local keys
        keys=$(docker exec nexus-php-redis redis-cli --no-auth-warning KEYS "${prefix}:*tenant_bootstrap*" 2>/dev/null || echo "")
        if [ -n "$keys" ]; then
            for key in $keys; do
                docker exec nexus-php-redis redis-cli --no-auth-warning DEL "$key" > /dev/null 2>&1
            done
        fi
        # Also flush tenant_settings cache
        keys=$(docker exec nexus-php-redis redis-cli --no-auth-warning KEYS "${prefix}:*tenant_settings*" 2>/dev/null || echo "")
        if [ -n "$keys" ]; then
            for key in $keys; do
                docker exec nexus-php-redis redis-cli --no-auth-warning DEL "$key" > /dev/null 2>&1
            done
        fi
        log_ok "Layer 3: Redis bootstrap/settings cache flushed"
    else
        log_warn "Layer 3: nexus-php-redis not running — skipping cache flush"
    fi
}

# After container rebuild/restart, re-enable maintenance if it was deferred
# or ensure it persists (container recreate wipes the file)
re_enable_maintenance_after_rebuild() {
    if docker ps --format "{{.Names}}" | grep -qx "$PHP_CONTAINER"; then
        docker exec "$PHP_CONTAINER" touch "$MAINTENANCE_FILE" 2>/dev/null || true
        log_ok "Maintenance mode re-confirmed after container rebuild"
    fi
}
