<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Volunteering;

use App\Core\TenantContext;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * 8 Oct 2026: the admin Applications page offered nothing at all on an approved
 * row, so an admin had no way to take a volunteer off an opportunity. An admin
 * can now remove an approved volunteer; the volunteer is told, the removal is
 * recorded in the organisation's audit log, and the place they held is freed.
 */
class AdminVolunteerRemoveVolunteerTest extends TestCase
{
    use DatabaseTransactions;

    private int $orgId;
    private int $opportunityId;
    private User $volunteer;

    protected function setUp(): void
    {
        parent::setUp();
        DB::table('tenants')->where('id', $this->testTenantId)->update([
            'features' => json_encode(['volunteering' => true]),
        ]);
        TenantContext::setById($this->testTenantId);

        $owner = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);
        $this->orgId = (int) DB::table('vol_organizations')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $owner->id,
            'name' => 'Remove Test Org',
            'status' => 'active',
            'created_at' => now(),
        ]);
        $this->opportunityId = (int) DB::table('vol_opportunities')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'organization_id' => $this->orgId,
            'title' => 'Remove Test Garden',
            'description' => 'Test opportunity',
            'created_at' => now(),
        ]);
        $this->volunteer = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'preferred_language' => 'en',
        ]);
    }

    private function application(string $status, int $tenantId = 0, int $opportunityId = 0): int
    {
        return (int) DB::table('vol_applications')->insertGetId([
            'tenant_id' => $tenantId ?: $this->testTenantId,
            'opportunity_id' => $opportunityId ?: $this->opportunityId,
            'user_id' => $this->volunteer->id,
            'status' => $status,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function actAsAdmin(): User
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);
        return $admin;
    }

    public function test_an_admin_removes_an_approved_volunteer_and_it_is_recorded_and_told(): void
    {
        $admin = $this->actAsAdmin();
        $id = $this->application('approved');

        $this->apiPost("/v2/admin/volunteering/approvals/{$id}/remove", [])->assertOk();

        $this->assertDatabaseMissing('vol_applications', ['id' => $id]);
        $this->assertDatabaseHas('org_audit_log', [
            'tenant_id' => $this->testTenantId,
            'organization_id' => $this->orgId,
            'user_id' => $admin->id,
            'target_user_id' => $this->volunteer->id,
            'action' => 'volunteer_removed_from_opportunity',
        ]);
        $this->assertDatabaseHas('notifications', [
            'tenant_id' => $this->testTenantId,
            'user_id' => $this->volunteer->id,
            'message' => __('api_controllers_3.admin_bells.volunteer_removed', ['opportunity' => 'Remove Test Garden']),
        ]);
    }

    public function test_only_an_approved_volunteer_can_be_removed(): void
    {
        $this->actAsAdmin();
        foreach (['pending', 'declined'] as $status) {
            $id = $this->application($status);
            $this->apiPost("/v2/admin/volunteering/approvals/{$id}/remove", [])->assertStatus(422);
            $this->assertDatabaseHas('vol_applications', ['id' => $id, 'status' => $status]);
        }
    }

    public function test_another_communitys_application_cannot_be_removed(): void
    {
        $this->actAsAdmin();
        $otherOpportunity = (int) DB::table('vol_opportunities')->insertGetId([
            'tenant_id' => 999,
            'title' => 'Other community',
            'description' => 'Test opportunity',
            'created_at' => now(),
        ]);
        $id = $this->application('approved', 999, $otherOpportunity);

        $this->apiPost("/v2/admin/volunteering/approvals/{$id}/remove", [])->assertNotFound();
        $this->assertDatabaseHas('vol_applications', ['id' => $id, 'status' => 'approved']);
    }

    public function test_a_member_who_is_not_an_admin_is_refused(): void
    {
        Sanctum::actingAs(User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']));
        $id = $this->application('approved');

        $this->assertContains(
            $this->apiPost("/v2/admin/volunteering/approvals/{$id}/remove", [])->status(),
            [401, 403]
        );
        $this->assertDatabaseHas('vol_applications', ['id' => $id, 'status' => 'approved']);
    }
}
