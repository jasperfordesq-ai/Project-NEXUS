<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Support\Billing;

use App\Core\SuperPanelAccess;
use App\Services\BillingStandingService;
use App\Services\TenantBillingService;
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
    public const CARD_SUBSCRIPTION = 'card_subscription';

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
     * The community a payment from this one is made to: its direct parent.
     * Null when the caller may not record or read such a payment.
     *
     * Reach is checked at BOTH ends. The paying community must be one the
     * caller may act on (refusalFor()), and the community being paid must be
     * the caller's own or one below it. On a sound tree the second always
     * follows from the first; it is checked anyway, because a community whose
     * `path` and `parent_id` disagree would otherwise let a manager write
     * into, and read from, another hub's payment record.
     */
    public static function payeeFor(int $tenantId): ?int
    {
        if (self::refusalFor($tenantId) !== null) {
            return null;
        }

        $parentId = (int) DB::table('tenants')->where('id', $tenantId)->value('parent_id');
        if ($parentId <= 1) {
            return null;
        }

        $access = SuperPanelAccess::getAccess();
        $own = (int) ($access['tenant_id'] ?? 0);
        $platformWide = ($access['level'] ?? null) === 'master';

        if (!$platformWide && $parentId !== $own && !SuperPanelAccess::canManageTenant($parentId)) {
            return null;
        }

        return $parentId;
    }

    /**
     * Null when the caller may change this community's plan, else why not.
     *
     * Everything refusalFor() refuses, plus a community with a live card
     * subscription with the platform: a plan change made here would not reach
     * Stripe, which would keep charging the old plan and put it back on its
     * next update. Only the platform team changes that one.
     */
    public static function planChangeRefusalFor(int $tenantId): ?string
    {
        $refusal = self::refusalFor($tenantId);
        if ($refusal !== null) {
            return $refusal;
        }

        return TenantBillingService::hasLiveCardSubscription($tenantId) ? self::CARD_SUBSCRIPTION : null;
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

            // The plan as it applies to this community: its parent's version
            // when it pays its parent. Never the assignment's custom price or
            // discount, which are the platform team's.
            $plan = PlanTerms::forCommunity($id);
            $members = self::members($id, $plan['max_users'] ?? null);

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
                'plan' => $plan,
                'members' => $members,
                // Only the plan-specific reason: a row the caller cannot act
                // on at all already says why in `cannot_act_reason`.
                'plan_change_refusal' => $refusal === null ? self::planChangeRefusalFor($id) : null,
                // The rule for going over the member number, where it comes
                // from, what is stored on the community itself, and the day
                // the daily check would pause it.
                'over_limit' => OverLimitRule::describe($id, $members['active']),
                // "Move up" is not offered for a card payer: the same rule the
                // write refuses with.
                'upgrade_allowed' => OverLimitRule::refusalFor($id, 'upgrade') === null,
            ];
        }

        return $rows;
    }

    /**
     * A community's active members (whole branch, signed in within the
     * window: the number a plan is sized by everywhere) against its plan's
     * member number. `max` and `percent` are null without a plan or with a
     * plan that has no member number.
     *
     * `total` is every member of the branch with an account in good standing,
     * whether or not they signed in lately: the number a manager thinks of as
     * "our members" (owner, 23 Nov 2026: the page showed 35 for a community
     * of 274 and read as broken). It is shown beside `active` and decides
     * nothing: the plan's number is checked against `active` alone, and
     * `percent` is `active` against `max`. `window_days` is how recently a
     * member must have signed in to count as active, so the screen can say
     * so without holding its own copy of the number.
     *
     * @return array{active: int, total: int, window_days: int, max: ?int, percent: ?int}
     */
    public static function members(int $tenantId, ?int $maxUsers): array
    {
        $active = TenantBillingService::getSubtreeActiveMemberCount($tenantId);
        $max = $maxUsers !== null && $maxUsers > 0 ? $maxUsers : null;

        return [
            'active' => $active,
            'total' => TenantBillingService::getSubtreeUserCount($tenantId),
            'window_days' => StandardPlans::ACTIVE_WINDOW_DAYS,
            'max' => $max,
            'percent' => $max !== null ? intdiv($active * 100, $max) : null,
        ];
    }
}
