<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Controllers;

use App\Core\TenantContext;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * Feature tests for AdminVolunteerController.
 *
 * Covers index, opportunities, applications, approvals, organizations,
 * approveApplication, declineApplication, verifyHours.
 * The controller checks TenantContext::hasFeature('volunteering') and
 * gracefully returns empty data if volunteer tables don't exist.
 */
class AdminVolunteerControllerTest extends TestCase
{
    use DatabaseTransactions;

    // ================================================================
    // INDEX — GET /v2/admin/volunteering
    // ================================================================

    public function test_index_returns_200_for_admin(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiGet('/v2/admin/volunteering');

        // 200 if feature enabled, 403 if feature disabled
        $this->assertTrue(in_array($response->status(), [200, 403]));
    }

    /**
     * The Overview's "Needs your attention" row (2026-10-18) reads the same
     * queue counts the sidebar badges use, so the two can never disagree.
     */
    public function test_index_reports_the_queues_waiting_for_an_admin(): void
    {
        DB::table('tenants')->where('id', $this->testTenantId)->update(['features' => json_encode(['volunteering' => true])]);
        \App\Core\TenantContext::setById($this->testTenantId);
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);
        $volunteer = User::factory()->forTenant($this->testTenantId)->create();
        $oppId = (int) DB::table('vol_opportunities')->insertGetId([
            'tenant_id' => $this->testTenantId, 'title' => 'Attention opp', 'description' => 'x', 'is_active' => 1, 'created_at' => now(),
        ]);
        DB::table('vol_applications')->insert([
            'tenant_id' => $this->testTenantId, 'opportunity_id' => $oppId, 'user_id' => $volunteer->id, 'status' => 'pending', 'created_at' => now(),
        ]);
        DB::table('vol_expenses')->insert([
            'tenant_id' => $this->testTenantId, 'user_id' => $volunteer->id, 'expense_type' => 'travel', 'amount' => 5,
            'status' => 'pending',
        ]);

        $attention = $this->apiGet('/v2/admin/volunteering')->assertOk()->json('data.stats.attention');

        $this->assertSame(1, $attention['pending_vol_applications']);
        $this->assertSame(1, $attention['pending_vol_expenses']);
        foreach (['pending_vol_hours', 'pending_vol_projects', 'pending_vol_swaps', 'pending_organisations'] as $key) {
            $this->assertArrayHasKey($key, $attention);
        }
    }

    public function test_index_returns_403_for_regular_member(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($member);

        $response = $this->apiGet('/v2/admin/volunteering');

        $response->assertStatus(403);
    }

    public function test_index_returns_401_for_unauthenticated(): void
    {
        $response = $this->apiGet('/v2/admin/volunteering');

        $response->assertStatus(401);
    }

    // ================================================================
    // APPROVALS — GET /v2/admin/volunteering/approvals
    // ================================================================

    public function test_approvals_returns_200_or_403_for_admin(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiGet('/v2/admin/volunteering/approvals');

        // 200 if feature enabled, 403 if feature disabled
        $this->assertTrue(in_array($response->status(), [200, 403]));
    }

    public function test_approvals_returns_403_for_regular_member(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($member);

        $response = $this->apiGet('/v2/admin/volunteering/approvals');

        $response->assertStatus(403);
    }

    // ================================================================
    // ORGANIZATIONS — GET /v2/admin/volunteering/organizations
    // ================================================================

    public function test_organizations_returns_200_or_403_for_admin(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiGet('/v2/admin/volunteering/organizations');

        // 200 if feature enabled, 403 if feature disabled
        $this->assertTrue(in_array($response->status(), [200, 403]));
    }

    public function test_organizations_returns_403_for_regular_member(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($member);

        $response = $this->apiGet('/v2/admin/volunteering/organizations');

        $response->assertStatus(403);
    }

    // ================================================================
    // APPROVE APPLICATION — POST /v2/admin/volunteering/approvals/{id}/approve
    // ================================================================

    public function test_approve_application_returns_403_for_regular_member(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($member);

        $response = $this->apiPost('/v2/admin/volunteering/approvals/1/approve');

        $response->assertStatus(403);
    }

    public function test_approve_application_returns_401_for_unauthenticated(): void
    {
        $response = $this->apiPost('/v2/admin/volunteering/approvals/1/approve');

        $response->assertStatus(401);
    }

    // ================================================================
    // DECLINE APPLICATION — POST /v2/admin/volunteering/approvals/{id}/decline
    // ================================================================

    public function test_decline_application_returns_403_for_regular_member(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($member);

        $response = $this->apiPost('/v2/admin/volunteering/approvals/1/decline');

        $response->assertStatus(403);
    }

    // ================================================================
    // VERIFY HOURS — POST /v2/admin/volunteering/hours/{id}/verify
    // Auto-mint on approval + concurrent/retry double-approve idempotency.
    // ================================================================

    public function test_verify_hours_approve_mints_once_and_second_approve_is_idempotent(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create(['balance' => 0]);
        $volunteer = User::factory()->forTenant($this->testTenantId)->create(['balance' => 0]);

        TenantContext::setById($this->testTenantId);

        $orgId = DB::table('vol_organizations')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $admin->id,
            'name' => 'Idempotency Org',
            'slug' => 'idempotency-org-' . uniqid(),
            'description' => 'Organisation used for verify-hours idempotency coverage.',
            'contact_email' => 'idem@example.test',
            'status' => 'active',
            'auto_pay_enabled' => 0,
            'balance' => 10.00,
            'created_at' => now(),
        ]);

        $logId = DB::table('vol_logs')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $volunteer->id,
            'organization_id' => $orgId,
            'opportunity_id' => null,
            'date_logged' => now()->subDay()->toDateString(),
            'hours' => 2.00,
            'description' => 'Idempotency shift',
            'status' => 'pending',
            'created_at' => now(),
        ]);

        Sanctum::actingAs($admin);

        // First approval mints 1 credit per whole hour to the volunteer.
        $first = $this->apiPost("/v2/admin/volunteering/hours/{$logId}/verify", ['action' => 'approve']);
        $first->assertStatus(200);

        $this->assertSame('approved', DB::table('vol_logs')->where('id', $logId)->value('status'));
        $this->assertEquals(2, (int) DB::table('users')->where('id', $volunteer->id)->value('balance'));
        $this->assertEquals(8.00, (float) DB::table('vol_organizations')->where('id', $orgId)->value('balance'));
        $this->assertSame(1, DB::table('vol_org_transactions')->where('vol_log_id', $logId)->where('type', 'volunteer_payment')->count());

        // A second approval (a retry, or the loser of a concurrent race) must NOT
        // double-mint. The status guard on the UPDATE returns the same 422 the
        // pre-check returns and leaves all balances untouched.
        $second = $this->apiPost("/v2/admin/volunteering/hours/{$logId}/verify", ['action' => 'approve']);
        $second->assertStatus(422);

        $this->assertEquals(2, (int) DB::table('users')->where('id', $volunteer->id)->value('balance'));
        $this->assertEquals(8.00, (float) DB::table('vol_organizations')->where('id', $orgId)->value('balance'));
        $this->assertSame(1, DB::table('vol_org_transactions')->where('vol_log_id', $logId)->where('type', 'volunteer_payment')->count());
    }

    public function test_verify_hours_blocks_admin_self_approval(): void
    {
        // Separation of duties: an admin must not be able to approve THEIR OWN
        // volunteer hours and mint themselves time credits. Mirrors the guard in
        // VolunteerService::verifyHours() for org owners/admins.
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create(['balance' => 0]);
        $owner = User::factory()->forTenant($this->testTenantId)->create(['balance' => 0]);

        TenantContext::setById($this->testTenantId);

        $orgId = DB::table('vol_organizations')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $owner->id,
            'name' => 'Self Approval Org',
            'slug' => 'self-approval-org-' . uniqid(),
            'description' => 'Organisation used for admin self-approval guard coverage.',
            'contact_email' => 'self-approval@example.test',
            'status' => 'active',
            'auto_pay_enabled' => 0,
            'balance' => 10.00,
            'created_at' => now(),
        ]);

        // The pending log belongs to the ADMIN themselves.
        $logId = DB::table('vol_logs')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $admin->id,
            'organization_id' => $orgId,
            'opportunity_id' => null,
            'date_logged' => now()->subDay()->toDateString(),
            'hours' => 5.00,
            'description' => 'Self-logged shift',
            'status' => 'pending',
            'created_at' => now(),
        ]);

        Sanctum::actingAs($admin);

        $response = $this->apiPost("/v2/admin/volunteering/hours/{$logId}/verify", ['action' => 'approve']);
        $response->assertStatus(403);
        $response->assertJsonPath('errors.0.code', 'FORBIDDEN');

        // Nothing mutated: log still pending, no credits minted, wallet untouched.
        $this->assertSame('pending', DB::table('vol_logs')->where('id', $logId)->value('status'));
        $this->assertEquals(0, (int) DB::table('users')->where('id', $admin->id)->value('balance'));
        $this->assertEquals(10.00, (float) DB::table('vol_organizations')->where('id', $orgId)->value('balance'));
        $this->assertSame(0, DB::table('vol_org_transactions')->where('vol_log_id', $logId)->count());

        // Declining your own hours is blocked the same way.
        $decline = $this->apiPost("/v2/admin/volunteering/hours/{$logId}/verify", ['action' => 'decline']);
        $decline->assertStatus(403);
        $this->assertSame('pending', DB::table('vol_logs')->where('id', $logId)->value('status'));
    }

    public function test_list_hours_includes_payment_reconciliation(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create(['balance' => 0]);
        $volunteer = User::factory()->forTenant($this->testTenantId)->create(['balance' => 3]);

        TenantContext::setById($this->testTenantId);

        $orgId = DB::table('vol_organizations')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $admin->id,
            'name' => 'Paid Hours Audit Org',
            'slug' => 'paid-hours-audit-org-' . uniqid(),
            'description' => 'Organisation used for admin hours payment audit coverage.',
            'contact_email' => 'paid-hours@example.test',
            'status' => 'active',
            'auto_pay_enabled' => 0,
            'balance' => -3.00,
            'created_at' => now(),
        ]);

        $logId = DB::table('vol_logs')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $volunteer->id,
            'organization_id' => $orgId,
            'opportunity_id' => null,
            'date_logged' => now()->subDay()->toDateString(),
            'hours' => 3.00,
            'description' => 'Approved paid shift',
            'status' => 'approved',
            'created_at' => now(),
        ]);

        DB::table('vol_org_transactions')->insert([
            'tenant_id' => $this->testTenantId,
            'vol_organization_id' => $orgId,
            'user_id' => $volunteer->id,
            'vol_log_id' => $logId,
            'type' => 'volunteer_payment',
            'amount' => -3.00,
            'balance_after' => -3.00,
            'description' => 'Volunteer payment for approved hours',
            'created_at' => now(),
        ]);

        Sanctum::actingAs($admin);

        $response = $this->apiGet('/v2/admin/volunteering/hours?status=approved');

        $response->assertStatus(200);
        $item = $response->json('data.items.0');
        $this->assertSame($logId, (int) ($item['id'] ?? 0));
        $this->assertSame(1, (int) ($item['paid'] ?? 0));
        $this->assertEquals(3.00, (float) $response->json('data.items.0.paid_amount'));
        $this->assertEquals(3.00, (float) $response->json('data.stats.total_paid'));
    }

    public function test_approve_application_counts_group_reservations_against_capacity(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $volunteer = User::factory()->forTenant($this->testTenantId)->create();
        TenantContext::setById($this->testTenantId);

        $orgId = DB::table('vol_organizations')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $admin->id,
            'name' => 'Overbook Guard Org',
            'slug' => 'overbook-guard-org-' . uniqid(),
            'description' => 'Organisation used for admin overbooking coverage.',
            'status' => 'active',
            'created_at' => now(),
        ]);
        $oppId = DB::table('vol_opportunities')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'organization_id' => $orgId,
            'created_by' => $admin->id,
            'title' => 'Overbook Guard Opportunity',
            'description' => 'x',
            'status' => 'active',
            'is_active' => 1,
            'created_at' => now(),
        ]);
        // Capacity 2, already fully consumed: 1 approved application + a group
        // reservation holding the other slot.
        $shiftId = DB::table('vol_shifts')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'opportunity_id' => $oppId,
            'start_time' => now()->addDays(2)->format('Y-m-d H:i:s'),
            'end_time' => now()->addDays(2)->addHours(2)->format('Y-m-d H:i:s'),
            'capacity' => 2,
        ]);
        DB::table('vol_applications')->insert([
            'tenant_id' => $this->testTenantId,
            'opportunity_id' => $oppId,
            'user_id' => $admin->id,
            'shift_id' => $shiftId,
            'status' => 'approved',
            'created_at' => now(),
        ]);
        DB::table('vol_shift_group_reservations')->insert([
            'tenant_id' => $this->testTenantId,
            'shift_id' => $shiftId,
            'group_id' => 1,
            'reserved_by' => $admin->id,
            'reserved_slots' => 1,
            'filled_slots' => 0,
            'status' => 'active',
            'created_at' => now(),
        ]);
        // The pending application the admin will try to approve.
        $pendingAppId = DB::table('vol_applications')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'opportunity_id' => $oppId,
            'user_id' => $volunteer->id,
            'shift_id' => $shiftId,
            'status' => 'pending',
            'created_at' => now(),
        ]);

        Sanctum::actingAs($admin);
        $response = $this->apiPost("/v2/admin/volunteering/approvals/{$pendingAppId}/approve");

        // 1 approved + 1 reserved == capacity 2 → must be rejected, not approved.
        $response->assertStatus(422);
        $this->assertSame('pending', DB::table('vol_applications')->where('id', $pendingAppId)->value('status'));
    }

    // ================================================================
    // ADJUST ORG WALLET — PUT /v2/admin/volunteering/organizations/{id}/wallet/adjust
    // Money-moving admin endpoint: authorization + conservation + guards.
    // ================================================================

    private function createAdjustableOrg(int $ownerId, float $balance): int
    {
        return (int) DB::table('vol_organizations')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $ownerId,
            'name' => 'Adjust Org',
            'slug' => 'adjust-org-' . uniqid(),
            'description' => 'Organisation used for admin wallet-adjust coverage.',
            'status' => 'active',
            'auto_pay_enabled' => 0,
            'balance' => $balance,
            'created_at' => now(),
        ]);
    }

    public function test_admin_adjust_org_wallet_topup_increases_balance(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);
        TenantContext::setById($this->testTenantId);
        $orgId = $this->createAdjustableOrg($admin->id, 5.00);

        $response = $this->apiPut("/v2/admin/volunteering/organizations/{$orgId}/wallet/adjust", [
            'amount' => 10,
            'reason' => 'Grant top-up',
        ]);

        $response->assertStatus(200);
        $this->assertEquals(15.00, (float) DB::table('vol_organizations')->where('id', $orgId)->value('balance'));
        $this->assertSame(1, DB::table('vol_org_transactions')
            ->where('vol_organization_id', $orgId)->where('type', 'admin_adjustment')->count());
    }

    public function test_admin_adjust_org_wallet_forbidden_for_regular_member(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($member);
        TenantContext::setById($this->testTenantId);
        $orgId = $this->createAdjustableOrg($member->id, 5.00);

        $response = $this->apiPut("/v2/admin/volunteering/organizations/{$orgId}/wallet/adjust", [
            'amount' => 10,
            'reason' => 'Should be blocked',
        ]);

        $response->assertStatus(403);
        $this->assertEquals(5.00, (float) DB::table('vol_organizations')->where('id', $orgId)->value('balance'));
    }

    public function test_admin_adjust_org_wallet_rejects_zero_amount(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);
        TenantContext::setById($this->testTenantId);
        $orgId = $this->createAdjustableOrg($admin->id, 5.00);

        $response = $this->apiPut("/v2/admin/volunteering/organizations/{$orgId}/wallet/adjust", [
            'amount' => 0,
            'reason' => 'No-op',
        ]);

        $response->assertStatus(400);
    }

    public function test_admin_adjust_org_wallet_blocks_negative_result(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);
        TenantContext::setById($this->testTenantId);
        $orgId = $this->createAdjustableOrg($admin->id, 5.00);

        // Deducting more than the balance would drive the wallet negative — the
        // admin-adjustment path (unlike the auto-mint path) blocks that.
        $response = $this->apiPut("/v2/admin/volunteering/organizations/{$orgId}/wallet/adjust", [
            'amount' => -10,
            'reason' => 'Over-deduct',
        ]);

        $response->assertStatus(400);
        $this->assertEquals(5.00, (float) DB::table('vol_organizations')->where('id', $orgId)->value('balance'));
    }
}
