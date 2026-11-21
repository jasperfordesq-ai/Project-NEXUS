<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Billing;

use App\Services\TenantBillingService;
use App\Support\Billing\BillingLock;
use App\Support\Billing\PlanTerms;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * The default plans, and the suggested package worked out from them, come
 * from `pay_plans` as the platform team has edited it, not from the seed in
 * StandardPlans::TIERS.
 *
 * Until 21 November 2026 Billing control's suggestion read the code constant,
 * so editing a plan's member number changed every limit but the suggestion.
 */
final class PlanTermsDefaultsTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();
        BillingLock::flush();
        PlanTerms::flush();
    }

    protected function tearDown(): void
    {
        // parent::tearDown() rolls the transaction back; it must always run.
        try {
            BillingLock::flush();
            PlanTerms::flush();
        } finally {
            parent::tearDown();
        }
    }

    public function test_defaults_are_the_active_standard_plans_smallest_first(): void
    {
        // One standard plan switched off, and one active plan that is not standard.
        DB::table('pay_plans')->where('slug', 'expansion')->update(['is_active' => 0]);
        DB::table('pay_plans')->insert([
            'name' => 'Not standard',
            'slug' => 'not-standard-' . bin2hex(random_bytes(4)),
            'tier_level' => 0,
            'max_users' => 1,
            'is_active' => 1,
            'is_standard' => 0,
            'created_at' => now(),
        ]);
        PlanTerms::flush();

        $defaults = PlanTerms::defaults();

        $this->assertSame(
            ['spark', 'local', 'community', 'growth', 'scale', 'network'],
            array_column($defaults, 'slug')
        );
        $members = array_column($defaults, 'max_users');
        $sorted = $members;
        sort($sorted);
        $this->assertSame($sorted, $members, 'smallest member number first');

        $spark = $defaults[0];
        foreach ([
            'plan_id', 'slug', 'name', 'description', 'max_users',
            'price_monthly', 'price_yearly', 'setup_fee',
            'price_monthly_gbp', 'price_yearly_gbp', 'setup_fee_gbp',
            'terms', 'hub_tenant_id', 'is_standard',
        ] as $key) {
            $this->assertArrayHasKey($key, $spark, $key);
        }
        $this->assertArrayNotHasKey('currency', $spark, 'no community, so both currencies are given');
        $this->assertSame('default', $spark['terms']);
        $this->assertNull($spark['hub_tenant_id']);
        $this->assertTrue($spark['is_standard']);
        $this->assertIsInt($spark['plan_id']);
        $this->assertIsInt($spark['max_users']);
        $this->assertIsFloat($spark['price_monthly']);
        $this->assertIsFloat($spark['price_monthly_gbp']);
    }

    public function test_suggestion_follows_an_edited_member_number(): void
    {
        DB::table('pay_plans')->where('slug', 'spark')->update(['max_users' => 50]);
        PlanTerms::flush();

        $this->assertSame('local', PlanTerms::smallestDefaultFitting(60)['slug']);
        $this->assertSame('spark', PlanTerms::smallestDefaultFitting(50)['slug']);
    }

    public function test_no_suggestion_above_the_largest(): void
    {
        $largest = (int) DB::table('pay_plans')
            ->where('is_standard', 1)->where('is_active', 1)->max('max_users');

        $this->assertNull(PlanTerms::smallestDefaultFitting($largest + 1));
        $this->assertNotNull(PlanTerms::smallestDefaultFitting($largest));
    }

    public function test_snapshot_suggestion_uses_the_database(): void
    {
        $id = (int) DB::table('tenants')->insertGetId([
            'name' => 'Suggestion community',
            'slug' => 'suggest-' . bin2hex(random_bytes(5)),
            'is_active' => 1,
            'parent_id' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        DB::table('tenants')->where('id', $id)->update(['path' => "/1/{$id}/"]);
        for ($i = 0; $i < 3; $i++) {
            $uid = bin2hex(random_bytes(6));
            DB::table('users')->insert([
                'tenant_id' => $id,
                'name' => 'Member ' . $uid,
                'first_name' => 'Member',
                'last_name' => 'Test',
                'email' => $uid . '@example.test',
                'status' => 'active',
                'last_login_at' => now()->subDays(2),
                'created_at' => now(),
            ]);
        }

        // Spark would fit three members by the seed (100); edited down to 2,
        // the database says Local.
        DB::table('pay_plans')->where('slug', 'spark')->update(['max_users' => 2]);
        PlanTerms::flush();

        $row = collect(TenantBillingService::getBillingSnapshot())->firstWhere('id', $id);

        $this->assertNotNull($row);
        $this->assertSame(3, $row['active_member_count']);
        $this->assertSame('local', $row['suggested_plan'], 'still the slug, as a string');
    }
}
