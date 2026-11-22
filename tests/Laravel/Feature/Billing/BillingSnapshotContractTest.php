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
        'current_plan', 'over_limit', 'standing',
        // Sized by active members (DESIGN §11), not registered ones.
        'active_member_count', 'usage_percent', 'suggested_plan',
        // Stage 6: the earliest automatic pause date and the newest payment
        // recorded by hand.
        'pause_on', 'last_payment',
        // Hub plans Stage 4: the rule for going over the member number.
        // `over_limit_rule`, not `over_limit`: that key stays the true/false
        // "over its limit now" flag above.
        'over_limit_rule', 'upgrade_allowed',
        // 21 Nov 2026: the currency a special price typed for it is in.
        'billing_currency',
        // 22 Nov 2026: a card payment refunded lately, or disputed.
        'payment_alerts',
    ];

    /** Read off `over_limit_rule`, key for key (same as a Branch payments row's `over_limit`). */
    private const REQUIRED_RULE_KEYS = [
        'action', 'effective_action', 'grace_days', 'action_source', 'days_source',
        'own_action', 'own_grace_days', 'acts_on',
        // Final fix wave A3: whether anything in the rule acts at all.
        'automation_enabled',
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
        // Stage 2 of the hub plans work: 'default', or 'hub' when the
        // community pays its parent and the parent changed this plan. `name`
        // and `max_users` are then the hub's.
        'terms',
        // 21 Nov 2026: prices in the currency the community is charged in,
        // and what Assign plan must show so that saving does not wipe it.
        'currency', 'price_monthly', 'price_yearly', 'billing_interval', 'notes', 'expires_at', 'is_active',
    ];

    /** Read off `current_plan.effective_price`. */
    private const REQUIRED_PRICE_KEYS = ['monthly', 'yearly', 'has_custom', 'discount_pct', 'nonprofit'];

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

    /** Add $count active members who signed in recently. */
    private function addActiveMembers(int $tenantId, int $count): void
    {
        $rows = [];
        for ($i = 0; $i < $count; $i++) {
            $rows[] = [
                'tenant_id' => $tenantId,
                'first_name' => 'Active',
                'last_name' => 'Member',
                'name' => 'Active Member',
                'email' => 'contract.' . bin2hex(random_bytes(7)) . '@example.com',
                'password_hash' => 'x',
                'role' => 'member',
                'status' => 'active',
                'is_approved' => 1,
                'last_login_at' => now()->subDays(5),
                'created_at' => now(),
            ];
        }
        foreach (array_chunk($rows, 200) as $chunk) {
            DB::table('users')->insert($chunk);
        }
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
            $this->assertSame(self::REQUIRED_RULE_KEYS, array_keys($row['over_limit_rule']));
            $this->assertIsBool($row['over_limit']);
            $this->assertIsBool($row['upgrade_allowed']);
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
        $this->assertSame('default', $plan['terms']);
    }

    public function test_a_community_that_pays_its_hub_shows_the_hubs_name_and_member_number(): void
    {
        $this->actAsPlatformTeam();
        $local = DB::table('pay_plans')->where('slug', 'local')->first();
        $hub = $this->makeCommunity('Contract hub');
        $child = (int) DB::table('tenants')->insertGetId([
            'name' => 'Contract hub child', 'slug' => 'contract-' . bin2hex(random_bytes(5)),
            'is_active' => 1, 'parent_id' => $hub, 'depth' => 2,
            'created_at' => now(), 'updated_at' => now(),
        ]);
        DB::table('tenants')->where('id', $child)->update(['path' => "/1/{$hub}/{$child}/"]);
        foreach ([$hub, $child] as $id) {
            DB::table('tenant_plan_assignments')->insert(['tenant_id' => $id, 'pay_plan_id' => $local->id, 'status' => 'active']);
        }
        DB::table('hub_plan_terms')->insert([
            'hub_tenant_id' => $hub, 'pay_plan_id' => $local->id, 'name' => 'Hub local', 'max_users' => 40,
            'created_at' => now(), 'updated_at' => now(),
        ]);
        \App\Support\Billing\PlanTerms::flush();

        $rows = collect($this->apiGet('/v2/admin/super/billing/snapshot')->json('data'));

        $childPlan = $rows->firstWhere('id', $child)['current_plan'];
        $this->assertSame('hub', $childPlan['terms']);
        $this->assertSame('Hub local', $childPlan['name']);
        $this->assertSame(40, $childPlan['max_users']);
        $this->assertSame((int) $local->id, $childPlan['id']);

        // The suggestion is worked out on the same terms as the limit: the
        // plans this community can be put on, with the hub's member numbers.
        DB::table('hub_plan_terms')->where('hub_tenant_id', $hub)->update(['max_users' => 500]);
        \App\Support\Billing\PlanTerms::flush();
        $platformPayer = $this->makeCommunity('Contract platform payer');
        $this->addActiveMembers($child, 400);
        $this->addActiveMembers($platformPayer, 400);

        $rows = collect($this->apiGet('/v2/admin/super/billing/snapshot')->json('data'));
        $this->assertSame(400, $rows->firstWhere('id', $child)['active_member_count']);
        $this->assertSame('local', $rows->firstWhere('id', $child)['suggested_plan'], 'The hub lets Local hold 500.');
        $this->assertSame(
            \App\Support\Billing\PlanTerms::smallestDefaultFitting(400)['slug'],
            $rows->firstWhere('id', $platformPayer)['suggested_plan'],
            'A community that pays the platform is suggested by the default numbers.'
        );
        $this->assertNotSame('local', $rows->firstWhere('id', $platformPayer)['suggested_plan']);

        // The hub itself pays the platform: its own plan is on the default terms.
        $hubPlan = $rows->firstWhere('id', $hub)['current_plan'];
        $this->assertSame('default', $hubPlan['terms']);
        $this->assertSame((string) $local->name, $hubPlan['name']);
        $this->assertSame((int) $local->max_users, $hubPlan['max_users']);
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
