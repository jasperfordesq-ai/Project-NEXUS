<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Volunteering\Incidents;

use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Queue;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * Audit of 19 Oct 2026: the organisation's deputy lead can be appointed and
 * either role cleared; "dealt with" can be closed or reopened; the lead is told
 * when a share is withdrawn; staff counts leave out incidents about the viewer;
 * staff alerts point at the case, not the list.
 */
final class OrganisationLeadsAndLifecycleTest extends TestCase
{
    use DatabaseTransactions;
    use IncidentFixtures;

    protected function setUp(): void
    {
        parent::setUp();
        Queue::fake();
        Mail::fake();
        $this->withoutMiddleware([
            \Illuminate\Routing\Middleware\ThrottleRequests::class,
            \Illuminate\Routing\Middleware\ThrottleRequestsWithRedis::class,
        ]);
        $this->enableVolunteering();
    }

    public function test_admin_can_appoint_and_clear_the_deputy_and_the_lead(): void
    {
        $orgId = $this->organisation($this->user(), 'LEADS Org ' . uniqid());
        $lead = $this->user();
        $deputy = $this->user();
        Sanctum::actingAs($this->user('admin'), ['*']);

        $this->apiPut("/v2/admin/volunteering/organizations/{$orgId}/dlp", ['dlp_user_id' => $lead->id, 'deputy_dlp_user_id' => $deputy->id])
            ->assertStatus(200);
        $row = DB::table('vol_organizations')->where('id', $orgId)->first(['dlp_user_id', 'deputy_dlp_user_id']);
        $this->assertSame([(int) $lead->id, (int) $deputy->id], [(int) $row->dlp_user_id, (int) $row->deputy_dlp_user_id]);

        // The same person cannot hold both roles.
        $this->apiPut("/v2/admin/volunteering/organizations/{$orgId}/dlp", ['deputy_dlp_user_id' => $lead->id])
            ->assertStatus(422)->assertJsonPath('errors.0.field', 'deputy_dlp_user_id');

        // Clearing one role leaves the other alone.
        $this->apiPut("/v2/admin/volunteering/organizations/{$orgId}/dlp", ['deputy_dlp_user_id' => null])->assertStatus(200);
        $row = DB::table('vol_organizations')->where('id', $orgId)->first(['dlp_user_id', 'deputy_dlp_user_id']);
        $this->assertSame((int) $lead->id, (int) $row->dlp_user_id);
        $this->assertNull($row->deputy_dlp_user_id);

        $this->apiPut("/v2/admin/volunteering/organizations/{$orgId}/dlp", ['dlp_user_id' => 0])->assertStatus(200);
        $this->assertNull(DB::table('vol_organizations')->where('id', $orgId)->value('dlp_user_id'));

        // Nothing to change is a validation error, as before.
        $this->apiPut("/v2/admin/volunteering/organizations/{$orgId}/dlp", [])->assertStatus(422);

        // The roster names both.
        $this->apiPut("/v2/admin/volunteering/organizations/{$orgId}/dlp", ['dlp_user_id' => $lead->id, 'deputy_dlp_user_id' => $deputy->id])->assertStatus(200);
        $roster = collect($this->apiGet('/v2/admin/volunteering/incidents')->assertStatus(200)->json('data.dlp_assignments'))
            ->firstWhere('organization_id', $orgId);
        $this->assertSame((int) $deputy->id, $roster['deputy_dlp_user_id']);
        $this->assertNotEmpty($roster['deputy_dlp_user_name']);
    }

    public function test_the_deputy_sees_the_organisation_view_and_the_team_page_names_both(): void
    {
        $owner = $this->user();
        $orgId = $this->organisation($owner, 'LEADS Org ' . uniqid());
        $deputy = $this->user();
        DB::table('vol_organizations')->where('id', $orgId)->update(['dlp_user_id' => $this->user()->id, 'deputy_dlp_user_id' => $deputy->id]);
        $incident = $this->incident($this->user(), ['organization_id' => $orgId]);

        Sanctum::actingAs($deputy, ['*']);
        $list = $this->apiGet("/v2/volunteering/organisations/{$orgId}/incidents")->assertStatus(200)->json('data');
        $this->assertSame('org_lead', $list['relation']);
        $this->assertSame([(int) $incident->id], array_column($list['items'], 'id'));

        $this->app['auth']->forgetGuards();
        Sanctum::actingAs($owner, ['*']);
        $team = $this->apiGet("/v2/volunteering/organisations/{$orgId}/members")->assertStatus(200)->json('data.safeguarding');
        $this->assertSame((int) $deputy->id, $team['deputy']['user_id']);
        $this->assertNotEmpty($team['lead']['name']);
    }

    public function test_dealt_with_can_be_closed_or_reopened_but_closed_is_final(): void
    {
        [$incident] = $this->linkedIncident();
        Sanctum::actingAs($this->user('broker'), ['*']);
        $url = "/v2/admin/volunteering/incidents/{$incident->id}";

        $this->apiPut($url, ['status' => 'resolved', 'reason' => 'Volunteer stood down; family informed.'])->assertStatus(200);
        $this->apiPut($url, ['status' => 'investigating'])->assertStatus(200);
        $this->apiPut($url, ['status' => 'resolved', 'reason' => 'Nothing further came of it.'])->assertStatus(200);
        $this->apiPut($url, ['status' => 'closed', 'reason' => 'Record complete.'])->assertStatus(200);
        $this->assertSame('closed', DB::table('vol_safeguarding_incidents')->where('id', $incident->id)->value('status'));

        $this->apiPut($url, ['status' => 'investigating'])->assertStatus(422);
        $this->assertSame('closed', DB::table('vol_safeguarding_incidents')->where('id', $incident->id)->value('status'));
    }

    public function test_the_lead_is_told_when_a_share_is_withdrawn(): void
    {
        $lead = $this->user();
        [$incident, $orgId] = $this->linkedIncident();
        DB::table('vol_organizations')->where('id', $orgId)->update(['dlp_user_id' => $lead->id]);
        Sanctum::actingAs($this->user('broker'), ['*']);

        $this->apiPost("/v2/admin/volunteering/incidents/{$incident->id}/share")->assertStatus(201);
        $before = DB::table('notifications')->where('user_id', $lead->id)->count();
        $this->apiDelete("/v2/admin/volunteering/incidents/{$incident->id}/share")->assertStatus(200);
        $this->assertSame($before + 1, DB::table('notifications')->where('user_id', $lead->id)->count());
        $this->assertSame(
            "/volunteering/org/{$orgId}/safeguarding/{$incident->id}",
            DB::table('notifications')->where('user_id', $lead->id)->orderByDesc('id')->value('link')
        );

        // Withdrawing again changes nothing, so nobody is told again.
        $this->apiDelete("/v2/admin/volunteering/incidents/{$incident->id}/share")->assertStatus(200);
        $this->assertSame($before + 1, DB::table('notifications')->where('user_id', $lead->id)->count());
    }

    public function test_staff_counts_leave_out_incidents_about_the_viewer(): void
    {
        $staff = $this->user('broker');
        $this->incident($this->user(), ['subject_user_id' => $staff->id]);
        $this->incident($this->user());
        Sanctum::actingAs($staff, ['*']);

        $data = $this->apiGet('/v2/admin/volunteering/incidents')->assertStatus(200)->json('data');
        $ids = array_column($data['items'] ?? $data['incidents'] ?? [], 'id');
        $this->assertSame(count($ids), $data['stats']['total_incidents']);
    }

    public function test_staff_alerts_point_at_the_case(): void
    {
        $staff = $this->user('broker');
        $orgId = $this->organisation($this->user(), 'LEADS Org ' . uniqid());
        Sanctum::actingAs($this->user(), ['*']);
        $id = (int) $this->apiPost('/v2/volunteering/incidents', [
            'title' => 'LEADS alert link', 'description' => 'Something happened that needs a careful look by the team.',
            'incident_type' => 'concern', 'severity' => 'medium', 'organization_id' => $orgId,
            'incident_date' => now()->toDateString(),
        ])->assertStatus(201)->json('data.id');

        $link = DB::table('notifications')->where('user_id', $staff->id)->orderByDesc('id')->value('link');
        $this->assertSame("/broker/safeguarding/volunteering/{$id}", $link);
    }
}
