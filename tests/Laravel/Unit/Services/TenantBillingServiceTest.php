<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Services;

use Tests\Laravel\TestCase;
use App\Services\TenantBillingService;
use App\Core\TenantContext;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;

/**
 * TenantBillingServiceTest
 *
 * Strategy:
 * - getEffectivePrice: pure computation — no DB required; tested exhaustively.
 * - getSubtreeUserCount: DB-backed; seed a minimal tenant + users.
 * - assignPlan / pauseBilling / resumeBilling / setGracePeriod: DB-backed;
 *   verify rows written and audit log entries created.
 * - grantDelegate / revokeDelegate: DB-backed; verify billing_delegates rows.
 * - getBillingSnapshot / getRevenueDashboard / getAuditLog / exportCsv:
 *   verified via real DB rows using tenant 2.
 *
 * Queue::fake() is set in setUp to prevent any job/observer from resetting
 * TenantContext under a sync queue dispatch.
 */
class TenantBillingServiceTest extends TestCase
{
    use DatabaseTransactions;

    private const TENANT_ID = 2;

    // Unique plan id range for these tests (real plans start from 1).
    private int $planId;

    protected function setUp(): void
    {
        parent::setUp();
        Queue::fake();
        TenantContext::setById(self::TENANT_ID);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Helpers
    // ─────────────────────────────────────────────────────────────────────

    /** Insert a pay_plan row and return its id. */
    private function insertPlan(
        float $monthly = 10.0,
        float $yearly = 100.0,
        ?int $maxUsers = null,
        string $name = 'Test Plan',
        string $slug = ''
    ): int {
        $slug = $slug ?: 'test-plan-' . uniqid();
        return DB::table('pay_plans')->insertGetId([
            'name'          => $name,
            'slug'          => $slug,
            'price_monthly' => $monthly,
            'price_yearly'  => $yearly,
            'max_users'     => $maxUsers,
            'tier_level'    => 1,
            'is_active'     => 1,
            'created_at'    => now(),
            'updated_at'    => now(),
        ]);
    }

    /** Insert an active plan assignment for a tenant and return its id. */
    private function insertPlanAssignment(
        int $tenantId,
        int $planId,
        array $extra = []
    ): int {
        return DB::table('tenant_plan_assignments')->insertGetId(array_merge([
            'tenant_id'           => $tenantId,
            'pay_plan_id'         => $planId,
            'status'              => 'active',
            'starts_at'           => now(),
            'is_paused'           => 0,
            'nonprofit_verified'  => 0,
            'discount_percentage' => 0,
            'created_at'          => now(),
            'updated_at'          => now(),
        ], $extra));
    }

    /** Insert a minimal active user in the given tenant and return its id. */
    private function insertUser(int $tenantId = self::TENANT_ID): int
    {
        $uid = uniqid('u', true);
        return DB::table('users')->insertGetId([
            'tenant_id'  => $tenantId,
            'name'       => 'Test ' . $uid,
            'first_name' => 'Test',
            'last_name'  => 'User',
            'email'      => $uid . '@example.test',
            'status'     => 'active',
            'role'       => 'member',
            'balance'    => 0,
            'is_approved'=> 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    // ─────────────────────────────────────────────────────────────────────
    // getEffectivePrice — pure computation tests
    // ─────────────────────────────────────────────────────────────────────

    public function test_getEffectivePrice_returns_plan_defaults_when_no_custom_price(): void
    {
        $result = TenantBillingService::getEffectivePrice([
            'price_monthly'        => 10.0,
            'price_yearly'         => 100.0,
            'custom_price_monthly' => null,
            'custom_price_yearly'  => null,
            'discount_percentage'  => 0,
            'nonprofit_verified'   => false,
        ]);

        $this->assertSame(10.0,  $result['monthly']);
        $this->assertSame(100.0, $result['yearly']);
        $this->assertFalse($result['has_custom']);
        $this->assertSame(0,     $result['discount_pct']);
        $this->assertFalse($result['nonprofit']);
    }

    public function test_getEffectivePrice_uses_custom_price_over_plan_default(): void
    {
        $result = TenantBillingService::getEffectivePrice([
            'price_monthly'        => 10.0,
            'price_yearly'         => 100.0,
            'custom_price_monthly' => 5.0,
            'custom_price_yearly'  => 50.0,
            'discount_percentage'  => 0,
            'nonprofit_verified'   => false,
        ]);

        $this->assertSame(5.0,  $result['monthly']);
        $this->assertSame(50.0, $result['yearly']);
        $this->assertTrue($result['has_custom']);
    }

    public function test_getEffectivePrice_applies_20_percent_nonprofit_discount(): void
    {
        $result = TenantBillingService::getEffectivePrice([
            'price_monthly'        => 100.0,
            'price_yearly'         => 1000.0,
            'custom_price_monthly' => null,
            'custom_price_yearly'  => null,
            'discount_percentage'  => 0,
            'nonprofit_verified'   => true,
        ]);

        $this->assertSame(80.0,  $result['monthly']);
        $this->assertSame(800.0, $result['yearly']);
        $this->assertTrue($result['nonprofit']);
    }

    public function test_getEffectivePrice_applies_discount_percentage_on_top_of_base(): void
    {
        $result = TenantBillingService::getEffectivePrice([
            'price_monthly'        => 100.0,
            'price_yearly'         => 1000.0,
            'custom_price_monthly' => null,
            'custom_price_yearly'  => null,
            'discount_percentage'  => 10,
            'nonprofit_verified'   => false,
        ]);

        // 100 * 0.90 = 90, 1000 * 0.90 = 900
        $this->assertSame(90.0,  $result['monthly']);
        $this->assertSame(900.0, $result['yearly']);
        $this->assertSame(10, $result['discount_pct']);
    }

    public function test_getEffectivePrice_stacks_nonprofit_and_discount_percentage(): void
    {
        $result = TenantBillingService::getEffectivePrice([
            'price_monthly'        => 100.0,
            'price_yearly'         => 1000.0,
            'custom_price_monthly' => null,
            'custom_price_yearly'  => null,
            'discount_percentage'  => 50,
            'nonprofit_verified'   => true,
        ]);

        // 100 * 0.80 * 0.50 = 40, 1000 * 0.80 * 0.50 = 400
        $this->assertSame(40.0,  $result['monthly']);
        $this->assertSame(400.0, $result['yearly']);
    }

    public function test_getEffectivePrice_clamps_to_zero_when_discounts_exceed_price(): void
    {
        $result = TenantBillingService::getEffectivePrice([
            'price_monthly'        => 0.0,
            'price_yearly'         => 0.0,
            'custom_price_monthly' => null,
            'custom_price_yearly'  => null,
            'discount_percentage'  => 100,
            'nonprofit_verified'   => true,
        ]);

        $this->assertSame(0.0, $result['monthly']);
        $this->assertSame(0.0, $result['yearly']);
    }

    public function test_getEffectivePrice_clamps_discount_pct_to_0_100_range(): void
    {
        // discount_percentage > 100 should behave as 100 (result: 0)
        $result = TenantBillingService::getEffectivePrice([
            'price_monthly'        => 50.0,
            'price_yearly'         => 500.0,
            'custom_price_monthly' => null,
            'custom_price_yearly'  => null,
            'discount_percentage'  => 150,
            'nonprofit_verified'   => false,
        ]);

        $this->assertSame(0.0, $result['monthly']);
        $this->assertSame(0.0, $result['yearly']);
        $this->assertSame(100, $result['discount_pct']);
    }

    public function test_getEffectivePrice_rounds_to_two_decimal_places(): void
    {
        $result = TenantBillingService::getEffectivePrice([
            'price_monthly'        => 9.999,
            'price_yearly'         => 99.999,
            'custom_price_monthly' => null,
            'custom_price_yearly'  => null,
            'discount_percentage'  => 0,
            'nonprofit_verified'   => false,
        ]);

        $this->assertSame(10.0,  $result['monthly']);
        $this->assertSame(100.0, $result['yearly']);
    }

    // ─────────────────────────────────────────────────────────────────────
    // getSubtreeUserCount — DB-backed
    // ─────────────────────────────────────────────────────────────────────

    public function test_getSubtreeUserCount_returns_zero_for_nonexistent_tenant(): void
    {
        $count = TenantBillingService::getSubtreeUserCount(999999);
        $this->assertSame(0, $count);
    }

    public function test_getSubtreeUserCount_counts_active_users_in_tenant(): void
    {
        // Tenant 2 exists in nexus_test with a known path.
        $before = TenantBillingService::getSubtreeUserCount(self::TENANT_ID);

        // Add one active user.
        $this->insertUser(self::TENANT_ID);

        $after = TenantBillingService::getSubtreeUserCount(self::TENANT_ID);
        $this->assertSame($before + 1, $after);
    }

    /**
     * 🔴 A tenant with no materialised path must not be billed for the platform.
     *
     * `'' . '%'` is `'%'`, so before the 2026-08-06 fix this counted every
     * active member on the installation as belonging to this one tenant. It is
     * a billing figure — it drives over-limit detection, the grace period and
     * the quoted price — so the failure mode was over-charging a community by
     * whatever the rest of the platform weighed.
     *
     * The tenant here owns exactly two active members while other tenants own
     * more, so the old behaviour fails this outright rather than by a margin.
     */
    public function test_getSubtreeUserCount_with_empty_path_counts_only_its_own_members(): void
    {
        $pathlessTenantId = 98051;
        DB::table('tenants')->insertOrIgnore([
            'id'                => $pathlessTenantId,
            'name'              => 'Pathless Billing Tenant',
            'slug'              => 'pathless-billing-' . $pathlessTenantId,
            'is_active'         => 1,
            'depth'             => 1,
            'allows_subtenants' => 0,
            'parent_id'         => 1,
            'path'              => null,
            'created_at'        => now(),
            'updated_at'        => now(),
        ]);
        // insertOrIgnore leaves an existing row untouched; force the state under test.
        DB::table('tenants')->where('id', $pathlessTenantId)->update(['path' => null]);
        DB::table('users')->where('tenant_id', $pathlessTenantId)->delete();

        $this->insertUser($pathlessTenantId);
        $this->insertUser($pathlessTenantId);

        /*
         * The unrelated tenant MUST have a path of its own, or this test proves
         * nothing. `LIKE '%'` only matches rows whose path is non-NULL, and in
         * `nexus_test` the tenants that hold most members (1 and 2) have no
         * path — so an earlier version of this test passed with the guard
         * deliberately disabled. Seeding a path-having stranger is what makes
         * the regression detectable.
         */
        $strangerCount = $this->seedUnrelatedTenantWithPath(98055, 3);

        $count = TenantBillingService::getSubtreeUserCount($pathlessTenantId);

        $this->assertSame(
            2,
            $count,
            "a pathless tenant must be billed for its own members only; {$strangerCount} members "
                . 'belong to an unrelated tenant and must not be swept in by an empty-prefix LIKE'
        );
    }

    /**
     * Seed a tenant that is NOT related to the tenant under test, give it a real
     * materialised path and some active members, and return how many.
     */
    private function seedUnrelatedTenantWithPath(int $tenantId, int $members): int
    {
        DB::table('tenants')->insertOrIgnore([
            'id'                => $tenantId,
            'name'              => 'Unrelated Billing Tenant',
            'slug'              => 'unrelated-billing-' . $tenantId,
            'is_active'         => 1,
            'depth'             => 1,
            'allows_subtenants' => 0,
            'parent_id'         => 1,
            'path'              => '/1/' . $tenantId . '/',
            'created_at'        => now(),
            'updated_at'        => now(),
        ]);
        DB::table('tenants')->where('id', $tenantId)->update(['path' => '/1/' . $tenantId . '/']);
        DB::table('users')->where('tenant_id', $tenantId)->delete();

        for ($i = 0; $i < $members; $i++) {
            $this->insertUser($tenantId);
        }

        return $members;
    }

    /** An empty string is as dangerous as NULL, and is what a failed UPDATE can leave. */
    public function test_getSubtreeUserCount_with_blank_string_path_counts_only_its_own_members(): void
    {
        $blankPathTenantId = 98052;
        DB::table('tenants')->insertOrIgnore([
            'id'                => $blankPathTenantId,
            'name'              => 'Blank Path Billing Tenant',
            'slug'              => 'blank-path-billing-' . $blankPathTenantId,
            'is_active'         => 1,
            'depth'             => 1,
            'allows_subtenants' => 0,
            'parent_id'         => 1,
            'path'              => '',
            'created_at'        => now(),
            'updated_at'        => now(),
        ]);
        DB::table('tenants')->where('id', $blankPathTenantId)->update(['path' => '']);
        DB::table('users')->where('tenant_id', $blankPathTenantId)->delete();

        $this->insertUser($blankPathTenantId);
        $this->seedUnrelatedTenantWithPath(98056, 3);

        $this->assertSame(
            1,
            TenantBillingService::getSubtreeUserCount($blankPathTenantId),
            'a blank path must not sweep in an unrelated tenant that does have one'
        );
    }

    /** The real subtree must still be counted — the guard must not over-fire. */
    public function test_getSubtreeUserCount_still_includes_descendants_when_the_path_is_present(): void
    {
        $parentId = 98053;
        $childId  = 98054;

        foreach ([
            [$parentId, '/1/' . $parentId . '/', 1],
            [$childId,  '/1/' . $parentId . '/' . $childId . '/', 0],
        ] as [$id, $path, $allowsSub]) {
            DB::table('tenants')->insertOrIgnore([
                'id'                => $id,
                'name'              => 'Subtree Billing ' . $id,
                'slug'              => 'subtree-billing-' . $id,
                'is_active'         => 1,
                'depth'             => 2,
                'allows_subtenants' => $allowsSub,
                'parent_id'         => $id === $childId ? $parentId : 1,
                'path'              => $path,
                'created_at'        => now(),
                'updated_at'        => now(),
            ]);
            DB::table('tenants')->where('id', $id)->update(['path' => $path]);
            DB::table('users')->where('tenant_id', $id)->delete();
        }

        $this->insertUser($parentId);
        $this->insertUser($childId);
        $this->insertUser($childId);

        $this->assertSame(
            3,
            TenantBillingService::getSubtreeUserCount($parentId),
            'a hub must still be billed for its branches'
        );
        $this->assertSame(
            2,
            TenantBillingService::getSubtreeUserCount($childId),
            'a branch must be billed for itself, not for its parent'
        );
    }

    // ─────────────────────────────────────────────────────────────────────
    // assignPlan — DB-backed
    // ─────────────────────────────────────────────────────────────────────

    public function test_assignPlan_inserts_new_assignment_when_none_exists(): void
    {
        // Use a temporary isolated tenant so there's no existing assignment.
        $tempTenantId = 98001;
        DB::table('tenants')->insertOrIgnore([
            'id'               => $tempTenantId,
            'name'             => 'BillingTest',
            'slug'             => 'billing-test-' . $tempTenantId,
            'is_active'        => 1,
            'depth'            => 1,
            'allows_subtenants'=> 0,
            'parent_id'        => 1,
            'path'             => '/1/' . $tempTenantId . '/',
            'created_at'       => now(),
            'updated_at'       => now(),
        ]);

        $planId = $this->insertPlan(20.0, 200.0, 100, 'Seed', 'seed-billing-test');

        TenantBillingService::assignPlan(
            $tempTenantId,
            $planId,
            null,
            'Test assignment',
            1
        );

        $row = DB::table('tenant_plan_assignments')
            ->where('tenant_id', $tempTenantId)
            ->where('status', 'active')
            ->first();

        $this->assertNotNull($row);
        $this->assertSame($planId, (int) $row->pay_plan_id);
    }

    public function test_assignPlan_writes_billing_audit_log_entry(): void
    {
        $tempTenantId = 98002;
        DB::table('tenants')->insertOrIgnore([
            'id'               => $tempTenantId,
            'name'             => 'BillingTest2',
            'slug'             => 'billing-test-' . $tempTenantId,
            'is_active'        => 1,
            'depth'            => 1,
            'allows_subtenants'=> 0,
            'parent_id'        => 1,
            'path'             => '/1/' . $tempTenantId . '/',
            'created_at'       => now(),
            'updated_at'       => now(),
        ]);

        $planId = $this->insertPlan(20.0, 200.0, null, 'Plan2', 'plan2-billing-test');

        TenantBillingService::assignPlan($tempTenantId, $planId, null, null, 1);

        $logCount = DB::table('billing_audit_log')
            ->where('tenant_id', $tempTenantId)
            ->where('action', 'plan_assigned')
            ->count();

        $this->assertGreaterThanOrEqual(1, $logCount);
    }

    public function test_assignPlan_updates_existing_assignment(): void
    {
        $tempTenantId = 98003;
        DB::table('tenants')->insertOrIgnore([
            'id'               => $tempTenantId,
            'name'             => 'BillingTest3',
            'slug'             => 'billing-test-' . $tempTenantId,
            'is_active'        => 1,
            'depth'            => 1,
            'allows_subtenants'=> 0,
            'parent_id'        => 1,
            'path'             => '/1/' . $tempTenantId . '/',
            'created_at'       => now(),
            'updated_at'       => now(),
        ]);

        $planA = $this->insertPlan(10.0, 100.0, null, 'PlanA', 'plan-a-' . $tempTenantId);
        $planB = $this->insertPlan(20.0, 200.0, null, 'PlanB', 'plan-b-' . $tempTenantId);

        // First assignment.
        TenantBillingService::assignPlan($tempTenantId, $planA, null, null, 1);

        // Update to plan B.
        TenantBillingService::assignPlan($tempTenantId, $planB, null, 'upgraded', 1);

        $rows = DB::table('tenant_plan_assignments')
            ->where('tenant_id', $tempTenantId)
            ->where('status', 'active')
            ->get();

        // Only one active row should exist (it was updated, not doubled).
        $this->assertCount(1, $rows);
        $this->assertSame($planB, (int) $rows->first()->pay_plan_id);
    }

    // ─────────────────────────────────────────────────────────────────────
    // pauseBilling / resumeBilling — DB-backed
    // ─────────────────────────────────────────────────────────────────────

    public function test_pauseBilling_sets_is_paused_flag(): void
    {
        $planId = $this->insertPlan();
        $assignId = $this->insertPlanAssignment(self::TENANT_ID, $planId);

        TenantBillingService::pauseBilling(self::TENANT_ID, 1);

        $row = DB::table('tenant_plan_assignments')->where('id', $assignId)->first();
        $this->assertSame(1, (int) $row->is_paused);
    }

    public function test_pauseBilling_writes_audit_log_with_plan_paused_action(): void
    {
        $planId = $this->insertPlan();
        $this->insertPlanAssignment(self::TENANT_ID, $planId);

        $before = DB::table('billing_audit_log')
            ->where('tenant_id', self::TENANT_ID)
            ->where('action', 'plan_paused')
            ->count();

        TenantBillingService::pauseBilling(self::TENANT_ID, 1);

        $after = DB::table('billing_audit_log')
            ->where('tenant_id', self::TENANT_ID)
            ->where('action', 'plan_paused')
            ->count();

        $this->assertSame($before + 1, $after);
    }

    public function test_resumeBilling_clears_is_paused_and_grace_period(): void
    {
        $planId = $this->insertPlan();
        $assignId = $this->insertPlanAssignment(self::TENANT_ID, $planId, [
            'is_paused'            => 1,
            'grace_period_ends_at' => now()->addDays(7),
        ]);

        TenantBillingService::resumeBilling(self::TENANT_ID, 1);

        $row = DB::table('tenant_plan_assignments')->where('id', $assignId)->first();
        $this->assertSame(0, (int) $row->is_paused);
        $this->assertNull($row->grace_period_ends_at);
    }

    public function test_pauseBilling_is_noop_when_no_active_assignment_exists(): void
    {
        // Use a tenant with no assignments — no exception should be thrown.
        $tempTenantId = 98010;
        DB::table('tenants')->insertOrIgnore([
            'id' => $tempTenantId, 'name' => 'Noop', 'slug' => 'noop-' . $tempTenantId,
            'is_active' => 1, 'depth' => 0, 'allows_subtenants' => 0,
            'created_at' => now(), 'updated_at' => now(),
        ]);

        // Should silently return without writing anything.
        TenantBillingService::pauseBilling($tempTenantId, 1);

        $count = DB::table('billing_audit_log')
            ->where('tenant_id', $tempTenantId)
            ->where('action', 'plan_paused')
            ->count();

        $this->assertSame(0, $count);
    }

    // ─────────────────────────────────────────────────────────────────────
    // setGracePeriod — DB-backed
    // ─────────────────────────────────────────────────────────────────────

    public function test_setGracePeriod_sets_future_grace_period_ends_at(): void
    {
        $planId   = $this->insertPlan();
        $assignId = $this->insertPlanAssignment(self::TENANT_ID, $planId);

        TenantBillingService::setGracePeriod(self::TENANT_ID, 14, 1);

        $row = DB::table('tenant_plan_assignments')->where('id', $assignId)->first();
        $this->assertNotNull($row->grace_period_ends_at);

        // grace_period_ends_at should be in the future.
        $this->assertGreaterThan(time(), strtotime($row->grace_period_ends_at));
    }

    public function test_setGracePeriod_writes_audit_log(): void
    {
        $planId = $this->insertPlan();
        $this->insertPlanAssignment(self::TENANT_ID, $planId);

        $before = DB::table('billing_audit_log')
            ->where('tenant_id', self::TENANT_ID)
            ->where('action', 'grace_period_set')
            ->count();

        TenantBillingService::setGracePeriod(self::TENANT_ID, 7, 1);

        $after = DB::table('billing_audit_log')
            ->where('tenant_id', self::TENANT_ID)
            ->where('action', 'grace_period_set')
            ->count();

        $this->assertSame($before + 1, $after);
    }

    // ─────────────────────────────────────────────────────────────────────
    // grantDelegate / revokeDelegate — DB-backed
    // ─────────────────────────────────────────────────────────────────────

    public function test_grantDelegate_inserts_billing_delegate_row(): void
    {
        $userId = $this->insertUser();

        TenantBillingService::grantDelegate($userId, 'view_billing', 1);

        $row = DB::table('billing_delegates')
            ->where('user_id', $userId)
            ->where('scope', 'view_billing')
            ->whereNull('revoked_at')
            ->first();

        $this->assertNotNull($row);
        $this->assertSame('view_billing', $row->scope);
    }

    public function test_grantDelegate_reactivates_previously_revoked_row(): void
    {
        $userId = $this->insertUser();

        // Insert a pre-revoked row.
        DB::table('billing_delegates')->insertOrIgnore([
            'user_id'            => $userId,
            'granted_by_user_id' => 1,
            'scope'              => 'edit_own_price',
            'granted_at'         => now()->subDays(10),
            'revoked_at'         => now()->subDays(5),
            'created_at'         => now()->subDays(10),
            'updated_at'         => now()->subDays(5),
        ]);

        TenantBillingService::grantDelegate($userId, 'edit_own_price', 1);

        $row = DB::table('billing_delegates')
            ->where('user_id', $userId)
            ->where('scope', 'edit_own_price')
            ->whereNull('revoked_at')
            ->first();

        $this->assertNotNull($row, 'Revoked row should be reactivated');
    }

    public function test_revokeDelegate_sets_revoked_at(): void
    {
        $userId = $this->insertUser();

        DB::table('billing_delegates')->insert([
            'user_id'            => $userId,
            'granted_by_user_id' => 1,
            'scope'              => 'manage_children',
            'granted_at'         => now(),
            'revoked_at'         => null,
            'created_at'         => now(),
            'updated_at'         => now(),
        ]);

        TenantBillingService::revokeDelegate($userId, 'manage_children', 1);

        $row = DB::table('billing_delegates')
            ->where('user_id', $userId)
            ->where('scope', 'manage_children')
            ->first();

        $this->assertNotNull($row->revoked_at);
    }

    // ─────────────────────────────────────────────────────────────────────
    // getAuditLog — DB-backed
    // ─────────────────────────────────────────────────────────────────────

    public function test_getAuditLog_returns_array_of_arrays(): void
    {
        // Ensure at least one audit entry exists for tenant 2.
        DB::table('billing_audit_log')->insert([
            'tenant_id'        => self::TENANT_ID,
            'acted_by_user_id' => null,
            'action'           => 'plan_assigned',
            'old_value'        => null,
            'new_value'        => json_encode(['plan_id' => 1]),
            'notes'            => 'unit test entry',
            'created_at'       => now(),
            'updated_at'       => now(),
        ]);

        $log = TenantBillingService::getAuditLog(self::TENANT_ID, 50);

        $this->assertIsArray($log);
        $this->assertNotEmpty($log);
        $this->assertIsArray($log[0]);
        $this->assertArrayHasKey('action', $log[0]);
    }

    // ─────────────────────────────────────────────────────────────────────
    // getBillingSnapshot — smoke test
    // ─────────────────────────────────────────────────────────────────────

    public function test_getBillingSnapshot_returns_array_with_expected_keys(): void
    {
        $snapshot = TenantBillingService::getBillingSnapshot();

        $this->assertIsArray($snapshot);

        if (!empty($snapshot)) {
            $first = $snapshot[0];
            $this->assertArrayHasKey('id', $first);
            $this->assertArrayHasKey('own_user_count', $first);
            $this->assertArrayHasKey('subtree_user_count', $first);
            $this->assertArrayHasKey('suggested_plan', $first);
            $this->assertArrayHasKey('over_limit', $first);
            $this->assertArrayHasKey('is_in_grace_period', $first);
            $this->assertArrayHasKey('grace_days_remaining', $first);
        }

        // Returns at least a valid array (even if empty on a minimal test DB).
        $this->addToAssertionCount(1);
    }

    // ─────────────────────────────────────────────────────────────────────
    // getRevenueDashboard — smoke test
    // ─────────────────────────────────────────────────────────────────────

    public function test_getRevenueDashboard_returns_expected_keys(): void
    {
        $dashboard = TenantBillingService::getRevenueDashboard();

        $this->assertIsArray($dashboard);
        $this->assertArrayHasKey('active_tenants',       $dashboard);
        $this->assertArrayHasKey('paused_tenants',       $dashboard);
        $this->assertArrayHasKey('free_tenants',         $dashboard);
        $this->assertArrayHasKey('over_limit_tenants',   $dashboard);
        $this->assertArrayHasKey('in_grace_period',      $dashboard);
        $this->assertArrayHasKey('mrr',                  $dashboard);
        $this->assertArrayHasKey('arr',                  $dashboard);
        $this->assertArrayHasKey('total_platform_users', $dashboard);
        $this->assertArrayHasKey('plan_breakdown',       $dashboard);
        $this->assertArrayHasKey('recent_changes',       $dashboard);
    }

    public function test_getRevenueDashboard_arr_is_mrr_times_twelve(): void
    {
        $dashboard = TenantBillingService::getRevenueDashboard();

        $this->assertEqualsWithDelta(
            round($dashboard['mrr'] * 12, 2),
            $dashboard['arr'],
            0.01,
            'ARR should equal MRR * 12'
        );
    }

    // ─────────────────────────────────────────────────────────────────────
    // exportCsv — smoke test
    // ─────────────────────────────────────────────────────────────────────

    public function test_exportCsv_returns_string_with_header_row(): void
    {
        $csv = TenantBillingService::exportCsv();

        $this->assertIsString($csv);

        $firstLine = strtok($csv, "\n");
        $this->assertStringContainsString('tenant_id', $firstLine);
        $this->assertStringContainsString('plan_name', $firstLine);
        $this->assertStringContainsString('effective_yearly_price', $firstLine);
    }

    // ─────────────────────────────────────────────────────────────────────
    // suggested_plan thresholds — pure computation via snapshot
    // ─────────────────────────────────────────────────────────────────────

    /**
     * The suggested plan logic is embedded in getBillingSnapshot.  We exercise
     * it via getEffectivePrice indirectly, but we can verify the threshold
     * constants by examining the match arms directly through the snapshot result.
     *
     * Here we verify via the snapshot that any tenant with subtree_user_count <= 50
     * gets 'seed' as suggested_plan.
     */
    public function test_suggested_plan_is_seed_when_subtree_count_is_zero(): void
    {
        // Create an empty tenant (no users) so subtree_count will be 0.
        $tempTenantId = 98020;
        DB::table('tenants')->insertOrIgnore([
            'id'               => $tempTenantId,
            'name'             => 'EmptySeed',
            'slug'             => 'empty-seed-' . $tempTenantId,
            'is_active'        => 1,
            'depth'            => 1,
            'allows_subtenants'=> 0,
            'parent_id'        => 1,
            'path'             => '/1/' . $tempTenantId . '/',
            'created_at'       => now(),
            'updated_at'       => now(),
        ]);

        $snapshot = TenantBillingService::getBillingSnapshot();

        $row = array_filter($snapshot, fn($s) => (int) $s['id'] === $tempTenantId);
        $row = array_values($row);

        $this->assertCount(1, $row);
        $this->assertSame('seed', $row[0]['suggested_plan']);
    }
}
