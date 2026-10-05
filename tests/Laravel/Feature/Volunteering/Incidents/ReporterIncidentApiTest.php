<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Volunteering\Incidents;

use App\Services\Volunteering\IncidentTimelineService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Queue;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/** Spec §4.2: the person who reported an incident follows it and can add to it. */
final class ReporterIncidentApiTest extends TestCase
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

    public function test_an_administrators_list_holds_only_their_own_reports(): void
    {
        $admin = $this->user('admin');
        $this->incident($admin, ['title' => 'INCREP mine']);
        $this->incident($this->user(), ['title' => 'INCREP someone else']);
        Sanctum::actingAs($admin, ['*']);

        $items = $this->apiGet('/v2/volunteering/incidents')->assertStatus(200)->json('data.items');

        $this->assertSame(['INCREP mine'], array_column($items, 'title'));
        foreach (['id', 'title', 'status', 'severity', 'created_at', 'organization_name'] as $key) {
            $this->assertArrayHasKey($key, $items[0]);
        }
    }

    public function test_the_reporter_sees_their_report_and_only_their_part_of_the_timeline(): void
    {
        $reporter = $this->user();
        [$incident] = $this->linkedIncident($reporter);
        $staff = $this->user('broker');
        $timeline = app(IncidentTimelineService::class);
        $timeline->record($this->testTenantId, (int) $incident->id, 'staff_note', $staff->id, 'staff', 'INTERNAL note text');
        $timeline->record($this->testTenantId, (int) $incident->id, 'status_changed', $staff->id, 'staff', 'INTERNAL reason text', ['from' => 'open', 'to' => 'investigating']);
        $timeline->record($this->testTenantId, (int) $incident->id, 'message_to_reporter', $staff->id, 'staff', 'Thank you for telling us.');
        $timeline->record($this->testTenantId, (int) $incident->id, 'message_to_organisation', $staff->id, 'staff', 'INTERNAL org message', [], (int) $incident->organization_id);
        Sanctum::actingAs($reporter, ['*']);

        $response = $this->apiGet("/v2/volunteering/incidents/{$incident->id}")->assertStatus(200);
        $view = $response->json('data');

        $this->assertSame((int) $incident->id, $view['id']);
        $this->assertSame('INCCASE fixture', $view['title']);
        $this->assertTrue($view['can_add']);
        $this->assertSame(['status_changed', 'message_to_reporter'], array_column($view['timeline'], 'type'));
        $this->assertStringNotContainsString('INTERNAL', $response->getContent());
        $this->assertArrayNotHasKey('reporter_name', $view);
        $this->assertArrayNotHasKey('assigned_to', $view);
    }

    public function test_anyone_but_the_reporter_is_told_it_does_not_exist(): void
    {
        [$incident] = $this->linkedIncident();

        foreach ([$this->user(), $this->user('admin'), $this->user('broker')] as $who) {
            Sanctum::actingAs($who, ['*']);
            $response = $this->apiGet("/v2/volunteering/incidents/{$incident->id}");
            $response->assertStatus(404);
            $this->assertStringNotContainsString('INCCASE fixture', $response->getContent());
        }
    }

    public function test_the_reporter_can_add_information(): void
    {
        $reporter = $this->user();
        [$incident] = $this->linkedIncident($reporter);
        Sanctum::actingAs($reporter, ['*']);

        $this->apiPost("/v2/volunteering/incidents/{$incident->id}/additions", ['body' => '  It happened again on Tuesday evening.  '])
            ->assertStatus(201);

        $row = DB::table('vol_incident_events')->where('incident_id', $incident->id)->first();
        $this->assertSame('reporter_addition', $row->event_type);
        $this->assertSame('reporter', $row->actor_role);
        $this->assertSame((int) $reporter->id, (int) $row->actor_user_id);
        $this->assertSame('It happened again on Tuesday evening.', $row->body);
    }

    public function test_an_addition_must_be_20_to_5000_characters(): void
    {
        $reporter = $this->user();
        $incident = $this->incident($reporter);
        Sanctum::actingAs($reporter, ['*']);

        foreach ([str_repeat('x', 19), '   ' . str_repeat('x', 19) . '   ', str_repeat('x', 5001)] as $body) {
            $this->apiPost("/v2/volunteering/incidents/{$incident->id}/additions", ['body' => $body])
                ->assertStatus(422)->assertJsonPath('errors.0.field', 'body');
        }
        $this->assertSame(0, DB::table('vol_incident_events')->where('incident_id', $incident->id)->count());
    }

    public function test_cannot_add_to_a_closed_report(): void
    {
        $reporter = $this->user();
        $incident = $this->incident($reporter, ['status' => 'closed']);
        Sanctum::actingAs($reporter, ['*']);

        $this->assertFalse($this->apiGet("/v2/volunteering/incidents/{$incident->id}")->json('data.can_add'));
        $this->apiPost("/v2/volunteering/incidents/{$incident->id}/additions", ['body' => 'Something new happened after it closed.'])
            ->assertStatus(409)->assertJsonPath('errors.0.code', 'INCIDENT_CLOSED');
        $this->assertSame(0, DB::table('vol_incident_events')->where('incident_id', $incident->id)->count());
    }

    public function test_only_the_reporter_can_add(): void
    {
        [$incident] = $this->linkedIncident();

        foreach ([$this->user(), $this->user('admin')] as $who) {
            Sanctum::actingAs($who, ['*']);
            $this->apiPost("/v2/volunteering/incidents/{$incident->id}/additions", ['body' => 'Trying to add to a report that is not mine.'])
                ->assertStatus(404);
        }
        $this->assertSame(0, DB::table('vol_incident_events')->where('incident_id', $incident->id)->count());
    }

    public function test_a_reporter_who_disclosed_about_themselves_keeps_the_reporter_view(): void
    {
        $reporter = $this->user('broker');
        $incident = $this->incident($reporter, ['subject_user_id' => $reporter->id]);
        Sanctum::actingAs($reporter, ['*']);

        $this->apiGet("/v2/volunteering/incidents/{$incident->id}")->assertStatus(200)->assertJsonPath('data.id', (int) $incident->id);
        $this->apiPost("/v2/volunteering/incidents/{$incident->id}/additions", ['body' => 'More detail about what happened to me.'])
            ->assertStatus(201);
        // ... but never the staff case file.
        $this->apiGet("/v2/admin/volunteering/incidents/{$incident->id}")->assertStatus(404);
    }
}
