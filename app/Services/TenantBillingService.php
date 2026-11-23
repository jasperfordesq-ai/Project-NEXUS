<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;
use App\Core\Mailer;
use App\Support\Billing\JoiningGate;
use App\Support\Billing\OverLimitRule;
use App\Support\Billing\PlanTerms;
use App\Support\Billing\StandardPlans;

/**
 * TenantBillingService — Billing snapshot, plan assignment, pricing, and revenue
 * dashboard for the super admin panel.
 *
 * Provides per-tenant user counts (including subtree descendants), current plan
 * lookups, over-limit detection, atomic plan upserts with audit logging and
 * CSV export.
 *
 * "Pause billing", the "grace period" and "billing delegates" were retired on
 * 22 November 2026: each wrote a value nothing ever read
 * (`tenant_plan_assignments.is_paused`, `.grace_period_ends_at`, the
 * `billing_delegates` table). The columns and the table are kept; nothing
 * writes them any more, and their endpoints refuse.
 */
class TenantBillingService
{
    // ─────────────────────────────────────────────────────────────────────────
    // User Count
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Count all active users in a tenant AND all its descendants using the
     * materialised path column.
     *
     * Path for tenant 5 is like `/1/5/`, so descendants start with `/1/5/`.
     */
    public static function getSubtreeUserCount(int $tenantId): int
    {
        $row = DB::selectOne('SELECT path FROM tenants WHERE id = ?', [$tenantId]);
        if (!$row) {
            return 0;
        }

        $path = trim((string) ($row->path ?? ''));

        /*
         * 🔴 An empty materialised path must NEVER reach the LIKE.
         *
         * `'' . '%'` is `'%'`, which matches every tenant that has a path — so
         * this tenant would be counted as owning the entire platform's active
         * membership. Measured on the dev database 2026-08-06: the real subtree
         * of tenant 2 is 5 active members; with an empty path the same query
         * returns 29, which is every active member on the installation.
         *
         * That is a billing figure. It drives `max_users` over-limit detection,
         * the grace period, and the price a community is quoted, so the failure
         * mode is over-charging a charity by whatever the rest of the platform
         * happens to weigh — and it grows silently as the platform grows.
         *
         * Without a path we cannot identify descendants at all, so count only
         * what we can prove: this tenant's own active members. That under-counts
         * a hub whose path is missing, which bills too little rather than far
         * too much — recoverable, and the log line says it happened. Do not
         * "fix" this by falling back to the LIKE.
         *
         * `tenants.path` is populated by a second UPDATE after the row is
         * inserted, so a crash between the two leaves exactly this state. It is
         * deliberately not NOT NULL for that reason — see
         * `.local-docs-archive/hierarchical-super-admin-feasibility-2026-08-05.md`.
         * The same empty-prefix flaw was fixed in `App\Core\SuperPanelAccess`;
         * this was its last copy.
         */
        if ($path === '') {
            Log::error('TenantBillingService: tenant has no materialised path; counting own members only', [
                'tenant_id' => $tenantId,
                'impact'    => 'subtree members excluded from the billing count for this tenant',
            ]);

            $ownOnly = DB::selectOne(
                'SELECT COUNT(*) AS cnt FROM users WHERE tenant_id = ? AND status = ?',
                [$tenantId, 'active']
            );

            return (int) ($ownOnly->cnt ?? 0);
        }

        $result = DB::selectOne(
            'SELECT COUNT(*) AS cnt
             FROM users u
             INNER JOIN tenants t ON u.tenant_id = t.id
             WHERE (t.id = ? OR t.path LIKE ?)
               AND u.status = ?',
            [$tenantId, $path . '%', 'active']
        );

        return (int) ($result->cnt ?? 0);
    }

    /**
     * Count ACTIVE members of a tenant and everything below it: an active
     * account that signed in within the last $days days. This is the number
     * the standard packages are sized by (the pricing page: "someone who signs
     * in at least once in a typical 90 days"), and the number a member limit
     * is checked against. A parent's count includes its whole branch because a
     * parent pays for its branch.
     *
     * The empty-path guard is the same as getSubtreeUserCount()'s and for the
     * same reason: an empty prefix would bill this community for the whole
     * platform. Without a path, only its own members are counted.
     */
    public static function getSubtreeActiveMemberCount(int $tenantId, int $days = StandardPlans::ACTIVE_WINDOW_DAYS, ?\DateTimeInterface $asOf = null): int
    {
        $row = DB::selectOne('SELECT path FROM tenants WHERE id = ?', [$tenantId]);
        if (!$row) {
            return 0;
        }

        $path = trim((string) ($row->path ?? ''));
        // `$asOf`: the window ends at that moment instead of now. The daily
        // check passes the moment a community was paused for being over its
        // number: its members cannot use it while it is paused, so counted to
        // "now" they would all age out of the window and the pause would lift
        // itself after a couple of months with nothing changed. Counted to the
        // pause, the number only falls when accounts are really taken off.
        $since = ($asOf !== null ? \Illuminate\Support\Carbon::instance($asOf) : now())->copy()->subDays($days);

        if ($path === '') {
            Log::error('TenantBillingService: tenant has no materialised path; counting own active members only', [
                'tenant_id' => $tenantId,
                'impact'    => 'subtree members excluded from the active member count for this tenant',
            ]);

            $ownOnly = DB::selectOne(
                'SELECT COUNT(*) AS cnt FROM users
                 WHERE tenant_id = ? AND status = ? AND last_login_at >= ?',
                [$tenantId, 'active', $since]
            );

            return (int) ($ownOnly->cnt ?? 0);
        }

        $result = DB::selectOne(
            'SELECT COUNT(*) AS cnt
             FROM users u
             INNER JOIN tenants t ON u.tenant_id = t.id
             WHERE (t.id = ? OR t.path LIKE ?)
               AND u.status = ?
               AND u.last_login_at >= ?',
            [$tenantId, $path . '%', 'active', $since]
        );

        return (int) ($result->cnt ?? 0);
    }

    /**
     * Active member counts for many tenants in two queries, each the same
     * figure getSubtreeActiveMemberCount() returns, for the snapshot, which
     * must not add a query per row.
     *
     * Descendants are found by the same path-prefix rule as the SQL LIKE.
     * Paths are digits and slashes only, so a plain prefix comparison agrees
     * with LIKE. A tenant with an empty path gets its own members only.
     *
     * @param  list<int> $tenantIds
     * @return array<int, int> tenant id => active members in its branch
     */
    private static function activeMemberCountsForBranches(array $tenantIds, int $days = StandardPlans::ACTIVE_WINDOW_DAYS): array
    {
        if ($tenantIds === []) {
            return [];
        }

        $since = now()->subDays($days);

        $perTenant = [];
        foreach (DB::select(
            "SELECT tenant_id, COUNT(*) AS cnt
             FROM users
             WHERE status = 'active' AND last_login_at >= ?
             GROUP BY tenant_id",
            [$since]
        ) as $row) {
            $perTenant[(int) $row->tenant_id] = (int) $row->cnt;
        }

        $paths = [];
        foreach (DB::select('SELECT id, path FROM tenants') as $row) {
            $paths[(int) $row->id] = trim((string) ($row->path ?? ''));
        }

        $counts = [];
        foreach ($tenantIds as $tenantId) {
            $path = $paths[$tenantId] ?? '';
            $total = $perTenant[$tenantId] ?? 0;

            if ($path !== '') {
                foreach ($paths as $otherId => $otherPath) {
                    if ($otherId !== $tenantId && $otherPath !== '' && str_starts_with($otherPath, $path)) {
                        $total += $perTenant[$otherId] ?? 0;
                    }
                }
            }

            $counts[$tenantId] = $total;
        }

        return $counts;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Effective Price
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Calculate the effective price for a plan assignment row.
     *
     * Logic:
     * 1. Start with custom_price_monthly/yearly if set, else plan defaults.
     * 2. Apply 20% nonprofit auto-discount if nonprofit_verified.
     * 3. Apply discount_percentage on top.
     * 4. Clamp to minimum €0.
     *
     * @param  array<string, mixed> $assignment Row with plan and assignment columns merged.
     * @return array{monthly: float, yearly: float, has_custom: bool, discount_pct: int, nonprofit: bool}
     */
    public static function getEffectivePrice(array $assignment): array
    {
        $baseMonthly = isset($assignment['custom_price_monthly']) && $assignment['custom_price_monthly'] !== null
            ? (float) $assignment['custom_price_monthly']
            : (float) ($assignment['price_monthly'] ?? 0.0);

        $baseYearly = isset($assignment['custom_price_yearly']) && $assignment['custom_price_yearly'] !== null
            ? (float) $assignment['custom_price_yearly']
            : (float) ($assignment['price_yearly'] ?? 0.0);

        $hasCustom       = (isset($assignment['custom_price_monthly']) && $assignment['custom_price_monthly'] !== null)
                         || (isset($assignment['custom_price_yearly']) && $assignment['custom_price_yearly'] !== null);
        $nonprofitVerified = !empty($assignment['nonprofit_verified']);
        $discountPct     = max(0, min(100, (int) ($assignment['discount_percentage'] ?? 0)));

        // Step 1: Nonprofit 20% auto-discount.
        if ($nonprofitVerified) {
            $baseMonthly *= 0.80;
            $baseYearly  *= 0.80;
        }

        // Step 2: Additional discount percentage on top.
        if ($discountPct > 0) {
            $multiplier  = (100 - $discountPct) / 100;
            $baseMonthly *= $multiplier;
            $baseYearly  *= $multiplier;
        }

        // Step 3: Clamp to zero.
        $effectiveMonthly = max(0.0, round($baseMonthly, 2));
        $effectiveYearly  = max(0.0, round($baseYearly, 2));

        return [
            'monthly'      => $effectiveMonthly,
            'yearly'       => $effectiveYearly,
            'has_custom'   => $hasCustom,
            'discount_pct' => $discountPct,
            'nonprofit'    => $nonprofitVerified,
        ];
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Billing Snapshot
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Return a billing snapshot for all non-master tenants (tenant_id != 1).
     *
     * Each row includes own_user_count, subtree_user_count, current_plan,
     * suggested_plan, over_limit flag, effective_price, grace period info, etc.
     *
     * `active_member_count` (signed in within 90 days, whole branch) is what
     * `over_limit`, `usage_percent` and `suggested_plan` are measured on;
     * `subtree_user_count` (every active account) is still reported beside it.
     *
     * @return array<int, array<string, mixed>>
     */
    public static function getBillingSnapshot(): array
    {
        $tenants = DB::select(
            'SELECT id, name, slug, depth, parent_id, allows_subtenants
             FROM tenants
             WHERE id != 1
             ORDER BY depth ASC, name ASC'
        );

        if (empty($tenants)) {
            return [];
        }

        $tenantIds    = array_map(fn($t) => (int) $t->id, $tenants);
        $placeholders = implode(',', array_fill(0, count($tenantIds), '?'));

        // Batch own_user_count.
        $ownCounts = DB::select(
            "SELECT tenant_id, COUNT(*) AS cnt
             FROM users
             WHERE tenant_id IN ({$placeholders}) AND status = 'active'
             GROUP BY tenant_id",
            $tenantIds
        );
        $ownCountMap = [];
        foreach ($ownCounts as $row) {
            $ownCountMap[(int) $row->tenant_id] = (int) $row->cnt;
        }

        // Each community's current assignment, whatever its status: a failed
        // card payment leaves it `expired`, and a trial is `trial`. Reading only
        // `active` ones showed those communities as having no plan at all. A
        // community can hold several rows (a new active row is inserted when
        // none is active), so an active one wins, then the most recent.
        $assignments = DB::select(
            "SELECT tpa.tenant_id, tpa.status AS assignment_status,
                    tpa.custom_price_monthly, tpa.custom_price_yearly,
                    tpa.discount_percentage, tpa.discount_reason,
                    tpa.nonprofit_verified,
                    tpa.expires_at, tpa.notes, tpa.billing_interval,
                    pp.id AS plan_id, pp.name AS plan_name, pp.slug AS plan_slug,
                    pp.max_users, pp.price_monthly, pp.price_yearly,
                    pp.price_monthly_gbp, pp.price_yearly_gbp,
                    pp.max_communities, pp.is_standard, pp.is_active AS plan_is_active
             FROM tenant_plan_assignments tpa
             INNER JOIN pay_plans pp ON pp.id = tpa.pay_plan_id
             WHERE tpa.tenant_id IN ({$placeholders})
             ORDER BY tpa.tenant_id, (tpa.status = 'active') DESC, tpa.id DESC",
            $tenantIds
        );
        // The currency each community is billed in, read once per community.
        $currencyOf = [];
        foreach ($tenantIds as $tenantId) {
            $currencyOf[$tenantId] = StripeSubscriptionService::billingCurrencyFor($tenantId);
        }

        $planMap = [];
        foreach ($assignments as $row) {
            if (isset($planMap[(int) $row->tenant_id])) {
                continue;
            }
            // In the currency the community is charged in. Every price on
            // this screen used to be the euro one, pound communities included,
            // while a special price typed here was read as the community's
            // own currency by the email that announces it.
            $money = self::pricesFor($row, $currencyOf[(int) $row->tenant_id] ?? 'eur');

            $assignmentArr = [
                // The Billing control screen opens "Assign plan" on the
                // community's current plan, so it has to be told which it is.
                'id'                    => (int) $row->plan_id,
                'name'                  => $row->plan_name,
                'slug'                  => $row->plan_slug,
                'max_users'             => $row->max_users !== null ? (int) $row->max_users : null,
                'max_communities'       => $row->max_communities !== null ? (int) $row->max_communities : null,
                'is_standard'           => (bool) $row->is_standard,
                // A retired plan: nobody new is put on it, but the community
                // on it can still have its price and notes edited.
                'is_active'             => (bool) $row->plan_is_active,
                'currency'              => $money['currency'],
                'price_monthly'         => $money['monthly'],
                'price_yearly'          => $money['yearly'],
                // 'monthly' | 'yearly' for a card payer; null when paid by hand.
                'billing_interval'      => in_array($row->billing_interval, ['monthly', 'yearly'], true) ? (string) $row->billing_interval : null,
                'notes'                 => $row->notes !== null && $row->notes !== '' ? (string) $row->notes : null,
                'custom_price_monthly'  => $row->custom_price_monthly !== null ? (float) $row->custom_price_monthly : null,
                'custom_price_yearly'   => $row->custom_price_yearly !== null ? (float) $row->custom_price_yearly : null,
                'discount_percentage'   => (int) ($row->discount_percentage ?? 0),
                'discount_reason'       => $row->discount_reason,
                'nonprofit_verified'    => (bool) ($row->nonprofit_verified ?? false),
                'expires_at'            => $row->expires_at,
                'assignment_status'     => (string) ($row->assignment_status ?? 'active'),
            ];
            $assignmentArr['effective_price'] = self::getEffectivePrice($assignmentArr);

            // The name and member number as they apply to the community: its
            // hub's when it pays its parent and the parent changed this plan.
            // Prices stay the platform's: they are what the platform is owed.
            $applied = PlanTerms::applyHubChanges((int) $row->tenant_id, (int) $row->plan_id, [
                'name'      => $assignmentArr['name'],
                'max_users' => $assignmentArr['max_users'],
            ]);
            $assignmentArr['name'] = $applied['values']['name'];
            $assignmentArr['max_users'] = $applied['values']['max_users'];
            $assignmentArr['terms'] = $applied['terms'];

            $planMap[(int) $row->tenant_id] = $assignmentArr;
        }

        $activeCountMap = self::activeMemberCountsForBranches($tenantIds);

        // The newest payment recorded by hand per community, in one query.
        // Newest = latest received, then latest recorded, as the history.
        $lastPayments = DB::select(
            "SELECT tenant_id, received_on, method
             FROM (
                 SELECT tenant_id, received_on, method,
                        ROW_NUMBER() OVER (PARTITION BY tenant_id ORDER BY received_on DESC, id DESC) AS rn
                 FROM billing_payments
                 WHERE tenant_id IN ({$placeholders})
                   AND voided_at IS NULL
             ) newest
             WHERE rn = 1",
            $tenantIds
        );
        $lastPaymentMap = [];
        foreach ($lastPayments as $row) {
            $lastPaymentMap[(int) $row->tenant_id] = [
                'received_on' => substr((string) $row->received_on, 0, 10),
                'method'      => (string) $row->method,
            ];
        }

        // A card payment refunded lately, or disputed: flagged on the row.
        $paymentAlerts = BillingStandingService::paymentAlerts(array_map('intval', $tenantIds));

        $snapshot = [];
        foreach ($tenants as $tenant) {
            $id           = (int) $tenant->id;
            $ownCount     = $ownCountMap[$id] ?? 0;
            $subtreeCount = self::getSubtreeUserCount($id);
            $activeCount  = $activeCountMap[$id] ?? 0;
            $currentPlan  = $planMap[$id] ?? null;

            // Packages are sized by ACTIVE members (DESIGN §11). Null above the
            // largest package: that is a bespoke quote, not a package. Read
            // from the plans this community can be put on, on the terms that
            // apply to it (its hub's, when it pays its parent), so the
            // suggestion and `over_limit` measure against the same numbers.
            $suggested = PlanTerms::smallestFitting($id, $activeCount)['slug'] ?? null;

            $overLimit    = false;
            $usagePercent = null;
            if ($currentPlan !== null && $currentPlan['max_users'] !== null) {
                $overLimit = $activeCount > $currentPlan['max_users'];
                $usagePercent = $currentPlan['max_users'] > 0
                    ? (int) floor($activeCount * 100 / $currentPlan['max_users'])
                    : null;
            }

            $standing = BillingStandingService::get($id);

            $snapshot[] = [
                'id'                  => $id,
                'name'                => $tenant->name,
                'slug'                => $tenant->slug,
                'depth'               => (int) $tenant->depth,
                'parent_id'           => $tenant->parent_id !== null ? (int) $tenant->parent_id : null,
                'allows_subtenants'   => (bool) $tenant->allows_subtenants,
                'own_user_count'      => $ownCount,
                'subtree_user_count'  => $subtreeCount,
                'active_member_count' => $activeCount,
                // How recently a member must have signed in to be counted in
                // `active_member_count`, so the screen can say what "active"
                // means without holding its own copy of the number.
                'active_window_days'  => StandardPlans::ACTIVE_WINDOW_DAYS,
                'usage_percent'       => $usagePercent,
                // 'eur' | 'gbp': what a special price typed for it is in, when
                // the plan chosen has a pound price.
                'billing_currency'    => $currencyOf[$id] ?? 'eur',
                'current_plan'        => $currentPlan,
                'suggested_plan'      => $suggested,
                'over_limit'          => $overLimit,
                // Payment standing: who it pays, paid until, paused or exempt.
                // One definition, shared with every other caller, at the cost
                // of a few small queries per row on a platform-team-only page
                // that already counts members once per row.
                'standing'            => $standing,
                // The "cutoff": the earliest day the daily check would pause
                // it, from the paid-until date. Null when it never would.
                'pause_on'            => BillingAutomationService::earliestPauseDate(
                    $standing['paid_until'],
                    $standing['payer'],
                    $standing['exempt'],
                    $standing['suspended_at'] !== null
                ),
                'last_payment'        => $lastPaymentMap[$id] ?? null,
                'payment_alerts'      => $paymentAlerts[$id] ?? ['refunded' => false, 'disputed' => false],
            ] + self::overLimitFields($id, $activeCount);
        }

        return $snapshot;
    }

    /**
     * A plan's monthly and yearly price in the currency a community billed in
     * $communityCurrency is charged: pounds only when the plan has a pound
     * price, euro otherwise (the same rule as card checkout, decided for the
     * plan as a whole so one row never mixes two currencies).
     *
     * @param object $plan a row with price_monthly, price_yearly and the two `_gbp` columns
     * @return array{currency: 'eur'|'gbp', monthly: float, yearly: float}
     */
    public static function pricesFor(object $plan, string $communityCurrency): array
    {
        $poundMonthly = (float) ($plan->price_monthly_gbp ?? 0);
        $poundYearly = (float) ($plan->price_yearly_gbp ?? 0);

        if ($communityCurrency === 'gbp' && ($poundMonthly > 0 || $poundYearly > 0)) {
            return ['currency' => 'gbp', 'monthly' => $poundMonthly, 'yearly' => $poundYearly];
        }

        return [
            'currency' => 'eur',
            'monthly' => (float) ($plan->price_monthly ?? 0),
            'yearly' => (float) ($plan->price_yearly ?? 0),
        ];
    }

    /**
     * The rule for going over the member number on a Billing control row, as
     * Branch payments carries it (OverLimitRule::describe()), and whether
     * "move up" may be chosen. Not named `over_limit`: that key is the "over
     * its limit now" flag the screen already reads.
     *
     * The platform's own community has no rule (the server refuses one for
     * it), so it gets none and no button to set one.
     *
     * @return array{over_limit_rule: array<string, mixed>|null, upgrade_allowed: bool}
     */
    public static function overLimitFields(int $tenantId, int $activeMembers): array
    {
        if ($tenantId <= 1) {
            return ['over_limit_rule' => null, 'upgrade_allowed' => false];
        }

        return [
            'over_limit_rule' => OverLimitRule::describe($tenantId, $activeMembers),
            'upgrade_allowed' => OverLimitRule::refusalFor($tenantId, 'upgrade') === null,
        ];
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Revenue Dashboard
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * What the platform itself expects to be paid, for the platform team's
     * Revenue page.
     *
     * Money is counted only for a community that pays the PLATFORM (by card
     * or by invoice), is not exempt and is not paused. A community that pays
     * its hub is the hub's income, not the platform's; it used to be added in
     * at the platform's euro list price, as were exempt communities, yearly
     * payers (at the monthly price) and pound communities (as euro).
     *
     * Each amount is in the currency the community is charged in. Euro and
     * pounds are totalled separately and never added together. A yearly payer
     * counts at a twelfth of its yearly price.
     *
     * "Over the limit" is measured on active members (signed in within 90
     * days, whole branch) against the member number as it applies to the
     * community, the same as Billing control. It counted every account.
     *
     * @return array{
     *   communities: int, with_plan: int, without_plan: int,
     *   paying_platform: int, paying_parent: int, not_billed: int,
     *   paused: int, over_limit: int, active_members: int,
     *   totals: list<array{currency: 'eur'|'gbp', monthly: float, yearly: float, communities: int}>,
     *   plan_breakdown: list<array{plan: string, communities: int, paying_platform: int, monthly_eur: float, monthly_gbp: float}>,
     *   recent_changes: list<array{tenant_name: string, action: string, created_at: string, acted_by: string|null}>
     * }
     */
    public static function getRevenueDashboard(): array
    {
        $tenants = DB::select("SELECT id FROM tenants WHERE id != 1 AND is_active = 1");
        $tenantIds = array_map(static fn ($t): int => (int) $t->id, $tenants);

        // The plan in force per community: a card payer whose renewal failed
        // is still on its plan (PLAN_IN_FORCE_SQL), an active record wins.
        $assignments = DB::select(
            "SELECT tpa.tenant_id, tpa.billing_interval, tpa.nonprofit_verified,
                    tpa.discount_percentage, tpa.custom_price_monthly, tpa.custom_price_yearly,
                    pp.id AS plan_id, pp.name AS plan_name, pp.max_users,
                    pp.price_monthly, pp.price_yearly, pp.price_monthly_gbp, pp.price_yearly_gbp,
                    pp.setup_fee, pp.setup_fee_gbp
             FROM tenant_plan_assignments tpa
             INNER JOIN pay_plans pp ON pp.id = tpa.pay_plan_id
             INNER JOIN tenants t ON t.id = tpa.tenant_id AND t.id != 1 AND t.is_active = 1
             WHERE " . self::PLAN_IN_FORCE_SQL . "
             ORDER BY tpa.tenant_id, (tpa.status = 'active') DESC, (tpa.status = 'trial') DESC, tpa.id DESC"
        );
        $planOf = [];
        foreach ($assignments as $row) {
            $planOf[(int) $row->tenant_id] ??= $row;
        }

        $activeCounts = $tenantIds !== [] ? self::activeMemberCountsForBranches($tenantIds) : [];

        $counts = [
            'with_plan' => 0, 'without_plan' => 0, 'paying_platform' => 0,
            'paying_parent' => 0, 'not_billed' => 0, 'paused' => 0, 'over_limit' => 0,
        ];
        $totals = [];
        $breakdown = [];

        foreach ($tenantIds as $id) {
            $standing = BillingStandingService::get($id);
            $isPaused = $standing['suspended_at'] !== null;
            $notBilled = $standing['exempt'] || $standing['payer'] === 'not_billed';
            $paysPlatform = !$notBilled && in_array($standing['payer'], ['platform_card', 'platform_invoice'], true);

            if ($isPaused) {
                $counts['paused']++;
            }
            if ($notBilled) {
                $counts['not_billed']++;
            } elseif ($paysPlatform) {
                $counts['paying_platform']++;
            } else {
                $counts['paying_parent']++;
            }

            $plan = $planOf[$id] ?? null;
            if ($plan === null) {
                $counts['without_plan']++;
                continue;
            }
            $counts['with_plan']++;

            // The member number as it applies: the hub's own, when it pays its hub.
            $applied = PlanTerms::applyHubChanges($id, (int) $plan->plan_id, [
                'name' => (string) $plan->plan_name,
                'max_users' => $plan->max_users !== null ? (int) $plan->max_users : null,
            ]);
            $maxUsers = $applied['values']['max_users'];
            if ($maxUsers !== null && ($activeCounts[$id] ?? 0) > (int) $maxUsers) {
                $counts['over_limit']++;
            }

            // Grouped under the platform's own plan name: a hub may call the
            // same plan something else, and that is one plan here.
            $name = (string) $plan->plan_name;
            $breakdown[$name] ??= ['plan' => $name, 'communities' => 0, 'paying_platform' => 0, 'monthly_eur' => 0.0, 'monthly_gbp' => 0.0];
            $breakdown[$name]['communities']++;

            if (!$paysPlatform || $isPaused) {
                continue;
            }

            $interval = $plan->billing_interval === 'yearly' ? 'yearly' : 'monthly';
            $currency = StripeSubscriptionService::billingCurrencyFor($id);
            $monthlyQuote = StripeSubscriptionService::quoteFor($plan, 'monthly', $currency);
            $yearlyQuote = StripeSubscriptionService::quoteFor($plan, 'yearly', $currency);
            $charged = $interval === 'yearly' ? $yearlyQuote['currency'] : $monthlyQuote['currency'];

            // A special price, a discount and the non-profit reduction apply
            // to the price in the currency the community is charged in.
            $effective = self::getEffectivePrice([
                'custom_price_monthly' => $plan->custom_price_monthly,
                'custom_price_yearly'  => $plan->custom_price_yearly,
                'discount_percentage'  => $plan->discount_percentage,
                'nonprofit_verified'   => $plan->nonprofit_verified,
                'price_monthly'        => $monthlyQuote['amount'],
                'price_yearly'         => $yearlyQuote['amount'],
            ]);
            $monthly = $interval === 'yearly' ? round($effective['yearly'] / 12, 2) : $effective['monthly'];

            $totals[$charged] ??= ['currency' => $charged, 'monthly' => 0.0, 'yearly' => 0.0, 'communities' => 0];
            $totals[$charged]['monthly'] += $monthly;
            $totals[$charged]['communities']++;

            $breakdown[$name]['paying_platform']++;
            $breakdown[$name]['monthly_' . $charged] += $monthly;
        }

        foreach ($totals as $currency => $total) {
            $totals[$currency]['monthly'] = round($total['monthly'], 2);
            $totals[$currency]['yearly'] = round($total['monthly'] * 12, 2);
        }
        ksort($totals);
        foreach ($breakdown as $name => $row) {
            $breakdown[$name]['monthly_eur'] = round($row['monthly_eur'], 2);
            $breakdown[$name]['monthly_gbp'] = round($row['monthly_gbp'], 2);
        }

        $recentRows = DB::select(
            "SELECT bal.action, bal.created_at,
                    t.name AS tenant_name,
                    CONCAT(COALESCE(u.first_name,''), ' ', COALESCE(u.last_name,'')) AS acted_by
             FROM billing_audit_log bal
             LEFT JOIN tenants t ON t.id = bal.tenant_id
             LEFT JOIN users u ON u.id = bal.acted_by_user_id
             ORDER BY bal.created_at DESC, bal.id DESC
             LIMIT 10"
        );

        return [
            'communities'     => count($tenantIds),
            'with_plan'       => $counts['with_plan'],
            'without_plan'    => $counts['without_plan'],
            'paying_platform' => $counts['paying_platform'],
            'paying_parent'   => $counts['paying_parent'],
            'not_billed'      => $counts['not_billed'],
            'paused'          => $counts['paused'],
            'over_limit'      => $counts['over_limit'],
            'active_members'  => self::platformActiveMembers(),
            'totals'          => array_values($totals),
            'plan_breakdown'  => array_values($breakdown),
            'recent_changes'  => array_map(static fn ($r): array => [
                'tenant_name' => (string) ($r->tenant_name ?? ''),
                'action'      => (string) $r->action,
                'created_at'  => (string) $r->created_at,
                'acted_by'    => trim((string) ($r->acted_by ?? '')) ?: null,
            ], $recentRows),
        ];
    }

    /**
     * Active members on the whole installation: active accounts that signed
     * in within the plans' own window. Each counted once.
     */
    private static function platformActiveMembers(): int
    {
        return (int) (DB::selectOne(
            "SELECT COUNT(*) AS cnt FROM users
             WHERE status = 'active' AND last_login_at >= ?",
            [now()->subDays(StandardPlans::ACTIVE_WINDOW_DAYS)]
        )->cnt ?? 0);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Plan Assignment
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Upsert a plan assignment for a tenant, including pricing overrides and
     * discounts. Writes an audit log entry and tells every admin of the community
     * (BillingStandingNotifier::planChanged).
     */
    public static function assignPlan(
        int $tenantId,
        int $planId,
        ?string $expiresAt,
        ?string $notes,
        int $assignedBy,
        ?float $customPriceMonthly = null,
        ?float $customPriceYearly = null,
        int $discountPct = 0,
        ?string $discountReason = null,
        bool $nonprofitVerified = false
    ): void {
        // The record in force: an active one, a trial, or a card payer's
        // record after a failed renewal (`expired`, Stripe still collecting).
        // Only `active` was looked for, so for those a SECOND record was
        // inserted beside the one the card is charged on.
        $existing = DB::selectOne(
            "SELECT tpa.id, tpa.pay_plan_id, tpa.custom_price_monthly, tpa.custom_price_yearly,
                    tpa.discount_percentage, tpa.discount_reason, tpa.nonprofit_verified, tpa.expires_at, tpa.notes
             FROM tenant_plan_assignments tpa
             WHERE tpa.tenant_id = ? AND " . self::PLAN_IN_FORCE_SQL . "
             ORDER BY (tpa.status = 'active') DESC, (tpa.status = 'trial') DESC, tpa.id DESC
             LIMIT 1",
            [$tenantId]
        );

        $oldValue = $existing ? (array) $existing : null;

        $now = now();

        if ($existing) {
            DB::table('tenant_plan_assignments')
                ->where('id', $existing->id)
                ->update([
                    'pay_plan_id'           => $planId,
                    'expires_at'            => $expiresAt,
                    'notes'                 => $notes,
                    'custom_price_monthly'  => $customPriceMonthly,
                    'custom_price_yearly'   => $customPriceYearly,
                    'discount_percentage'   => $discountPct,
                    'discount_reason'       => $discountReason,
                    'nonprofit_verified'    => $nonprofitVerified ? 1 : 0,
                    'updated_at'            => $now,
                ]);
        } else {
            DB::table('tenant_plan_assignments')->insert([
                'tenant_id'             => $tenantId,
                'pay_plan_id'           => $planId,
                'status'                => 'active',
                'starts_at'             => $now,
                'expires_at'            => $expiresAt,
                'notes'                 => $notes,
                'custom_price_monthly'  => $customPriceMonthly,
                'custom_price_yearly'   => $customPriceYearly,
                'discount_percentage'   => $discountPct,
                'discount_reason'       => $discountReason,
                'nonprofit_verified'    => $nonprofitVerified ? 1 : 0,
                'created_at'            => $now,
                'updated_at'            => $now,
            ]);
        }

        $newValue = [
            'pay_plan_id'          => $planId,
            'expires_at'           => $expiresAt,
            'custom_price_monthly' => $customPriceMonthly,
            'custom_price_yearly'  => $customPriceYearly,
            'discount_percentage'  => $discountPct,
            'discount_reason'      => $discountReason,
            'nonprofit_verified'   => $nonprofitVerified,
            'notes'                => $notes,
        ];

        self::logAudit($tenantId, $assignedBy, 'plan_assigned', $oldValue, $newValue, $notes);
        JoiningGate::flush();

        // A new plan is new terms: the days over start again, with a fresh
        // notice (DESIGN 6.4). Only when the plan itself changed: a new
        // price or note leaves the member number where it was.
        if ($existing === null || (int) $existing->pay_plan_id !== $planId) {
            BillingStandingService::restartLimitClock([$tenantId]);
        }

        // Legacy activity_log entry (kept for backward compatibility).
        if (Schema::hasTable('activity_log')) {
            DB::table('activity_log')->insert([
                'tenant_id'   => $tenantId,
                'user_id'     => $assignedBy,
                'action'      => 'billing.plan_assigned',
                'entity_type' => 'tenant',
                'entity_id'   => $tenantId,
                'details'     => json_encode(['plan_id' => $planId, 'notes' => $notes]),
                'created_at'  => $now,
            ]);
        }

        // Every admin of the community, in their own language, in the currency
        // it is billed in (BillingStandingNotifier::planChanged). The old email
        // went to one admin with a hard-coded euro price and a link most
        // communities are never shown. The notes are the platform team's own
        // words and are not sent.
        try {
            $oldPlanName = null;
            if ($existing !== null && (int) $existing->pay_plan_id !== $planId) {
                $oldPlanName = DB::table('pay_plans')->where('id', (int) $existing->pay_plan_id)->value('name');
            }

            BillingStandingNotifier::planChanged(
                $tenantId,
                self::planChangedFacts($tenantId, $oldPlanName !== null ? (string) $oldPlanName : null)
            );
        } catch (\Throwable $e) {
            Log::error('[TenantBillingService] assignPlan email failed: ' . $e->getMessage(), [
                'tenant_id' => $tenantId,
            ]);
        }
    }

    /**
     * Change the plan a community is on, and nothing else.
     *
     * The assignment's custom price, discount, non-profit flag, notes and
     * expiry belong to the platform team and are left exactly as they are;
     * assignPlan() overwrites them with whatever it is passed, so a hub's
     * manager (and the automatic move up) comes through here instead. With no
     * current assignment, an active one is created with everything else at
     * its defaults.
     *
     * Audited as `plan_changed` with who asked (`$source`). Sends nothing:
     * the caller sends BillingStandingNotifier::planChanged().
     *
     * A community with a live card subscription is the platform team's: a
     * change here would not reach Stripe, which would keep charging the old
     * plan and put it back on its next update. So a hub (`hub`) or the daily
     * check (`auto`) is refused with \DomainException('billing_card_subscription');
     * only `platform` may change it.
     *
     * @param 'hub'|'platform'|'auto' $source
     */
    public static function changePlanOnly(int $tenantId, int $planId, ?int $actedBy, string $source): void
    {
        if (!in_array($source, ['hub', 'platform', 'auto'], true)) {
            throw new \InvalidArgumentException("Unknown plan change source: {$source}");
        }
        if (!DB::table('pay_plans')->where('id', $planId)->exists()) {
            throw new \InvalidArgumentException("Plan {$planId} does not exist");
        }

        DB::transaction(static function () use ($tenantId, $planId, $actedBy, $source): void {
            // The newest active record (highest id) is the plan in force:
            // the same row PlanTerms::forCommunity() and planChangedFacts() read.
            $existing = DB::table('tenant_plan_assignments')
                ->where('tenant_id', $tenantId)
                ->where('status', 'active')
                ->orderByDesc('id')
                ->lockForUpdate()
                ->first(['id', 'pay_plan_id']);

            if ($source !== 'platform' && self::hasLiveCardSubscription($tenantId)) {
                throw new \DomainException('billing_card_subscription');
            }

            $now = now();
            if ($existing !== null) {
                if ((int) $existing->pay_plan_id === $planId) {
                    return;
                }
                DB::table('tenant_plan_assignments')
                    ->where('id', $existing->id)
                    ->where('tenant_id', $tenantId)
                    ->update(['pay_plan_id' => $planId, 'updated_at' => $now]);
            } else {
                DB::table('tenant_plan_assignments')->insert([
                    'tenant_id'   => $tenantId,
                    'pay_plan_id' => $planId,
                    'status'      => 'active',
                    'starts_at'   => $now,
                    'created_at'  => $now,
                    'updated_at'  => $now,
                ]);
            }

            self::logAudit(
                $tenantId,
                $actedBy,
                'plan_changed',
                $existing !== null ? ['pay_plan_id' => (int) $existing->pay_plan_id] : null,
                ['pay_plan_id' => $planId, 'source' => $source],
                $source
            );

            // A new plan is new terms: the days over start again, with a
            // fresh notice (DESIGN 6.4).
            BillingStandingService::restartLimitClock([$tenantId]);
        });
        JoiningGate::flush();
    }

    /**
     * Stripe's words for a subscription that is over: nothing more will be
     * charged or retried on it, and a new one may be started.
     */
    public const STRIPE_SUBSCRIPTION_ENDED = ['canceled', 'incomplete_expired'];

    /**
     * SQL for "this plan record (alias `tpa`) is a plan the community is on":
     * active, on trial, or `expired` only because its card failed while
     * Stripe still has the subscription open (STRIPE_SUBSCRIPTION_ENDED,
     * spelled out because this is raw SQL).
     *
     * 🔴 A failed renewal is stored as `expired`. Reading "on a plan" as
     * `status = 'active'` meant a card payer's plan vanished the moment its
     * card failed: no member limit was watched any more, so a community
     * paused for being over its number was reopened, and a shut joining door
     * opened. A plan on trial was never watched at all.
     */
    public const PLAN_IN_FORCE_SQL = "(tpa.status IN ('active', 'trial')
        OR (tpa.status = 'expired'
            AND tpa.stripe_subscription_id IS NOT NULL AND tpa.stripe_subscription_id <> ''
            AND tpa.stripe_status IS NOT NULL
            AND tpa.stripe_status NOT IN ('canceled', 'incomplete_expired')))";

    /**
     * Whether the community holds a card subscription with the platform that
     * Stripe has not ended. The ONE definition of "a card payer": who a
     * community pays by default (BillingStandingService::defaultPayer()), the
     * refusal of a second checkout, the hub's "the platform team changes this
     * plan" refusal and "move up" all ask here.
     *
     * What Stripe last said decides (`stripe_status`, kept word for word by
     * the webhook handlers): every status except the two in
     * STRIPE_SUBSCRIPTION_ENDED is a subscription that still exists. That
     * includes `past_due`, `unpaid` and `paused`, which the record's own
     * `status` folds into `expired`.
     *
     * 🔴 Until 21 November 2026 this asked `status IN (active, trial)`. A
     * failed renewal is stored as `expired`, so the moment a card failed the
     * community stopped being a card payer: the daily check no longer waited
     * for Stripe (the owner's ruling of 20 November), its admins lost the
     * Billing link they needed to fix the card, and a second subscription
     * could be started beside the first.
     *
     * A record Stripe has said nothing about yet (`stripe_status` NULL, from
     * before that column was kept) is judged by its own status, as before. A
     * record cancelled here never counts.
     */
    public static function hasLiveCardSubscription(int $tenantId): bool
    {
        return DB::table('tenant_plan_assignments')
            ->where('tenant_id', $tenantId)
            ->whereNotNull('stripe_subscription_id')
            ->where('stripe_subscription_id', '<>', '')
            ->where('status', '<>', 'cancelled')
            ->where(static function ($query): void {
                $query
                    ->where(static function ($said): void {
                        $said->whereNotNull('stripe_status')
                            ->whereNotIn('stripe_status', self::STRIPE_SUBSCRIPTION_ENDED);
                    })
                    ->orWhere(static function ($silent): void {
                        $silent->whereNull('stripe_status')
                            ->whereIn('status', ['active', 'trial', 'trialing']);
                    });
            })
            ->exists();
    }

    /**
     * What BillingStandingNotifier::planChanged() needs to tell a community's
     * admins about the plan it is on now.
     *
     * The plan as it applies to the community (PlanTerms::forCommunity), in
     * the currency it is billed in. For a community that pays its parent that
     * is its hub's price: the platform team's custom price and discounts are
     * about what is owed to the platform and are not applied to it. For a
     * community that pays the platform, they are, and are taken to be in the
     * community's own billing currency.
     *
     * @return array{old_plan_name: ?string, plan_name: string, max_users: ?int, price_monthly: ?float, price_yearly: ?float, currency: string, payee_name: ?string}
     */
    public static function planChangedFacts(int $tenantId, ?string $oldPlanName): array
    {
        $terms = PlanTerms::forCommunity($tenantId);
        if ($terms === null) {
            throw new \RuntimeException("Community {$tenantId} has no current plan");
        }

        $monthly = $terms['price_monthly'];
        $yearly = $terms['price_yearly'];
        $payeeName = null;

        $hubId = PlanTerms::hubFor($tenantId);
        if ($hubId !== null) {
            $payeeName = DB::table('tenants')->where('id', $hubId)->value('name');
        } else {
            // The newest active record, as PlanTerms::forCommunity() reads it.
            $assignment = DB::table('tenant_plan_assignments')
                ->where('tenant_id', $tenantId)
                ->where('status', 'active')
                ->orderByDesc('id')
                ->first(['custom_price_monthly', 'custom_price_yearly', 'discount_percentage', 'nonprofit_verified']);

            if ($assignment !== null) {
                $effective = self::getEffectivePrice([
                    'custom_price_monthly' => $assignment->custom_price_monthly,
                    'custom_price_yearly'  => $assignment->custom_price_yearly,
                    'discount_percentage'  => $assignment->discount_percentage,
                    'nonprofit_verified'   => $assignment->nonprofit_verified,
                    'price_monthly'        => $monthly ?? 0.0,
                    'price_yearly'         => $yearly ?? 0.0,
                ]);
                $monthly = $effective['monthly'];
                $yearly = $effective['yearly'];
            }
        }

        return [
            'old_plan_name' => $oldPlanName,
            'plan_name'     => $terms['name'],
            'max_users'     => $terms['max_users'],
            'price_monthly' => $monthly,
            'price_yearly'  => $yearly,
            'currency'      => $terms['currency'],
            'payee_name'    => $payeeName !== null ? (string) $payeeName : null,
        ];
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Audit Log
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Return recent billing_audit_log rows for a tenant.
     *
     * @return array<int, array<string, mixed>>
     */
    public static function getAuditLog(int $tenantId, int $limit = 50): array
    {
        $rows = DB::select(
            "SELECT bal.*,
                    CONCAT(COALESCE(u.first_name,''), ' ', COALESCE(u.last_name,'')) AS acted_by_name
             FROM billing_audit_log bal
             LEFT JOIN users u ON u.id = bal.acted_by_user_id
             WHERE bal.tenant_id = ?
             ORDER BY bal.created_at DESC
             LIMIT ?",
            [$tenantId, $limit]
        );

        return array_map(fn($r) => (array) $r, $rows);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // CSV Export
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Export a CSV string of all active tenant billing assignments.
     */
    public static function exportCsv(): string
    {
        // Built from the same snapshot as the Billing control screen, so the
        // file says what the screen says: every community (those with no
        // plan too), active members, the currency it is charged in, who it
        // pays, its paid-until date and its standing. It used to list only
        // communities with an active plan, at the euro price, with two
        // columns (`is_paused`, `grace_period_ends_at`) that no longer do
        // anything.
        $headers = [
            'tenant_id', 'tenant_name', 'depth', 'plan_name', 'plan_status',
            'own_users', 'subtree_users', 'active_members', 'member_limit',
            'currency', 'effective_monthly_price', 'effective_yearly_price',
            'discount_pct', 'nonprofit', 'billing_interval',
            'pays', 'paid_until', 'standing', 'review_date',
        ];

        // Community and plan names are set by people and land on the platform
        // administrator's machine: neutralise formulas (E-088).
        $text = static fn (?string $value): string =>
            '"' . str_replace('"', '""', \App\Support\CsvExportSanitizer::cell((string) $value)) . '"';

        $lines = [implode(',', $headers)];

        foreach (self::getBillingSnapshot() as $row) {
            $plan = $row['current_plan'];
            $standing = $row['standing'];
            $state = $standing['exempt'] ? 'exempt' : ($standing['suspended_at'] !== null ? 'paused' : ($standing['locked'] ? 'paused_from_above' : 'open'));

            $lines[] = implode(',', [
                (int) $row['id'],
                $text($row['name']),
                (int) $row['depth'],
                $text($plan['name'] ?? ''),
                $plan['assignment_status'] ?? '',
                (int) $row['own_user_count'],
                (int) $row['subtree_user_count'],
                (int) $row['active_member_count'],
                $plan !== null && $plan['max_users'] !== null ? (int) $plan['max_users'] : '',
                $plan['currency'] ?? '',
                $plan !== null ? number_format($plan['effective_price']['monthly'], 2, '.', '') : '',
                $plan !== null ? number_format($plan['effective_price']['yearly'], 2, '.', '') : '',
                $plan !== null ? $plan['effective_price']['discount_pct'] : '',
                $plan !== null ? ($plan['effective_price']['nonprofit'] ? '1' : '0') : '',
                $plan['billing_interval'] ?? '',
                $standing['payer'],
                $standing['paid_until'] ?? '',
                $state,
                $plan !== null && $plan['expires_at'] !== null ? substr((string) $plan['expires_at'], 0, 10) : '',
            ]);
        }

        return implode("\n", $lines) . "\n";
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Private Helpers
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Insert a row into billing_audit_log.
     *
     * @param mixed $oldValue Array or null — will be json_encoded.
     * @param mixed $newValue Array or null — will be json_encoded.
     */
    public static function logAudit(
        int $tenantId,
        ?int $actedBy,
        string $action,
        $oldValue,
        $newValue,
        ?string $notes
    ): void {
        try {
            DB::table('billing_audit_log')->insert([
                'tenant_id'        => $tenantId,
                'acted_by_user_id' => $actedBy,
                'action'           => $action,
                'old_value'        => $oldValue !== null ? json_encode($oldValue) : null,
                'new_value'        => $newValue !== null ? json_encode($newValue) : null,
                'notes'            => $notes,
                'created_at'       => now(),
                'updated_at'       => now(),
            ]);
        } catch (\Throwable $e) {
            Log::warning('[TenantBillingService] logAudit failed: ' . $e->getMessage(), [
                'tenant_id' => $tenantId,
                'action'    => $action,
            ]);
        }
    }
}
