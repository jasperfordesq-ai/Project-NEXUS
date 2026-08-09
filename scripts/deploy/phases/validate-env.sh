#!/usr/bin/env bash
# Copyright © 2024–2026 Jasper Ford
# SPDX-License-Identifier: AGPL-3.0-or-later
set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../lib/common.sh
. "$SCRIPT_DIR/../lib/common.sh"

validate_required_env_vars() {
    log_step "=== Required Env Var Check ==="

    # These vars must be non-empty in .env before any deploy proceeds.
    # If a var disappears (e.g. .env rebuilt from .env.example, manual edit error,
    # partial restore from backup), the deploy fails here rather than silently
    # breaking live integrations.
    local REQUIRED_VARS=(
        # Core
        APP_KEY
        JWT_SECRET
        # Database (project uses DB_NAME/DB_USER/DB_PASS, not Laravel defaults)
        DB_HOST
        DB_NAME
        DB_USER
        DB_PASS
        # Stripe — billing, donations, identity
        STRIPE_SECRET_KEY
        STRIPE_PUBLISHABLE_KEY
        STRIPE_WEBHOOK_SECRET
        STRIPE_IDENTITY_SECRET_KEY
        STRIPE_IDENTITY_WEBHOOK_SECRET
        # Postmark — platform email delivery (SendGrid fully removed 2026-07-01)
        POSTMARK_SERVER_TOKEN
        # Pusher — real-time WebSockets
        PUSHER_APP_ID
        PUSHER_KEY
        PUSHER_SECRET
        # Web Push (VAPID)
        VAPID_PUBLIC_KEY
        VAPID_PRIVATE_KEY
        # Cron auth
        CRON_KEY
    )

    local FAILED=0
    local ENV_FILE="$DEPLOY_DIR/.env"

    for var in "${REQUIRED_VARS[@]}"; do
        # Strip quotes from the value when reading
        value=$(grep "^${var}=" "$ENV_FILE" 2>/dev/null | head -1 | cut -d'=' -f2- | tr -d '"'"'" | xargs)
        if [ -z "$value" ]; then
            log_err "Required env var missing or empty: $var"
            FAILED=1
        fi
    done

    if [ $FAILED -eq 1 ]; then
        log_err "One or more required env vars are missing — aborting deploy."
        log_err "Edit $ENV_FILE and add the missing values, then re-run the deploy."
        exit 1
    fi

    log_ok "All required env vars present"
}

validate_environment() {
    log_step "=== Pre-Deploy Validation ==="

    local VALIDATION_FAILED=0

    # Check required env vars first — fail fast before touching containers
    validate_required_env_vars

    # Validate critical variable values (not just presence)
    local APP_ENV_VAL
    APP_ENV_VAL=$(grep "^APP_ENV=" "$DEPLOY_DIR/.env" 2>/dev/null | head -1 | cut -d'=' -f2- | tr -d '"'"'" | xargs)
    if [ "${APP_ENV_VAL}" != "production" ]; then
        log_err "APP_ENV is '${APP_ENV_VAL}' — must be 'production' for a production deploy"
        VALIDATION_FAILED=1
    else
        log_ok "APP_ENV=production"
    fi

    local APP_DEBUG_VAL
    APP_DEBUG_VAL=$(grep "^APP_DEBUG=" "$DEPLOY_DIR/.env" 2>/dev/null | head -1 | cut -d'=' -f2- | tr -d '"'"'" | xargs)
    if [ "${APP_DEBUG_VAL}" != "false" ]; then
        log_err "APP_DEBUG is '${APP_DEBUG_VAL}' — must be 'false' to prevent stack traces leaking to users"
        VALIDATION_FAILED=1
    else
        log_ok "APP_DEBUG=false"
    fi

    # Check disk space
    AVAILABLE_MB=$(df -m "$DEPLOY_DIR" | tail -1 | awk '{print $4}')
    if [ "$AVAILABLE_MB" -lt "$MIN_DISK_SPACE_MB" ]; then
        log_err "Insufficient disk space: ${AVAILABLE_MB}MB (minimum: ${MIN_DISK_SPACE_MB}MB)"
        VALIDATION_FAILED=1
    else
        log_ok "Disk space: ${AVAILABLE_MB}MB available"
    fi

    # Check critical files
    if [ ! -f "$DEPLOY_DIR/.env" ]; then
        log_err ".env file missing"
        VALIDATION_FAILED=1
    else
        log_ok ".env exists"
    fi

    # compose.bluegreen.yml is THE production compose file. This used to check
    # for compose.prod.yml instead, which was deleted on 2026-08-09 along with
    # the legacy single-color stack it described — that check would have failed
    # every deploy from the moment the file went.
    if [ ! -f "$DEPLOY_DIR/compose.bluegreen.yml" ]; then
        log_err "compose.bluegreen.yml missing"
        VALIDATION_FAILED=1
    else
        log_ok "compose.bluegreen.yml exists"
    fi

    # Check if any PHP app container is running — accepts blue-green or legacy names
    if docker ps --format "{{.Names}}" | grep -qE "^nexus-(blue|green)-php-app$|^nexus-php-app$"; then
        log_ok "PHP app container running ($(docker ps --format "{{.Names}}" | grep -E "^nexus-(blue|green)-php-app$|^nexus-php-app$" | head -1))"
    else
        log_warn "No PHP app container running (nexus-blue-php-app, nexus-green-php-app, or nexus-php-app)"
    fi

    if ! docker ps --filter "name=nexus-php-db" --format "{{.Names}}" | grep -q "nexus-php-db"; then
        log_err "nexus-php-db container is not running"
        VALIDATION_FAILED=1
    else
        log_ok "nexus-php-db container running"
    fi

    # Check database connectivity (read password from .env)
    DB_PASS=$(grep "^DB_PASS=" "$DEPLOY_DIR/.env" 2>/dev/null | sed 's/^DB_PASS=//' | tr -d "\"'")
    if docker exec -e MYSQL_PWD="$DB_PASS" nexus-php-db mysqladmin ping -h localhost -unexus > /dev/null 2>&1; then
        log_ok "Database connection OK"
    else
        log_err "Database connection failed"
        VALIDATION_FAILED=1
    fi

    # Check Redis connectivity
    if docker exec nexus-php-redis redis-cli ping > /dev/null 2>&1; then
        log_ok "Redis connection OK"
    else
        log_warn "Redis connection failed (non-critical)"
    fi

    if [ $VALIDATION_FAILED -eq 1 ]; then
        log_err "Pre-deploy validation failed"
        exit 1
    fi

    log_ok "All pre-deploy checks passed"
}

validate_dockerfiles() {
    log_step "=== Dockerfile Sanity Check ==="

    local FAILED=0

    if [ -f "react-frontend/Dockerfile.prod" ]; then
        if grep -q "FROM nginx:alpine" react-frontend/Dockerfile.prod; then
            log_ok "Dockerfile.prod: nginx base image confirmed (production)"
        else
            log_err "Dockerfile.prod: nginx base image NOT found — wrong Dockerfile?"
            FAILED=1
        fi
    else
        log_warn "react-frontend/Dockerfile.prod not found — skipping check"
    fi

    if [ -f "react-frontend/Dockerfile" ]; then
        if grep -q "FROM node:" react-frontend/Dockerfile; then
            log_ok "Dockerfile (dev): node base image confirmed"
        else
            log_warn "react-frontend/Dockerfile: node base image not found (unexpected)"
        fi
    fi

    if [ $FAILED -eq 1 ]; then
        log_err "Dockerfile sanity check failed — aborting deploy"
        exit 1
    fi
}

# When executed directly (not sourced), run validate_environment.
# Build phases may `source` this file to get access to validate_dockerfiles.
if [ "${BASH_SOURCE[0]}" = "$0" ]; then
    validate_environment
fi
