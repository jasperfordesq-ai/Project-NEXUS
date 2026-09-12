<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Controllers;

use Tests\Laravel\TestCase;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use App\Models\User;
use App\Services\VolunteerCheckInService;

/**
 * Feature tests for VolunteerCheckInController — shift check-in/out.
 */
class VolunteerCheckInControllerTest extends TestCase
{
    use DatabaseTransactions;

    private function authenticatedUser(): User
    {
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);

        Sanctum::actingAs($user, ['*']);

        return $user;
    }

    public function test_get_check_in_requires_auth(): void
    {
        $response = $this->apiGet('/v2/volunteering/shifts/1/checkin');

        $response->assertStatus(401);
    }

    public function test_shift_check_ins_requires_auth(): void
    {
        $response = $this->apiGet('/v2/volunteering/shifts/1/checkins');

        $response->assertStatus(401);
    }

    public function test_get_check_in_authenticated_smoke(): void
    {
        $this->authenticatedUser();

        $response = $this->apiGet('/v2/volunteering/shifts/1/checkin');

        $this->assertLessThan(500, $response->status());
    }

    public function test_shift_check_ins_authenticated_smoke(): void
    {
        $this->authenticatedUser();

        $response = $this->apiGet('/v2/volunteering/shifts/1/checkins');

        $this->assertLessThan(500, $response->status());
    }

    public function test_active_org_admin_can_verify_shift_checkin(): void
    {
        $owner = User::factory()->forTenant($this->testTenantId)->create();
        $admin = User::factory()->forTenant($this->testTenantId)->create();
        $volunteer = User::factory()->forTenant($this->testTenantId)->create();

        $orgId = (int) DB::table('vol_organizations')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $owner->id,
            'name' => 'Check-in Org',
            'slug' => 'check-in-org-' . uniqid(),
            'description' => 'Organisation for check-in verification tests.',
            'status' => 'active',
            'created_at' => now(),
        ]);

        DB::table('org_members')->insert([
            'tenant_id' => $this->testTenantId,
            'organization_id' => $orgId,
            'org_type' => 'volunteer',
            'user_id' => $admin->id,
            'role' => 'admin',
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $opportunityId = (int) DB::table('vol_opportunities')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'organization_id' => $orgId,
            'title' => 'Check-in Opportunity',
            'description' => 'A test opportunity with a shift.',
            'status' => 'active',
            'is_active' => 1,
            'created_at' => now(),
        ]);

        $shiftId = (int) DB::table('vol_shifts')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'opportunity_id' => $opportunityId,
            'start_time' => now()->subMinutes(5),
            'end_time' => now()->addHour(),
            'capacity' => 5,
            'created_at' => now(),
        ]);

        DB::table('vol_applications')->insert([
            'tenant_id' => $this->testTenantId,
            'opportunity_id' => $opportunityId,
            'shift_id' => $shiftId,
            'user_id' => $volunteer->id,
            'status' => 'approved',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $token = VolunteerCheckInService::generateToken($shiftId, $volunteer->id);
        $this->assertNotNull($token);

        Sanctum::actingAs($admin, ['*']);

        $response = $this->apiPost('/v2/volunteering/checkin/verify/' . $token);

        $response->assertStatus(200);
        $this->assertSame('checked_in', DB::table('vol_shift_checkins')->where('qr_token', $token)->value('status'));
        $webhooks = \Mockery::mock(\App\Services\WebhookDispatchService::class);
        $webhooks->shouldReceive('dispatch')->once()->with('shift.completed', ['user_id' => $volunteer->id, 'shift_id' => $shiftId]);
        $this->app->instance(\App\Services\WebhookDispatchService::class, $webhooks);
        $this->apiPost('/v2/volunteering/checkin/checkout/' . $token)->assertOk();
        $checkedOutAt = DB::table('vol_shift_checkins')->where('qr_token', $token)->value('checked_out_at');
        $this->apiPost('/v2/volunteering/checkin/checkout/' . $token)->assertOk();
        $this->assertSame($checkedOutAt, DB::table('vol_shift_checkins')->where('qr_token', $token)->value('checked_out_at'));
    }

    /**
     * fix(volunteering): QR check-in tokens previously never expired, so a
     * leaked/stale token could still check a volunteer in weeks after the shift.
     * verifyCheckIn now rejects once now > end_time + 4h grace. Exercised at the
     * service level to avoid the org-admin authorization path (quarantined above).
     */
    private function seedApprovedCheckin(\Carbon\Carbon $start, ?\Carbon\Carbon $end): string
    {
        \App\Core\TenantContext::setById($this->testTenantId);

        $owner = User::factory()->forTenant($this->testTenantId)->create();
        $volunteer = User::factory()->forTenant($this->testTenantId)->create();

        $orgId = (int) DB::table('vol_organizations')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $owner->id,
            'name' => 'Window Org',
            'slug' => 'window-org-' . uniqid(),
            'description' => 'Org for check-in window tests.',
            'status' => 'active',
            'created_at' => now(),
        ]);

        $opportunityId = (int) DB::table('vol_opportunities')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'organization_id' => $orgId,
            'title' => 'Window Opportunity',
            'description' => 'A shift used to test the check-in window.',
            'status' => 'active',
            'is_active' => 1,
            'created_at' => now(),
        ]);

        $shiftId = (int) DB::table('vol_shifts')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'opportunity_id' => $opportunityId,
            'start_time' => $start,
            'end_time' => $end,
            'capacity' => 5,
            'created_at' => now(),
        ]);

        DB::table('vol_applications')->insert([
            'tenant_id' => $this->testTenantId,
            'opportunity_id' => $opportunityId,
            'shift_id' => $shiftId,
            'user_id' => $volunteer->id,
            'status' => 'approved',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        // Re-assert tenant context immediately before the service call. Creating
        // the fixture users above (User::factory()->forTenant()) re-resolves
        // TenantContext to the default tenant, so generateToken() — and the
        // verifyCheckIn() the caller runs next — would otherwise scope
        // VolApplication to tenant 1 and never see the approved row seeded here.
        \App\Core\TenantContext::setById($this->testTenantId);

        $token = VolunteerCheckInService::generateToken($shiftId, $volunteer->id);
        $this->assertNotNull($token);

        return (string) $token;
    }

    public function test_verify_checkin_rejects_stale_token_after_window_closed(): void
    {
        // Shift ended 5h ago — beyond the 4h grace window.
        $token = $this->seedApprovedCheckin(now()->subHours(6), now()->subHours(5));

        $service = new VolunteerCheckInService();
        $result = $service->verifyCheckIn($token);

        $this->assertNull($result);
        $this->assertNotEmpty($service->getErrors());
        $this->assertSame('VALIDATION_ERROR', $service->getErrors()[0]['code']);
    }

    public function test_verify_checkin_allowed_within_grace_window(): void
    {
        // Shift ended 1h ago — still inside the 4h grace window.
        $token = $this->seedApprovedCheckin(now()->subHours(2), now()->subHour());

        $service = new VolunteerCheckInService();
        $result = $service->verifyCheckIn($token);

        $this->assertNotNull($result);
        $this->assertSame('checked_in', $result['status']);
    }
}
