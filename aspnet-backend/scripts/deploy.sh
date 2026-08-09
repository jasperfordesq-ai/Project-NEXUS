#!/bin/bash
# Copyright © 2024–2026 Jasper Ford
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Production deployment script for Project NEXUS ASP.NET API (Nexus.Api).
# Handles the API container only. The V2 SPA (nexus-react-frontend) is
# deployed via raw `docker run` per .claude/production-containers.md —
# this script does NOT touch it.
#
# Learns from V1's safe-deploy.sh: locking, validation, backup, smoke test,
# rollback, Cloudflare purge.
#
# Usage:
#   ./scripts/deploy.sh              # Standard deploy (rsync + rebuild + smoke test)
#   ./scripts/deploy.sh quick        # Quick restart (no rebuild — pulls existing image)
#   ./scripts/deploy.sh rollback     # Revert to previous image
#   ./scripts/deploy.sh status       # Check deployment state (read-only)
#
# Prerequisites:
#   - SSH key at ~/.ssh/project-nexus.pem or C:/ssh-keys/project-nexus.pem
#   - NEXUS_DEPLOY_HOST env var set (e.g. azureuser@your-server-ip)
#   - Cloudflare API token on the server at /opt/nexus-backend/.cloudflare-api-token

set -e

MODE="${1:-deploy}"
SERVER="${NEXUS_DEPLOY_HOST:?ERROR: Set NEXUS_DEPLOY_HOST (e.g. export NEXUS_DEPLOY_HOST=azureuser@your-server-ip)}"
REMOTE_DIR="/opt/nexus-backend"
LOCK_FILE="$REMOTE_DIR/.deploy.lock"
LAST_DEPLOY_FILE="$REMOTE_DIR/.last-successful-deploy"
API_IMAGE="nexus-backend-api"
API_CONTAINER="nexus-backend-api"
HEALTH_URL="http://localhost:5080/health"
MIN_DISK_MB=1024

# Detect SSH key
for KEY_PATH in "$HOME/.ssh/project-nexus.pem" "/c/ssh-keys/project-nexus.pem" "C:/ssh-keys/project-nexus.pem"; do
    [ -f "$KEY_PATH" ] && SSH_KEY="$KEY_PATH" && break
done
[ -z "$SSH_KEY" ] && echo "ERROR: SSH key not found" && exit 1

SSH_CMD="ssh -i $SSH_KEY -o StrictHostKeyChecking=no $SERVER"

log() { echo "[$(date '+%H:%M:%S')] $1"; }
fail() { log "FAILED: $1"; exit 1; }

# ===== STATUS MODE =====
if [ "$MODE" = "status" ]; then
    log "Checking deployment status..."
    $SSH_CMD << EOSTATUS
        echo "=== Deployment Status ==="
        cd "$REMOTE_DIR" 2>/dev/null || { echo "V2 not deployed yet"; exit 0; }
        echo "Lock file: \$([ -f .deploy.lock ] && echo 'LOCKED' || echo 'unlocked')"
        echo "Last successful deploy: \$(cat .last-successful-deploy 2>/dev/null || echo 'none')"
        echo ""
        echo "=== Container Status ==="
        sudo docker compose ps api 2>/dev/null || echo "No containers"
        echo ""
        echo "=== Health Check ==="
        STATUS=\$(curl -s -o /dev/null -w "%{http_code}" $HEALTH_URL 2>/dev/null || echo "unreachable")
        echo "Health: \$STATUS"
        echo ""
        echo "=== Disk Space ==="
        df -h /opt | tail -1
EOSTATUS
    exit 0
fi

echo "============================================"
echo "  Project NEXUS .NET Edition - API Production Deploy"
echo "  Mode: $MODE"
echo "  Target: $SERVER:$REMOTE_DIR"
echo "  Note: SPA deploys live in .claude/production-containers.md"
echo "============================================"
echo ""

# ===== ROLLBACK MODE =====
if [ "$MODE" = "rollback" ]; then
    log "Rolling back to previous deployment..."
    $SSH_CMD << EOROLLBACK
        set -e
        cd "$REMOTE_DIR"
        PREV=\$(cat .last-successful-deploy 2>/dev/null)
        [ -z "\$PREV" ] && echo "No previous deployment to rollback to" && exit 1

        echo "Rolling back to: \$PREV"
        ROLLBACK_IMAGE="$API_IMAGE:rollback"
        if sudo docker image inspect "\$ROLLBACK_IMAGE" > /dev/null 2>&1; then
            sudo docker tag "\$ROLLBACK_IMAGE" "$API_IMAGE:latest"
            sudo docker compose up -d api
            sleep 10
            STATUS=\$(curl -s -o /dev/null -w "%{http_code}" $HEALTH_URL || echo "000")
            if [ "\$STATUS" = "200" ]; then
                echo "Rollback successful. Health check passed."
            else
                echo "WARNING: Rollback health check returned \$STATUS. Check logs."
            fi
        else
            echo "No rollback image found. Manual intervention needed."
            exit 1
        fi
EOROLLBACK
    exit $?
fi

# ===== DEPLOY / QUICK MODE =====

# Confirm production deploy
if [ -t 0 ]; then
    read -p "Deploy to PRODUCTION? Type YES to confirm: " CONFIRM
    [ "$CONFIRM" != "YES" ] && echo "Cancelled." && exit 0
fi

# --- Step 1: Pre-deploy validation ---
log "Step 1/7: Pre-deploy validation..."
$SSH_CMD << EOVALIDATE
    set -e

    # Check deployment lock (prevent concurrent deploys)
    if [ -f "$LOCK_FILE" ]; then
        LOCK_PID=\$(cat "$LOCK_FILE")
        if kill -0 "\$LOCK_PID" 2>/dev/null; then
            echo "ERROR: Deployment already in progress (PID: \$LOCK_PID)"
            exit 1
        else
            echo "Removing stale lock (PID \$LOCK_PID no longer running)"
            rm -f "$LOCK_FILE"
        fi
    fi

    # Acquire lock
    echo \$\$ > "$LOCK_FILE"

    # Check disk space
    AVAIL=\$(df -m /opt | tail -1 | awk '{print \$4}')
    if [ "\$AVAIL" -lt "$MIN_DISK_MB" ]; then
        echo "ERROR: Only \${AVAIL}MB free (need ${MIN_DISK_MB}MB)"
        rm -f "$LOCK_FILE"
        exit 1
    fi
    echo "Disk space: \${AVAIL}MB available"

    # Ensure target directory exists
    mkdir -p "$REMOTE_DIR/backups" "$REMOTE_DIR/logs"
EOVALIDATE

# --- Step 2: Database backup (ALWAYS backup before potential migration) ---
log "Step 2/7: Pre-deploy database backup..."
$SSH_CMD << EOBACKUP
    set -e
    cd "$REMOTE_DIR"
    TIMESTAMP=\$(date +%Y%m%d_%H%M%S)

    if sudo docker compose ps db --status running -q 2>/dev/null | head -1; then
        sudo docker compose exec -T db pg_dump -U postgres -d nexus_dev --clean --if-exists \
            > "backups/pre_deploy_\${TIMESTAMP}.sql" 2>/dev/null || true
        echo "Backup: backups/pre_deploy_\${TIMESTAMP}.sql"
    else
        echo "Database not running, skipping backup"
    fi
EOBACKUP

# --- Step 3: Upload source (skip for quick mode) ---
if [ "$MODE" != "quick" ]; then
    log "Step 3/7: Uploading source files..."
    if command -v rsync &> /dev/null; then
        rsync -avz --delete \
            -e "ssh -i $SSH_KEY -o StrictHostKeyChecking=no" \
            --exclude='.git' \
            --exclude='backups/' \
            --exclude='.env' \
            --exclude='compose.override.yml' \
            --exclude='.claude/' \
            --exclude='tests/' \
            --exclude='.github/' \
            --exclude='node_modules/' \
            ./ "${SERVER}:${REMOTE_DIR}/"
    else
        scp -i "$SSH_KEY" -r src/ "${SERVER}:${REMOTE_DIR}/src/"
        scp -i "$SSH_KEY" Dockerfile compose.yml Nexus.sln "${SERVER}:${REMOTE_DIR}/"
    fi
else
    log "Step 3/7: Skipped (quick mode)"
fi

# --- Step 4: Build Docker image (tag current for rollback) ---
log "Step 4/7: Building Docker image..."
$SSH_CMD << EOBUILD
    set -e
    cd "$REMOTE_DIR"

    # Tag current image for rollback
    CURRENT=\$(sudo docker compose images api --format '{{.Repository}}:{{.Tag}}' 2>/dev/null | head -1)
    if [ -n "\$CURRENT" ] && [ "\$CURRENT" != ":" ]; then
        sudo docker tag "\$CURRENT" "${API_IMAGE}:rollback" 2>/dev/null || true
        echo "Tagged rollback: ${API_IMAGE}:rollback"
    fi

    # Build (EF migrations run automatically at app startup via Database.MigrateAsync)
    sudo docker compose build --no-cache api
    echo "Build complete"
EOBUILD

# --- Step 5: Restart and smoke test ---
log "Step 5/7: Restarting and smoke testing..."
$SSH_CMD << EOSMOKE
    set -e
    cd "$REMOTE_DIR"

    sudo docker compose up -d api
    echo "Waiting for health check (migrations run at startup)..."

    HEALTHY=false
    for i in \$(seq 1 24); do
        sleep 5
        STATUS=\$(curl -s -o /dev/null -w "%{http_code}" $HEALTH_URL 2>/dev/null || echo "000")
        if [ "\$STATUS" = "200" ]; then
            echo "Health check PASSED after \$((i * 5)) seconds"
            HEALTHY=true
            break
        fi
        echo "  Attempt \$i/24: HTTP \$STATUS"
    done

    if [ "\$HEALTHY" = "false" ]; then
        echo "FAILED: Health check failed after 120 seconds"
        echo "Attempting rollback..."

        ROLLBACK_IMAGE="${API_IMAGE}:rollback"
        if sudo docker image inspect "\$ROLLBACK_IMAGE" > /dev/null 2>&1; then
            sudo docker tag "\$ROLLBACK_IMAGE" "${API_IMAGE}:latest"
            sudo docker compose up -d api
            sleep 15
            RSTATUS=\$(curl -s -o /dev/null -w "%{http_code}" $HEALTH_URL || echo "000")
            [ "\$RSTATUS" = "200" ] && echo "Rollback successful" || echo "WARNING: Rollback may have failed"
        fi
        rm -f $LOCK_FILE
        exit 1
    fi

    # Extended smoke tests
    echo ""
    echo "Extended smoke tests..."
    SWAGGER=\$(curl -s -o /dev/null -w "%{http_code}" http://localhost:5080/swagger/index.html 2>/dev/null || echo "000")
    echo "  Swagger UI: HTTP \$SWAGGER"

    # Save successful deploy hash
    git rev-parse --short HEAD 2>/dev/null > $LAST_DEPLOY_FILE || true
    echo ""
    echo "Deployment successful!"
EOSMOKE

# --- Step 6: Cloudflare cache purge (delegates to scripts/purge-cloudflare-cache.sh on server) ---
log "Step 6/7: Purging Cloudflare cache..."
$SSH_CMD << EOPURGE
    if [ -x "$REMOTE_DIR/scripts/purge-cloudflare-cache.sh" ]; then
        sudo bash "$REMOTE_DIR/scripts/purge-cloudflare-cache.sh" 2>&1 | tail -15 || true
    else
        echo "purge-cloudflare-cache.sh not found, skipping"
    fi
EOPURGE

# --- Step 7: Docker image prune ---
log "Step 7/7: Pruning dangling Docker images..."
$SSH_CMD "sudo docker image prune -f 2>&1 | grep 'Total reclaimed' || echo 'Nothing to prune'"

# Release deployment lock
$SSH_CMD "rm -f $LOCK_FILE" 2>/dev/null || true

log "Deploy complete!"
echo ""
echo "============================================"
echo "  Deployment Summary"
echo "  Status: SUCCESS"
echo "  Server: $SERVER"
echo "  Health: https://api.project-nexus.net/health"
echo "============================================"
echo ""
echo "Note: This script deploys the API only. To deploy the SPA, see"
echo "      .claude/production-containers.md"
