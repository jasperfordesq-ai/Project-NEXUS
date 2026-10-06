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
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Queue;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * Organisers asking for help with a shift urgently.
 *
 * Gap A5 of the volunteering journey walk (6 Oct 2026): POST
 * /v2/volunteering/emergency-alerts existed but no screen called it, so the
 * volunteer "Alerts" tab could never fill. Sending, listing and cancelling now
 * follow the same "may manage this opportunity" rule as the rest of the
 * organiser tools (creator, organisation owner/admins, community admins).
 */
class VolunteerUrgentShiftRequestTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();
        Queue::fake();
        Mail::fake();
        DB::table('tenants')->where('id', $this->testTenantId)->update([
            'features' => json_encode(['volunteering' => true, 'organisations' => true]),
        ]);
        TenantContext::setById($this->testTenantId);
    }

    private function member(): User
    {
        return User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true]);
    }

    /** @return array{0: int, 1: int, 2: int} [organisationId, opportunityId, shiftId] */
    private function opportunityWithShift(User $owner, ?User $creator = null, string $startsIn = '+2 days'): array
    {
        $orgId = (int) DB::table('vol_organizations')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $owner->id,
            'name' => 'Urgent fixture organisation',
            'slug' => 'urgent-fixture-org-' . uniqid(),
            'status' => 'approved',
            'created_at' => now(),
        ]);
        $oppId = (int) DB::table('vol_opportunities')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'organization_id' => $orgId,
            'created_by' => ($creator ?? $owner)->id,
            'title' => 'Urgent fixture opportunity',
            'description' => 'Needs cover.',
            'is_active' => 1,
            'status' => 'open',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $start = new \DateTimeImmutable($startsIn);
        $shiftId = (int) DB::table('vol_shifts')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'opportunity_id' => $oppId,
            'start_time' => $start->format('Y-m-d H:i:s'),
            'end_time' => $start->modify('+2 hours')->format('Y-m-d H:i:s'),
            'capacity' => 4,
            'created_at' => now(),
        ]);

        return [$orgId, $oppId, $shiftId];
    }

    private function approvedVolunteer(int $oppId, ?int $shiftId = null): User
    {
        $volunteer = $this->member();
        DB::table('vol_applications')->insert([
            'tenant_id' => $this->testTenantId,
            'opportunity_id' => $oppId,
            'shift_id' => $shiftId,
            'user_id' => $volunteer->id,
            'status' => 'approved',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return $volunteer;
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

    private function send(int $shiftId, array $overrides = []): \Illuminate\Testing\TestResponse
    {
        return $this->apiPost('/v2/volunteering/emergency-alerts', array_merge([
            'shift_id' => $shiftId,
            'message' => 'Two people dropped out — can anyone cover Saturday morning?',
            'priority' => 'urgent',
        ], $overrides));
    }

    public function test_an_organisation_admin_can_ask_for_help_and_learns_how_many_were_told(): void
    {
        $owner = $this->member();
        [$orgId, $oppId, $shiftId] = $this->opportunityWithShift($owner);
        $orgAdmin = $this->member();
        $this->makeOrgAdmin($orgId, $orgAdmin);
        $this->approvedVolunteer($oppId);
        $this->approvedVolunteer($oppId);
        $this->approvedVolunteer($oppId, $shiftId); // already on the shift: not asked

        Sanctum::actingAs($orgAdmin, ['*']);
        $response = $this->send($shiftId)->assertCreated();

        $this->assertSame(2, $response->json('data.notified'));
        $this->assertTrue(DB::table('vol_emergency_alerts')->where('id', $response->json('data.id'))->where('status', 'active')->exists());
    }

    public function test_the_opportunitys_creator_can_ask_for_help(): void
    {
        $creator = $this->member();
        [, , $shiftId] = $this->opportunityWithShift($this->member(), $creator);

        Sanctum::actingAs($creator, ['*']);
        $this->send($shiftId)->assertCreated();
    }

    public function test_a_plain_member_cannot_ask_for_help(): void
    {
        [, , $shiftId] = $this->opportunityWithShift($this->member());

        Sanctum::actingAs($this->member(), ['*']);
        $this->send($shiftId)->assertForbidden();
        $this->assertFalse(DB::table('vol_emergency_alerts')->where('shift_id', $shiftId)->exists());
    }

    public function test_a_shift_that_has_started_cannot_get_an_urgent_request(): void
    {
        $owner = $this->member();
        [, , $shiftId] = $this->opportunityWithShift($owner, null, '-1 hour');

        Sanctum::actingAs($owner, ['*']);
        $this->send($shiftId)->assertStatus(400);
        $this->assertFalse(DB::table('vol_emergency_alerts')->where('shift_id', $shiftId)->exists());
    }

    public function test_managers_see_the_opportunitys_requests_with_replies_and_others_do_not(): void
    {
        $owner = $this->member();
        [$orgId, $oppId, $shiftId] = $this->opportunityWithShift($owner);
        $this->approvedVolunteer($oppId);
        Sanctum::actingAs($owner, ['*']);
        $alertId = (int) $this->send($shiftId)->assertCreated()->json('data.id');

        $orgAdmin = $this->member();
        $this->makeOrgAdmin($orgId, $orgAdmin);
        Sanctum::actingAs($orgAdmin, ['*']);
        $list = $this->apiGet("/v2/volunteering/opportunities/{$oppId}/emergency-alerts")->assertOk();
        $row = collect($list->json('data.alerts'))->firstWhere('id', $alertId);
        $this->assertNotNull($row, 'a request sent by another manager is listed');
        $this->assertSame($shiftId, $row['shift']['id']);
        $this->assertSame(1, $row['stats']['total_notified']);
        $this->assertSame('active', $row['status']);

        Sanctum::actingAs($this->member(), ['*']);
        $this->apiGet("/v2/volunteering/opportunities/{$oppId}/emergency-alerts")->assertForbidden();
    }

    public function test_another_manager_can_cancel_a_request_and_a_plain_member_cannot(): void
    {
        $owner = $this->member();
        [$orgId, , $shiftId] = $this->opportunityWithShift($owner);
        Sanctum::actingAs($owner, ['*']);
        $alertId = (int) $this->send($shiftId)->assertCreated()->json('data.id');

        Sanctum::actingAs($this->member(), ['*']);
        $this->apiDelete("/v2/volunteering/emergency-alerts/{$alertId}")->assertStatus(404);
        $this->assertSame('active', DB::table('vol_emergency_alerts')->where('id', $alertId)->value('status'));

        $orgAdmin = $this->member();
        $this->makeOrgAdmin($orgId, $orgAdmin);
        Sanctum::actingAs($orgAdmin, ['*']);
        $this->apiDelete("/v2/volunteering/emergency-alerts/{$alertId}")->assertNoContent();
        $this->assertSame('cancelled', DB::table('vol_emergency_alerts')->where('id', $alertId)->value('status'));
    }
}
