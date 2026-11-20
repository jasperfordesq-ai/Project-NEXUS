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
        // Sized by active members (DESIGN §11), not registered ones.
        'active_member_count', 'usage_percent', 'suggested_plan',
        // Stage 6: the earliest automatic pause date and the newest payment
        // recorded by hand.
        'pause_on', 'last_payment',
    ];

    /** Read off `last_payment` when a community has one. */
    private const REQUIRED_LAST_PAYMENT_KEYS = ['received_on', 'method'];

    /** Read off `current_plan` when a community has one. */
    private const REQUIRED_PLAN_KEYS = [
        'id', 'name', 'custom_price_monthly', 'custom_price_yearly',
        'discount_percentage', 'discount_reason', 'nonprofit_verified', 'effective_price',
        'max_users', 'max_communities', 'is_standard',
        // Compared with `suggested_plan` to show a better-fitting package.
        'slug',
        // A failed card payment leaves the plan `expired`; the screen shows it
        // beside the plan rather than reporting "No plan" (Stage 5).
        'assignment_status',
    ];

    /** Read off `current_plan.effective_price`. */
    private const REQUIRED_PRICE_KEYS = ['yearly', 'has_custom', 'discount_pct', 'nonprofit'];

    /** Read off `standing`. */
    private const REQUIRED_STANDING_KEYS = ['payer', 'suspended_at', 'exempt', 'locked', 'locked_by_tenant_id', 'paid_until'];

    /** Read off each row of GET /v2/admin/plans. */
    private const REQUIRED_PLAN_LIST_KEYS = [
        'id', 'name', 'slug', 'price_monthly', 'max_users', 'is_active',
        'is_standard', 'price_monthly_gbp', 'price_yearly_gbp', 'setup_fee', 'setup_fee_gbp',
        'max_communities', 'storage_gb', 'emails_per_month',
    ];

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
        $this->assertSame('active', $plan['assignment_status']);
    }

    /**
     * Until Stage 5 only `active` assignments were read, so a community whose
     * card payment had failed (`expired`), or that was on a trial, showed as
     * having no plan at all.
     *
     * @return array<string, array{string}>
     */
    public static function inactiveStatuses(): array
    {
        return [
            'expired' => ['expired'],
            'trial' => ['trial'],
            'cancelled' => ['cancelled'],
        ];
    }

    /** @dataProvider inactiveStatuses */
    public function test_a_community_whose_plan_is_not_active_still_shows_its_plan(string $status): void
    {
        DB::table('tenant_plan_assignments')->where('tenant_id', $this->withPlan)->update(['status' => $status]);
        $this->actAsPlatformTeam();

        $row = collect($this->apiGet('/v2/admin/super/billing/snapshot')->json('data'))->firstWhere('id', $this->withPlan);

        $this->assertNotNull($row['current_plan']);
        $this->assertSame($this->planId, $row['current_plan']['id']);
        $this->assertSame($status, $row['current_plan']['assignment_status']);
        // Usage is still measured against that plan's limit.
        $this->assertSame(0, $row['usage_percent']);
        $this->assertFalse($row['over_limit']);
    }

    public function test_an_active_assignment_wins_over_a_newer_inactive_one(): void
    {
        $otherPlan = (int) DB::table('pay_plans')->insertGetId([
            'name' => 'Contract old plan',
            'slug' => 'contract-old-' . bin2hex(random_bytes(4)),
            'price_monthly' => 10,
            'price_yearly' => 100,
            'max_users' => 50,
            'created_at' => now(),
        ]);
        DB::table('tenant_plan_assignments')->insert([
            'tenant_id' => $this->withPlan,
            'pay_plan_id' => $otherPlan,
            'status' => 'cancelled',
        ]);
        $this->actAsPlatformTeam();

        $row = collect($this->apiGet('/v2/admin/super/billing/snapshot')->json('data'))->firstWhere('id', $this->withPlan);

        $this->assertSame($this->planId, $row['current_plan']['id']);
        $this->assertSame('active', $row['current_plan']['assignment_status']);
    }

    public function test_without_an_active_assignment_the_most_recent_one_is_shown(): void
    {
        DB::table('tenant_plan_assignments')->where('tenant_id', $this->withPlan)->update(['status' => 'cancelled']);
        $newerPlan = (int) DB::table('pay_plans')->insertGetId([
            'name' => 'Contract newer plan',
            'slug' => 'contract-newer-' . bin2hex(random_bytes(4)),
            'price_monthly' => 10,
            'price_yearly' => 100,
            'max_users' => 50,
            'created_at' => now(),
        ]);
        DB::table('tenant_plan_assignments')->insert([
            'tenant_id' => $this->withPlan,
            'pay_plan_id' => $newerPlan,
            'status' => 'expired',
        ]);
        $this->actAsPlatformTeam();

        $row = collect($this->apiGet('/v2/admin/super/billing/snapshot')->json('data'))->firstWhere('id', $this->withPlan);

        $this->assertSame($newerPlan, $row['current_plan']['id']);
        $this->assertSame('expired', $row['current_plan']['assignment_status']);
    }

    public function test_pause_on_and_last_payment_are_sent(): void
    {
        $actor = $this->actAsPlatformTeam();
        \App\Services\BillingStandingService::recordPayment($this->withPlan, [
            'paid_until' => '2027-03-10',
            'received_on' => now()->subDays(10)->toDateString(),
            'method' => 'bank_transfer',
        ], (int) $actor->id);
        \App\Services\BillingStandingService::recordPayment($this->withPlan, [
            'paid_until' => '2027-04-10',
            'received_on' => now()->subDays(2)->toDateString(),
            'method' => 'cheque',
        ], (int) $actor->id);

        // While the daily check is off nothing is paused automatically, so
        // no pause day is named.
        $off = collect($this->apiGet('/v2/admin/super/billing/snapshot')->json('data'))->firstWhere('id', $this->withPlan);
        $this->assertArrayHasKey('pause_on', $off);
        $this->assertNull($off['pause_on'], 'A pause day was named while the checks are switched off.');

        \App\Support\Billing\BillingSettings::set('automation_enabled', true, null);

        $rows = collect($this->apiGet('/v2/admin/super/billing/snapshot')->json('data'));
        $withPlan = $rows->firstWhere('id', $this->withPlan);
        $withoutPlan = $rows->firstWhere('id', $this->withoutPlan);

        $this->assertSame(
            \App\Services\BillingAutomationService::earliestPauseDate('2027-04-10', $withPlan['standing']['payer'], false, false),
            $withPlan['pause_on']
        );
        $this->assertNotNull($withPlan['pause_on'], 'A tracked date that is billed has a pause date.');

        foreach (self::REQUIRED_LAST_PAYMENT_KEYS as $key) {
            $this->assertArrayHasKey($key, $withPlan['last_payment'], "row.last_payment.{$key}");
        }
        $this->assertSame(['received_on' => now()->subDays(2)->toDateString(), 'method' => 'cheque'], $withPlan['last_payment']);

        // No date tracked and no payment by hand: both null, not missing.
        $this->assertNull($withoutPlan['pause_on']);
        $this->assertNull($withoutPlan['last_payment']);
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

        $spark = collect($response->json('data'))->firstWhere('slug', 'spark');
        $this->assertNotNull($spark, 'the standard packages are listed');
        $this->assertTrue($spark['is_standard']);
        $this->assertSame(1, $spark['max_communities']);
    }
}
