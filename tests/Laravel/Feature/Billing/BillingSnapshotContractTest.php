<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Billing;

use App\Support\Billing\BillingLock;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\Concerns\ActsAsAccessTiers;
use Tests\Laravel\TestCase;

/**
 * Pins what the Platform team's Billing control screen reads to what the
 * server sends.
 *
 * 🔴 Why this test exists, specifically. Until 20 November 2026 the screen
 * (react-frontend/src/admin/modules/billing/BillingControl.tsx) read
 * `tenant_id`, `tenant_name`, `current_plan_id`, `current_plan_name`,
 * `is_over_limit`, `is_paused` and `effective_price` off the top of each row.
 * The server has always sent `id`, `name`, a nested `current_plan` object and
 * `over_limit`. So every community name, plan and price was blank, and every
 * button posted `tenant_id: undefined` and was refused. The screen's own
 * tests passed throughout, because their fixtures were written in the shape
 * the screen wanted and nothing compared that shape to a real response.
 *
 * So this asserts KEY NAMES against a real response. If you rename a key here
 * you must rename it in BillingControl.tsx in the same commit, and vice versa.
 * The screen's tests build their fixtures from these same lists.
 */
final class BillingSnapshotContractTest extends TestCase
{
    use ActsAsAccessTiers;
    use DatabaseTransactions;

    /** Read off every row. */
    private const REQUIRED_ROW_KEYS = [
        'id', 'name', 'depth', 'own_user_count', 'subtree_user_count',
        'current_plan', 'over_limit', 'is_in_grace_period', 'standing',
    ];

    /** Read off `current_plan` when a community has one. */
    private const REQUIRED_PLAN_KEYS = [
        'id', 'name', 'custom_price_monthly', 'custom_price_yearly',
        'discount_percentage', 'discount_reason', 'nonprofit_verified', 'effective_price',
    ];

    /** Read off `current_plan.effective_price`. */
    private const REQUIRED_PRICE_KEYS = ['yearly', 'has_custom', 'discount_pct', 'nonprofit'];

    /** Read off `standing`. */
    private const REQUIRED_STANDING_KEYS = ['payer', 'suspended_at', 'exempt', 'locked', 'locked_by_tenant_id'];

    /** Read off each row of GET /v2/admin/plans. */
    private const REQUIRED_PLAN_LIST_KEYS = ['id', 'name', 'slug', 'price_monthly'];

    private int $withPlan;
    private int $withoutPlan;
    private int $planId;

    protected function setUp(): void
    {
        parent::setUp();

        $this->withPlan = $this->makeCommunity('Contract with plan');
        $this->withoutPlan = $this->makeCommunity('Contract without plan');

        $this->planId = (int) DB::table('pay_plans')->insertGetId([
            'name' => 'Contract plan',
            'slug' => 'contract-plan-' . bin2hex(random_bytes(4)),
            'price_monthly' => 40,
            'price_yearly' => 400,
            'max_users' => 250,
            'created_at' => now(),
        ]);
        DB::table('tenant_plan_assignments')->insert([
            'tenant_id' => $this->withPlan,
            'pay_plan_id' => $this->planId,
            'status' => 'active',
        ]);

        BillingLock::flush();
    }

    protected function tearDown(): void
    {
        // parent::tearDown() rolls the transaction back; it must always run.
        try {
            BillingLock::flush();
        } finally {
            parent::tearDown();
        }
    }

    private function makeCommunity(string $name): int
    {
        $id = (int) DB::table('tenants')->insertGetId([
            'name' => $name,
            'slug' => 'contract-' . bin2hex(random_bytes(5)),
            'is_active' => 1,
            'parent_id' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        DB::table('tenants')->where('id', $id)->update(['path' => "/1/{$id}/"]);

        return $id;
    }

    public function test_every_row_carries_the_keys_the_screen_reads(): void
    {
        $this->actAsPlatformTeam();

        $response = $this->apiGet('/v2/admin/super/billing/snapshot');
        $response->assertStatus(200);

        $rows = collect($response->json('data'));
        $withPlan = $rows->firstWhere('id', $this->withPlan);
        $withoutPlan = $rows->firstWhere('id', $this->withoutPlan);
        $this->assertNotNull($withPlan);
        $this->assertNotNull($withoutPlan);

        foreach ([$withPlan, $withoutPlan] as $row) {
            foreach (self::REQUIRED_ROW_KEYS as $key) {
                $this->assertArrayHasKey($key, $row, "row.{$key}");
            }
            foreach (self::REQUIRED_STANDING_KEYS as $key) {
                $this->assertArrayHasKey($key, $row['standing'], "row.standing.{$key}");
            }
        }

        $this->assertSame('Contract with plan', $withPlan['name']);
        $this->assertNull($withoutPlan['current_plan'], 'A community with no plan sends null, not an empty object.');
    }

    public function test_a_community_with_a_plan_carries_the_plan_keys_the_screen_reads(): void
    {
        $this->actAsPlatformTeam();

        $row = collect($this->apiGet('/v2/admin/super/billing/snapshot')->json('data'))->firstWhere('id', $this->withPlan);
        $plan = $row['current_plan'];

        foreach (self::REQUIRED_PLAN_KEYS as $key) {
            $this->assertArrayHasKey($key, $plan, "row.current_plan.{$key}");
        }
        foreach (self::REQUIRED_PRICE_KEYS as $key) {
            $this->assertArrayHasKey($key, $plan['effective_price'], "row.current_plan.effective_price.{$key}");
        }

        // The Assign plan dialog opens on the community's current plan, which
        // it can only do if the row says which plan that is.
        $this->assertSame($this->planId, $plan['id']);
        $this->assertSame('Contract plan', $plan['name']);
        $this->assertEquals(400, $plan['effective_price']['yearly']);
    }

    public function test_the_plan_list_carries_the_keys_the_screen_reads(): void
    {
        $this->actAsPlatformTeam();

        $response = $this->apiGet('/v2/admin/plans');
        $response->assertStatus(200);

        $plan = collect($response->json('data'))->firstWhere('id', $this->planId);
        $this->assertNotNull($plan);

        foreach (self::REQUIRED_PLAN_LIST_KEYS as $key) {
            $this->assertArrayHasKey($key, $plan, "plan.{$key}");
        }
    }
}
