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
 * An organiser editing, closing, reopening and cancelling an opportunity.
 *
 * Gap A2 of the volunteering journey walk (6 Oct 2026): the website offered no
 * way to do any of these, although PUT and DELETE existed. Closing is new: it
 * stops new applications and takes the opportunity off the public list, while
 * the volunteers already on it keep their places and can still open its page.
 */
class VolunteerOpportunityManageTest extends TestCase
{
    use DatabaseTransactions;

    private function enableVolunteering(): void
    {
        DB::table('tenants')->where('id', $this->testTenantId)->update([
            'features' => json_encode(['volunteering' => true, 'organisations' => true]),
        ]);
        TenantContext::setById($this->testTenantId);
    }

    private function member(array $overrides = []): User
    {
        return User::factory()->forTenant($this->testTenantId)->create(array_merge([
            'status' => 'active',
            'is_approved' => true,
        ], $overrides));
    }

    private function opportunity(User $orgOwner, ?User $creator = null): int
    {
        $orgId = (int) DB::table('vol_organizations')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $orgOwner->id,
            'name' => 'Manage fixture organisation',
            'slug' => 'manage-fixture-org-' . uniqid(),
            'status' => 'approved',
            'created_at' => now(),
        ]);

        return (int) DB::table('vol_opportunities')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'organization_id' => $orgId,
            'created_by' => ($creator ?? $orgOwner)->id,
            'title' => 'Manage fixture opportunity',
            'description' => 'Something to manage.',
            'is_active' => 1,
            'status' => 'open',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function apply(User $volunteer, int $oppId, string $status = 'approved'): void
    {
        DB::table('vol_applications')->insert([
            'tenant_id' => $this->testTenantId,
            'opportunity_id' => $oppId,
            'user_id' => $volunteer->id,
            'status' => $status,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    public function test_the_organisation_owner_can_close_and_reopen_an_opportunity(): void
    {
        $this->enableVolunteering();
        $owner = $this->member();
        $oppId = $this->opportunity($owner);
        Sanctum::actingAs($owner, ['*']);

        $this->apiPut("/v2/volunteering/opportunities/{$oppId}", ['status' => 'closed'])->assertOk();
        $this->assertSame('closed', DB::table('vol_opportunities')->where('id', $oppId)->value('status'));
        $this->apiGet("/v2/volunteering/opportunities/{$oppId}")->assertOk()->assertJsonPath('data.status', 'closed');

        $this->apiPut("/v2/volunteering/opportunities/{$oppId}", ['status' => 'open'])->assertOk();
        $this->assertSame('open', DB::table('vol_opportunities')->where('id', $oppId)->value('status'));
    }

    public function test_a_status_other_than_open_or_closed_is_refused(): void
    {
        $this->enableVolunteering();
        $owner = $this->member();
        $oppId = $this->opportunity($owner);
        Sanctum::actingAs($owner, ['*']);

        $this->apiPut("/v2/volunteering/opportunities/{$oppId}", ['status' => 'deleted'])->assertStatus(422);
        $this->assertSame('open', DB::table('vol_opportunities')->where('id', $oppId)->value('status'));
    }

    public function test_a_closed_opportunity_takes_no_new_applications_and_leaves_the_public_list(): void
    {
        $this->enableVolunteering();
        $owner = $this->member();
        $oppId = $this->opportunity($owner);
        DB::table('vol_opportunities')->where('id', $oppId)->update(['status' => 'closed']);

        $stranger = $this->member();
        Sanctum::actingAs($stranger, ['*']);

        $this->assertNotContains(
            $oppId,
            array_map('intval', array_column($this->apiGet('/v2/volunteering/opportunities?per_page=50')->json('data') ?? [], 'id'))
        );
        $this->apiGet("/v2/volunteering/opportunities/{$oppId}")->assertNotFound();
        $this->apiPost("/v2/volunteering/opportunities/{$oppId}/apply", ['message' => 'Please'])->assertStatus(404);
        $this->assertFalse(DB::table('vol_applications')->where('opportunity_id', $oppId)->where('user_id', $stranger->id)->exists());
    }

    public function test_a_volunteer_already_on_a_closed_opportunity_can_still_open_it(): void
    {
        $this->enableVolunteering();
        $owner = $this->member();
        $oppId = $this->opportunity($owner);
        $volunteer = $this->member();
        $this->apply($volunteer, $oppId);
        DB::table('vol_opportunities')->where('id', $oppId)->update(['status' => 'closed']);

        Sanctum::actingAs($volunteer, ['*']);
        $this->apiGet("/v2/volunteering/opportunities/{$oppId}")
            ->assertOk()
            ->assertJsonPath('data.status', 'closed')
            ->assertJsonPath('data.application.status', 'approved');
    }

    public function test_the_creator_who_is_not_an_organisation_admin_can_edit_close_and_cancel(): void
    {
        $this->enableVolunteering();
        $orgOwner = $this->member();
        $creator = $this->member();
        $oppId = $this->opportunity($orgOwner, $creator);
        Sanctum::actingAs($creator, ['*']);

        $this->apiPut("/v2/volunteering/opportunities/{$oppId}", ['title' => 'Renamed by its creator'])->assertOk();
        $this->assertSame('Renamed by its creator', DB::table('vol_opportunities')->where('id', $oppId)->value('title'));

        $this->apiPut("/v2/volunteering/opportunities/{$oppId}", ['status' => 'closed'])->assertOk();
        $this->apiGet("/v2/volunteering/opportunities/{$oppId}")->assertOk()->assertJsonPath('data.status', 'closed');

        $this->apiDelete("/v2/volunteering/opportunities/{$oppId}")->assertNoContent();
        $this->assertSame(0, (int) DB::table('vol_opportunities')->where('id', $oppId)->value('is_active'));
    }

    public function test_cancelling_tells_the_approved_volunteers(): void
    {
        $this->enableVolunteering();
        $owner = $this->member();
        $oppId = $this->opportunity($owner);
        $approved = $this->member();
        $pending = $this->member();
        $this->apply($approved, $oppId, 'approved');
        $this->apply($pending, $oppId, 'pending');
        Sanctum::actingAs($owner, ['*']);

        $this->apiDelete("/v2/volunteering/opportunities/{$oppId}")->assertNoContent();

        $this->assertTrue(DB::table('notifications')->where('user_id', $approved->id)->where('type', 'volunteer_opportunity')->exists());
        $this->assertFalse(DB::table('notifications')->where('user_id', $pending->id)->where('type', 'volunteer_opportunity')->exists());
    }

    public function test_a_plain_member_cannot_close_someone_elses_opportunity(): void
    {
        $this->enableVolunteering();
        $oppId = $this->opportunity($this->member());
        Sanctum::actingAs($this->member(), ['*']);

        $this->apiPut("/v2/volunteering/opportunities/{$oppId}", ['status' => 'closed'])->assertForbidden();
        $this->assertSame('open', DB::table('vol_opportunities')->where('id', $oppId)->value('status'));
    }
}
