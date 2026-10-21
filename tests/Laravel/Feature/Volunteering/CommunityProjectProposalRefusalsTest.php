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
 * A community project proposal the service refuses must be answered as a refusal.
 *
 * Until 21 Oct 2026 CommunityProjectService::propose() recorded a validation error and
 * returned [] for a missing title, a missing description or a malformed date, but the
 * controller only caught exceptions, so it answered 201 Created with an empty body.
 * The website showed "proposal submitted" and nothing was saved. Supporting a project
 * that does not exist likewise answered 200 { success: false }.
 */
class CommunityProjectProposalRefusalsTest extends TestCase
{
    use DatabaseTransactions;

    private function signIn(): User
    {
        DB::table('tenants')->where('id', $this->testTenantId)->update([
            'features' => json_encode(['volunteering' => true]),
        ]);
        TenantContext::setById($this->testTenantId);
        $user = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true]);
        Sanctum::actingAs($user, ['*']);

        return $user;
    }

    private function projectCount(): int
    {
        return DB::table('vol_community_projects')->where('tenant_id', $this->testTenantId)->count();
    }

    public function test_a_proposal_without_a_title_is_refused_and_nothing_is_saved(): void
    {
        $this->signIn();
        $before = $this->projectCount();

        $this->apiPost('/v2/volunteering/community-projects', ['title' => '  ', 'description' => 'A community garden'])
            ->assertStatus(422)
            ->assertJsonPath('errors.0.code', 'VALIDATION_ERROR')
            ->assertJsonPath('errors.0.field', 'title');

        $this->assertSame($before, $this->projectCount());
    }

    public function test_a_proposal_without_a_description_is_refused(): void
    {
        $this->signIn();

        $this->apiPost('/v2/volunteering/community-projects', ['title' => 'Garden'])
            ->assertStatus(422)
            ->assertJsonPath('errors.0.field', 'description');
    }

    public function test_a_proposal_with_a_malformed_date_is_refused(): void
    {
        $this->signIn();
        $before = $this->projectCount();

        $this->apiPost('/v2/volunteering/community-projects', ['title' => 'Garden', 'description' => 'Dig', 'proposed_date' => '31/12/2099'])
            ->assertStatus(422)
            ->assertJsonPath('errors.0.field', 'proposed_date');

        $this->assertSame($before, $this->projectCount());
    }

    public function test_a_valid_proposal_is_created_as_proposed(): void
    {
        $user = $this->signIn();

        $response = $this->apiPost('/v2/volunteering/community-projects', [
            'title' => 'Garden',
            'description' => 'Dig beds for the school',
            'location' => 'Mallow',
            'target_volunteers' => 6,
            'proposed_date' => '2099-05-01',
        ])->assertStatus(201);

        $id = (int) $response->json('data.id');
        $this->assertGreaterThan(0, $id);
        $this->assertDatabaseHas('vol_community_projects', [
            'id' => $id,
            'tenant_id' => $this->testTenantId,
            'proposed_by' => $user->id,
            'status' => 'proposed',
            'target_volunteers' => 6,
        ]);
    }

    public function test_the_list_names_who_proposed_each_project(): void
    {
        $viewer = $this->signIn();
        $proposer = User::factory()->forTenant($this->testTenantId)->create([
            'first_name' => 'Avery', 'last_name' => 'Stone', 'status' => 'active', 'is_approved' => true,
        ]);
        $id = DB::table('vol_community_projects')->insertGetId([
            'tenant_id' => $this->testTenantId, 'proposed_by' => $proposer->id, 'title' => 'Neighbourhood garden',
            'description' => 'Grow food together', 'status' => 'approved', 'supporter_count' => 0,
            'created_at' => now(), 'updated_at' => now(),
        ]);
        Sanctum::actingAs($viewer, ['*']);

        $items = collect($this->apiGet('/v2/volunteering/community-projects?per_page=50')->assertOk()->json('data.items'));
        $project = $items->firstWhere('id', $id);

        $this->assertNotNull($project);
        $this->assertSame('Avery Stone', $project['proposer_name']);
    }

    public function test_supporting_a_project_that_does_not_exist_is_not_found(): void
    {
        $this->signIn();

        $this->apiPost('/v2/volunteering/community-projects/999999999/support', [])
            ->assertStatus(404)
            ->assertJsonPath('errors.0.code', 'NOT_FOUND');
    }
}
