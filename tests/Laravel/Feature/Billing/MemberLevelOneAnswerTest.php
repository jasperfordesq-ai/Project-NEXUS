<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Billing;

use App\Services\BillingAutomationService;
use App\Services\TenantBillingService;
use App\Support\Billing\BillingLock;
use App\Support\Billing\BillingSettings;
use App\Support\Billing\BranchPayments;
use App\Support\Billing\MemberLevel;
use App\Support\Billing\PlanTerms;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * "Near its member limit" has one answer (Stage 5 of the billing ease-of-use
 * plan, 23 November 2026).
 *
 * Each screen worked it out for itself. Billing control read the platform's
 * warning percent; Branch payments had 80 written into it. With the setting
 * at anything but 80 the two lists coloured the same community differently,
 * and neither was sure to agree with the daily check that sends the warning.
 * Branch payments also counted a community exactly AT its number as "over
 * their plan".
 *
 * The server now says it once (MemberLevel), from the one setting, and both
 * lists and the daily check read that.
 */
final class MemberLevelOneAnswerTest extends TestCase
{
    use DatabaseTransactions;

    private int $community;
    private int $plan;

    protected function setUp(): void
    {
        parent::setUp();
        BillingLock::flush();
        BillingSettings::flush();
        PlanTerms::flush();

        $this->community = (int) DB::table('tenants')->insertGetId([
            'name' => 'Level ' . bin2hex(random_bytes(3)), 'slug' => 'level-' . bin2hex(random_bytes(5)),
            'is_active' => 1, 'parent_id' => 1, 'depth' => 1, 'created_at' => now(), 'updated_at' => now(),
        ]);
        DB::table('tenants')->where('id', $this->community)->update(['path' => "/1/{$this->community}/"]);

        $this->plan = (int) DB::table('pay_plans')->insertGetId([
            'name' => 'Ten members', 'slug' => 'ten-' . bin2hex(random_bytes(4)), 'tier_level' => 1,
            'max_users' => 10, 'price_monthly' => 10, 'price_yearly' => 100,
            'is_active' => 1, 'is_standard' => 1, 'created_at' => now(), 'updated_at' => now(),
        ]);
        DB::table('tenant_plan_assignments')->insert([
            'tenant_id' => $this->community, 'pay_plan_id' => $this->plan, 'status' => 'active',
            'starts_at' => now(), 'created_at' => now(), 'updated_at' => now(),
        ]);
        PlanTerms::flush();
    }

    protected function tearDown(): void
    {
        try {
            BillingLock::flush();
            BillingSettings::flush();
            PlanTerms::flush();
        } finally {
            parent::tearDown();
        }
    }

    private function addActiveMembers(int $count): void
    {
        for ($i = 0; $i < $count; $i++) {
            $uid = bin2hex(random_bytes(6));
            DB::table('users')->insert([
                'tenant_id' => $this->community, 'name' => 'Member ' . $uid, 'first_name' => 'Member', 'last_name' => 'Test',
                'email' => $uid . '@example.test', 'status' => 'active', 'role' => 'member', 'balance' => 0, 'is_approved' => 1,
                'last_login_at' => now()->subDay(), 'created_at' => now(), 'updated_at' => now(),
            ]);
        }
    }

    /** @return array<string, mixed> */
    private function controlRow(): array
    {
        foreach (TenantBillingService::getBillingSnapshot() as $row) {
            if ((int) $row['id'] === $this->community) {
                return $row;
            }
        }
        $this->fail('The community is not on Billing control.');
    }

    public function test_the_four_levels_are_the_daily_checks_own_stages(): void
    {
        $this->assertSame('ok', MemberLevel::of(79, 100, 80));
        $this->assertSame('near', MemberLevel::of(80, 100, 80));
        $this->assertSame('near', MemberLevel::of(99, 100, 80));
        $this->assertSame('full', MemberLevel::of(100, 100, 80), 'at its number is not over it');
        $this->assertSame('over', MemberLevel::of(101, 100, 80));

        $this->assertSame('ok', MemberLevel::of(500, null, 80), 'no limit: never near or over');
        $this->assertSame('ok', MemberLevel::of(500, 0, 80));
    }

    public function test_the_warning_percent_comes_from_the_one_setting(): void
    {
        BillingSettings::set('limit_warning_percent', 90, null);
        $this->assertSame('ok', MemberLevel::of(85, 100), '85% is not near when the platform warns from 90%');
        $this->assertSame('near', MemberLevel::of(90, 100));

        BillingSettings::set('limit_warning_percent', 70, null);
        $this->assertSame('near', MemberLevel::of(75, 100));
    }

    public function test_both_lists_and_the_daily_check_agree_when_the_setting_is_not_eighty(): void
    {
        BillingSettings::set('limit_warning_percent', 90, null);
        $this->addActiveMembers(8); // 80% of 10: near at the old written-in 80, not at 90

        $branch = BranchPayments::members($this->community, 10);
        $control = $this->controlRow();
        $check = BillingAutomationService::memberLimitState($this->community);

        $this->assertSame('ok', $branch['level'], 'Branch payments no longer has 80 written into it');
        $this->assertSame('ok', $control['members_level']);
        $this->assertNull($check['stage'] ?? null, 'and the daily check would not warn either');

        $this->addActiveMembers(1); // 90%
        $this->assertSame('near', BranchPayments::members($this->community, 10)['level']);
        $this->assertSame('near', $this->controlRow()['members_level']);
        $this->assertSame('approaching', BillingAutomationService::memberLimitState($this->community)['stage']);
    }

    public function test_a_community_at_its_number_is_full_and_not_over(): void
    {
        $this->addActiveMembers(10);

        $branch = BranchPayments::members($this->community, 10);
        $this->assertSame('full', $branch['level']);
        $this->assertFalse($branch['over'], 'ten of ten is not "over their plan"');
        $this->assertSame('full', $this->controlRow()['members_level']);
        $this->assertFalse($this->controlRow()['over_limit']);

        $this->addActiveMembers(1);
        $branch = BranchPayments::members($this->community, 10);
        $this->assertSame('over', $branch['level']);
        $this->assertTrue($branch['over']);
        $this->assertSame('over', $this->controlRow()['members_level']);
        $this->assertTrue($this->controlRow()['over_limit']);
    }
}
