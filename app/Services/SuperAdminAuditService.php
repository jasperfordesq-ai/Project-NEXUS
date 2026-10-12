<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Core\SuperPanelAccess;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;
use App\Support\UserDisplayName;

/**
 * SuperAdminAuditService — Native Laravel implementation.
 *
 * Logs and retrieves audit trail entries for the Super Admin Panel.
 * All entries are stored in the `super_admin_audit_log` table.
 */
class SuperAdminAuditService
{
    /**
     * Sentinel written when log() is handed an action type this class does not
     * know about. It is a real enum member so the row stays queryable and the
     * admin UI can label it (`audit_action_unknown` exists in every locale) —
     * unlike the empty string MariaDB would otherwise coerce it to.
     */
    public const UNKNOWN_ACTION = 'unknown';

    /**
     * Human-readable labels for each action type.
     *
     * 🔴 The keys of this map are the canonical set of values log() may write, and
     * they MUST match the `super_admin_audit_log.action_type` enum exactly. The
     * platform runs MariaDB with `strict => false` (config/database.php), so an
     * out-of-enum value is NOT rejected — it is silently coerced to '' while the
     * INSERT reports success. Drift is therefore invisible at runtime, which is
     * how 'tenant_purged' went unrecorded from 2026-03 to 2026-08.
     * Pinned by Tests\Laravel\Unit\Database\SuperAdminAuditActionTypeContractTest.
     */
    private const ACTION_LABELS = [
        'tenant_created'              => 'Tenant Created',
        'tenant_updated'              => 'Tenant Updated',
        'tenant_deleted'              => 'Tenant Deleted',
        'tenant_purged'               => 'Tenant Purged',
        'tenant_moved'                => 'Tenant Moved',
        'hub_toggled'                 => 'Hub Toggled',
        'super_admin_granted'         => 'Super Admin Granted',
        'super_admin_revoked'         => 'Super Admin Revoked',
        'global_super_admin_granted'  => 'Global Super Admin Granted',
        'global_super_admin_revoked'  => 'Global Super Admin Revoked',
        'user_created'                => 'User Created',
        'user_updated'                => 'User Updated',
        'user_moved'                  => 'User Moved',
        'bulk_users_moved'            => 'Bulk Users Moved',
        'bulk_tenants_updated'        => 'Bulk Tenants Updated',
        self::UNKNOWN_ACTION          => 'Unrecognised Action',
    ];

    /**
     * FontAwesome icon class for each action type. Must carry the same keys as
     * ACTION_LABELS — see the note there.
     */
    private const ACTION_ICONS = [
        'tenant_created'              => 'fa-plus-circle',
        'tenant_updated'              => 'fa-pen',
        'tenant_deleted'              => 'fa-trash',
        'tenant_purged'               => 'fa-radiation',
        'tenant_moved'                => 'fa-arrows-alt',
        'hub_toggled'                 => 'fa-toggle-on',
        'super_admin_granted'         => 'fa-user-shield',
        'super_admin_revoked'         => 'fa-user-slash',
        'global_super_admin_granted'  => 'fa-shield-halved',
        'global_super_admin_revoked'  => 'fa-shield-slash',
        'user_created'                => 'fa-user-plus',
        'user_updated'                => 'fa-user-edit',
        'user_moved'                  => 'fa-exchange-alt',
        'bulk_users_moved'            => 'fa-users',
        'bulk_tenants_updated'        => 'fa-building',
        self::UNKNOWN_ACTION          => 'fa-question-circle',
    ];

    public function __construct()
    {
    }

    /**
     * Every action type log() can faithfully record — i.e. the values that must
     * exist as `super_admin_audit_log.action_type` enum members.
     *
     * @return array<int,string>
     */
    public static function actionTypes(): array
    {
        return array_keys(self::ACTION_LABELS);
    }

    private static ?bool $hasTargetTenantColumn = null;

    /**
     * Whether the F-593 `target_tenant_id` column exists yet. Cached per process.
     * Without this guard a database that has not run the migration would lose
     * every audit row (the insert would throw and log() returns false).
     */
    private static function hasTargetTenantColumn(): bool
    {
        if (self::$hasTargetTenantColumn === null) {
            try {
                self::$hasTargetTenantColumn = Schema::hasColumn('super_admin_audit_log', 'target_tenant_id');
            } catch (\Throwable $e) {
                self::$hasTargetTenantColumn = false;
            }
        }

        return self::$hasTargetTenantColumn;
    }

    /**
     * The one community an audited action affected — or, when it affected
     * several (a move), their lowest common ancestor in the tenant tree — or
     * NULL when no single community can be named (bulk rows, unknown tenants,
     * tenants in separate roots).
     *
     * 🔴 F-593. This is what the log is scoped by for a tenant super admin: a row
     * is shown only when this tenant is inside the caller's subtree. A subtree
     * contains a lowest common ancestor exactly when it contains every tenant
     * beneath it, so "the LCA is in my subtree" means "every community this
     * action touched is in my subtree" — both ends of a move, never just one.
     * NULL is never in any subtree, so it fails closed: platform-only.
     *
     * @param array<string,mixed>|null $oldValues
     * @param array<string,mixed>|null $newValues
     */
    public static function resolveTargetTenantId(
        string $actionType,
        string $targetType,
        ?int $targetId,
        ?array $oldValues,
        ?array $newValues
    ): ?int {
        if ($targetType === 'tenant') {
            if ($targetId === null || $targetId <= 0) {
                return null;
            }
            // A re-parenting touches the old position and the new one. Both
            // paths are recorded on the row itself, so use them as written.
            if ($actionType === 'tenant_moved') {
                $oldPath = is_string($oldValues['path'] ?? null) ? $oldValues['path'] : '';
                $newPath = is_string($newValues['path'] ?? null) ? $newValues['path'] : '';

                return ($oldPath !== '' && $newPath !== '')
                    ? self::lowestCommonAncestor([$oldPath, $newPath])
                    : null;
            }

            return $targetId;
        }

        if ($targetType === 'user') {
            $tenantIds = [];
            foreach ([$oldValues, $newValues] as $values) {
                $tid = (int) ($values['tenant_id'] ?? 0);
                if ($tid > 0) {
                    $tenantIds[] = $tid;
                }
            }
            if ($tenantIds === [] && $targetId !== null && $targetId > 0) {
                // Super panel: cross-tenant by design — a primary-key read of the
                // target account's own community, nothing else.
                $tid = (int) (DB::table('users')->where('id', $targetId)->value('tenant_id') ?? 0);
                if ($tid > 0) {
                    $tenantIds[] = $tid;
                }
            }

            $tenantIds = array_values(array_unique($tenantIds));
            if ($tenantIds === []) {
                return null;
            }
            if (count($tenantIds) === 1) {
                return $tenantIds[0];
            }

            $paths = DB::table('tenants')->whereIn('id', $tenantIds)->pluck('path', 'id')->all();
            if (count($paths) !== count($tenantIds)) {
                return null;
            }

            return self::lowestCommonAncestor(array_values(array_map(
                static fn ($p): string => (string) $p,
                $paths
            )));
        }

        // 'bulk' and anything unrecognised: no single community. Platform-only.
        return null;
    }

    /**
     * Deepest tenant id shared by every materialised path ('/1/4/11/' style), or
     * null when they share none or any path is unusable.
     *
     * @param list<string> $paths
     */
    private static function lowestCommonAncestor(array $paths): ?int
    {
        $common = null;
        foreach ($paths as $path) {
            $segments = array_values(array_filter(
                explode('/', trim($path, '/')),
                static fn (string $s): bool => $s !== ''
            ));
            if ($segments === []) {
                return null;
            }
            if ($common === null) {
                $common = $segments;
                continue;
            }
            $shared = [];
            foreach ($common as $i => $segment) {
                if (!isset($segments[$i]) || $segments[$i] !== $segment) {
                    break;
                }
                $shared[] = $segment;
            }
            $common = $shared;
            if ($common === []) {
                return null;
            }
        }

        if ($common === null || $common === []) {
            return null;
        }
        $last = (int) $common[count($common) - 1];

        return $last > 0 ? $last : null;
    }

    /**
     * F-593: confine an audit-log query for the current caller. The platform
     * owner sees every row; a tenant super admin sees only rows whose target
     * community (see resolveTargetTenantId()) is inside its subtree; anyone
     * else sees nothing. Fail closed throughout.
     *
     * Until 12 Oct 2026 this filtered on actor_tenant_id — where the ACTOR's
     * account sat — so rows about other communities leaked whenever a platform
     * admin was homed on the caller's tenant, and rows about the caller's own
     * subtree were hidden whenever the actor was homed elsewhere.
     */
    private static function applyCallerScope(\Illuminate\Database\Query\Builder $query): void
    {
        $filter = SuperPanelAccess::subtreeFilter();
        if ($filter['deny']) {
            $query->whereRaw('1 = 0');
            return;
        }
        if (!$filter['filter']) {
            return; // the platform owner
        }
        if (empty($filter['prefix'])) {
            $query->whereRaw('1 = 0');
            return;
        }

        $subtreeIds = DB::table('tenants')
            ->where('path', 'LIKE', $filter['prefix'] . '%')
            ->pluck('id')
            ->all();

        if (empty($subtreeIds)) {
            $query->whereRaw('1 = 0');
        } else {
            $query->whereIn('target_tenant_id', $subtreeIds);
        }
    }

    /**
     * Log an audit entry to super_admin_audit_log.
     *
     * Returns TRUE when the entry was recorded faithfully, FALSE when it was not
     * — either because the row could not be written at all, or because
     * $actionType is not a known action and was degraded to UNKNOWN_ACTION.
     *
     * 🔴 FALSE does not imply "nothing was written". Callers performing
     * destructive work should surface a warning on FALSE rather than assume
     * either outcome; see TenantProvisioning\TenantPurgeService.
     *
     * 🔴 F-353: $actorOverride exists because this class normally resolves the
     * acting admin from SuperPanelAccess / $_SESSION, and a QUEUE WORKER has
     * neither — so work dispatched to the queue was recorded as
     * actor_user_id = 0, actor_name = 'System'. A caller that runs outside the
     * ordering request MUST carry the actor forward on its job payload and
     * pass it here.
     *
     * @param array{user_id?: int|null, tenant_id?: int|null, ip_address?: string|null, user_agent?: string|null}|null $actorOverride
     */
    public static function log(
        string $actionType,
        string $targetType,
        ?int $targetId = null,
        ?string $targetName = null,
        ?array $oldValues = null,
        ?array $newValues = null,
        ?string $description = null,
        ?array $actorOverride = null
    ): bool {
        try {
            // Validate BEFORE the insert. Checking the insert's own outcome cannot
            // catch an unknown action type: with strict mode off the write succeeds
            // and only the stored value is blanked, so the failure is invisible
            // downstream. Fail OPEN — record the row under UNKNOWN_ACTION so the
            // actor, target, values and description survive — and report false.
            $faithful = array_key_exists($actionType, self::ACTION_LABELS);
            if (!$faithful) {
                Log::error('SuperAdminAuditService::log unknown action_type — recorded as "' . self::UNKNOWN_ACTION . '"', [
                    'action_type' => $actionType,
                    'target_type' => $targetType,
                    'target_id'   => $targetId,
                ]);
            }

            // An explicitly supplied actor wins: it is the only source that can
            // be right when this runs on the queue (F-353).
            $explicitUserId = isset($actorOverride['user_id']) ? (int) $actorOverride['user_id'] : 0;
            if ($explicitUserId > 0) {
                $actorUserId = $explicitUserId;
                $actorTenantId = (int) ($actorOverride['tenant_id'] ?? 0);
            } else {
                $access = SuperPanelAccess::getAccess();
                $actorUserId = $access['user_id'] ?? ($_SESSION['user_id'] ?? 0);
                $actorTenantId = $access['tenant_id'] ?? ($_SESSION['tenant_id'] ?? 0);
            }

            // Resolve actor name and email
            $actor = null;
            if ($actorUserId) {
                $actor = DB::selectOne(
                    "SELECT first_name, last_name, email FROM users WHERE id = ?",
                    [$actorUserId]
                );
            }

            $actorName = $actor
                ? UserDisplayName::resolve($actor)
                : 'System';
            $actorEmail = $actor->email ?? 'system@project-nexus.ie';

            $row = [
                'actor_user_id'  => $actorUserId,
                'actor_tenant_id' => $actorTenantId,
                'actor_name'     => $actorName,
                'actor_email'    => $actorEmail,
                'action_type'    => $faithful ? $actionType : self::UNKNOWN_ACTION,
                'target_type'    => $targetType,
                'target_id'      => $targetId,
                'target_name'    => $targetName,
                'old_values'     => $oldValues ? json_encode($oldValues) : null,
                'new_values'     => $newValues ? json_encode($newValues) : null,
                'description'    => $description,
                // A queue worker's request() is a synthetic console request with
                // no real client address, so prefer the one captured when the
                // action was ordered (F-353).
                'ip_address'     => $actorOverride['ip_address'] ?? request()->ip(),
                'user_agent'     => $actorOverride['user_agent'] ?? request()->userAgent(),
                'created_at'     => now(),
            ];

            // F-593: record WHICH community the action was about, so the log can
            // be scoped by target rather than by where the actor's account sits.
            if (self::hasTargetTenantColumn()) {
                $row['target_tenant_id'] = self::resolveTargetTenantId(
                    $faithful ? $actionType : self::UNKNOWN_ACTION,
                    $targetType,
                    $targetId,
                    $oldValues,
                    $newValues
                );
            }

            DB::table('super_admin_audit_log')->insert($row);

            return $faithful;
        } catch (\Throwable $e) {
            Log::error('SuperAdminAuditService::log failed', [
                'error' => $e->getMessage(),
                'action_type' => $actionType,
            ]);
            return false;
        }
    }

    /**
     * Retrieve audit log entries with optional filtering.
     *
     * Supported filters: action_type, target_type, search, date_from, date_to, limit, offset.
     *
     * @return array<int, array>
     */
    public static function getLog(array $filters = []): array
    {
        try {
            $query = DB::table('super_admin_audit_log')
                ->orderByDesc('created_at');

            // Scope by the community each row is ABOUT (F-593) — fail closed.
            self::applyCallerScope($query);

            if (!empty($filters['action_type'])) {
                $query->where('action_type', $filters['action_type']);
            }

            if (!empty($filters['target_type'])) {
                $query->where('target_type', $filters['target_type']);
            }

            if (!empty($filters['search'])) {
                $search = '%' . $filters['search'] . '%';
                $query->where(function ($q) use ($search) {
                    $q->where('description', 'LIKE', $search)
                      ->orWhere('target_name', 'LIKE', $search)
                      ->orWhere('actor_name', 'LIKE', $search)
                      ->orWhere('actor_email', 'LIKE', $search);
                });
            }

            if (!empty($filters['date_from'])) {
                $query->where('created_at', '>=', $filters['date_from'] . ' 00:00:00');
            }

            if (!empty($filters['date_to'])) {
                $query->where('created_at', '<=', $filters['date_to'] . ' 23:59:59');
            }

            $limit = (int) ($filters['limit'] ?? 50);
            $offset = (int) ($filters['offset'] ?? 0);

            $rows = $query->limit($limit)->offset($offset)->get();

            return $rows->map(function ($row) {
                $row = (array) $row;
                // Decode JSON fields
                $row['old_values'] = $row['old_values'] ? json_decode($row['old_values'], true) : null;
                $row['new_values'] = $row['new_values'] ? json_decode($row['new_values'], true) : null;
                return $row;
            })->all();
        } catch (\Throwable $e) {
            Log::error('SuperAdminAuditService::getLog failed', ['error' => $e->getMessage()]);
            return [];
        }
    }

    /**
     * Get audit statistics for the last N days.
     *
     * Returns: total_actions, by_type (array of action_type + count), top_actors.
     */
    public static function getStats(int $days = 30): array
    {
        try {
            $since = now()->subDays($days)->toDateTimeString();

            $baseQuery = DB::table('super_admin_audit_log')
                ->where('created_at', '>=', $since);

            // Same scope as getLog() (F-593).
            self::applyCallerScope($baseQuery);

            $totalActions = (clone $baseQuery)->count();

            $byType = (clone $baseQuery)
                ->select('action_type', DB::raw('COUNT(*) as count'))
                ->groupBy('action_type')
                ->orderByDesc('count')
                ->get()
                ->map(fn($row) => (array) $row)
                ->all();

            $topActors = (clone $baseQuery)
                ->select('actor_user_id', 'actor_name', 'actor_email', DB::raw('COUNT(*) as action_count'))
                ->groupBy('actor_user_id', 'actor_name', 'actor_email')
                ->orderByDesc('action_count')
                ->limit(10)
                ->get()
                ->map(fn($row) => (array) $row)
                ->all();

            return [
                'total_actions' => $totalActions,
                'by_type' => $byType,
                'top_actors' => $topActors,
            ];
        } catch (\Throwable $e) {
            Log::error('SuperAdminAuditService::getStats failed', ['error' => $e->getMessage()]);
            return [
                'total_actions' => 0,
                'by_type' => [],
                'top_actors' => [],
            ];
        }
    }

    /**
     * Get a human-readable label for an action type.
     */
    public static function getActionLabel(string $actionType): string
    {
        return self::ACTION_LABELS[$actionType] ?? ucwords(str_replace('_', ' ', $actionType));
    }

    /**
     * Get a FontAwesome icon class for an action type.
     */
    public static function getActionIcon(string $actionType): string
    {
        return self::ACTION_ICONS[$actionType] ?? 'fa-circle';
    }
}
