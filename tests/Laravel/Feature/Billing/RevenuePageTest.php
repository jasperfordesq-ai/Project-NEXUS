<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Billing;

use App\Models\User;
use App\Services\TenantBillingService;
use App\Support\Billing\BillingLock;
use App\Support\Billing\PlanTerms;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * The platform team's Revenue page (audit of 21 November 2026, B9).
 *
 * It added every active plan at its euro monthly list price: communities
 * that pay their hub, exempt ones, yearly payers and pound communities
 * included. And the screen read a field the server never sent, so the plan
 * table showed "NaN". The shape here is the one the screen's type declares
 * (RevenueDashboard.tsx): rename a key in both places or in neither.
 *
 * Other communities exist in the test database, so every number is checked
 * as the difference this test's own communities make.
 */
final class RevenuePageTest extends TestCase
{
    use DatabaseTransactions;

    private int $plan;

    protected function setUp(): void
    {
        parent::setUp();
        BillingLock::flush();
        PlanTerms::flush();

        $this->plan = (int) DB::table('pay_plans')->insertGetId([
            'name' => 'Revenue test plan ' . bin2hex(random_bytes(3)),
            'slug' => 'revenue-test-' . bin2hex(random_bytes(4)),
            'tier_level' => 9,
            'price_monthly' => 100, 'price_yearly' => 1200,
            'price_monthly_gbp' => 80, 'price_yearly_gbp' => 960,
            'max_users' => 2, 'is_active' => 1, 'created_at' => now(), 'updated_at' => now(),
        ]);
    }

    protected function tearDown(): void
    {
        try {
            BillingLock::flush();
            PlanTerms::flush();
        } finally {
            parent::tearDown();
        }
    }

    private function community(int $parentId = 1, string $parentPath = '/1/', ?string $currency = null, bool $hub = false): int
    {
        $id = (int) DB::table('tenants')->insertGetId([
            'name' => 'Revenue community ' . bin2hex(random_bytes(3)),
            'slug' => 'revenue-' . bin2hex(random_bytes(5)),
            'is_active' => 1, 'parent_id' => $parentId, 'allows_subtenants' => $hub ? 1 : 0,
            'depth' => substr_count($parentPath, '/') - 1,
            'created_at' => now(), 'updated_at' => now(),
        ]);
        DB::table('tenants')->where('id', $id)->update(['path' => "{$parentPath}{$id}/"]);
        if ($currency !== null) {
            DB::table('tenant_settings')->insert([
                'tenant_id' => $id, 'setting_key' => 'general.default_currency', 'setting_value' => $currency,
            ]);
        }

        return $id;
    }

    /** @param array<string, mixed> $extra */
    private function onPlan(int $tenantId, array $extra = []): void
    {
        DB::table('tenant_plan_assignments')->insert($extra + [
            'tenant_id' => $tenantId, 'pay_plan_id' => $this->plan, 'status' => 'active',
            'starts_at' => now(), 'created_at' => now(), 'updated_at' => now(),
        ]);
    }

    /** @param array<string, mixed> $values */
    private function standing(int $tenantId, array $values): void
    {
        DB::table('tenant_billing_standing')->insert($values + [
            'tenant_id' => $tenantId, 'created_at' => now(), 'updated_at' => now(),
        ]);
    }

    /** @return array{eur: float, gbp: float} */
    private function monthly(array $page): array
    {
        $out = ['eur' => 0.0, 'gbp' => 0.0];
        foreach ($page['totals'] as $total) {
            $out[$total['currency']] = (float) $total['monthly'];
        }

        return $out;
    }

    public function test_the_page_sends_exactly_the_fields_the_screen_reads(): void
    {
        $this->onPlan($this->community());

        $page = TenantBillingService::getRevenueDashboard();

        $this->assertSame([
            'communities', 'with_plan', 'without_plan', 'paying_platform', 'paying_parent',
            'not_billed', 'paused', 'over_limit', 'active_members', 'totals', 'plan_breakdown', 'recent_changes',
        ], array_keys($page));
        $this->assertNotEmpty($page['totals']);
        $this->assertSame(['currency', 'monthly', 'yearly', 'communities'], array_keys($page['totals'][0]));
        $this->assertSame(
            ['plan', 'communities', 'paying_platform', 'monthly_eur', 'monthly_gbp'],
            array_keys($page['plan_breakdown'][0])
        );
    }

    public function test_only_what_the_platform_itself_is_paid_is_counted_each_in_its_own_currency(): void
    {
        $before = TenantBillingService::getRevenueDashboard();

        // Pays the platform in euro, monthly: 100.
        $euro = $this->community();
        $this->onPlan($euro);

        // Pays the platform in pounds, yearly: 960 a year is 80 a month.
        $pound = $this->community(1, '/1/', 'gbp');
        $this->onPlan($pound, ['billing_interval' => 'yearly']);

        // Half price by agreement, euro, monthly: 50.
        $discounted = $this->community();
        $this->onPlan($discounted, ['discount_percentage' => 50]);

        // Pays its hub: the hub's income, not the platform's.
        $hub = $this->community(1, '/1/', null, true);
        $child = $this->community($hub, "/1/{$hub}/");
        $this->onPlan($child);

        // Exempt: on a plan, owes nothing.
        $exempt = $this->community();
        $this->onPlan($exempt);
        $this->standing($exempt, ['exempt' => 1, 'exempt_reason' => 'Test']);

        // Paused: on a plan, not paying.
        $paused = $this->community();
        $this->onPlan($paused);
        $this->standing($paused, ['suspended_at' => now(), 'suspension_source' => 'manual']);

        BillingLock::flush();
        $after = TenantBillingService::getRevenueDashboard();

        $this->assertEqualsWithDelta(150.0, $this->monthly($after)['eur'] - $this->monthly($before)['eur'], 0.001);
        $this->assertEqualsWithDelta(80.0, $this->monthly($after)['gbp'] - $this->monthly($before)['gbp'], 0.001);

        $this->assertSame(7, $after['communities'] - $before['communities']);
        $this->assertSame(6, $after['with_plan'] - $before['with_plan']);
        $this->assertSame(1, $after['without_plan'] - $before['without_plan'], 'the hub has no plan');
        $this->assertSame(1, $after['paying_parent'] - $before['paying_parent']);
        $this->assertSame(1, $after['not_billed'] - $before['not_billed']);
        $this->assertSame(1, $after['paused'] - $before['paused']);

        $row = collect($after['plan_breakdown'])->firstWhere('plan', DB::table('pay_plans')->where('id', $this->plan)->value('name'));
        $this->assertSame(6, $row['communities']);
        $this->assertSame(3, $row['paying_platform'], 'the paused, exempt and hub-paid ones bring the platform nothing');
        $this->assertEqualsWithDelta(150.0, $row['monthly_eur'], 0.001);
        $this->assertEqualsWithDelta(80.0, $row['monthly_gbp'], 0.001);

        foreach ($after['totals'] as $total) {
            $this->assertEqualsWithDelta($total['monthly'] * 12, $total['yearly'], 0.01);
        }
    }

    public function test_over_the_limit_counts_members_who_signed_in_not_every_account(): void
    {
        $before = TenantBillingService::getRevenueDashboard()['over_limit'];

        // Three accounts on a plan for two, but only one has signed in lately.
        $quiet = $this->community();
        $this->onPlan($quiet);
        User::factory()->forTenant($quiet)->count(2)->create(['status' => 'active', 'last_login_at' => now()->subDays(200)]);
        User::factory()->forTenant($quiet)->create(['status' => 'active', 'last_login_at' => now()->subDay()]);

        // Three who signed in this week: over.
        $busy = $this->community();
        $this->onPlan($busy);
        User::factory()->forTenant($busy)->count(3)->create(['status' => 'active', 'last_login_at' => now()->subDay()]);

        $this->assertSame(1, TenantBillingService::getRevenueDashboard()['over_limit'] - $before);
    }
}
