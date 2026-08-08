<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Unit\Services;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\CaringCommunityMemberStatementService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\Laravel\TestCase;

class CaringCommunityMemberStatementServiceTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();
        TenantContext::setById($this->testTenantId);
    }

    private function service(): CaringCommunityMemberStatementService
    {
        return app(CaringCommunityMemberStatementService::class);
    }

    public function test_statement_returns_null_for_unknown_user(): void
    {
        $this->assertNull($this->service()->statement($this->testTenantId, 999999));
    }

    public function test_statement_returns_null_for_user_from_different_tenant(): void
    {
        $otherUser = User::factory()->forTenant(999)->create();

        $this->assertNull($this->service()->statement($this->testTenantId, $otherUser->id));
    }

    public function test_statement_includes_user_period_policy_and_empty_summary_for_fresh_member(): void
    {
        $user = User::factory()->forTenant($this->testTenantId)->create(['balance' => 12]);

        $result = $this->service()->statement($this->testTenantId, $user->id, [
            'start_date' => '2026-01-01',
            'end_date' => '2026-01-31',
        ]);

        $this->assertNotNull($result);
        $this->assertSame($user->id, $result['user']['id']);
        $this->assertSame(12.0, $result['user']['current_balance']);
        $this->assertSame('2026-01-01', $result['period']['start']);
        $this->assertSame('2026-01-31', $result['period']['end']);
        $this->assertArrayHasKey('monthly_statement_day', $result['policy']);
        $this->assertSame(0.0, $result['summary']['approved_support_hours']);
        $this->assertSame(0.0, $result['summary']['pending_support_hours']);
        $this->assertSame(0, $result['summary']['declined_support_logs']);
        $this->assertSame(0.0, $result['summary']['wallet_hours_earned']);
        $this->assertSame(0.0, $result['summary']['wallet_hours_spent']);
        $this->assertSame([], $result['support_logs']);
        $this->assertSame([], $result['wallet_transactions']);
    }

    public function test_summary_correctly_aggregates_approved_and_pending_hours(): void
    {
        $user = User::factory()->forTenant($this->testTenantId)->create(['balance' => 0]);

        DB::table('vol_logs')->insert([
            ['tenant_id' => $this->testTenantId, 'user_id' => $user->id, 'date_logged' => '2026-03-10', 'hours' => 3.0, 'status' => 'approved', 'description' => 'Supported neighbour', 'created_at' => now()],
            ['tenant_id' => $this->testTenantId, 'user_id' => $user->id, 'date_logged' => '2026-03-15', 'hours' => 1.5, 'status' => 'approved', 'description' => 'Dropped off shopping', 'created_at' => now()],
            ['tenant_id' => $this->testTenantId, 'user_id' => $user->id, 'date_logged' => '2026-03-20', 'hours' => 2.0, 'status' => 'pending', 'description' => 'Waiting review', 'created_at' => now()],
            ['tenant_id' => $this->testTenantId, 'user_id' => $user->id, 'date_logged' => '2026-03-22', 'hours' => 1.0, 'status' => 'declined', 'description' => 'Rejected', 'created_at' => now()],
        ]);

        $result = $this->service()->statement($this->testTenantId, $user->id, [
            'start_date' => '2026-03-01',
            'end_date' => '2026-03-31',
        ]);

        $this->assertSame(4.5, $result['summary']['approved_support_hours']);
        $this->assertSame(2.0, $result['summary']['pending_support_hours']);
        $this->assertSame(1, $result['summary']['declined_support_logs']);
        $this->assertCount(4, $result['support_logs']);
    }

    public function test_social_value_estimate_is_hours_times_chf_rate(): void
    {
        $user = User::factory()->forTenant($this->testTenantId)->create(['balance' => 0]);

        // Wipe workflow policy settings so the default CHF rate (35) is used.
        DB::table('tenant_settings')
            ->where('tenant_id', $this->testTenantId)
            ->where('setting_key', 'like', 'caring_community.workflow.%')
            ->delete();

        DB::table('vol_logs')->insert([
            'tenant_id' => $this->testTenantId,
            'user_id' => $user->id,
            'date_logged' => '2026-03-10',
            'hours' => 4.0,
            'status' => 'approved',
            'description' => 'Helped with transport',
            'created_at' => now(),
        ]);

        $result = $this->service()->statement($this->testTenantId, $user->id, [
            'start_date' => '2026-03-01',
            'end_date' => '2026-03-31',
        ]);

        $this->assertSame(140.0, $result['summary']['estimated_social_value_chf']); // 4 × 35
    }

    public function test_wallet_transactions_split_into_earned_and_spent(): void
    {
        $user = User::factory()->forTenant($this->testTenantId)->create(['balance' => 0]);
        $other = User::factory()->forTenant($this->testTenantId)->create(['balance' => 0]);

        DB::table('transactions')->insert([
            [
                'tenant_id' => $this->testTenantId,
                'sender_id' => $other->id,
                'receiver_id' => $user->id,
                'amount' => 3,
                'description' => 'Earned payment',
                'status' => 'completed',
                'transaction_type' => 'volunteer',
                'created_at' => '2026-03-10 10:00:00',
                'updated_at' => '2026-03-10 10:00:00',
            ],
            [
                'tenant_id' => $this->testTenantId,
                'sender_id' => $user->id,
                'receiver_id' => $other->id,
                'amount' => 1,
                'description' => 'Spent on service',
                'status' => 'completed',
                'transaction_type' => 'exchange',
                'created_at' => '2026-03-15 10:00:00',
                'updated_at' => '2026-03-15 10:00:00',
            ],
        ]);

        $result = $this->service()->statement($this->testTenantId, $user->id, [
            'start_date' => '2026-03-01',
            'end_date' => '2026-03-31',
        ]);

        $this->assertSame(3.0, $result['summary']['wallet_hours_earned']);
        $this->assertSame(1.0, $result['summary']['wallet_hours_spent']);
        $this->assertSame(2.0, $result['summary']['wallet_net_change']);

        $earned = collect($result['wallet_transactions'])->firstWhere('direction', 'earned');
        $spent = collect($result['wallet_transactions'])->firstWhere('direction', 'spent');
        $this->assertSame(3.0, $earned['signed_amount']);
        $this->assertSame(-1.0, $spent['signed_amount']);
    }

    public function test_period_swaps_start_end_when_inverted(): void
    {
        $user = User::factory()->forTenant($this->testTenantId)->create(['balance' => 0]);

        $result = $this->service()->statement($this->testTenantId, $user->id, [
            'start_date' => '2026-03-31',
            'end_date' => '2026-03-01',
        ]);

        $this->assertSame('2026-03-01', $result['period']['start']);
        $this->assertSame('2026-03-31', $result['period']['end']);
    }

    public function test_support_logs_outside_period_are_excluded(): void
    {
        $user = User::factory()->forTenant($this->testTenantId)->create(['balance' => 0]);

        DB::table('vol_logs')->insert([
            ['tenant_id' => $this->testTenantId, 'user_id' => $user->id, 'date_logged' => '2026-02-15', 'hours' => 5.0, 'status' => 'approved', 'description' => 'Before period', 'created_at' => now()],
            ['tenant_id' => $this->testTenantId, 'user_id' => $user->id, 'date_logged' => '2026-03-15', 'hours' => 2.0, 'status' => 'approved', 'description' => 'Inside period', 'created_at' => now()],
        ]);

        $result = $this->service()->statement($this->testTenantId, $user->id, [
            'start_date' => '2026-03-01',
            'end_date' => '2026-03-31',
        ]);

        $this->assertCount(1, $result['support_logs']);
        $this->assertSame(2.0, $result['summary']['approved_support_hours']);
    }

    public function test_csv_produces_header_row_and_one_row_per_activity(): void
    {
        $user = User::factory()->forTenant($this->testTenantId)->create(['balance' => 0]);

        DB::table('vol_logs')->insert([
            'tenant_id' => $this->testTenantId,
            'user_id' => $user->id,
            'date_logged' => '2026-03-10',
            'hours' => 1.5,
            'status' => 'approved',
            'description' => 'Test',
            'created_at' => now(),
        ]);

        $csv = $this->service()->csv($this->testTenantId, $user->id, [
            'start_date' => '2026-03-01',
            'end_date' => '2026-03-31',
        ]);

        $this->assertNotNull($csv);
        $this->assertStringContainsString('caring-community-statement-', $csv['filename']);
        $lines = array_filter(explode("\n", trim($csv['csv'])));
        // header + 1 log row
        $this->assertGreaterThanOrEqual(2, count($lines));
    }

    public function test_support_hours_grouped_by_organisation(): void
    {
        if (!Schema::hasTable('vol_logs') || !Schema::hasTable('vol_organizations')) {
            $this->markTestSkipped('Required tables not present.');
        }
        $user = User::factory()->forTenant($this->testTenantId)->create(['balance' => 0]);
        $orgOwner = User::factory()->forTenant($this->testTenantId)->create();
        $orgId = DB::table('vol_organizations')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $orgOwner->id,
            'name' => 'Red Cross Test',
            'slug' => 'red-cross-' . uniqid(),
            'status' => 'active',
            'balance' => 0,
            'created_at' => now(),
        ]);

        DB::table('vol_logs')->insert([
            ['tenant_id' => $this->testTenantId, 'user_id' => $user->id, 'organization_id' => $orgId, 'date_logged' => '2026-03-10', 'hours' => 2.0, 'status' => 'approved', 'description' => 'Visit 1', 'created_at' => now()],
            ['tenant_id' => $this->testTenantId, 'user_id' => $user->id, 'organization_id' => $orgId, 'date_logged' => '2026-03-15', 'hours' => 1.5, 'status' => 'approved', 'description' => 'Visit 2', 'created_at' => now()],
        ]);

        $result = $this->service()->statement($this->testTenantId, $user->id, [
            'start_date' => '2026-03-01',
            'end_date' => '2026-03-31',
        ]);

        $byOrg = $result['support_hours_by_organisation'];
        $this->assertCount(1, $byOrg);
        $this->assertSame('Red Cross Test', $byOrg[0]['organisation_name']);
        $this->assertSame(3.5, $byOrg[0]['approved_hours']);
        $this->assertSame(2, $byOrg[0]['log_count']);
    }
}
