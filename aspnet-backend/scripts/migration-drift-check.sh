#!/bin/bash
# Copyright © 2024–2026 Jasper Ford
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Migration Drift Check
# =====================
# Compares migration history between local and production databases
# to detect schema drift before it causes deployment failures.
#
# Usage:
#   ./scripts/migration-drift-check.sh              # Full check (requires NEXUS_DEPLOY_HOST)
#   ./scripts/migration-drift-check.sh --local-only  # Check local model changes only
#
# Exit codes:
#   0 = No drift detected
#   1 = Drift detected or error

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
COMPOSE="docker compose"
PROJECT_PATH="src/Nexus.Api"

# Colors (disabled if not a terminal)
if [ -t 1 ]; then
    RED='\033[0;31m'
    GREEN='\033[0;32m'
    YELLOW='\033[1;33m'
    BLUE='\033[0;34m'
    NC='\033[0m'
else
    RED='' GREEN='' YELLOW='' BLUE='' NC=''
fi

echo ""
echo "============================================"
echo "  Migration Drift Check"
echo "============================================"
echo ""

DRIFT_FOUND=0

# ---------------------------------------------------------------------------
# Step 1: Check for uncommitted model changes locally
# ---------------------------------------------------------------------------
echo -e "${BLUE}[1/3] Checking for uncommitted model changes...${NC}"

cd "$PROJECT_ROOT"

# Use EF Core's built-in pending model change detection
if $COMPOSE exec -T api dotnet ef migrations has-pending-model-changes \
    --project /app/$PROJECT_PATH 2>/dev/null; then
    echo -e "${RED}  WARNING: DbContext has changes not captured in a migration!${NC}"
    echo "  Run: make migrate NAME=DescriptiveName"
    DRIFT_FOUND=1
else
    echo -e "${GREEN}  OK: Model matches last migration.${NC}"
fi
echo ""

# ---------------------------------------------------------------------------
# Step 2: List local migrations
# ---------------------------------------------------------------------------
echo -e "${BLUE}[2/3] Local migrations:${NC}"

LOCAL_MIGRATIONS=$($COMPOSE exec -T api dotnet ef migrations list \
    --project /app/$PROJECT_PATH --no-connect 2>/dev/null \
    | grep -E '^\d{14}_' || true)

LOCAL_COUNT=$(echo "$LOCAL_MIGRATIONS" | grep -c '.' || echo "0")
echo "  Found $LOCAL_COUNT migration(s) in codebase"

# ---------------------------------------------------------------------------
# Step 3: Compare with production (if accessible)
# ---------------------------------------------------------------------------
if [ "$1" = "--local-only" ]; then
    echo ""
    echo -e "${YELLOW}Skipping production comparison (--local-only).${NC}"
elif [ -z "$NEXUS_DEPLOY_HOST" ]; then
    echo ""
    echo -e "${YELLOW}[3/3] Production comparison skipped.${NC}"
    echo "  Set NEXUS_DEPLOY_HOST to enable production drift check."
else
    echo -e "${BLUE}[3/3] Comparing with production...${NC}"

    SSH_HOST="$NEXUS_DEPLOY_HOST"
    PROD_DIR="/opt/nexus-backend"

    # Detect SSH key
    if [ -f "$HOME/.ssh/project-nexus.pem" ]; then
        SSH_KEY="$HOME/.ssh/project-nexus.pem"
    elif [ -f "/c/ssh-keys/project-nexus.pem" ]; then
        SSH_KEY="/c/ssh-keys/project-nexus.pem"
    elif [ -f "C:/ssh-keys/project-nexus.pem" ]; then
        SSH_KEY="C:/ssh-keys/project-nexus.pem"
    else
        echo -e "${RED}  ERROR: SSH key not found.${NC}"
        echo "  Expected at ~/.ssh/project-nexus.pem or C:/ssh-keys/project-nexus.pem"
        exit 1
    fi

    SSH_CMD="ssh -i $SSH_KEY $SSH_HOST"

    # Get production migration list
    PROD_MIGRATIONS=$($SSH_CMD "cd $PROD_DIR; \
        sudo docker compose exec -T api dotnet ef migrations list \
            --project /app/$PROJECT_PATH 2>/dev/null \
        | grep -E '^\d{14}_'" 2>/dev/null || echo "")

    PROD_COUNT=$(echo "$PROD_MIGRATIONS" | grep -c '.' 2>/dev/null || echo "0")
    echo "  Production has $PROD_COUNT migration(s) applied"

    # Compare: find migrations in local but not in production (pending for prod)
    PENDING_FOR_PROD=""
    while IFS= read -r migration; do
        [ -z "$migration" ] && continue
        if ! echo "$PROD_MIGRATIONS" | grep -qF "$migration"; then
            PENDING_FOR_PROD="${PENDING_FOR_PROD}    - ${migration}\n"
        fi
    done <<< "$LOCAL_MIGRATIONS"

    # Compare: find migrations in production but not in local (dangerous!)
    EXTRA_IN_PROD=""
    while IFS= read -r migration; do
        [ -z "$migration" ] && continue
        if ! echo "$LOCAL_MIGRATIONS" | grep -qF "$migration"; then
            EXTRA_IN_PROD="${EXTRA_IN_PROD}    - ${migration}\n"
        fi
    done <<< "$PROD_MIGRATIONS"

    echo ""
    if [ -n "$PENDING_FOR_PROD" ]; then
        echo -e "${YELLOW}  Migrations PENDING on production:${NC}"
        echo -e "$PENDING_FOR_PROD"
        echo "  Run: make migrate-prod"
        DRIFT_FOUND=1
    else
        echo -e "${GREEN}  Production is up to date with local migrations.${NC}"
    fi

    if [ -n "$EXTRA_IN_PROD" ]; then
        echo -e "${RED}  DANGER: Production has migrations NOT in local codebase:${NC}"
        echo -e "$EXTRA_IN_PROD"
        echo "  This indicates schema drift! Someone applied migrations directly to production."
        echo "  Fix: Pull the migration files from production or recreate them locally."
        DRIFT_FOUND=1
    fi
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo ""
echo "============================================"
if [ "$DRIFT_FOUND" -eq 1 ]; then
    echo -e "${RED}  DRIFT DETECTED - Action required${NC}"
    echo "============================================"
    exit 1
else
    echo -e "${GREEN}  NO DRIFT - All clear${NC}"
    echo "============================================"
    exit 0
fi
