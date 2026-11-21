<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Support\Billing;

use App\Services\BillingAutomationService;
use App\Services\BillingStandingService;
use App\Services\TenantBillingService;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * What happens when a community goes over its plan's member number, and after
 * how many days (DESIGN 6.4).
 *
 * Three levels; the nearest one that is set wins, for the action and for the
 * day count separately:
 *
 *   1. the community's own (`tenant_billing_standing.over_limit_*`);
 *   2. when it pays its parent and that parent is above tenant 1, the default
 *      its parent set for its children (`children_over_limit_*` on the
 *      parent's row) — the same condition as a hub's plan terms
 *      (PlanTerms::hubFor());
 *   3. the platform's (`BillingSettings` `over_limit_action` /
 *      `over_limit_grace_days`).
 *
 * `effective_action` is what the daily check does: "move up" is treated as
 * "warn only" for a community that pays the platform by card or holds a live
 * card subscription, because moving it would leave Stripe charging the old
 * plan. Only the platform team can move such a community.
 *
 * Read fresh every time: a change of rule or of payer takes effect at once.
 */
final class OverLimitRule
{
    public const ACTIONS = ['none', 'block_joining', 'pause', 'upgrade'];

    public const RULE_NOT_ALLOWED = 'RULE_NOT_ALLOWED';

    /** The day count's inclusive range, as BillingSettings has it for the platform's. */
    public const MIN_DAYS = 1;
    public const MAX_DAYS = 365;

    /**
     * @return array{action:string, effective_action:string, grace_days:int, action_source:'community'|'hub'|'platform', days_source:'community'|'hub'|'platform'}
     */
    public static function for(int $tenantId): array
    {
        $own = self::stored($tenantId, 'over_limit_action', 'over_limit_grace_days');

        $hubId = PlanTerms::hubFor($tenantId);
        $hub = $hubId !== null
            ? self::stored($hubId, 'children_over_limit_action', 'children_over_limit_grace_days')
            : ['action' => null, 'grace_days' => null];

        [$action, $actionSource] = match (true) {
            $own['action'] !== null => [$own['action'], 'community'],
            $hub['action'] !== null => [$hub['action'], 'hub'],
            default => [(string) BillingSettings::get('over_limit_action'), 'platform'],
        };

        [$days, $daysSource] = match (true) {
            $own['grace_days'] !== null => [$own['grace_days'], 'community'],
            $hub['grace_days'] !== null => [$hub['grace_days'], 'hub'],
            default => [(int) BillingSettings::get('over_limit_grace_days'), 'platform'],
        };

        return [
            'action' => $action,
            'effective_action' => $action === 'upgrade' && self::paysByCard($tenantId) ? 'none' : $action,
            'grace_days' => $days,
            'action_source' => $actionSource,
            'days_source' => $daysSource,
        ];
    }

    /**
     * Exactly what a community's days-over count depends on, as a short
     * stable string: the action the check follows, the days, the member
     * number and the plan (`pause|30|250|12`). The daily check records it
     * beside the count; when the two differ the terms have changed by some
     * route (a rule, a default, a payer, a plan, a member number) and the
     * count starts again with a fresh notice. Structural on purpose: no list
     * of callers to forget.
     *
     * @param array{plan_id:int, plan_name:string, max_users:int} $limit BillingAutomationService::watchedLimit()
     * @param array{effective_action:string, grace_days:int}|null $rule for(), when the caller has it
     */
    public static function termsKey(int $tenantId, array $limit, ?array $rule = null): string
    {
        $rule ??= self::for($tenantId);

        return implode('|', [$rule['effective_action'], (int) $rule['grace_days'], (int) $limit['max_users'], (int) $limit['plan_id']]);
    }

    /**
     * Null when $action may be set as $tenantId's own rule, else
     * RULE_NOT_ALLOWED: "move up" for a community that pays by card. Null
     * (follow the default) is always allowed; a default of "move up" reaching
     * a card payer is treated as warn only instead.
     */
    public static function refusalFor(int $tenantId, ?string $action): ?string
    {
        return $action === 'upgrade' && self::paysByCard($tenantId) ? self::RULE_NOT_ALLOWED : null;
    }

    /**
     * Whether the community pays the platform by card, or holds a live card
     * subscription whatever it is recorded as paying.
     */
    public static function paysByCard(int $tenantId): bool
    {
        if ($tenantId <= 1) {
            return false;
        }

        $payer = DB::table('tenant_billing_standing')->where('tenant_id', $tenantId)->value('payer');
        $payer ??= BillingStandingService::defaultPayer($tenantId);

        return $payer === 'platform_card' || TenantBillingService::hasLiveCardSubscription($tenantId);
    }

    /**
     * What is stored on the community itself (null = following a default).
     *
     * @return array{action:?string, grace_days:?int}
     */
    public static function own(int $tenantId): array
    {
        return self::stored($tenantId, 'over_limit_action', 'over_limit_grace_days');
    }

    /**
     * The default a hub set for the communities that pay it (null = they
     * follow the platform's).
     *
     * @return array{action:?string, grace_days:?int}
     */
    public static function childrenDefault(int $hubTenantId): array
    {
        return self::stored($hubTenantId, 'children_over_limit_action', 'children_over_limit_grace_days');
    }

    /**
     * The rule as the lists show it: for() plus what is stored on the
     * community itself, and the day the daily check would pause it.
     *
     * @param int|null $active the community's active members, when the caller has counted them
     * @return array{action:string, effective_action:string, grace_days:int, action_source:string, days_source:string, own_action:?string, own_grace_days:?int, acts_on:?string}
     */
    public static function describe(int $tenantId, ?int $active = null): array
    {
        $rule = self::for($tenantId);
        $own = self::own($tenantId);

        return $rule + [
            'own_action' => $own['action'],
            'own_grace_days' => $own['grace_days'],
            'acts_on' => BillingAutomationService::limitActsOn($tenantId, $rule, $active),
        ];
    }

    /**
     * Communities that pay $hubTenantId (its direct children with no payer
     * stored, or `parent` stored), optionally only those now on $planId.
     *
     * @return list<int>
     */
    public static function communitiesPaying(int $hubTenantId, ?int $planId = null): array
    {
        if ($hubTenantId <= 1) {
            return [];
        }

        // The hub is above tenant 1, so a child with no stored payer pays it
        // (BillingStandingService::defaultPayer()).
        $query = DB::table('tenants as c')
            ->leftJoin('tenant_billing_standing as s', 's.tenant_id', '=', 'c.id')
            ->where('c.parent_id', $hubTenantId)
            ->whereRaw("COALESCE(s.payer, 'parent') = 'parent'");

        if ($planId !== null) {
            $query->whereExists(static function ($sub) use ($planId): void {
                $sub->from('tenant_plan_assignments as tpa')
                    ->whereColumn('tpa.tenant_id', 'c.id')
                    ->where('tpa.pay_plan_id', $planId)
                    ->whereIn('tpa.status', ['active', 'trial', 'trialing']);
            });
        }

        return array_map('intval', $query->orderBy('c.id')->pluck('c.id')->all());
    }

    /** A valid action, or null for unset; anything else is refused. */
    public static function isValidAction(mixed $action): bool
    {
        return $action === null || (is_string($action) && in_array($action, self::ACTIONS, true));
    }

    /** A valid day count, or null for unset; anything else is refused. */
    public static function isValidDays(mixed $days): bool
    {
        return $days === null || (is_int($days) && $days >= self::MIN_DAYS && $days <= self::MAX_DAYS);
    }

    /**
     * A stored value that is not valid (written by hand) is treated as unset
     * and logged: the daily check must never act on a nonsense rule, and must
     * never stop because of one.
     *
     * @return array{action:?string, grace_days:?int}
     */
    private static function stored(int $tenantId, string $actionColumn, string $daysColumn): array
    {
        $row = DB::table('tenant_billing_standing')
            ->where('tenant_id', $tenantId)
            ->first([$actionColumn, $daysColumn]);

        $action = $row?->{$actionColumn};
        $days = $row?->{$daysColumn} !== null ? (int) $row->{$daysColumn} : null;

        if ($action !== null && !self::isValidAction((string) $action)) {
            Log::error('[OverLimitRule] stored action is not valid; following the default', ['tenant_id' => $tenantId, 'column' => $actionColumn]);
            $action = null;
        }
        if (!self::isValidDays($days)) {
            Log::error('[OverLimitRule] stored day count is not valid; following the default', ['tenant_id' => $tenantId, 'column' => $daysColumn]);
            $days = null;
        }

        return ['action' => $action !== null ? (string) $action : null, 'grace_days' => $days];
    }
}
