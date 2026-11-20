<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Support\Billing;

use App\Core\SuperPanelAccess;
use App\Services\BillingStandingService;
use Illuminate\Support\Facades\DB;

/**
 * What a parent community's manager may see and do about the payment standing
 * of the communities below it.
 *
 * One rule, used by the list and by every write, so the screen can never
 * offer an action the server then refuses, or hide one it would allow.
 *
 * Who: the signed-in super admin, as SuperPanelAccess resolved them for this
 * request (the controller's requireSuperAdmin() does that). The owner's reach
 * rule applies unchanged: every community BELOW the caller's own, never its
 * own, never above, never beside (`canManageTenant()`).
 *
 * On top of reach, two things are the platform team's alone:
 *   - a community that pays the platform (anything directly under the
 *     platform's own community). A manager of the platform community reaches
 *     those by the reach rule, and must still not be able to pause them.
 *   - an exempt community. The exemption is the platform team's decision.
 */
final class BranchPayments
{
    public const NOT_IN_REACH = 'not_in_reach';
    public const PAYS_PLATFORM = 'pays_platform';
    public const EXEMPT = 'exempt';

    /**
     * Null when the caller may act on this community, else why not.
     *
     * Reach is decided first and on its own, so a caller learns nothing about
     * a community it cannot reach — not even whether it exists.
     */
    public static function refusalFor(int $tenantId): ?string
    {
        if ($tenantId <= 1 || !SuperPanelAccess::canManageTenant($tenantId)) {
            return self::NOT_IN_REACH;
        }

        // A platform-wide super admin "can manage" any id, including one that
        // does not exist.
        if (!DB::table('tenants')->where('id', $tenantId)->exists()) {
            return self::NOT_IN_REACH;
        }

        // Decided from where the community sits as well as from its record:
        // anything directly under the platform's own community pays the
        // platform whatever a stored value says, so a wrong or changed
        // `payer` can never hand it to a manager.
        $parentId = DB::table('tenants')->where('id', $tenantId)->value('parent_id');
        $standing = BillingStandingService::get($tenantId);

        if ($parentId === null || (int) $parentId <= 1 || $standing['payer'] !== 'parent') {
            return self::PAYS_PLATFORM;
        }

        if ($standing['exempt']) {
            return self::EXEMPT;
        }

        return null;
    }

    /**
     * Every community the caller may see, except the platform's own and — for
     * a manager confined to a branch — the caller's own.
     *
     * @return list<array<string, mixed>>
     */
    public static function rows(): array
    {
        $access = SuperPanelAccess::getAccess();
        $scope = SuperPanelAccess::getScopeClause('t');

        $sql = "SELECT t.id, t.name, t.depth, t.parent_id, p.name AS parent_name
                FROM tenants t
                LEFT JOIN tenants p ON p.id = t.parent_id
                WHERE t.id <> 1 AND {$scope['sql']}";
        $params = $scope['params'];

        if (($access['level'] ?? null) !== 'master' && !empty($access['tenant_id'])) {
            $sql .= ' AND t.id <> ?';
            $params[] = (int) $access['tenant_id'];
        }

        $sql .= ' ORDER BY t.path ASC, t.name ASC';

        $today = now()->startOfDay();
        $rows = [];

        foreach (DB::select($sql, $params) as $tenant) {
            $id = (int) $tenant->id;
            $standing = BillingStandingService::get($id);
            $refusal = self::refusalFor($id);

            $daysLate = null;
            if ($standing['paid_until'] !== null) {
                $paidUntil = \Illuminate\Support\Carbon::parse($standing['paid_until'])->startOfDay();
                if ($paidUntil->lt($today)) {
                    $daysLate = (int) $paidUntil->diffInDays($today);
                }
            }

            // The note against a pause and the reason for an exemption are
            // whoever wrote them's own words — often the platform team's, and
            // for a manager of the platform community they would cover every
            // community that pays the platform. The page needs neither.
            $pausedFromAbove = $standing['locked'] && $standing['locked_by_tenant_id'] !== $id;
            unset($standing['suspension_note'], $standing['exempt_reason']);

            $rows[] = [
                'id' => $id,
                'name' => $tenant->name,
                'depth' => (int) $tenant->depth,
                'parent_id' => $tenant->parent_id !== null ? (int) $tenant->parent_id : null,
                'parent_name' => $tenant->parent_name,
                'standing' => $standing,
                'days_late' => $daysLate,
                'can_act' => $refusal === null,
                'cannot_act_reason' => $refusal,
                'paused_from_above' => $pausedFromAbove,
            ];
        }

        return $rows;
    }
}
