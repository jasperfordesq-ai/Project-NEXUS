#!/bin/bash
# =============================================================================
# Project NEXUS — Admin & Super Admin Security Regression Gate
# =============================================================================
# Single command to verify all admin panel and tenant isolation security.
# Run this after ANY changes to:
#   - TenantContext.php
#   - AdminSuperApiController.php
#   - SuperPanelAccess.php
#   - BaseApiController.php (requireAdmin/requireSuperAdmin)
#   - ApiErrorCodes.php
#   - Any admin API controller
#
# Usage:
#   ./scripts/verify-admin-security.sh              # Full verification
#   ./scripts/verify-admin-security.sh --quick       # Security tests only (skip build)
#   ./scripts/verify-admin-security.sh --docker      # Run inside Docker container
#
# Exit codes:
#   0 = All checks pass
#   1 = One or more checks failed
# =============================================================================

set -uo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m'

ERRORS=0
WARNINGS=0
QUICK=false
INSIDE_DOCKER=false      # --docker flag: script is already inside the container
USE_DOCKER_EXEC=false    # Auto-detected: run commands via docker exec from host
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Parse arguments
for arg in "$@"; do
    case $arg in
        --quick) QUICK=true ;;
        --docker) INSIDE_DOCKER=true ;;
        *) echo "Unknown argument: $arg"; exit 1 ;;
    esac
done

echo -e "${BOLD}================================================${NC}"
echo -e "${BOLD} Project NEXUS — Admin Security Regression Gate${NC}"
echo -e "${BOLD}================================================${NC}"
echo ""
echo "Mode: $([ "$QUICK" = true ] && echo 'Quick (security tests only)' || echo 'Full (security + build)')"
echo "Date: $(date '+%Y-%m-%d %H:%M:%S')"
echo ""

# Helper function
check_pass() {
    echo -e "  ${GREEN}✓ PASS${NC}: $1"
}

check_fail() {
    echo -e "  ${RED}✗ FAIL${NC}: $1"
    ERRORS=$((ERRORS + 1))
}

check_warn() {
    echo -e "  ${YELLOW}⚠ WARN${NC}: $1"
    WARNINGS=$((WARNINGS + 1))
}

# ─────────────────────────────────────────────────────────────────────────────
# GATE 1: Tenant Isolation Tests (PHPUnit)
# ─────────────────────────────────────────────────────────────────────────────
echo -e "${BLUE}═══ GATE 1: Tenant Isolation Security Tests ═══${NC}"

if [ "$INSIDE_DOCKER" = true ]; then
    # Already inside the container — use local commands directly
    USE_DOCKER_EXEC=false
else
    # Running from host — check if Docker container is available
    if command -v docker &>/dev/null && docker ps -q --filter name=nexus-php-app 2>/dev/null | grep -q .; then
        USE_DOCKER_EXEC=true
    else
        USE_DOCKER_EXEC=false
    fi
fi

# Run tenant isolation tests
echo "  Running TenantIsolationTest (18 tests, @group tenant-isolation)..."
if [ "$USE_DOCKER_EXEC" = true ]; then
    RESULT=$(docker exec nexus-php-app bash -c "cd /var/www/html && vendor/bin/phpunit tests/Middleware/TenantIsolationTest.php --teamcity 2>/dev/null" 2>&1)
else
    cd "$PROJECT_ROOT"
    RESULT=$(vendor/bin/phpunit tests/Middleware/TenantIsolationTest.php --teamcity 2>/dev/null 2>&1)
fi

FAILURES=$(echo "$RESULT" | grep -c 'testFailed' || true)
FINISHED=$(echo "$RESULT" | grep -c 'testFinished' || true)

if [ "$FAILURES" -eq 0 ] && [ "$FINISHED" -ge 18 ]; then
    check_pass "TenantIsolationTest: $FINISHED tests passed, 0 failures"
else
    check_fail "TenantIsolationTest: $FINISHED finished, $FAILURES failures"
fi

# Run SuperPanelAccess tests
echo "  Running TenantSuperAdminPanelSubtreeTest..."
if [ "$USE_DOCKER_EXEC" = true ]; then
    RESULT=$(docker exec nexus-php-app bash -c "cd /var/www/html && vendor/bin/phpunit tests/Laravel/Feature/SuperAdmin/TenantSuperAdminPanelSubtreeTest.php --teamcity 2>/dev/null" 2>&1)
else
    RESULT=$(vendor/bin/phpunit tests/Laravel/Feature/SuperAdmin/TenantSuperAdminPanelSubtreeTest.php --teamcity 2>/dev/null 2>&1)
fi

FAILURES=$(echo "$RESULT" | grep -c 'testFailed' || true)
FINISHED=$(echo "$RESULT" | grep -c 'testFinished' || true)

if [ "$FAILURES" -eq 0 ] && [ "$FINISHED" -ge 15 ]; then
    check_pass "TenantSuperAdminPanelSubtreeTest: $FINISHED tests passed, 0 failures"
else
    check_fail "TenantSuperAdminPanelSubtreeTest: $FINISHED finished, $FAILURES failures"
fi

# ─────────────────────────────────────────────────────────────────────────────
# GATE 2: Source Code Security Assertions
# ─────────────────────────────────────────────────────────────────────────────
echo ""
echo -e "${BLUE}═══ GATE 2: Source Code Security Assertions ═══${NC}"

# 2a: isTokenUserSuperAdmin uses !empty() not loose checks
TENANT_CTX="$PROJECT_ROOT/app/Core/TenantContext.php"
if [ -f "$TENANT_CTX" ]; then
    if grep -q '!empty($userRow->is_super_admin)' "$TENANT_CTX"; then
        check_pass "TenantContext: isTokenUserSuperAdmin uses !empty() for is_super_admin"
    else
        check_fail "TenantContext: isTokenUserSuperAdmin does NOT use !empty() for is_super_admin"
    fi

    if grep -q "respondWithTenantMismatchError" "$TENANT_CTX"; then
        check_pass "TenantContext: respondWithTenantMismatchError exists"
    else
        check_fail "TenantContext: respondWithTenantMismatchError is MISSING"
    fi
else
    check_fail "TenantContext.php not found at $TENANT_CTX"
fi

# 2b: AdminSuperController checks SuperPanelAccess
SUPER_CTRL="$PROJECT_ROOT/app/Http/Controllers/Api/AdminSuperController.php"
if [ -f "$SUPER_CTRL" ]; then
    if grep -q "SUPER_PANEL_ACCESS_DENIED" "$SUPER_CTRL"; then
        check_pass "AdminSuperApiController: Uses SUPER_PANEL_ACCESS_DENIED error code"
    else
        check_fail "AdminSuperApiController: SUPER_PANEL_ACCESS_DENIED error code MISSING"
    fi

    if grep -q 'SuperPanelAccess::getAccess()' "$SUPER_CTRL"; then
        check_pass "AdminSuperApiController: Calls SuperPanelAccess::getAccess()"
    else
        check_fail "AdminSuperApiController: SuperPanelAccess::getAccess() call MISSING"
    fi
else
    check_fail "AdminSuperApiController.php not found at $SUPER_CTRL"
fi

# 2c: ApiErrorCodes has SUPER_PANEL_ACCESS_DENIED
ERROR_CODES="$PROJECT_ROOT/app/Core/ApiErrorCodes.php"
if [ -f "$ERROR_CODES" ]; then
    if grep -q "SUPER_PANEL_ACCESS_DENIED" "$ERROR_CODES"; then
        check_pass "ApiErrorCodes: SUPER_PANEL_ACCESS_DENIED constant exists"
    else
        check_fail "ApiErrorCodes: SUPER_PANEL_ACCESS_DENIED constant MISSING"
    fi

    if grep -q "TENANT_MISMATCH" "$ERROR_CODES"; then
        check_pass "ApiErrorCodes: TENANT_MISMATCH constant exists"
    else
        check_fail "ApiErrorCodes: TENANT_MISMATCH constant MISSING"
    fi
else
    check_fail "ApiErrorCodes.php not found at $ERROR_CODES"
fi

# 2d: SuperPanelAccess checks allows_subtenants
SPA_FILE="$PROJECT_ROOT/app/Core/SuperPanelAccess.php"
if [ -f "$SPA_FILE" ]; then
    if grep -q "allows_subtenants" "$SPA_FILE"; then
        check_pass "SuperPanelAccess: Checks allows_subtenants flag"
    else
        check_fail "SuperPanelAccess: allows_subtenants check MISSING"
    fi
else
    check_fail "SuperPanelAccess.php not found at $SPA_FILE"
fi

# ─────────────────────────────────────────────────────────────────────────────
# GATE 3: Regression Pattern Scan
# ─────────────────────────────────────────────────────────────────────────────
echo ""
echo -e "${BLUE}═══ GATE 3: Regression Pattern Scan ═══${NC}"

# 3a: Check for dangerous double-unwrap pattern in React
DOUBLE_UNWRAP=$(grep -r 'data\.data ??' "$PROJECT_ROOT/react-frontend/src/" --include="*.ts" --include="*.tsx" 2>/dev/null | grep -v node_modules | grep -v '.test.' | wc -l || true)
if [ "$DOUBLE_UNWRAP" -eq 0 ]; then
    check_pass "No double-unwrap (data.data ??) patterns found in React source"
else
    check_fail "Found $DOUBLE_UNWRAP double-unwrap (data.data ??) patterns in React source"
fi

# 3b: Check for unscoped DELETE/UPDATE in admin controllers (scan the directory)
UNSCOPED=$(grep -rn 'DELETE FROM\|UPDATE.*SET' "$PROJECT_ROOT/app/Http/Controllers/Api/" --include="Admin*.php" 2>/dev/null | grep -v 'tenant_id' | grep -v '// ' | grep -v '\*' | wc -l || true)
if [ "$UNSCOPED" -eq 0 ]; then
    check_pass "No unscoped DELETE/UPDATE in admin API controllers"
else
    check_warn "Found $UNSCOPED potentially unscoped DELETE/UPDATE in admin API controllers (review manually)"
fi

# ─────────────────────────────────────────────────────────────────────────────
# GATE 4: Full Middleware Test Suite (if not --quick)
# ─────────────────────────────────────────────────────────────────────────────
if [ "$QUICK" = false ]; then
    echo ""
    echo -e "${BLUE}═══ GATE 4: Full Middleware Test Suite ═══${NC}"

    echo "  Running all Middleware tests..."
    if [ "$USE_DOCKER_EXEC" = true ]; then
        RESULT=$(docker exec nexus-php-app bash -c "cd /var/www/html && vendor/bin/phpunit --testsuite Middleware --teamcity 2>/dev/null" 2>&1)
    else
        RESULT=$(vendor/bin/phpunit --testsuite Middleware --teamcity 2>/dev/null 2>&1)
    fi

    FAILURES=$(echo "$RESULT" | grep -c 'testFailed' || true)
    FINISHED=$(echo "$RESULT" | grep -c 'testFinished' || true)

    if [ "$FAILURES" -eq 0 ]; then
        check_pass "Full Middleware suite: $FINISHED tests passed, 0 failures"
    else
        check_fail "Full Middleware suite: $FINISHED finished, $FAILURES failures"
    fi
fi

# ─────────────────────────────────────────────────────────────────────────────
# GATE 5: TypeScript + Build (if not --quick)
# ─────────────────────────────────────────────────────────────────────────────
if [ "$QUICK" = false ]; then
    echo ""
    echo -e "${BLUE}═══ GATE 5: React Frontend Build ═══${NC}"

    if command -v npm &>/dev/null; then
        cd "$PROJECT_ROOT/react-frontend"

        echo "  Running TypeScript check (tsc --noEmit)..."
        if npx tsc --noEmit 2>&1 | tail -5; then
            check_pass "TypeScript compilation: No errors"
        else
            check_fail "TypeScript compilation errors found"
        fi

        echo "  Running Vite build..."
        if npm run build 2>&1 | tail -3; then
            check_pass "Vite build: Success"
        else
            check_fail "Vite build failed"
        fi
    elif [ "$USE_DOCKER_EXEC" = true ]; then
        # Try running via the React container
        if docker ps -q --filter name=nexus-react 2>/dev/null | grep -q .; then
            echo "  Running TypeScript check via React container..."
            if docker exec nexus-react bash -c "cd /app && npx tsc --noEmit" 2>&1 | tail -5; then
                check_pass "TypeScript compilation: No errors"
            else
                check_fail "TypeScript compilation errors found"
            fi
        else
            check_warn "Gate 5 skipped: npm not available and React container not running"
        fi
    else
        check_warn "Gate 5 skipped: npm not available in this environment (run from host or use --quick)"
    fi
fi

# ─────────────────────────────────────────────────────────────────────────────
# SUMMARY
# ─────────────────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}================================================${NC}"
echo -e "${BOLD} RESULTS${NC}"
echo -e "${BOLD}================================================${NC}"

if [ "$ERRORS" -eq 0 ]; then
    echo -e "  ${GREEN}${BOLD}ALL GATES PASSED${NC} ($WARNINGS warnings)"
    echo ""
    echo "  Admin & Super Admin security is verified."
    echo "  Safe to commit and deploy."
    exit 0
else
    echo -e "  ${RED}${BOLD}$ERRORS GATE(S) FAILED${NC} ($WARNINGS warnings)"
    echo ""
    echo "  ⚠ DO NOT commit or deploy until all gates pass."
    echo "  Review failures above and fix before proceeding."
    exit 1
fi
