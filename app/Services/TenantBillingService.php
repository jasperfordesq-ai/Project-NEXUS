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
 * lookups, over-limit detection, atomic plan upserts with audit logging,
 * grace periods, billing pause/resume, delegate management, and CSV export.
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
    public static function getSubtreeActiveMemberCount(int $tenantId, int $days = StandardPlans::ACTIVE_WINDOW_DAYS): int
    {
        $row = DB::selectOne('SELECT path FROM tenants WHERE id = ?', [$tenantId]);
        if (!$row) {
            return 0;
        }

        $path = trim((string) ($row->path ?? ''));
        $since = now()->subDays($days);

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
                    tpa.grace_period_ends_at, tpa.is_paused, tpa.nonprofit_verified,
                    tpa.expires_at,
                    pp.id AS plan_id, pp.name AS plan_name, pp.slug AS plan_slug,
                    pp.max_users, pp.price_monthly, pp.price_yearly,
                    pp.max_communities, pp.is_standard
             FROM tenant_plan_assignments tpa
             INNER JOIN pay_plans pp ON pp.id = tpa.pay_plan_id
             WHERE tpa.tenant_id IN ({$placeholders})
             ORDER BY tpa.tenant_id, (tpa.status = 'active') DESC, tpa.id DESC",
            $tenantIds
        );
        $planMap = [];
        foreach ($assignments as $row) {
            if (isset($planMap[(int) $row->tenant_id])) {
                continue;
            }
            $assignmentArr = [
                // The Billing control screen opens "Assign plan" on the
                // community's current plan, so it has to be told which it is.
                'id'                    => (int) $row->plan_id,
                'name'                  => $row->plan_name,
                'slug'                  => $row->plan_slug,
                'max_users'             => $row->max_users !== null ? (int) $row->max_users : null,
                'max_communities'       => $row->max_communities !== null ? (int) $row->max_communities : null,
                'is_standard'           => (bool) $row->is_standard,
                'price_monthly'         => (float) $row->price_monthly,
                'price_yearly'          => (float) $row->price_yearly,
                'custom_price_monthly'  => $row->custom_price_monthly !== null ? (float) $row->custom_price_monthly : null,
                'custom_price_yearly'   => $row->custom_price_yearly !== null ? (float) $row->custom_price_yearly : null,
                'discount_percentage'   => (int) ($row->discount_percentage ?? 0),
                'discount_reason'       => $row->discount_reason,
                'grace_period_ends_at'  => $row->grace_period_ends_at,
                'is_paused'             => (bool) ($row->is_paused ?? false),
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

            // Grace period status.
            $isInGracePeriod  = false;
            $graceDaysRemaining = 0;
            if ($currentPlan !== null && !empty($currentPlan['grace_period_ends_at'])) {
                $graceEnds = strtotime($currentPlan['grace_period_ends_at']);
                $now       = time();
                if ($graceEnds !== false && $graceEnds > $now) {
                    $isInGracePeriod    = true;
                    $graceDaysRemaining = (int) ceil(($graceEnds - $now) / 86400);
                }
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
                'usage_percent'       => $usagePercent,
                'current_plan'        => $currentPlan,
                'suggested_plan'      => $suggested,
                'over_limit'          => $overLimit,
                'is_in_grace_period'  => $isInGracePeriod,
                'grace_days_remaining'=> $graceDaysRemaining,
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
            ] + self::overLimitFields($id, $activeCount);
        }

        return $snapshot;
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
     * Return a revenue dashboard summary for god-level super admins.
     *
     * @return array<string, mixed>
     */
    public static function getRevenueDashboard(): array
    {
        // All active plan assignments with plan price data.
        $allAssignments = DB::select(
            "SELECT tpa.tenant_id, tpa.is_paused, tpa.nonprofit_verified,
                    tpa.discount_percentage, tpa.custom_price_monthly, tpa.custom_price_yearly,
                    tpa.grace_period_ends_at,
                    pp.name AS plan_name, pp.price_monthly, pp.price_yearly,
                    pp.max_users
             FROM tenant_plan_assignments tpa
             INNER JOIN pay_plans pp ON pp.id = tpa.pay_plan_id
             WHERE tpa.status = 'active'"
        );

        $activeTenants    = 0;
        $pausedTenants    = 0;
        $freeTenants      = 0;
        $overLimitTenants = 0;
        $inGracePeriod    = 0;
        $mrr              = 0.0;
        $planBreakdownMap = [];

        $now = time();

        foreach ($allAssignments as $row) {
            $assignmentArr = [
                'custom_price_monthly' => $row->custom_price_monthly,
                'custom_price_yearly'  => $row->custom_price_yearly,
                'discount_percentage'  => $row->discount_percentage,
                'nonprofit_verified'   => $row->nonprofit_verified,
                'price_monthly'        => $row->price_monthly,
                'price_yearly'         => $row->price_yearly,
            ];
            $effective = self::getEffectivePrice($assignmentArr);

            $isPaused = (bool) ($row->is_paused ?? false);

            if ($isPaused) {
                $pausedTenants++;
                continue;
            }

            $activeTenants++;

            if ($effective['monthly'] === 0.0) {
                $freeTenants++;
            }

            // Grace period check.
            if (!empty($row->grace_period_ends_at)) {
                $graceEnds = strtotime($row->grace_period_ends_at);
                if ($graceEnds !== false && $graceEnds > $now) {
                    $inGracePeriod++;
                }
            }

            // Over limit check.
            if ($row->max_users !== null) {
                $subtreeCount = self::getSubtreeUserCount((int) $row->tenant_id);
                if ($subtreeCount > (int) $row->max_users) {
                    $overLimitTenants++;
                }
            }

            // MRR contribution.
            $mrr += $effective['monthly'];

            // Plan breakdown.
            $planName = $row->plan_name;
            if (!isset($planBreakdownMap[$planName])) {
                $planBreakdownMap[$planName] = ['count' => 0, 'mrr' => 0.0];
            }
            $planBreakdownMap[$planName]['count']++;
            $planBreakdownMap[$planName]['mrr'] += $effective['monthly'];
        }

        // Total active platform users.
        $totalUsers = (int) (DB::selectOne(
            "SELECT COUNT(*) AS cnt FROM users WHERE status = 'active'"
        )->cnt ?? 0);

        // Recent billing audit log.
        $recentRows = DB::select(
            "SELECT bal.tenant_id, bal.action, bal.created_at,
                    t.name AS tenant_name,
                    CONCAT(COALESCE(u.first_name,''), ' ', COALESCE(u.last_name,'')) AS acted_by
             FROM billing_audit_log bal
             LEFT JOIN tenants t ON t.id = bal.tenant_id
             LEFT JOIN users u ON u.id = bal.acted_by_user_id
             ORDER BY bal.created_at DESC
             LIMIT 10"
        );

        $recentChanges = array_map(fn($r) => [
            'tenant_name' => $r->tenant_name ?? '',
            'action'      => $r->action,
            'created_at'  => $r->created_at,
            'acted_by'    => trim($r->acted_by ?? '') ?: null,
        ], $recentRows);

        // Build plan breakdown array.
        $planBreakdown = [];
        foreach ($planBreakdownMap as $name => $data) {
            $planBreakdown[] = [
                'plan'  => $name,
                'count' => $data['count'],
                'mrr'   => round($data['mrr'], 2),
            ];
        }

        return [
            'active_tenants'       => $activeTenants,
            'paused_tenants'       => $pausedTenants,
            'free_tenants'         => $freeTenants,
            'over_limit_tenants'   => $overLimitTenants,
            'in_grace_period'      => $inGracePeriod,
            'mrr'                  => round($mrr, 2),
            'arr'                  => round($mrr * 12, 2),
            'total_platform_users' => $totalUsers,
            'plan_breakdown'       => $planBreakdown,
            'recent_changes'       => $recentChanges,
        ];
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
        $existing = DB::selectOne(
            "SELECT id, pay_plan_id, custom_price_monthly, custom_price_yearly,
                    discount_percentage, discount_reason, nonprofit_verified, expires_at, notes
             FROM tenant_plan_assignments
             WHERE tenant_id = ? AND status = 'active'
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
     * Whether the community holds a card subscription with the platform that
     * is still running: a current assignment record carrying a Stripe
     * subscription id. An expired or cancelled record that still has its old
     * id does not count.
     */
    public static function hasLiveCardSubscription(int $tenantId): bool
    {
        return DB::table('tenant_plan_assignments')
            ->where('tenant_id', $tenantId)
            ->whereIn('status', ['active', 'trial', 'trialing'])
            ->whereNotNull('stripe_subscription_id')
            ->where('stripe_subscription_id', '<>', '')
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
    // Grace Period / Pause / Resume
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Set a grace period on the tenant's active plan assignment.
     */
    public static function setGracePeriod(int $tenantId, int $days, int $actedBy): void
    {
        $existing = DB::selectOne(
            "SELECT id, grace_period_ends_at FROM tenant_plan_assignments WHERE tenant_id = ? AND status = 'active' LIMIT 1",
            [$tenantId]
        );

        if (!$existing) {
            return;
        }

        $oldValue = ['grace_period_ends_at' => $existing->grace_period_ends_at];

        DB::table('tenant_plan_assignments')
            ->where('id', $existing->id)
            ->update([
                'grace_period_ends_at' => DB::raw("DATE_ADD(NOW(), INTERVAL {$days} DAY)"),
                'updated_at'           => now(),
            ]);

        $newEnds = DB::selectOne(
            "SELECT grace_period_ends_at FROM tenant_plan_assignments WHERE id = ?",
            [$existing->id]
        );

        self::logAudit(
            $tenantId,
            $actedBy,
            'grace_period_set',
            $oldValue,
            ['grace_period_ends_at' => $newEnds->grace_period_ends_at ?? null, 'days' => $days],
            "Grace period set for {$days} days"
        );
    }

    /**
     * Pause billing for a tenant (sets is_paused = true).
     */
    public static function pauseBilling(int $tenantId, int $actedBy): void
    {
        $existing = DB::selectOne(
            "SELECT id, is_paused FROM tenant_plan_assignments WHERE tenant_id = ? AND status = 'active' LIMIT 1",
            [$tenantId]
        );

        if (!$existing) {
            return;
        }

        DB::table('tenant_plan_assignments')
            ->where('id', $existing->id)
            ->update(['is_paused' => 1, 'updated_at' => now()]);

        self::logAudit(
            $tenantId,
            $actedBy,
            'plan_paused',
            ['is_paused' => (bool) $existing->is_paused],
            ['is_paused' => true],
            null
        );
    }

    /**
     * Resume billing for a tenant (sets is_paused = false, clears grace period).
     */
    public static function resumeBilling(int $tenantId, int $actedBy): void
    {
        $existing = DB::selectOne(
            "SELECT id, is_paused, grace_period_ends_at FROM tenant_plan_assignments WHERE tenant_id = ? AND status = 'active' LIMIT 1",
            [$tenantId]
        );

        if (!$existing) {
            return;
        }

        DB::table('tenant_plan_assignments')
            ->where('id', $existing->id)
            ->update([
                'is_paused'            => 0,
                'grace_period_ends_at' => null,
                'updated_at'           => now(),
            ]);

        self::logAudit(
            $tenantId,
            $actedBy,
            'plan_resumed',
            ['is_paused' => (bool) $existing->is_paused, 'grace_period_ends_at' => $existing->grace_period_ends_at],
            ['is_paused' => false, 'grace_period_ends_at' => null],
            null
        );
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Delegates
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Grant a billing delegate scope to a user.
     * Upserts: if a previously revoked row exists it is reactivated.
     */
    public static function grantDelegate(int $userId, string $scope, int $grantedBy): void
    {
        $existing = DB::selectOne(
            "SELECT id FROM billing_delegates WHERE user_id = ? AND scope = ? LIMIT 1",
            [$userId, $scope]
        );

        $now = now();

        if ($existing) {
            DB::table('billing_delegates')
                ->where('id', $existing->id)
                ->update([
                    'revoked_at'      => null,
                    'granted_by_user_id' => $grantedBy,
                    'granted_at'      => $now,
                    'updated_at'      => $now,
                ]);
        } else {
            DB::table('billing_delegates')->insert([
                'user_id'            => $userId,
                'granted_by_user_id' => $grantedBy,
                'scope'              => $scope,
                'granted_at'         => $now,
                'revoked_at'         => null,
                'created_at'         => $now,
                'updated_at'         => $now,
            ]);
        }

        // Audit log: tenant_id = 0 since delegates are global.
        self::logAudit(
            0,
            $grantedBy,
            'delegate_granted',
            null,
            ['user_id' => $userId, 'scope' => $scope],
            "Delegate scope '{$scope}' granted to user #{$userId}"
        );
    }

    /**
     * Revoke a billing delegate scope from a user.
     */
    public static function revokeDelegate(int $userId, string $scope, int $revokedBy): void
    {
        DB::table('billing_delegates')
            ->where('user_id', $userId)
            ->where('scope', $scope)
            ->whereNull('revoked_at')
            ->update(['revoked_at' => now(), 'updated_at' => now()]);

        self::logAudit(
            0,
            $revokedBy,
            'delegate_revoked',
            ['user_id' => $userId, 'scope' => $scope],
            null,
            "Delegate scope '{$scope}' revoked from user #{$userId}"
        );
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
        $rows = DB::select(
            "SELECT t.id AS tenant_id, t.name AS tenant_name, t.depth,
                    pp.name AS plan_name,
                    tpa.custom_price_monthly, tpa.custom_price_yearly,
                    tpa.discount_percentage, tpa.nonprofit_verified,
                    tpa.is_paused, tpa.grace_period_ends_at, tpa.expires_at,
                    pp.price_monthly, pp.price_yearly
             FROM tenant_plan_assignments tpa
             INNER JOIN tenants t ON t.id = tpa.tenant_id
             INNER JOIN pay_plans pp ON pp.id = tpa.pay_plan_id
             WHERE tpa.status = 'active'
               AND t.id != 1
             ORDER BY t.depth ASC, t.name ASC"
        );

        $headers = [
            'tenant_id', 'tenant_name', 'depth', 'plan_name',
            'own_users', 'subtree_users',
            'effective_yearly_price', 'discount_pct', 'nonprofit',
            'is_paused', 'grace_period_ends_at', 'expires_at',
        ];

        $lines = [];
        $lines[] = implode(',', $headers);

        foreach ($rows as $row) {
            $ownUsers = (int) (DB::selectOne(
                "SELECT COUNT(*) AS cnt FROM users WHERE tenant_id = ? AND status = 'active'",
                [(int) $row->tenant_id]
            )->cnt ?? 0);

            $subtreeUsers = self::getSubtreeUserCount((int) $row->tenant_id);

            $assignmentArr = [
                'custom_price_monthly' => $row->custom_price_monthly,
                'custom_price_yearly'  => $row->custom_price_yearly,
                'discount_percentage'  => $row->discount_percentage,
                'nonprofit_verified'   => $row->nonprofit_verified,
                'price_monthly'        => $row->price_monthly,
                'price_yearly'         => $row->price_yearly,
            ];
            $effective = self::getEffectivePrice($assignmentArr);

            // Community names are set by that community's own admin and land on
            // the platform administrator's machine: neutralise formulas (E-088).
            $lines[] = implode(',', [
                (int) $row->tenant_id,
                '"' . str_replace('"', '""', \App\Support\CsvExportSanitizer::cell((string) $row->tenant_name)) . '"',
                (int) $row->depth,
                '"' . str_replace('"', '""', \App\Support\CsvExportSanitizer::cell((string) $row->plan_name)) . '"',
                $ownUsers,
                $subtreeUsers,
                number_format($effective['yearly'], 2, '.', ''),
                $effective['discount_pct'],
                $effective['nonprofit'] ? '1' : '0',
                ($row->is_paused ? '1' : '0'),
                $row->grace_period_ends_at ?? '',
                $row->expires_at ?? '',
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
