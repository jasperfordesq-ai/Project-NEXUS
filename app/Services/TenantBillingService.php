<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;
use App\Core\EmailTemplateBuilder;
use App\Core\Mailer;
use App\Core\TenantContext;
use App\I18n\LocaleContext;

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

        // Fetch active plan assignments including all new columns.
        $assignments = DB::select(
            "SELECT tpa.tenant_id,
                    tpa.custom_price_monthly, tpa.custom_price_yearly,
                    tpa.discount_percentage, tpa.discount_reason,
                    tpa.grace_period_ends_at, tpa.is_paused, tpa.nonprofit_verified,
                    tpa.expires_at,
                    pp.name AS plan_name, pp.slug AS plan_slug,
                    pp.max_users, pp.price_monthly, pp.price_yearly
             FROM tenant_plan_assignments tpa
             INNER JOIN pay_plans pp ON pp.id = tpa.pay_plan_id
             WHERE tpa.tenant_id IN ({$placeholders})
               AND tpa.status = 'active'",
            $tenantIds
        );
        $planMap = [];
        foreach ($assignments as $row) {
            $assignmentArr = [
                'name'                  => $row->plan_name,
                'slug'                  => $row->plan_slug,
                'max_users'             => $row->max_users !== null ? (int) $row->max_users : null,
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
            ];
            $assignmentArr['effective_price'] = self::getEffectivePrice($assignmentArr);
            $planMap[(int) $row->tenant_id] = $assignmentArr;
        }

        $snapshot = [];
        foreach ($tenants as $tenant) {
            $id           = (int) $tenant->id;
            $ownCount     = $ownCountMap[$id] ?? 0;
            $subtreeCount = self::getSubtreeUserCount($id);
            $currentPlan  = $planMap[$id] ?? null;

            $suggested = match (true) {
                $subtreeCount <= 50   => 'seed',
                $subtreeCount <= 250  => 'community',
                $subtreeCount <= 1000 => 'regional',
                default               => 'network',
            };

            $overLimit = false;
            if ($currentPlan !== null && $currentPlan['max_users'] !== null) {
                $overLimit = $subtreeCount > $currentPlan['max_users'];
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

            $snapshot[] = [
                'id'                  => $id,
                'name'                => $tenant->name,
                'slug'                => $tenant->slug,
                'depth'               => (int) $tenant->depth,
                'parent_id'           => $tenant->parent_id !== null ? (int) $tenant->parent_id : null,
                'allows_subtenants'   => (bool) $tenant->allows_subtenants,
                'own_user_count'      => $ownCount,
                'subtree_user_count'  => $subtreeCount,
                'current_plan'        => $currentPlan,
                'suggested_plan'      => $suggested,
                'over_limit'          => $overLimit,
                'is_in_grace_period'  => $isInGracePeriod,
                'grace_days_remaining'=> $graceDaysRemaining,
            ];
        }

        return $snapshot;
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
     * discounts. Writes an audit log entry and sends an email to the tenant admin.
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

        // Send notification email to tenant admin.
        try {
            $plan = DB::selectOne("SELECT name, price_yearly FROM pay_plans WHERE id = ?", [$planId]);

            $assignmentArr = [
                'custom_price_monthly' => $customPriceMonthly,
                'custom_price_yearly'  => $customPriceYearly,
                'discount_percentage'  => $discountPct,
                'nonprofit_verified'   => $nonprofitVerified,
                'price_monthly'        => 0,
                'price_yearly'         => $plan ? (float) $plan->price_yearly : 0.0,
            ];
            $effective = self::getEffectivePrice($assignmentArr);

            $planName       = htmlspecialchars($plan->name ?? '', ENT_QUOTES, 'UTF-8');
            $effectivePrice = '€' . number_format($effective['yearly'], 2) . ' / yr';
            $expiryDate     = $expiresAt ? date('d M Y', strtotime($expiresAt)) : null;

            self::sendTenantAdminEmail(
                $tenantId,
                ['key' => 'emails_misc.billing.plan_assigned_subject'],
                ['key' => 'emails_misc.billing.plan_assigned_title'],
                [
                    'key' => 'emails_misc.billing.plan_assigned_body',
                    'params_builder' => fn() => [
                        'plan'   => $planName,
                        'price'  => $effectivePrice,
                        'expiry' => $expiryDate ?? __('emails_misc.billing.plan_assigned_no_expiry'),
                        'notes'  => $notes ?? '',
                    ],
                ],
                '/admin/billing',
                ['key' => 'emails_misc.billing.plan_assigned_cta']
            );
        } catch (\Throwable $e) {
            Log::warning('[TenantBillingService] assignPlan email failed: ' . $e->getMessage(), [
                'tenant_id' => $tenantId,
            ]);
        }
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

            $lines[] = implode(',', [
                (int) $row->tenant_id,
                '"' . str_replace('"', '""', $row->tenant_name) . '"',
                (int) $row->depth,
                '"' . str_replace('"', '""', $row->plan_name) . '"',
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
    private static function logAudit(
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

    /**
     * Send a notification email to the primary admin of a tenant, rendering
     * subject/title/body/CTA in the admin's preferred_language.
     *
     * Each $subject/$title/$body/$ctaText is an array: ['key' => 'lang.key',
     * 'params' => [...]] or with 'params_builder' => fn() => [...] for cases
     * where params themselves depend on locale-aware translations.
     *
     * @param array{key:string,params?:array,params_builder?:callable} $subject
     * @param array{key:string,params?:array,params_builder?:callable} $title
     * @param array{key:string,params?:array,params_builder?:callable} $body
     * @param array{key:string,params?:array,params_builder?:callable} $ctaText
     */
    private static function sendTenantAdminEmail(
        int $tenantId,
        array $subject,
        array $title,
        array $body,
        string $link,
        array $ctaText
    ): void {
        $previousTenantId = TenantContext::currentId();
        TenantContext::setById($tenantId);

        try {
            $admin = DB::table('users')
                ->where('tenant_id', $tenantId)
                ->where('role', 'admin')
                ->whereNotNull('email')
                ->select(['email', 'first_name', 'name', 'preferred_language'])
                ->first();

            if (!$admin || empty($admin->email)) {
                return;
            }

            LocaleContext::withLocale($admin, function () use ($admin, $subject, $title, $body, $link, $ctaText, $tenantId) {
                $firstName = $admin->first_name ?? $admin->name ?? __('emails.common.fallback_name');
                $fullUrl   = TenantContext::getFrontendUrl() . TenantContext::getSlugPrefix() . $link;

                $resolveParams = fn(array $spec): array =>
                    isset($spec['params_builder']) && is_callable($spec['params_builder'])
                        ? ($spec['params_builder'])()
                        : ($spec['params'] ?? []);

                $html = EmailTemplateBuilder::make()
                    ->title(__($title['key'], $resolveParams($title)))
                    ->greeting($firstName)
                    ->paragraph(__($body['key'], $resolveParams($body)))
                    ->button(__($ctaText['key'], $resolveParams($ctaText)), $fullUrl)
                    ->render();

                if (!\App\Services\EmailDispatchService::sendRaw($admin->email, __($subject['key'], $resolveParams($subject)), $html, null, null, null, 'billing', ['tenant_id' => $tenantId])) {
                    Log::warning('[TenantBillingService] tenant admin email failed', ['tenant_id' => $tenantId]);
                }
            });
        } finally {
            if ($previousTenantId !== null) {
                TenantContext::setById($previousTenantId);
            } else {
                TenantContext::reset();
            }
        }
    }
}
