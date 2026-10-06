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
 * Who may see and decide an opportunity's applications.
 *
 * Gap A4 of the volunteering journey walk (6 Oct 2026): the website showed
 * the applicants panel only to the opportunity's creator, so an organisation
 * admin who had not created it could not review anyone — while the server, the
 * other way round, refused the creator if they were not an organisation admin.
 * Both now follow one rule (creator, organisation owner/admins, community
 * admins). Nobody decides their own application.
 */
class VolunteerApplicationsManageTest extends TestCase
{
    use DatabaseTransactions;

    private function enableVolunteering(): void
    {
        DB::table('tenants')->where('id', $this->testTenantId)->update([
            'features' => json_encode(['volunteering' => true, 'organisations' => true]),
        ]);
        TenantContext::setById($this->testTenantId);
    }

    private function member(): User
    {
        return User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true]);
    }

    /** @return array{0: int, 1: int} [organisationId, opportunityId] */
    private function opportunity(User $orgOwner, User $creator): array
    {
        $orgId = (int) DB::table('vol_organizations')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $orgOwner->id,
            'name' => 'Applications fixture organisation',
            'slug' => 'applications-fixture-org-' . uniqid(),
            'status' => 'approved',
            'created_at' => now(),
        ]);
        $oppId = (int) DB::table('vol_opportunities')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'organization_id' => $orgId,
            'created_by' => $creator->id,
            'title' => 'Applications fixture opportunity',
            'description' => 'Has applicants.',
            'is_active' => 1,
            'status' => 'open',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return [$orgId, $oppId];
    }

    private function application(User $volunteer, int $oppId): int
    {
        return (int) DB::table('vol_applications')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'opportunity_id' => $oppId,
            'user_id' => $volunteer->id,
            'status' => 'pending',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function makeOrgAdmin(int $orgId, User $user): void
    {
        DB::table('org_members')->insert([
            'tenant_id' => $this->testTenantId,
            'organization_id' => $orgId,
            'org_type' => 'volunteer',
            'user_id' => $user->id,
            'role' => 'admin',
            'status' => 'active',
            'created_at' => now(),
        ]);
    }

    public function test_an_organisation_admin_who_did_not_create_it_can_review_and_approve(): void
    {
        $this->enableVolunteering();
        $owner = $this->member();
        [$orgId, $oppId] = $this->opportunity($owner, $owner);
        $orgAdmin = $this->member();
        $this->makeOrgAdmin($orgId, $orgAdmin);
        $appId = $this->application($this->member(), $oppId);

        Sanctum::actingAs($orgAdmin, ['*']);
        $this->apiGet("/v2/volunteering/opportunities/{$oppId}")->assertOk()->assertJsonPath('data.can_manage', true);
        $this->assertContains($appId, array_column($this->apiGet("/v2/volunteering/opportunities/{$oppId}/applications")->assertOk()->json('data.items'), 'id'));
        $this->apiPut("/v2/volunteering/applications/{$appId}", ['action' => 'approve'])->assertOk();
        $this->assertSame('approved', DB::table('vol_applications')->where('id', $appId)->value('status'));
    }

    public function test_the_creator_who_is_not_an_organisation_admin_can_review_and_approve(): void
    {
        $this->enableVolunteering();
        $creator = $this->member();
        [, $oppId] = $this->opportunity($this->member(), $creator);
        $appId = $this->application($this->member(), $oppId);

        Sanctum::actingAs($creator, ['*']);
        $this->apiGet("/v2/volunteering/opportunities/{$oppId}/applications")->assertOk();
        $this->apiPut("/v2/volunteering/applications/{$appId}", ['action' => 'approve'])->assertOk();
        $this->assertSame('approved', DB::table('vol_applications')->where('id', $appId)->value('status'));
    }

    public function test_a_plain_member_cannot_see_or_decide_applications(): void
    {
        $this->enableVolunteering();
        $owner = $this->member();
        [, $oppId] = $this->opportunity($owner, $owner);
        $appId = $this->application($this->member(), $oppId);

        Sanctum::actingAs($this->member(), ['*']);
        $this->apiGet("/v2/volunteering/opportunities/{$oppId}/applications")->assertForbidden();
        $this->apiPut("/v2/volunteering/applications/{$appId}", ['action' => 'approve'])->assertForbidden();
        $this->assertSame('pending', DB::table('vol_applications')->where('id', $appId)->value('status'));
    }

    public function test_nobody_decides_their_own_application(): void
    {
        $this->enableVolunteering();
        $owner = $this->member();
        [$orgId, $oppId] = $this->opportunity($owner, $owner);
        $orgAdmin = $this->member();
        $this->makeOrgAdmin($orgId, $orgAdmin);
        $ownAppId = $this->application($orgAdmin, $oppId);

        Sanctum::actingAs($orgAdmin, ['*']);
        $this->apiPut("/v2/volunteering/applications/{$ownAppId}", ['action' => 'approve'])->assertForbidden();
        $this->assertSame('pending', DB::table('vol_applications')->where('id', $ownAppId)->value('status'));
    }
}
