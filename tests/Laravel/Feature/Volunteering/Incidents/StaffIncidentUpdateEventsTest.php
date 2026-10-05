<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Volunteering\Incidents;

use App\Services\Volunteering\IncidentShareService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Queue;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * Reporting and every staff change write the incident's timeline; staff updates
 * answer 422 with the field for invalid input and 404 for an unknown incident.
 */
final class StaffIncidentUpdateEventsTest extends TestCase
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

    public function test_reporting_writes_a_reported_event(): void
    {
        Sanctum::actingAs($this->user(), ['*']);
        $id = $this->apiPost('/v2/volunteering/incidents', [
            'title' => 'INCUPD new', 'description' => 'A long enough description of the incident.',
            'severity' => 'low', 'incident_type' => 'concern',
        ])->assertStatus(201)->json('data.id');

        $this->assertSame(['reported'], DB::table('vol_incident_events')->where('incident_id', $id)->pluck('event_type')->all());
    }

    public function test_each_staff_change_writes_its_event(): void
    {
        [$incident] = $this->linkedIncident();
        $handler = $this->user('broker');
        Sanctum::actingAs($this->user('broker'), ['*']);

        $this->apiPut("/v2/admin/volunteering/incidents/{$incident->id}", [
            'status' => 'investigating', 'assigned_to' => $handler->id, 'severity' => 'high',
            'authority_notified' => true, 'authority_reference' => 'POL-1',
        ])->assertStatus(200);

        $events = DB::table('vol_incident_events')->where('incident_id', $incident->id)->get()->keyBy('event_type');
        foreach (['status_changed', 'handler_changed', 'filing_changed', 'authority_recorded'] as $t) {
            $this->assertTrue($events->has($t), "missing {$t}");
        }
        $this->assertSame(['from' => 'open', 'to' => 'investigating'], json_decode($events['status_changed']->data, true));
        $this->assertSame(['severity' => ['from' => 'medium', 'to' => 'high']], json_decode($events['filing_changed']->data, true));
        $this->assertSame((int) $handler->id, json_decode($events['handler_changed']->data, true)['to_user_id']);
    }

    public function test_resaving_unchanged_values_writes_nothing(): void
    {
        [$incident] = $this->linkedIncident();
        Sanctum::actingAs($this->user('broker'), ['*']);

        $this->apiPut("/v2/admin/volunteering/incidents/{$incident->id}", ['status' => 'open', 'severity' => 'medium'])->assertStatus(200);

        $this->assertSame(0, DB::table('vol_incident_events')->where('incident_id', $incident->id)->count());
    }

    public function test_resolving_needs_a_reason(): void
    {
        [$incident] = $this->linkedIncident();
        Sanctum::actingAs($this->user('broker'), ['*']);

        foreach (['', '   '] as $blank) {
            $this->apiPut("/v2/admin/volunteering/incidents/{$incident->id}", ['status' => 'resolved', 'reason' => $blank])
                ->assertStatus(422)->assertJsonPath('errors.0.field', 'reason');
        }
        $this->apiPut("/v2/admin/volunteering/incidents/{$incident->id}", ['status' => 'resolved'])
            ->assertStatus(422)->assertJsonPath('errors.0.field', 'reason');
        $this->assertSame('open', DB::table('vol_safeguarding_incidents')->where('id', $incident->id)->value('status'));

        $this->apiPut("/v2/admin/volunteering/incidents/{$incident->id}", ['status' => 'resolved', 'reason' => 'Volunteer stood down; family informed.'])->assertStatus(200);
        $row = DB::table('vol_incident_events')->where('incident_id', $incident->id)->where('event_type', 'status_changed')->first();
        $this->assertSame('Volunteer stood down; family informed.', $row->body);
    }

    public function test_investigating_does_not_need_a_reason_but_keeps_one_if_given(): void
    {
        [$incident] = $this->linkedIncident();
        Sanctum::actingAs($this->user('broker'), ['*']);

        $this->apiPut("/v2/admin/volunteering/incidents/{$incident->id}", ['status' => 'investigating', 'reason' => 'Called the organisation.'])->assertStatus(200);

        $this->assertSame('Called the organisation.', DB::table('vol_incident_events')->where('incident_id', $incident->id)->where('event_type', 'status_changed')->value('body'));
    }

    public function test_invalid_fields_are_422_with_the_field_and_unknown_incident_is_404(): void
    {
        [$incident] = $this->linkedIncident();
        Sanctum::actingAs($this->user('broker'), ['*']);

        $this->apiPut("/v2/admin/volunteering/incidents/{$incident->id}", ['severity' => 'apocalyptic'])
            ->assertStatus(422)->assertJsonPath('errors.0.field', 'severity');
        $this->apiPut("/v2/admin/volunteering/incidents/{$incident->id}", ['incident_date' => '2026-02-31'])
            ->assertStatus(422)->assertJsonPath('errors.0.field', 'incident_date');
        $this->apiPut('/v2/admin/volunteering/incidents/999999999', ['severity' => 'low'])->assertStatus(404);
    }

    public function test_moving_organisation_ends_the_share_and_hides_it_from_the_old_one(): void
    {
        [$incident, $orgId] = $this->linkedIncident();
        $lead = $this->user();
        DB::table('vol_organizations')->where('id', $orgId)->update(['dlp_user_id' => $lead->id]);
        $staff = $this->user('broker');
        app(IncidentShareService::class)->share($this->testTenantId, $incident, (int) $staff->id);
        $newOrg = $this->organisation($this->user(), 'INCUPD New Org');

        Sanctum::actingAs($staff, ['*']);
        $this->apiPut("/v2/admin/volunteering/incidents/{$incident->id}", ['organization_id' => $newOrg])->assertStatus(200);

        $withdrawn = DB::table('vol_incident_events')->where('incident_id', $incident->id)->where('event_type', 'share_withdrawn')->first();
        $this->assertNotNull($withdrawn);
        $this->assertSame('organisation_changed', json_decode($withdrawn->data, true)['reason']);
        $this->assertSame(0, DB::table('vol_incident_shares')->where('incident_id', $incident->id)->whereNull('withdrawn_at')->count());
    }

    public function test_action_taken_and_resolution_notes_are_no_longer_accepted(): void
    {
        [$incident] = $this->linkedIncident();
        Sanctum::actingAs($this->user('broker'), ['*']);

        $this->apiPut("/v2/admin/volunteering/incidents/{$incident->id}", ['action_taken' => 'x'])
            ->assertStatus(422)->assertJsonPath('errors.0.field', 'action_taken');
        $this->apiPut("/v2/admin/volunteering/incidents/{$incident->id}", ['resolution_notes' => 'x'])
            ->assertStatus(422)->assertJsonPath('errors.0.field', 'resolution_notes');
    }
}
