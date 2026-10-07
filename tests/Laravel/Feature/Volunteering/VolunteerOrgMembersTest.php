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
 * Gap D7 (7 Oct 2026): nobody could add or remove a volunteer organisation's
 * members or change their roles. Owner decision: community admins and the
 * organisation's owners may; the org `admin` role can see the team only.
 */
class VolunteerOrgMembersTest extends TestCase
{
    use DatabaseTransactions;

    private User $creator;
    private User $orgAdmin;
    private User $newcomer;
    private int $orgId;

    protected function setUp(): void
    {
        parent::setUp();
        DB::table('tenants')->where('id', $this->testTenantId)->update([
            'features' => json_encode(['volunteering' => true, 'organisations' => true]),
        ]);
        TenantContext::setById($this->testTenantId);

        $this->creator = $this->member('Creator');
        $this->orgAdmin = $this->member('Organiser');
        $this->newcomer = $this->member('Newcomer');

        $this->orgId = (int) DB::table('vol_organizations')->insertGetId([
            'tenant_id' => $this->testTenantId, 'user_id' => $this->creator->id, 'name' => 'Food Bank',
            'slug' => 'team-org-' . uniqid(), 'status' => 'approved', 'created_at' => now(),
        ]);
        foreach ([[$this->creator, 'owner'], [$this->orgAdmin, 'admin']] as [$user, $role]) {
            DB::table('org_members')->insert([
                'tenant_id' => $this->testTenantId, 'organization_id' => $this->orgId, 'org_type' => 'volunteer',
                'user_id' => $user->id, 'role' => $role, 'status' => 'active', 'created_at' => now(),
            ]);
        }
    }

    private function member(string $first): User
    {
        return User::factory()->forTenant($this->testTenantId)->create([
            'first_name' => $first, 'last_name' => 'Tester', 'name' => "$first Tester",
            'email' => strtolower($first) . '-' . uniqid('', true) . '@example.test',
            'status' => 'active', 'is_approved' => true, 'preferred_language' => 'en',
        ]);
    }

    private function url(string $suffix = ''): string
    {
        return "/v2/volunteering/organisations/{$this->orgId}/members{$suffix}";
    }

    private function rowFor(User $user): ?object
    {
        return DB::table('org_members')->where('organization_id', $this->orgId)->where('org_type', 'volunteer')
            ->where('user_id', $user->id)->first();
    }

    public function test_an_owner_adds_changes_and_removes_a_member_who_is_told_each_time(): void
    {
        Sanctum::actingAs($this->creator);

        $list = $this->apiGet($this->url())->assertOk();
        $this->assertTrue($list->json('data.can_manage'));
        $this->assertSame([$this->creator->id, $this->orgAdmin->id], array_column($list->json('data.items'), 'user_id'));
        $this->assertTrue($list->json('data.items.0.is_creator'));

        $this->apiPost($this->url(), ['user_id' => $this->newcomer->id, 'role' => 'admin'])->assertStatus(201);
        $this->assertSame('admin', $this->rowFor($this->newcomer)->role);
        $this->assertSame('active', $this->rowFor($this->newcomer)->status);

        $this->apiPut($this->url("/{$this->newcomer->id}"), ['role' => 'owner'])->assertOk();
        $this->assertSame('owner', $this->rowFor($this->newcomer)->role);

        $this->apiDelete($this->url("/{$this->newcomer->id}"))->assertOk();
        $this->assertSame('removed', $this->rowFor($this->newcomer)->status);
        $this->assertNotContains($this->newcomer->id, array_column($this->apiGet($this->url())->json('data.items'), 'user_id'));

        // Re-adding reactivates the same row rather than failing on the unique key.
        $this->apiPost($this->url(), ['user_id' => $this->newcomer->id, 'role' => 'member'])->assertStatus(201);
        $this->assertSame('active', $this->rowFor($this->newcomer)->status);
        $this->assertSame('member', $this->rowFor($this->newcomer)->role);

        $this->assertSame(4, DB::table('notifications')->where('user_id', $this->newcomer->id)
            ->where('type', 'volunteer_org_membership')->count());
        $this->assertSame(4, DB::table('org_audit_log')->where('organization_id', $this->orgId)
            ->where('target_user_id', $this->newcomer->id)->count());
    }

    public function test_the_org_admin_role_sees_the_team_but_cannot_change_it(): void
    {
        Sanctum::actingAs($this->orgAdmin);

        $this->assertFalse($this->apiGet($this->url())->assertOk()->json('data.can_manage'));
        $this->apiPost($this->url(), ['user_id' => $this->newcomer->id, 'role' => 'member'])->assertStatus(403);
        $this->assertNull($this->rowFor($this->newcomer));
    }

    public function test_someone_outside_the_team_cannot_see_it(): void
    {
        Sanctum::actingAs($this->newcomer);

        $this->apiGet($this->url())->assertStatus(403);
        $this->apiDelete($this->url("/{$this->orgAdmin->id}"))->assertStatus(403);
        $this->assertSame('active', $this->rowFor($this->orgAdmin)->status);
    }

    public function test_the_safeguards_hold(): void
    {
        Sanctum::actingAs($this->creator);

        // The creator cannot act on themselves, and nobody can act on the creator.
        $this->apiDelete($this->url("/{$this->creator->id}"))->assertStatus(422)->assertJsonPath('errors.0.code', 'SELF');
        $this->apiPost($this->url(), ['user_id' => $this->orgAdmin->id, 'role' => 'admin'])->assertStatus(409);
        $this->apiPost($this->url(), ['user_id' => $this->newcomer->id, 'role' => 'boss'])->assertStatus(422);
        $this->apiPut($this->url("/{$this->newcomer->id}"), ['role' => 'admin'])->assertStatus(404);

        $outsider = User::factory()->forTenant(1)->create(['status' => 'active']);
        $this->apiPost($this->url(), ['user_id' => $outsider->id, 'role' => 'member'])->assertStatus(422);
        $this->assertNull($this->rowFor($outsider));

        // A second owner cannot demote the creator.
        $this->apiPut($this->url("/{$this->orgAdmin->id}"), ['role' => 'owner'])->assertOk();
        Sanctum::actingAs($this->orgAdmin);
        $this->apiPut($this->url("/{$this->creator->id}"), ['role' => 'member'])->assertStatus(422)
            ->assertJsonPath('errors.0.code', 'CREATOR');
        $this->assertSame('owner', $this->rowFor($this->creator)->role);
    }

    public function test_the_last_owner_cannot_be_removed(): void
    {
        // A legacy organisation whose creator holds no owner row: the only
        // owner row belongs to someone else, and removing it is refused.
        DB::table('org_members')->where('organization_id', $this->orgId)->where('user_id', $this->creator->id)->update(['role' => 'member']);
        DB::table('org_members')->where('organization_id', $this->orgId)->where('user_id', $this->orgAdmin->id)->update(['role' => 'owner']);
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $this->apiDelete("/v2/admin/volunteering/organizations/{$this->orgId}/members/{$this->orgAdmin->id}")
            ->assertStatus(422)->assertJsonPath('errors.0.code', 'LAST_OWNER');
        $this->assertSame('active', $this->rowFor($this->orgAdmin)->status);
    }

    public function test_a_community_admin_manages_any_team_from_the_admin_panel(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $this->apiPost("/v2/admin/volunteering/organizations/{$this->orgId}/members", ['user_id' => $this->newcomer->id, 'role' => 'owner'])
            ->assertStatus(201);
        $this->apiPut("/v2/admin/volunteering/organizations/{$this->orgId}/members/{$this->orgAdmin->id}", ['role' => 'member'])
            ->assertOk();
        $this->assertSame('member', $this->rowFor($this->orgAdmin)->role);

        $list = collect($this->apiGet("/v2/admin/volunteering/organizations/{$this->orgId}/members")->assertOk()->json('data'));
        $this->assertTrue($list->firstWhere('user_id', $this->creator->id)['is_creator']);
        $this->assertFalse($list->firstWhere('user_id', $this->newcomer->id)['is_creator']);

        // A member of the community cannot use the admin routes.
        Sanctum::actingAs($this->newcomer);
        $this->apiDelete("/v2/admin/volunteering/organizations/{$this->orgId}/members/{$this->orgAdmin->id}")->assertStatus(403);
    }
}
