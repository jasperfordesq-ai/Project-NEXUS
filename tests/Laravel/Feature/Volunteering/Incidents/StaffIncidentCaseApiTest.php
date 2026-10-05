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

/** Spec §4.1: the staff case file — read, notes, messages, sharing — and who is refused. */
final class StaffIncidentCaseApiTest extends TestCase
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

    public function test_the_case_file_has_the_full_record(): void
    {
        $lead = $this->user();
        [$incident, $orgId] = $this->linkedIncident();
        DB::table('vol_organizations')->where('id', $orgId)->update(['dlp_user_id' => $lead->id]);

        Sanctum::actingAs($this->user('broker'), ['*']);
        $case = $this->apiGet("/v2/admin/volunteering/incidents/{$incident->id}")->assertStatus(200)->json('data');

        $this->assertSame((int) $incident->id, $case['id']);
        $this->assertSame('INCCASE fixture', $case['title']);
        $this->assertArrayHasKey('reporter_name', $case);
        $this->assertIsArray($case['timeline']);
        $this->assertIsArray($case['handlers']);
        $this->assertSame([(int) $lead->id], array_column($case['organisation_leads'], 'id'));
        $this->assertNull($case['share']);
    }

    public function test_notes_and_messages_go_on_the_timeline(): void
    {
        [$incident] = $this->linkedIncident();
        $staff = $this->user('broker');
        Sanctum::actingAs($staff, ['*']);

        $this->apiPost("/v2/admin/volunteering/incidents/{$incident->id}/notes", ['body' => ' Called the volunteer. '])->assertStatus(201);
        $this->apiPost("/v2/admin/volunteering/incidents/{$incident->id}/messages", ['audience' => 'reporter', 'body' => 'Thank you, we are looking into it.'])->assertStatus(201);
        $this->apiPost("/v2/admin/volunteering/incidents/{$incident->id}/messages", ['audience' => 'organisation', 'body' => 'Please call us.'])->assertStatus(201);

        $rows = DB::table('vol_incident_events')->where('incident_id', $incident->id)->orderBy('id')->get();
        $this->assertSame(['staff_note', 'message_to_reporter', 'message_to_organisation'], $rows->pluck('event_type')->all());
        $this->assertSame('Called the volunteer.', $rows[0]->body);
        $this->assertSame((int) $staff->id, (int) $rows[0]->actor_user_id);
        $this->assertSame((int) $incident->organization_id, (int) $rows[2]->organization_id);
    }

    public function test_blank_text_and_bad_audiences_are_refused_with_the_field(): void
    {
        $incident = $this->incident($this->user()); // no organisation
        Sanctum::actingAs($this->user('broker'), ['*']);

        $this->apiPost("/v2/admin/volunteering/incidents/{$incident->id}/notes", ['body' => '   '])
            ->assertStatus(422)->assertJsonPath('errors.0.field', 'body');
        $this->apiPost("/v2/admin/volunteering/incidents/{$incident->id}/notes", ['body' => str_repeat('x', 5001)])
            ->assertStatus(422)->assertJsonPath('errors.0.field', 'body');
        $this->apiPost("/v2/admin/volunteering/incidents/{$incident->id}/messages", ['audience' => 'everyone', 'body' => 'Hello there.'])
            ->assertStatus(422)->assertJsonPath('errors.0.field', 'audience');
        $this->apiPost("/v2/admin/volunteering/incidents/{$incident->id}/messages", ['audience' => 'organisation', 'body' => 'Hello there.'])
            ->assertStatus(422)->assertJsonPath('errors.0.field', 'audience');
        $this->assertSame(0, DB::table('vol_incident_events')->where('incident_id', $incident->id)->count());
    }

    public function test_sharing_and_withdrawing(): void
    {
        [$incident, $orgId] = $this->linkedIncident();
        Sanctum::actingAs($this->user('broker'), ['*']);

        $this->apiPost("/v2/admin/volunteering/incidents/{$incident->id}/share")
            ->assertStatus(422)->assertJsonPath('errors.0.field', 'dlp_user_id');

        DB::table('vol_organizations')->where('id', $orgId)->update(['dlp_user_id' => $this->user()->id]);
        $this->apiPost("/v2/admin/volunteering/incidents/{$incident->id}/share")->assertStatus(201);
        $this->apiPost("/v2/admin/volunteering/incidents/{$incident->id}/share")->assertStatus(200);
        $this->assertNotNull($this->apiGet("/v2/admin/volunteering/incidents/{$incident->id}")->json('data.share'));

        $this->apiDelete("/v2/admin/volunteering/incidents/{$incident->id}/share")->assertStatus(200);
        $this->apiDelete("/v2/admin/volunteering/incidents/{$incident->id}/share")->assertStatus(200); // already withdrawn: harmless

        $noOrg = $this->incident($this->user());
        $this->apiPost("/v2/admin/volunteering/incidents/{$noOrg->id}/share")
            ->assertStatus(422)->assertJsonPath('errors.0.field', 'organization_id');
    }

    public function test_the_subject_on_staff_and_another_community_get_404_everywhere(): void
    {
        [$incident] = $this->linkedIncident();
        $subject = $this->user('broker');
        DB::table('vol_safeguarding_incidents')->where('id', $incident->id)->update(['subject_user_id' => $subject->id]);

        // The subject is told it does not exist; another community's admin is
        // stopped by the tenant middleware first (403). Neither learns anything.
        foreach ([[$subject, [404]], [$this->user('admin', 999), [403, 404]]] as [$who, $allowed]) {
            Sanctum::actingAs($who, ['*']);
            foreach ([
                $this->apiGet("/v2/admin/volunteering/incidents/{$incident->id}"),
                $this->apiPost("/v2/admin/volunteering/incidents/{$incident->id}/notes", ['body' => 'note']),
                $this->apiPost("/v2/admin/volunteering/incidents/{$incident->id}/messages", ['audience' => 'reporter', 'body' => 'hello']),
                $this->apiPost("/v2/admin/volunteering/incidents/{$incident->id}/share"),
                $this->apiDelete("/v2/admin/volunteering/incidents/{$incident->id}/share"),
            ] as $response) {
                $this->assertContains($response->getStatusCode(), $allowed, $response->getContent());
                $this->assertStringNotContainsString('INCCASE fixture', $response->getContent());
            }
        }
        $this->assertSame(0, DB::table('vol_incident_events')->where('incident_id', $incident->id)->count());
    }

    public function test_an_ordinary_member_is_refused(): void
    {
        [$incident] = $this->linkedIncident();
        Sanctum::actingAs($this->user(), ['*']);

        $this->assertContains($this->apiGet("/v2/admin/volunteering/incidents/{$incident->id}")->getStatusCode(), [401, 403]);
        $this->assertContains($this->apiPost("/v2/admin/volunteering/incidents/{$incident->id}/notes", ['body' => 'note'])->getStatusCode(), [401, 403]);
    }

    public function test_the_list_can_show_only_incidents_nobody_is_handling(): void
    {
        $reporter = $this->user();
        $handled = $this->incident($reporter, ['title' => 'INCLIST handled', 'assigned_to' => $this->user('broker')->id]);
        $unhandled = $this->incident($reporter, ['title' => 'INCLIST unhandled']);
        Sanctum::actingAs($this->user('broker'), ['*']);

        $titles = array_column($this->apiGet('/v2/admin/volunteering/incidents?handler=none&search=INCLIST')->assertStatus(200)->json('data.incidents'), 'title');
        $this->assertSame(['INCLIST unhandled'], $titles);
        $this->assertCount(2, $this->apiGet('/v2/admin/volunteering/incidents?search=INCLIST')->json('data.incidents'));
        unset($handled, $unhandled);
    }
}
