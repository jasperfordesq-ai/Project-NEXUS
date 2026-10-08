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
 * 8 Oct 2026: an organisation's owner applied to volunteer for one of its own
 * opportunities (only the opportunity's creator was refused), then logged hours
 * and claimed expenses for it, and nobody could decide any of them because the
 * decision screens refuse your own items. The people who run an organisation
 * now cannot apply to it, log hours with it or claim expenses from it; and the
 * organisation can now remove an approved volunteer, which it could not before.
 */
class OrganisationRunnersCannotVolunteerForItTest extends TestCase
{
    use DatabaseTransactions;

    private User $owner;
    private User $teamAdmin;
    private User $teamMember;
    private User $volunteer;
    private int $orgId;
    private int $oppId;

    protected function setUp(): void
    {
        parent::setUp();
        DB::table('tenants')->where('id', $this->testTenantId)
            ->update(['features' => json_encode(['volunteering' => true, 'organisations' => true])]);
        TenantContext::setById($this->testTenantId);

        $this->owner = $this->member();
        $this->teamAdmin = $this->member();
        $this->teamMember = $this->member();
        $this->volunteer = $this->member();
        $poster = $this->member();

        $this->orgId = (int) DB::table('vol_organizations')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $this->owner->id,
            'name' => 'Runners Test Org',
            'slug' => 'runners-test-' . uniqid(),
            'description' => 'Test',
            'status' => 'active',
            'created_at' => now(),
        ]);
        $this->orgMember($this->teamAdmin->id, 'admin');
        $this->orgMember($this->teamMember->id, 'member');

        $this->oppId = (int) DB::table('vol_opportunities')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'organization_id' => $this->orgId,
            'created_by' => $poster->id,
            'title' => 'Runners Garden Helper',
            'description' => 'Test',
            'status' => 'active',
            'is_active' => 1,
            'created_at' => now(),
        ]);
    }

    private function member(): User
    {
        return User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
    }

    private function orgMember(int $userId, string $role): void
    {
        DB::table('org_members')->insert([
            'tenant_id' => $this->testTenantId,
            'organization_id' => $this->orgId,
            'org_type' => 'volunteer',
            'user_id' => $userId,
            'role' => $role,
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function application(int $userId, string $status): int
    {
        return (int) DB::table('vol_applications')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'opportunity_id' => $this->oppId,
            'user_id' => $userId,
            'status' => $status,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    public function test_the_owner_and_a_team_admin_cannot_apply_but_a_plain_team_member_can(): void
    {
        foreach ([$this->owner, $this->teamAdmin] as $runner) {
            Sanctum::actingAs($runner);
            $this->apiPost("/v2/volunteering/opportunities/{$this->oppId}/apply", [])->assertStatus(422);
            $this->assertDatabaseMissing('vol_applications', ['opportunity_id' => $this->oppId, 'user_id' => $runner->id]);
        }

        Sanctum::actingAs($this->teamMember);
        $this->apiPost("/v2/volunteering/opportunities/{$this->oppId}/apply", [])->assertStatus(201);
    }

    public function test_the_opportunity_tells_the_page_who_runs_it(): void
    {
        Sanctum::actingAs($this->teamAdmin);
        $this->assertTrue($this->apiGet("/v2/volunteering/opportunities/{$this->oppId}")->assertOk()->json('data.runs_organisation'));

        Sanctum::actingAs($this->volunteer);
        $this->assertFalse($this->apiGet("/v2/volunteering/opportunities/{$this->oppId}")->assertOk()->json('data.runs_organisation'));
    }

    public function test_a_runner_may_still_log_hours_and_claim_expenses_for_someone_else_to_decide(): void
    {
        // Owner decision, 8 Oct 2026: only applying is refused. Hours and
        // expense claims stay allowed and are decided by another admin.
        Sanctum::actingAs($this->owner);
        $this->assertContains($this->apiPost('/v2/volunteering/hours', [
            'organization_id' => $this->orgId,
            'date' => now()->subDay()->toDateString(),
            'hours' => 2,
            'description' => 'Own hours',
        ])->status(), [200, 201]);

        Sanctum::actingAs($this->teamAdmin);
        $this->apiPost('/v2/volunteering/expenses', [
            'organization_id' => $this->orgId,
            'expense_type' => 'travel',
            'amount' => 10,
            'description' => 'Own claim',
        ])->assertStatus(201);
    }

    public function test_an_approved_volunteer_can_still_log_hours(): void
    {
        $this->application($this->volunteer->id, 'approved');
        Sanctum::actingAs($this->volunteer);
        $this->assertContains($this->apiPost('/v2/volunteering/hours', [
            'organization_id' => $this->orgId,
            'opportunity_id' => $this->oppId,
            'date' => now()->subDay()->toDateString(),
            'hours' => 2,
            'description' => 'Garden work',
        ])->status(), [200, 201]);
    }

    public function test_a_team_admin_removes_an_approved_volunteer(): void
    {
        $id = $this->application($this->volunteer->id, 'approved');
        Sanctum::actingAs($this->teamAdmin);

        $this->apiPost("/v2/volunteering/applications/{$id}/remove", [])->assertOk();

        $this->assertDatabaseMissing('vol_applications', ['id' => $id]);
        $this->assertDatabaseHas('org_audit_log', [
            'organization_id' => $this->orgId,
            'user_id' => $this->teamAdmin->id,
            'target_user_id' => $this->volunteer->id,
            'action' => 'volunteer_removed_from_opportunity',
        ]);
        $this->assertDatabaseHas('notifications', [
            'user_id' => $this->volunteer->id,
            'message' => __('api_controllers_3.admin_bells.volunteer_removed', ['opportunity' => 'Runners Garden Helper']),
        ]);
    }

    public function test_a_runner_can_remove_their_own_old_application(): void
    {
        // The situation already in the data: an owner who applied before this fix.
        $id = $this->application($this->owner->id, 'approved');
        Sanctum::actingAs($this->owner);

        $this->apiPost("/v2/volunteering/applications/{$id}/remove", [])->assertOk();
        $this->assertDatabaseMissing('vol_applications', ['id' => $id]);
    }

    public function test_only_people_who_manage_it_can_remove_and_only_approved_volunteers(): void
    {
        $approved = $this->application($this->volunteer->id, 'approved');

        Sanctum::actingAs($this->teamMember);
        $this->apiPost("/v2/volunteering/applications/{$approved}/remove", [])->assertForbidden();
        $this->assertDatabaseHas('vol_applications', ['id' => $approved, 'status' => 'approved']);

        $pending = $this->application($this->member()->id, 'pending');
        Sanctum::actingAs($this->teamAdmin);
        $this->apiPost("/v2/volunteering/applications/{$pending}/remove", [])->assertStatus(400);
        $this->assertDatabaseHas('vol_applications', ['id' => $pending, 'status' => 'pending']);
    }
}
