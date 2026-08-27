<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Core\SuperPanelAccess;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use App\Support\UserDisplayName;

/**
 * TenantVisibilityService — Native Laravel implementation.
 *
 * Provides read-only visibility into tenants and users, scoped by the
 * current super-admin's access level (global for master, subtree for regional).
 */
class TenantVisibilityService
{
    public function __construct()
    {
    }

    /**
     * Get the list of tenant IDs visible to the current super admin.
     *
     * @return int[]
     */
    public static function getVisibleTenantIds(): array
    {
        try {
            $access = SuperPanelAccess::getAccess();

            if (!$access['granted']) {
                return [];
            }

            if ($access['level'] === 'master') {
                return DB::table('tenants')
                    ->pluck('id')
                    ->map(fn($id) => (int) $id)
                    ->all();
            }

            // Regional: return tenants in subtree
            if (!empty($access['tenant_path'])) {
                return DB::table('tenants')
                    ->where('path', 'LIKE', $access['tenant_path'] . '%')
                    ->pluck('id')
                    ->map(fn($id) => (int) $id)
                    ->all();
            }

            return [(int) $access['tenant_id']];
        } catch (\Throwable $e) {
            Log::error('TenantVisibilityService::getVisibleTenantIds failed', ['error' => $e->getMessage()]);
            return [];
        }
    }

    /**
     * Get a filtered list of tenants visible to the current super admin.
     *
     * Supported filters: search, is_active, allows_subtenants.
     * Returns tenants with indented_name for hierarchy display.
     *
     * @return array<int, array>
     */
    public static function getTenantList(array $filters = []): array
    {
        try {
            $query = DB::table('tenants')
                ->select([
                    'id', 'name', 'slug', 'domain', 'parent_id', 'path', 'depth',
                    'allows_subtenants', 'max_depth', 'is_active',
                    'contact_email', 'contact_phone', 'location_name', 'country_code',
                    'created_at', 'updated_at',
                ])
                ->orderBy('path')
                ->orderBy('name');

            // Scope by access level
            // 🔴 Fail closed — see SuperPanelAccess::subtreeFilter(). The previous
            // condition applied NO filter when the path was empty, which handed
            // the caller the entire platform instead of nothing.
            $filter = SuperPanelAccess::subtreeFilter();
            if ($filter['deny']) {
                $query->whereRaw('1 = 0');
            } elseif ($filter['filter']) {
                $query->where('path', 'LIKE', $filter['prefix'] . '%');
            }

            if (isset($filters['is_active'])) {
                $query->where('is_active', (int) $filters['is_active']);
            }

            if (!empty($filters['allows_subtenants'])) {
                $query->where('allows_subtenants', 1);
            }

            if (!empty($filters['search'])) {
                $search = '%' . $filters['search'] . '%';
                $query->where(function ($q) use ($search) {
                    $q->where('name', 'LIKE', $search)
                      ->orWhere('slug', 'LIKE', $search)
                      ->orWhere('domain', 'LIKE', $search)
                      ->orWhere('contact_email', 'LIKE', $search);
                });
            }

            $tenants = $query->get();

            // Add user counts per tenant
            $tenantIds = $tenants->pluck('id')->all();
            $userCounts = [];
            if (!empty($tenantIds)) {
                $placeholders = implode(',', array_fill(0, count($tenantIds), '?'));
                $counts = DB::select(
                    "SELECT tenant_id, COUNT(*) as user_count FROM users WHERE tenant_id IN ({$placeholders}) GROUP BY tenant_id",
                    $tenantIds
                );
                foreach ($counts as $c) {
                    $userCounts[(int) $c->tenant_id] = (int) $c->user_count;
                }
            }

            return $tenants->map(function ($tenant) use ($userCounts) {
                $row = (array) $tenant;
                $depth = (int) ($row['depth'] ?? 0);
                $row['indented_name'] = str_repeat('— ', $depth) . $row['name'];
                $row['user_count'] = $userCounts[(int) $row['id']] ?? 0;
                $row['allows_subtenants'] = (bool) $row['allows_subtenants'];
                $row['is_active'] = (bool) $row['is_active'];
                return $row;
            })->all();
        } catch (\Throwable $e) {
            Log::error('TenantVisibilityService::getTenantList failed', ['error' => $e->getMessage()]);
            return [];
        }
    }

    /**
     * Get a single tenant by ID (if visible to the current super admin).
     */
    public static function getTenant(int $tenantId): ?array
    {
        try {
            if (!SuperPanelAccess::canAccessTenant($tenantId)) {
                return null;
            }

            $tenant = DB::table('tenants')->where('id', $tenantId)->first();
            if (!$tenant) {
                return null;
            }

            $row = (array) $tenant;

            // Add user count
            $row['user_count'] = (int) DB::table('users')
                ->where('tenant_id', $tenantId)
                ->count();

            $row['listing_count'] = (int) DB::table('listings')
                ->where('tenant_id', $tenantId)
                ->count();

            // Add child count
            $row['child_count'] = (int) DB::table('tenants')
                ->where('parent_id', $tenantId)
                ->count();

            return $row;
        } catch (\Throwable $e) {
            Log::error('TenantVisibilityService::getTenant failed', ['error' => $e->getMessage()]);
            return null;
        }
    }

    /**
     * Get a filtered list of users across visible tenants.
     *
     * Supported filters: search, tenant_id, role, is_tenant_super_admin, limit, offset.
     *
     * @return array<int, array>
     */
    public static function getUserList(array $filters = []): array
    {
        try {
            $query = DB::table('users')
                ->join('tenants', 'users.tenant_id', '=', 'tenants.id')
                ->select([
                    'users.id', 'users.first_name', 'users.last_name', 'users.profile_type', 'users.organization_name', 'users.email',
                    'users.role', 'users.tenant_id', 'users.is_approved',
                    'users.is_super_admin', 'users.is_tenant_super_admin',
                    'users.location', 'users.phone',
                    'users.created_at', 'users.last_login_at',
                    'tenants.name as tenant_name', 'tenants.slug as tenant_slug',
                ])
                ->orderBy('users.created_at', 'desc');

            // Scope by access level
            // 🔴 Fail closed — see SuperPanelAccess::subtreeFilter(). This is the
            // user list: the largest cross-tenant PII surface in the panel.
            $filter = SuperPanelAccess::subtreeFilter();
            if ($filter['deny']) {
                $query->whereRaw('1 = 0');
            } elseif ($filter['filter']) {
                $query->where('tenants.path', 'LIKE', $filter['prefix'] . '%');
            }

            if (!empty($filters['tenant_id'])) {
                $query->where('users.tenant_id', (int) $filters['tenant_id']);
            }

            if (!empty($filters['role'])) {
                $query->where('users.role', $filters['role']);
            }

            if (!empty($filters['is_tenant_super_admin'])) {
                $query->where('users.is_tenant_super_admin', 1);
            }

            if (!empty($filters['search'])) {
                $search = '%' . $filters['search'] . '%';
                $query->where(function ($q) use ($search) {
                    $q->where('users.first_name', 'LIKE', $search)
                      ->orWhere('users.last_name', 'LIKE', $search)
                      ->orWhere('users.email', 'LIKE', $search)
                      ->orWhere('users.location', 'LIKE', $search);
                });
            }

            $limit = (int) ($filters['limit'] ?? 50);
            $offset = (int) ($filters['offset'] ?? 0);

            $users = $query->limit($limit)->offset($offset)->get();

            return $users->map(function ($user) {
                $row = (array) $user;
                $row['name'] = UserDisplayName::resolve($row);
                $row['is_approved'] = (bool) $row['is_approved'];
                $row['is_super_admin'] = (bool) $row['is_super_admin'];
                $row['is_tenant_super_admin'] = (bool) $row['is_tenant_super_admin'];
                return $row;
            })->all();
        } catch (\Throwable $e) {
            Log::error('TenantVisibilityService::getUserList failed', ['error' => $e->getMessage()]);
            return [];
        }
    }

    /**
     * Get admin users for a specific tenant.
     *
     * @return array<int, array>
     */
    public static function getTenantAdmins(int $tenantId): array
    {
        try {
            $admins = DB::table('users')
                ->where('tenant_id', $tenantId)
                ->where(function ($q) {
                    $q->whereIn('role', ['admin', 'tenant_admin', 'super_admin'])
                      ->orWhere('is_tenant_super_admin', 1)
                      ->orWhere('is_super_admin', 1);
                })
                ->select(['id', 'first_name', 'last_name', 'profile_type', 'organization_name', 'email', 'role', 'is_tenant_super_admin', 'is_super_admin', 'last_login_at'])
                ->orderBy('role')
                ->get();

            return $admins->map(function ($admin) {
                $row = (array) $admin;
                $row['name'] = UserDisplayName::resolve($row);
                return $row;
            })->all();
        } catch (\Throwable $e) {
            Log::error('TenantVisibilityService::getTenantAdmins failed', ['error' => $e->getMessage()]);
            return [];
        }
    }

    /**
     * Get the full tenant hierarchy as a nested tree structure.
     *
     * @return array<int, array>
     */
    public static function getHierarchyTree(): array
    {
        try {
            $query = DB::table('tenants')
                ->select(['id', 'name', 'slug', 'parent_id', 'depth', 'path', 'allows_subtenants', 'is_active'])
                ->orderBy('path')
                ->orderBy('name');

            // Scope by access level
            // 🔴 Fail closed — see SuperPanelAccess::subtreeFilter(). The previous
            // condition applied NO filter when the path was empty, which handed
            // the caller the entire platform instead of nothing.
            $filter = SuperPanelAccess::subtreeFilter();
            if ($filter['deny']) {
                $query->whereRaw('1 = 0');
            } elseif ($filter['filter']) {
                $query->where('path', 'LIKE', $filter['prefix'] . '%');
            }

            $tenants = $query->get()->map(fn($t) => (array) $t)->all();

            // Add user counts
            $tenantIds = array_column($tenants, 'id');
            $userCounts = [];
            if (!empty($tenantIds)) {
                $placeholders = implode(',', array_fill(0, count($tenantIds), '?'));
                $counts = DB::select(
                    "SELECT tenant_id, COUNT(*) as user_count FROM users WHERE tenant_id IN ({$placeholders}) GROUP BY tenant_id",
                    $tenantIds
                );
                foreach ($counts as $c) {
                    $userCounts[(int) $c->tenant_id] = (int) $c->user_count;
                }
            }

            // Build nested tree
            $indexed = [];
            foreach ($tenants as &$tenant) {
                $tenant['user_count'] = $userCounts[(int) $tenant['id']] ?? 0;
                $tenant['allows_subtenants'] = (bool) $tenant['allows_subtenants'];
                $tenant['is_active'] = (bool) $tenant['is_active'];
                $tenant['children'] = [];
                $indexed[(int) $tenant['id']] = &$tenant;
            }
            unset($tenant);

            $tree = [];
            foreach ($indexed as &$node) {
                $parentId = (int) ($node['parent_id'] ?? 0);
                if ($parentId > 0 && isset($indexed[$parentId])) {
                    $indexed[$parentId]['children'][] = &$node;
                } else {
                    $tree[] = &$node;
                }
            }
            unset($node);

            return $tree;
        } catch (\Throwable $e) {
            Log::error('TenantVisibilityService::getHierarchyTree failed', ['error' => $e->getMessage()]);
            return [];
        }
    }

    /**
     * Get dashboard statistics for the super admin panel.
     */
    public static function getDashboardStats(): array
    {
        try {
            $visibleIds = self::getVisibleTenantIds();

            if (empty($visibleIds)) {
                return [
                    'total_tenants' => 0,
                    'active_tenants' => 0,
                    'inactive_tenants' => 0,
                    'hub_tenants' => 0,
                    'total_users' => 0,
                    'super_admins' => 0,
                    'recent_tenants' => [],
                    'recent_users' => [],
                ];
            }

            $placeholders = implode(',', array_fill(0, count($visibleIds), '?'));

            $totalTenants = DB::selectOne(
                "SELECT COUNT(*) as cnt FROM tenants WHERE id IN ({$placeholders})",
                $visibleIds
            )->cnt;

            $activeTenants = DB::selectOne(
                "SELECT COUNT(*) as cnt FROM tenants WHERE id IN ({$placeholders}) AND is_active = 1",
                $visibleIds
            )->cnt;

            $hubTenants = DB::selectOne(
                "SELECT COUNT(*) as cnt FROM tenants WHERE id IN ({$placeholders}) AND allows_subtenants = 1",
                $visibleIds
            )->cnt;

            $totalUsers = DB::selectOne(
                "SELECT COUNT(*) as cnt FROM users WHERE tenant_id IN ({$placeholders})",
                $visibleIds
            )->cnt;

            $superAdmins = DB::selectOne(
                "SELECT COUNT(*) as cnt FROM users WHERE tenant_id IN ({$placeholders}) AND (is_tenant_super_admin = 1 OR is_super_admin = 1)",
                $visibleIds
            )->cnt;

            $recentTenants = DB::select(
                "SELECT id, name, slug, is_active, created_at FROM tenants WHERE id IN ({$placeholders}) ORDER BY created_at DESC LIMIT 5",
                $visibleIds
            );

            $recentUsers = DB::select(
                "SELECT u.id, u.first_name, u.last_name, u.email, u.role, u.tenant_id, t.name as tenant_name, u.created_at
                 FROM users u JOIN tenants t ON u.tenant_id = t.id
                 WHERE u.tenant_id IN ({$placeholders})
                 ORDER BY u.created_at DESC LIMIT 5",
                $visibleIds
            );

            return [
                'total_tenants'   => (int) $totalTenants,
                'active_tenants'  => (int) $activeTenants,
                'inactive_tenants' => (int) $totalTenants - (int) $activeTenants,
                'hub_tenants'     => (int) $hubTenants,
                'total_users'     => (int) $totalUsers,
                'super_admins'    => (int) $superAdmins,
                'recent_tenants'  => array_map(fn($r) => (array) $r, $recentTenants),
                'recent_users'    => array_map(fn($r) => (array) $r, $recentUsers),
            ];
        } catch (\Throwable $e) {
            Log::error('TenantVisibilityService::getDashboardStats failed', ['error' => $e->getMessage()]);
            return [
                'total_tenants' => 0,
                'active_tenants' => 0,
                'inactive_tenants' => 0,
                'hub_tenants' => 0,
                'total_users' => 0,
                'super_admins' => 0,
                'recent_tenants' => [],
                'recent_users' => [],
            ];
        }
    }

    /**
     * Get tenants that can be used as parents (Hub tenants visible to current admin).
     *
     * @return array<int, array>
     */
    public static function getAvailableParents(): array
    {
        try {
            $query = DB::table('tenants')
                ->where('allows_subtenants', 1)
                ->where('is_active', 1)
                ->select(['id', 'name', 'slug', 'depth', 'path'])
                ->orderBy('path')
                ->orderBy('name');

            // Scope by access level
            // 🔴 Fail closed — see SuperPanelAccess::subtreeFilter(). The previous
            // condition applied NO filter when the path was empty, which handed
            // the caller the entire platform instead of nothing.
            $filter = SuperPanelAccess::subtreeFilter();
            if ($filter['deny']) {
                $query->whereRaw('1 = 0');
            } elseif ($filter['filter']) {
                $query->where('path', 'LIKE', $filter['prefix'] . '%');
            }

            return $query->get()->map(function ($tenant) {
                $row = (array) $tenant;
                $depth = (int) ($row['depth'] ?? 0);
                $row['indented_name'] = str_repeat('— ', $depth) . $row['name'];
                return $row;
            })->all();
        } catch (\Throwable $e) {
            Log::error('TenantVisibilityService::getAvailableParents failed', ['error' => $e->getMessage()]);
            return [];
        }
    }
}
