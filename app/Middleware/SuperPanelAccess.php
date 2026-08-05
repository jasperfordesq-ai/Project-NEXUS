<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Middleware;

use Illuminate\Support\Facades\DB;
use App\Core\TenantContext;

/**
 * SuperPanelAccess Middleware
 *
 * Gatekeeper for the Super Admin Panel (Infrastructure Management)
 *
 * ACCESS RULES:
 * - Master Tenant (id=1) + is_tenant_super_admin: GLOBAL access (sees all tenants)
 * - Regional Tenant (allows_subtenants=1) + is_tenant_super_admin: SUBTREE access (sees own + descendants)
 * - Standard Tenant (allows_subtenants=0): NO Super Panel access (uses Platform Admin only)
 *
 * KEY CONCEPT: Same panel, different data based on user's tenant position in hierarchy.
 */
class SuperPanelAccess
{
    private static ?array $currentAccess = null;

    /**
     * Main gatekeeper - call at start of any Super Admin route
     */
    public static function handle(): void
    {
        if (!self::check()) {
            self::denyAccess();
        }
    }

    /**
     * Check if current user can access Super Admin Panel
     */
    public static function check(): bool
    {
        $access = self::getAccess();
        return $access['granted'];
    }

    /**
     * Get full access context for current user
     * Cached per request for performance
     *
     * @param int|null $userId Optional user ID for stateless (JWT) API auth.
     *                         When provided, bypasses $_SESSION lookup entirely.
     *                         This is critical for API endpoints where session_start()
     *                         may fail silently in containerized environments.
     */
    public static function getAccess(?int $userId = null): array
    {
        if (self::$currentAccess !== null) {
            return self::$currentAccess;
        }

        // Default: no access
        self::$currentAccess = [
            'granted' => false,
            'level' => 'none',
            'user_id' => null,
            'tenant_id' => null,
            'tenant_name' => null,
            'tenant_path' => null,
            'tenant_depth' => null,
            'scope' => 'none',
            'can_create_tenants' => false,
            'max_depth' => 0,
            'reason' => 'Not authenticated'
        ];

        // Resolve user ID: prefer explicit param, fall back to session
        $effectiveUserId = $userId ?? ($_SESSION['user_id'] ?? null);
        if (empty($effectiveUserId)) {
            return self::$currentAccess;
        }

        // Get user + their tenant info
        $rows = DB::select("
            SELECT
                u.id as user_id,
                u.tenant_id,
                u.role,
                u.is_super_admin,
                u.is_tenant_super_admin,
                u.is_god,
                t.name as tenant_name,
                t.path as tenant_path,
                t.depth as tenant_depth,
                t.allows_subtenants,
                t.max_depth
            FROM users u
            JOIN tenants t ON u.tenant_id = t.id
            WHERE u.id = ?
        ", [$effectiveUserId]);
        $user = !empty($rows) ? (array) $rows[0] : null;

        if (!$user) {
            self::$currentAccess['reason'] = 'User not found';
            return self::$currentAccess;
        }

        $isGod = !empty($user['is_god']) || $user['role'] === 'god';

        // 🔴 A PLATFORM super-admin is platform-wide wherever their account sits.
        // Predicate deliberately identical to EnsureIsSuperAdmin and to
        // app/Core/SuperPanelAccess.php — change one, change all three.
        $isPlatformSuperAdmin = $isGod
            || !empty($user['is_super_admin'])
            || in_array($user['role'] ?? '', ['super_admin', 'god'], true);

        $isTenantSuperAdmin = !empty($user['is_tenant_super_admin']);

        // RULE 1: Must hold one of the two super-admin capacities.
        if (!$isPlatformSuperAdmin && !$isTenantSuperAdmin) {
            self::$currentAccess['reason'] = 'Not a Super Admin for any tenant';
            return self::$currentAccess;
        }

        // A tenant super-admin ON the master tenant is global by design.
        $isMaster = ((int)$user['tenant_id'] === 1);
        $hasGlobalAccess = $isPlatformSuperAdmin || $isMaster;

        // RULE 2: a REGIONAL grant needs a tenant that may have children.
        if (!$hasGlobalAccess && !$user['allows_subtenants']) {
            self::$currentAccess['reason'] = 'Tenant does not have sub-tenant capability';
            return self::$currentAccess;
        }

        /*
         * 🔴 A regional grant REQUIRES a usable materialised path.
         *
         * `tenants.path` is nullable with no default, and the subtree boundary is
         * a string-prefix match. An empty prefix means EVERYTHING, not nothing:
         * `str_starts_with($anything, '')` is TRUE, and `path LIKE '%'` matches
         * every row. A hub tenant with no path would therefore hand its
         * super-admin the whole installation.
         *
         * 🔴 This class is currently registered nowhere and called by nothing —
         * the live gate is EnsureIsSuperAdmin, which refuses is_tenant_super_admin
         * outright. The guard is here so that WIRING THIS UP does not silently
         * open that hole. See the mirrored fix in app/Core/SuperPanelAccess.php.
         */
        if (!$hasGlobalAccess && trim((string) ($user['tenant_path'] ?? '')) === '') {
            self::$currentAccess['reason'] = 'Tenant has no materialised path; refusing subtree access';
            return self::$currentAccess;
        }

        // ACCESS GRANTED - determine scope
        self::$currentAccess = [
            'granted' => true,
            'level' => $hasGlobalAccess ? 'master' : 'regional',
            'user_id' => (int)$user['user_id'],
            'tenant_id' => (int)$user['tenant_id'],
            'tenant_name' => $user['tenant_name'],
            'tenant_path' => $user['tenant_path'],
            'tenant_depth' => (int)$user['tenant_depth'],
            'scope' => $hasGlobalAccess ? 'global' : 'subtree',
            'can_create_tenants' => $hasGlobalAccess || (bool)$user['allows_subtenants'],
            'max_depth' => (int)$user['max_depth'],
            'reason' => 'Access granted'
        ];

        return self::$currentAccess;
    }

    /**
     * Check if current user can view/manage a specific tenant
     */
    public static function canAccessTenant(int $targetTenantId): bool
    {
        $access = self::getAccess();

        if (!$access['granted']) {
            return false;
        }

        // Master sees all
        if ($access['level'] === 'master') {
            return true;
        }

        // Own tenant is always accessible
        if ($targetTenantId === $access['tenant_id']) {
            return true;
        }

        // Regional: check if target is in their subtree
        $rows = DB::select(
            "SELECT path FROM tenants WHERE id = ?",
            [$targetTenantId]
        );
        $target = !empty($rows) ? (array) $rows[0] : null;

        if (!$target) {
            return false;
        }

        // Target's path must START WITH user's tenant path
        // e.g., user path /2/, target path /2/5/ = YES
        // e.g., user path /2/, target path /3/ = NO
        // 🔴 Fail closed on an empty prefix: str_starts_with($x, '') is TRUE, so
        // without this an empty tenant_path would admit every tenant.
        $prefix = trim((string) ($access['tenant_path'] ?? ''));
        if ($prefix === '') {
            return false;
        }

        return str_starts_with((string) $target['path'], $prefix);
    }

    /**
     * Check if current user can MANAGE (edit/delete) a specific tenant
     * (Cannot manage own tenant, only view it)
     */
    public static function canManageTenant(int $targetTenantId): bool
    {
        $access = self::getAccess();

        if (!$access['granted']) {
            return false;
        }

        // Check god status via DB (session-free for JWT compatibility)
        $isGod = !empty($access['user_id']) && \App\Models\User::isGod($access['user_id']);

        // Cannot manage own tenant (only view) - unless god
        if ($targetTenantId === $access['tenant_id']) {
            return $isGod;
        }

        // Master can manage everything except Master itself (unless god)
        if ($access['level'] === 'master') {
            if ($targetTenantId === 1) {
                return $isGod;
            }
            return true;
        }

        // Regional: can only manage descendants
        return self::canAccessTenant($targetTenantId);
    }

    /**
     * Check if current user can CREATE a sub-tenant under given parent
     */
    public static function canCreateSubtenantUnder(int $parentTenantId): array
    {
        $access = self::getAccess();

        if (!$access['granted']) {
            return ['allowed' => false, 'reason' => 'No Super Admin access'];
        }

        // First, can they even see this parent tenant?
        if (!self::canAccessTenant($parentTenantId)) {
            return ['allowed' => false, 'reason' => 'Parent tenant not in your scope'];
        }

        // Get parent tenant info
        $rows = DB::select("
            SELECT id, name, path, depth, allows_subtenants, max_depth
            FROM tenants WHERE id = ?
        ", [$parentTenantId]);
        $parent = !empty($rows) ? (array) $rows[0] : null;

        if (!$parent) {
            return ['allowed' => false, 'reason' => 'Parent tenant not found'];
        }

        // Parent must allow sub-tenants
        if (!$parent['allows_subtenants']) {
            return ['allowed' => false, 'reason' => "'{$parent['name']}' cannot have sub-tenants"];
        }

        // Check depth limit
        $newDepth = (int)$parent['depth'] + 1;
        $maxDepth = (int)$parent['max_depth'];
        if ($maxDepth > 0 && $newDepth > $maxDepth) {
            return ['allowed' => false, 'reason' => 'Maximum hierarchy depth reached'];
        }

        return [
            'allowed' => true,
            'reason' => 'OK',
            'new_depth' => $newDepth,
            'parent_path' => $parent['path']
        ];
    }

    /**
     * Get the scope SQL clause for tenant filtering
     * Use this in all Super Admin queries
     *
     * @param string $tableAlias Table alias (e.g., 't' for 't.id')
     * @return array ['sql' => string, 'params' => array]
     */
    public static function getScopeClause(string $tableAlias = 't'): array
    {
        $access = self::getAccess();

        if (!$access['granted']) {
            // Return impossible condition if no access
            return [
                'sql' => "1 = 0",
                'params' => []
            ];
        }

        // Master: no restriction
        if ($access['level'] === 'master') {
            return [
                'sql' => "1 = 1",
                'params' => []
            ];
        }

        // Regional: restrict to subtree using path LIKE.
        // 🔴 An empty prefix yields `LIKE '%'` — every row. Deny instead.
        $prefix = trim((string) ($access['tenant_path'] ?? ''));
        if ($prefix === '') {
            return [
                'sql' => "1 = 0",
                'params' => []
            ];
        }

        return [
            'sql' => "{$tableAlias}.path LIKE ?",
            'params' => [$prefix . '%']
        ];
    }

    /**
     * Reset cached access (useful for testing)
     */
    public static function reset(): void
    {
        self::$currentAccess = null;
    }

    /**
     * Deny access and exit
     */
    private static function denyAccess(): void
    {
        $access = self::getAccess();

        http_response_code(403);

        \Illuminate\Support\Facades\Log::warning(sprintf(
            "SuperPanel ACCESS DENIED: user=%s, tenant=%s, reason=%s, ip=%s",
            $_SESSION['user_id'] ?? 'none',
            $_SESSION['tenant_id'] ?? 'none',
            $access['reason'],
            \App\Core\ClientIp::get()
        ));

        if (($_ENV['APP_ENV'] ?? getenv('APP_ENV')) === 'testing' || (function_exists('app') && app()->environment('testing'))) {
            throw new \Symfony\Component\HttpKernel\Exception\HttpException(403, json_encode([
                'error' => 'Access Denied',
                'message' => 'You do not have Super Admin Panel access',
                'reason' => $access['reason'],
                'code' => 'SUPER_PANEL_ACCESS_DENIED'
            ]));
        }

        if (self::isApiRequest()) {
            header('Content-Type: application/json');
            echo json_encode([
                'error' => 'Access Denied',
                'message' => 'You do not have Super Admin Panel access',
                'reason' => $access['reason'],
                'code' => 'SUPER_PANEL_ACCESS_DENIED'
            ]);
        } else {
            echo '<!DOCTYPE html><html><head><title>Access Denied</title></head><body>';
            echo '<h1>403 - Access Denied</h1>';
            echo '<p>You do not have permission to access the Super Admin Panel.</p>';
            echo '<p>Reason: ' . htmlspecialchars($access['reason']) . '</p>';
            echo '<p><a href="' . TenantContext::getBasePath() . '/admin">Return to Platform Admin</a></p>';
            echo '</body></html>';
        }

        exit;
    }

    /**
     * Check if current request is an API request
     */
    private static function isApiRequest(): bool
    {
        $acceptHeader = $_SERVER['HTTP_ACCEPT'] ?? '';
        $contentType = $_SERVER['CONTENT_TYPE'] ?? '';
        $uri = $_SERVER['REQUEST_URI'] ?? '';

        return str_contains($acceptHeader, 'application/json')
            || str_contains($contentType, 'application/json')
            || str_starts_with($uri, '/api/')
            || str_starts_with($uri, '/super-admin/api/');
    }
}
