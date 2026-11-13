<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Core\SuperPanelAccess;
use App\Support\Members\PendingApproval;
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

            // A tenant super admin: its own tenant plus descendants, by the
            // trailing-slash-anchored prefix subtreeFilter() resolves. Fail
            // closed on an unusable path.
            $filter = SuperPanelAccess::subtreeFilter();
            if ($filter['deny'] || !$filter['filter'] || $filter['prefix'] === null) {
                return [];
            }

            return DB::table('tenants')
                ->where('path', 'LIKE', $filter['prefix'] . '%')
                ->pluck('id')
                ->map(fn($id) => (int) $id)
                ->all();
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

    /** An erased account: GdprService and the soft purge both stamp these. */
    private const ERASED_SQL = '(users.deleted_at IS NOT NULL OR users.anonymized_at IS NOT NULL)';

    /**
     * The views (tabs) of the super-admin Users page. Same rules as the
     * community Users page (AdminUsersController::index) so the two agree:
     * deleted accounts appear under "deleted" and nowhere else, and "all"
     * means everyone who has not been deleted.
     */
    public const USER_VIEWS = ['active', 'pending', 'suspended', 'banned', 'deleted', 'all'];

    /**
     * Sortable columns, by the key the page sends. Only these fixed SQL
     * expressions ever reach ORDER BY; no request value does.
     */
    private const USER_SORTS = [
        'name' => "COALESCE(NULLIF(users.organization_name, ''), CONCAT(COALESCE(users.first_name, ''), ' ', COALESCE(users.last_name, '')))",
        'tenant' => 'tenants.name',
        'role' => 'users.role',
        'status' => 'users.status',
        'super_admin' => '(users.is_super_admin * 2 + users.is_tenant_super_admin)',
        'last_login_at' => 'users.last_login_at',
        'created_at' => 'users.created_at',
    ];

    /** The condition a view adds beyond the deleted/not-deleted split. */
    private static function userViewSql(string $view): ?string
    {
        return match ($view) {
            'active' => "users.is_approved = 1 AND (users.status IS NULL OR users.status = 'active')",
            'pending' => PendingApproval::sql('users'),
            'suspended' => "users.status = 'suspended'",
            'banned' => "users.status = 'banned'",
            default => null,
        };
    }

    /**
     * Get a filtered list of users across visible tenants.
     *
     * Supported filters: view (see USER_VIEWS; default 'all'), search,
     * tenant_id, role, super_admins, sort (see USER_SORTS), order, limit, offset.
     *
     * @return array<int, array>
     */
    public static function getUserList(array $filters = []): array
    {
        try {
            $sort = self::USER_SORTS[$filters['sort'] ?? ''] ?? self::USER_SORTS['created_at'];
            $order = strtolower((string) ($filters['order'] ?? 'desc')) === 'asc' ? 'asc' : 'desc';

            $query = self::userListQuery($filters)
                ->select([
                    'users.id', 'users.first_name', 'users.last_name', 'users.profile_type', 'users.organization_name', 'users.email',
                    'users.role', 'users.tenant_id', 'users.is_approved', 'users.status',
                    'users.is_super_admin', 'users.is_tenant_super_admin',
                    'users.location', 'users.phone',
                    'users.created_at', 'users.last_login_at',
                    'users.deleted_at', 'users.anonymized_at',
                    'tenants.name as tenant_name', 'tenants.slug as tenant_slug',
                ])
                // $sort and $order come only from the fixed lists above.
                ->orderByRaw("{$sort} {$order}")
                // `id` breaks ties, so rows with the same sort value keep one
                // order and a page boundary cannot repeat or skip a person.
                ->orderBy('users.id', $order);

            $limit = (int) ($filters['limit'] ?? 50);
            $offset = (int) ($filters['offset'] ?? 0);

            $users = $query->limit($limit)->offset($offset)->get();

            return $users->map(function ($user) {
                $row = (array) $user;
                $row['name'] = UserDisplayName::resolve($row);
                $row['status'] = self::displayStatus($row);
                $row['is_approved'] = (bool) $row['is_approved'];
                $row['is_super_admin'] = (bool) $row['is_super_admin'];
                $row['is_tenant_super_admin'] = (bool) $row['is_tenant_super_admin'];
                unset($row['anonymized_at']);
                return $row;
            })->all();
        } catch (\Throwable $e) {
            Log::error('TenantVisibilityService::getUserList failed', ['error' => $e->getMessage()]);
            return [];
        }
    }

    /**
     * The status the page shows, by the community Users page's rules. Until
     * 13 Nov 2026 the list sent no status at all, so the column was blank.
     */
    private static function displayStatus(array $row): string
    {
        if (($row['deleted_at'] ?? null) !== null || ($row['anonymized_at'] ?? null) !== null) {
            return 'deleted';
        }
        $status = is_string($row['status'] ?? null) ? $row['status'] : '';
        if (in_array($status, ['banned', 'suspended', 'inactive', 'rejected'], true)) {
            return $status;
        }
        if ($status === 'pending' || empty($row['is_approved'])) {
            return 'pending';
        }
        return 'active';
    }

    /**
     * How many users match the same filters as getUserList(), ignoring
     * limit/offset. The Users page numbers its pages from this.
     *
     * Deliberately not wrapped in a catch: a failed count must surface as an
     * error, not as "0 people", which would look like an empty platform.
     */
    public static function countUserList(array $filters = []): int
    {
        return self::userListQuery($filters)->count('users.id');
    }

    /**
     * How many users each view holds under the other filters (search,
     * community, role, super admins), for the numbers on the page's tabs.
     * One query; not wrapped in a catch, for the same reason as countUserList().
     *
     * @return array<string, int> keyed by USER_VIEWS
     */
    public static function countUserListByView(array $filters = []): array
    {
        $notErased = 'NOT ' . self::ERASED_SQL;
        $parts = [];
        foreach (self::USER_VIEWS as $view) {
            $condition = match ($view) {
                'deleted' => self::ERASED_SQL,
                'all' => $notErased,
                default => $notErased . ' AND ' . self::userViewSql($view),
            };
            // Every fragment is a fixed string above; no request value reaches it.
            $parts[] = "COALESCE(SUM(CASE WHEN {$condition} THEN 1 ELSE 0 END), 0) AS `{$view}`";
        }

        $row = (array) self::userListQuery($filters, false)->selectRaw(implode(', ', $parts))->first();

        $counts = [];
        foreach (self::USER_VIEWS as $view) {
            $counts[$view] = (int) ($row[$view] ?? 0);
        }
        return $counts;
    }

    /**
     * The visibility scope and filters shared by getUserList(), countUserList()
     * and countUserListByView(), so the list, its total and the tab numbers
     * can never disagree.
     */
    private static function userListQuery(array $filters, bool $applyView = true): \Illuminate\Database\Query\Builder
    {
        $query = DB::table('users')
            ->join('tenants', 'users.tenant_id', '=', 'tenants.id');

        // Scope by access level
        // 🔴 Fail closed — see SuperPanelAccess::subtreeFilter(). This is the
        // user list: the largest cross-tenant PII surface in the panel.
        $filter = SuperPanelAccess::subtreeFilter();
        if ($filter['deny']) {
            $query->whereRaw('1 = 0');
        } elseif ($filter['filter']) {
            $query->where('tenants.path', 'LIKE', $filter['prefix'] . '%');
        }

        // A manager's delegate (ManagerDelegate) is a recorded identity, not a
        // member: never listed, as on the community Users page.
        $query->where(function ($q) {
            $q->whereNull('users.status')->orWhere('users.status', '<>', 'delegate');
        });

        if ($applyView) {
            // No view named = everyone not deleted. The page asks for 'active'.
            $view = in_array($filters['view'] ?? null, self::USER_VIEWS, true) ? $filters['view'] : 'all';
            // Deleted accounts are listed under their own view and nowhere else.
            $query->whereRaw($view === 'deleted' ? self::ERASED_SQL : 'NOT ' . self::ERASED_SQL);
            $viewSql = self::userViewSql($view);
            if ($viewSql !== null) {
                $query->whereRaw($viewSql);
            }
        }

        if (!empty($filters['tenant_id'])) {
            $query->where('users.tenant_id', (int) $filters['tenant_id']);
        }

        if (!empty($filters['role'])) {
            $query->where('users.role', $filters['role']);
        }

        // "Super admins only" matched only tenant super admins until
        // 13 Nov 2026, so a global super admin without that flag was missing.
        if (!empty($filters['super_admins'])) {
            $query->where(function ($q) {
                $q->where('users.is_super_admin', 1)->orWhere('users.is_tenant_super_admin', 1);
            });
        }

        if (!empty($filters['search'])) {
            $term = trim((string) $filters['search']);
            $like = '%' . addcslashes($term, '%_\\') . '%';
            $query->where(function ($q) use ($like, $term) {
                $q->where('users.first_name', 'LIKE', $like)
                  ->orWhere('users.last_name', 'LIKE', $like)
                  ->orWhereRaw("CONCAT(COALESCE(users.first_name, ''), ' ', COALESCE(users.last_name, '')) LIKE ?", [$like])
                  ->orWhere('users.organization_name', 'LIKE', $like)
                  ->orWhere('users.email', 'LIKE', $like)
                  ->orWhere('users.location', 'LIKE', $like);
                if (ctype_digit($term)) {
                    $q->orWhere('users.id', (int) $term);
                }
            });
        }

        return $query;
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
                // F-490: this read two of the four admin flags. `is_admin` and
                // `is_god` were missing, so an administrator granted either way
                // was absent from the roster a partner community is shown.
                ->where(function ($q) {
                    $q->whereIn('role', ['admin', 'tenant_admin', 'super_admin', 'god'])
                      ->orWhere('is_admin', 1)
                      ->orWhere('is_tenant_super_admin', 1)
                      ->orWhere('is_super_admin', 1)
                      ->orWhere('is_god', 1);
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
