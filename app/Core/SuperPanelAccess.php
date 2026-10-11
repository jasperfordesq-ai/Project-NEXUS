<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Core;

use Illuminate\Support\Facades\DB;

/**
 * SuperPanelAccess Middleware - Gatekeeper for the Super Admin Panel.
 *
 * ACCESS RULES (owner decision, 11 October 2026):
 * - Platform owner (is_super_admin / is_god, or role super_admin / god), on any
 *   tenant: level `master` — every community.
 * - is_tenant_super_admin on a hub tenant (allows_subtenants=1) with a usable
 *   path — INCLUDING the master tenant (id=1): level `regional`, which now means
 *   its OWN community only. Not the sub-communities beneath it, not a sibling.
 * - Anyone else: NO Super Panel access.
 *
 * 🔴 "I don't want tenant admins to act outside of the home community or tenant
 * super admins, or normal tenant admins." Until 11 October 2026 a hub's tenant
 * super admin had `regional` reach over its whole sub-community subtree (by
 * materialised-path prefix), and a tenant super admin on the master tenant was
 * `master` over every community. Both are gone: only the platform owner acts
 * across communities. The wire value `regional` is kept so GET /v2/users/me and
 * the React panel keep their contract; its meaning narrowed.
 */
class SuperPanelAccess
{
    private static ?array $currentAccess = null;

    /**
     * Main gatekeeper - call at start of any Super Admin route.
     */
    public static function handle(): void
    {
        if (!self::check()) {
            self::denyAccess();
        }
    }

    /**
     * Check if current user can access Super Admin Panel.
     */
    public static function check(): bool
    {
        $access = self::getAccess();
        return $access['granted'];
    }

    /**
     * Get full access context for current user.
     * Cached per request for performance.
     *
     * @param int|null $userId Optional user ID for stateless (JWT) API auth.
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
        $results = DB::select("
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

        $user = $results[0] ?? null;

        if (!$user) {
            self::$currentAccess['reason'] = 'User not found';
            return self::$currentAccess;
        }

        $isGod = !empty($user->is_god) || $user->role === 'god';

        /*
         * 🔴 A PLATFORM super-admin is platform-wide, wherever their account sits.
         *
         * This used to compute `$hasGlobalAccess = $isGod || tenant_id === 1`, so a
         * user with `is_super_admin = 1` on any tenant other than the master
         * resolved to **regional** and was confined to that tenant's subtree —
         * while `EnsureIsSuperAdmin`, the gate guarding the same endpoints, admits
         * exactly those users platform-wide. The two disagreed about what the same
         * flag meant.
         *
         * That disagreement is also what made the empty-path hole reachable in the
         * test suite: an `is_super_admin` account on tenant 2 was treated as
         * regional, and tenant 2's seeded path is NULL, so the prefix was empty —
         * i.e. a wildcard. Aligning the two definitions removes the mismatch AND
         * the risk that a real platform super-admin provisioned off the master
         * tenant is denied by RULE 3 below.
         *
         * The predicate is deliberately identical to EnsureIsSuperAdmin's. If you
         * change one, change both.
         */
        $isPlatformSuperAdmin = $isGod
            || !empty($user->is_super_admin)
            || in_array($user->role ?? '', ['super_admin', 'god'], true);

        $isTenantSuperAdmin = !empty($user->is_tenant_super_admin);

        // RULE 1: Must hold one of the two super-admin capacities.
        if (!$isPlatformSuperAdmin && !$isTenantSuperAdmin) {
            self::$currentAccess['reason'] = 'Not a Super Admin for any tenant';
            return self::$currentAccess;
        }

        /*
         * 🔴 Cross-community ("master") reach is the PLATFORM OWNER's alone.
         *
         * This was `$isPlatformSuperAdmin || tenant_id === 1`: a tenant super
         * admin whose account sat on the master tenant was master over every
         * community. Owner decision, 11 October 2026 — a tenant super admin acts
         * in its own community only, wherever that community sits.
         */
        $hasGlobalAccess = $isPlatformSuperAdmin;

        // RULE 2: a non-platform grant still needs a hub tenant. It now confers
        // only the caller's own community, but dropping the requirement would
        // hand the panel to every tenant super admin on the platform — this
        // change narrows who reaches what and never widens it. Platform access
        // is unaffected.
        if (!$hasGlobalAccess && !$user->allows_subtenants) {
            self::$currentAccess['reason'] = 'Tenant does not have sub-tenant capability';
            return self::$currentAccess;
        }

        /*
         * 🔴 RULE 3: a regional grant REQUIRES a usable materialised path.
         *
         * The subtree boundary is a string-prefix match on `tenants.path`, and
         * `tenants.path` is nullable with no default. An empty prefix does not
         * mean "no access" — it means "everything":
         *   - `str_starts_with($anything, '')` is TRUE in PHP, so
         *     canAccessTenant() would admit EVERY tenant on the platform;
         *   - the list clause becomes `path LIKE '%'`, which matches every row.
         *
         * So a hub tenant with an unpopulated path would give its super-admin the
         * whole installation — tenant list, user list, hierarchy, dashboard and
         * audit log. Not exploitable while EnsureIsSuperAdmin refuses
         * is_tenant_super_admin, but it must never become the reason a
         * hierarchical panel leaks. Deny, loudly, rather than resolve to a
         * wildcard. Master/god access is path-independent and unaffected.
         *
         * Since 11 October 2026 a non-platform grant no longer reads the path at
         * all (it is confined to its own tenant id), so this rule no longer
         * guards a boundary. It is kept so that change narrows the set of
         * accounts admitted to the panel and never widens it.
         */
        if (!$hasGlobalAccess && trim((string) ($user->tenant_path ?? '')) === '') {
            self::$currentAccess['reason'] = 'Tenant has no materialised path; refusing subtree access';
            return self::$currentAccess;
        }

        // ACCESS GRANTED - determine scope
        self::$currentAccess = [
            'granted' => true,
            'level' => $hasGlobalAccess ? 'master' : 'regional',
            'user_id' => (int)$user->user_id,
            'tenant_id' => (int)$user->tenant_id,
            'tenant_name' => $user->tenant_name,
            'tenant_path' => $user->tenant_path,
            'tenant_depth' => (int)$user->tenant_depth,
            // 'own' — the caller's own community only (11 Oct 2026; was 'subtree').
            'scope' => $hasGlobalAccess ? 'global' : 'own',
            // Creating a community creates ANOTHER community: platform owner only.
            'can_create_tenants' => $hasGlobalAccess,
            'max_depth' => (int)$user->max_depth,
            'reason' => 'Access granted'
        ];

        return self::$currentAccess;
    }

    /**
     * True only for the platform owner — the one caller with cross-community
     * reach in the super panel. Use it to refuse actions that by their nature
     * span communities (creating or moving a community, moving a member between
     * communities) before any per-tenant check runs.
     */
    public static function hasPlatformReach(): bool
    {
        $access = self::getAccess();

        return !empty($access['granted']) && ($access['level'] ?? null) === 'master';
    }

    /**
     * Check if current user can view/manage a specific tenant.
     *
     * 🔴 Platform owner: any tenant. Everyone else: their OWN tenant only. This
     * used to admit a `regional` caller's whole sub-community subtree by a
     * materialised-path prefix match; owner decision 11 October 2026 removed
     * that reach. A sub-community is another community.
     */
    public static function canAccessTenant(int $targetTenantId): bool
    {
        $access = self::getAccess();

        if (!$access['granted']) {
            return false;
        }

        // The platform owner sees all.
        if ($access['level'] === 'master') {
            return true;
        }

        // Everyone else: their own community, and nothing beneath or beside it.
        return !empty($access['tenant_id']) && $targetTenantId === (int) $access['tenant_id'];
    }

    /**
     * Check if current user can MANAGE (edit/delete) a specific tenant.
     */
    public static function canManageTenant(int $targetTenantId): bool
    {
        $access = self::getAccess();

        if (!$access['granted']) {
            return false;
        }

        // Check god status via DB
        $isGod = !empty($access['user_id'])
            && \App\Models\User::isGod($access['user_id']);

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

        // Not the platform owner. The only tenant canAccessTenant() still admits
        // is the caller's own, refused above, so a non-platform caller may not
        // manage (deactivate, reactivate, restructure) any community.
        return false;
    }

    /**
     * Check if current user can CREATE a sub-tenant under given parent.
     */
    public static function canCreateSubtenantUnder(int $parentTenantId): array
    {
        $access = self::getAccess();

        if (!$access['granted']) {
            return ['allowed' => false, 'reason' => 'No Super Admin access'];
        }

        // A new community is another community: platform owner only.
        if ($access['level'] !== 'master') {
            return ['allowed' => false, 'reason' => 'Only the platform owner can create communities'];
        }

        if (!self::canAccessTenant($parentTenantId)) {
            return ['allowed' => false, 'reason' => 'Parent tenant not in your scope'];
        }

        $results = DB::select("
            SELECT id, name, path, depth, allows_subtenants, max_depth
            FROM tenants WHERE id = ?
        ", [$parentTenantId]);

        $parent = $results[0] ?? null;

        if (!$parent) {
            return ['allowed' => false, 'reason' => 'Parent tenant not found'];
        }

        if (!$parent->allows_subtenants) {
            return ['allowed' => false, 'reason' => "'{$parent->name}' cannot have sub-tenants"];
        }

        $newDepth = (int)$parent->depth + 1;
        $maxDepth = (int)$parent->max_depth;
        if ($maxDepth > 0 && $newDepth > $maxDepth) {
            return ['allowed' => false, 'reason' => 'Maximum hierarchy depth reached'];
        }

        return [
            'allowed' => true,
            'reason' => 'OK',
            'new_depth' => $newDepth,
            'parent_path' => $parent->path
        ];
    }

    /**
     * Get the scope SQL clause for tenant filtering.
     *
     * @param string $tableAlias Table alias (e.g., 't' for 't.id')
     * @return array ['sql' => string, 'params' => array]
     */
    public static function getScopeClause(string $tableAlias = 't'): array
    {
        $access = self::getAccess();

        if (!$access['granted']) {
            return [
                'sql' => "1 = 0",
                'params' => []
            ];
        }

        if ($access['level'] === 'master') {
            return [
                'sql' => "1 = 1",
                'params' => []
            ];
        }

        // Not the platform owner: the caller's own community only (11 Oct 2026;
        // this was a `path LIKE prefix%` subtree).
        $ownTenantId = (int) ($access['tenant_id'] ?? 0);
        if ($ownTenantId <= 0) {
            return [
                'sql' => "1 = 0",
                'params' => []
            ];
        }

        return [
            'sql' => "{$tableAlias}.id = ?",
            'params' => [$ownTenantId]
        ];
    }

    /**
     * How a query should be confined for the current caller — fail closed.
     *
     * 🔴 Replaces a fail-OPEN idiom that was repeated at six call sites:
     *
     *     if ($access['granted'] && $access['level'] === 'regional' && !empty($access['tenant_path'])) {
     *         $query->where('path', 'LIKE', $access['tenant_path'] . '%');
     *     }
     *
     * When the path was empty that condition is FALSE, so **no filter was applied
     * at all** and the caller received the entire platform — the opposite of the
     * intent. Anything that was not cleanly "regional with a path" silently got
     * the master view.
     *
     * Use this instead, and handle all three outcomes:
     *   - deny   => the caller gets nothing (add `1 = 0`)
     *   - filter => confine to the single community `tenant_id`
     *   - neither => platform owner; no confinement needed
     *
     * 🔴 Since 11 October 2026 the confinement is the caller's OWN community, not
     * a materialised-path subtree (owner decision: a tenant super admin does not
     * act outside its home community). The method keeps its name so the call
     * sites stay findable, but the `prefix` key is gone on purpose: a caller
     * still building `path LIKE prefix%` now fails loudly instead of quietly
     * reaching into sub-communities.
     *
     * @return array{deny:bool, filter:bool, tenant_id:?int}
     */
    public static function subtreeFilter(?int $userId = null): array
    {
        $access = self::getAccess($userId);

        if (empty($access['granted'])) {
            return ['deny' => true, 'filter' => false, 'tenant_id' => null];
        }

        if (($access['level'] ?? null) === 'master') {
            return ['deny' => false, 'filter' => false, 'tenant_id' => null];
        }

        $ownTenantId = (int) ($access['tenant_id'] ?? 0);
        if ($ownTenantId <= 0) {
            // No identifiable home community. Never widen to everything.
            return ['deny' => true, 'filter' => false, 'tenant_id' => null];
        }

        return ['deny' => false, 'filter' => true, 'tenant_id' => $ownTenantId];
    }

    /**
     * Reset cached access (useful for testing).
     */
    public static function reset(): void
    {
        self::$currentAccess = null;
    }

    /**
     * Deny access and exit.
     */
    private static function denyAccess(): void
    {
        $access = self::getAccess();

        \Illuminate\Support\Facades\Log::warning(sprintf(
            "SuperPanel ACCESS DENIED: user=%s, tenant=%s, reason=%s, ip=%s",
            $_SESSION['user_id'] ?? 'none',
            $_SESSION['tenant_id'] ?? 'none',
            $access['reason'],
            ClientIp::get()
        ));

        if (($_ENV['APP_ENV'] ?? getenv('APP_ENV')) === 'testing' || (function_exists('app') && app()->environment('testing'))) {
            throw new \Symfony\Component\HttpKernel\Exception\HttpException(403, json_encode([
                'error' => 'Access Denied', 'message' => 'You do not have Super Admin Panel access',
                'reason' => $access['reason'], 'code' => 'SUPER_PANEL_ACCESS_DENIED'
            ]));
        }

        http_response_code(403);

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
     * Check if current request is an API request.
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
