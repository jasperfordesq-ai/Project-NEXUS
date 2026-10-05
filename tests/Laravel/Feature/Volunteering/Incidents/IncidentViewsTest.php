<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Volunteering\Incidents;

use App\Services\Volunteering\IncidentShareService;
use App\Services\Volunteering\IncidentTimelineService;
use App\Services\Volunteering\IncidentViews;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/** Spec §3 matrix: each viewer relation gets exactly its row, built from the timeline. */
final class IncidentViewsTest extends TestCase
{
    use DatabaseTransactions;
    use IncidentFixtures;

    protected function setUp(): void
    {
        parent::setUp();
        $this->enableVolunteering();
    }

    public function test_each_relation_gets_exactly_its_matrix_row(): void
    {
        [$incident, $orgId] = $this->incidentWithEveryEvent();
        $events = app(IncidentTimelineService::class)->forIncident($this->testTenantId, (int) $incident->id);

        $staff = IncidentViews::staff($incident, $events, null);
        $this->assertSame('INCVIEW title', $staff['title']);
        $this->assertArrayHasKey('reporter_name', $staff);
        $this->assertCount(13, $staff['timeline']);

        $reporter = IncidentViews::reporter($incident, $events);
        $this->assertSame('INCVIEW title', $reporter['title']);
        foreach (['reporter_name', 'reported_by', 'assigned_to', 'assigned_to_name', 'authority_reference', 'authority_notified'] as $hidden) {
            $this->assertArrayNotHasKey($hidden, $reporter);
        }
        $this->assertEqualsCanonicalizing(
            ['reported', 'migrated', 'status_changed', 'message_to_reporter', 'reporter_addition'],
            array_values(array_unique(array_column($reporter['timeline'], 'type')))
        );
        foreach ($reporter['timeline'] as $e) {
            $this->assertArrayNotHasKey('actor_name', $e, 'the reporter never sees who on staff acted');
            if ($e['type'] === 'status_changed') {
                $this->assertArrayNotHasKey('body', $e, 'staff reasons are never shown to the reporter');
            }
        }

        $contact = IncidentViews::organisation($incident, $events, 'org_contact', false, $orgId);
        foreach (['title', 'description', 'subject_name', 'reporter_name', 'reported_by'] as $hidden) {
            $this->assertArrayNotHasKey($hidden, $contact);
        }
        $this->assertEqualsCanonicalizing(
            ['reported', 'migrated', 'status_changed', 'org_update', 'message_to_organisation'],
            array_values(array_unique(array_column($contact['timeline'], 'type')))
        );

        $leadShared = IncidentViews::organisation($incident, $events, 'org_lead', true, $orgId);
        $this->assertSame('INCVIEW title', $leadShared['title']);
        $this->assertSame('INCVIEW description of what happened.', $leadShared['description']);
        $this->assertArrayNotHasKey('reporter_name', $leadShared, 'never the reporter, even when shared');
        $this->assertArrayNotHasKey('reported_by', $leadShared);
        $this->assertContains('reporter_addition', array_column($leadShared['timeline'], 'type'));
        $this->assertContains('shared_with_organisation', array_column($leadShared['timeline'], 'type'));

        $leadUnshared = IncidentViews::organisation($incident, $events, 'org_lead', false, $orgId);
        $this->assertArrayNotHasKey('title', $leadUnshared);
        $this->assertNotContains('reporter_addition', array_column($leadUnshared['timeline'], 'type'));
    }

    public function test_an_organisation_never_sees_another_organisations_updates(): void
    {
        [$incident, $orgId] = $this->incidentWithEveryEvent();
        $timeline = app(IncidentTimelineService::class);
        $timeline->record($this->testTenantId, (int) $incident->id, 'org_update', null, 'organisation', 'From another org entirely.', [], $orgId + 1000);
        $events = $timeline->forIncident($this->testTenantId, (int) $incident->id);

        $view = IncidentViews::organisation($incident, $events, 'org_contact', false, $orgId);
        $this->assertNotContains('From another org entirely.', array_column($view['timeline'], 'body'));
    }

    public function test_an_unknown_event_type_or_role_is_refused(): void
    {
        $timeline = app(IncidentTimelineService::class);
        try {
            $timeline->record($this->testTenantId, 1, 'made_up', null, 'system');
            $this->fail('unknown type accepted');
        } catch (\InvalidArgumentException) {
        }
        $this->expectException(\InvalidArgumentException::class);
        $timeline->record($this->testTenantId, 1, 'staff_note', null, 'janitor');
    }

    public function test_share_needs_an_organisation_and_a_lead_and_ends_when_withdrawn(): void
    {
        $shares = app(IncidentShareService::class);
        $staff = $this->user('broker');
        $noOrg = $this->incident($this->user());
        $this->assertSame('no_organisation', $shares->share($this->testTenantId, $noOrg, (int) $staff->id));

        $orgId = $this->organisation($this->user(), 'INCVIEW NoLead');
        $noLead = $this->incident($this->user(), ['organization_id' => $orgId]);
        $this->assertSame('no_lead', $shares->share($this->testTenantId, $noLead, (int) $staff->id));

        $lead = $this->user();
        DB::table('vol_organizations')->where('id', $orgId)->update(['dlp_user_id' => $lead->id]);
        $this->assertSame('shared', $shares->share($this->testTenantId, $noLead, (int) $staff->id));
        $this->assertSame('already_shared', $shares->share($this->testTenantId, $noLead, (int) $staff->id));
        $this->assertNotNull($shares->activeShare($this->testTenantId, $noLead));
        $this->assertTrue($shares->withdraw($this->testTenantId, $noLead, (int) $staff->id));
        $this->assertNull($shares->activeShare($this->testTenantId, $noLead));
        $this->assertFalse($shares->withdraw($this->testTenantId, $noLead, (int) $staff->id), 'nothing left to withdraw');
        $this->assertSame(
            ['shared_with_organisation', 'share_withdrawn'],
            DB::table('vol_incident_events')->where('incident_id', $noLead->id)->orderBy('id')->pluck('event_type')->all()
        );
    }

    public function test_a_share_stops_counting_once_the_incident_belongs_to_another_organisation(): void
    {
        $shares = app(IncidentShareService::class);
        $lead = $this->user();
        $orgId = $this->organisation($this->user(), 'INCVIEW Lead Org', ['dlp_user_id' => $lead->id]);
        $incident = $this->incident($this->user(), ['organization_id' => $orgId]);
        $shares->share($this->testTenantId, $incident, (int) $this->user('broker')->id);

        $moved = clone $incident;
        $moved->organization_id = $orgId + 1;
        $this->assertNull($shares->activeShare($this->testTenantId, $moved));
    }

    /** @return array{0: object, 1: int} */
    private function incidentWithEveryEvent(): array
    {
        $subject = $this->user();
        [$incident, $orgId] = $this->linkedIncident();
        DB::table('vol_safeguarding_incidents')->where('id', $incident->id)->update([
            'title' => 'INCVIEW title', 'description' => 'INCVIEW description of what happened.', 'subject_user_id' => $subject->id,
        ]);
        $incident = DB::table('vol_safeguarding_incidents')->where('id', $incident->id)->first();
        $t = app(IncidentTimelineService::class);
        $id = (int) $incident->id;
        $staffId = (int) $this->user('broker')->id;
        $tid = $this->testTenantId;
        $t->record($tid, $id, 'reported', (int) $incident->reported_by, 'reporter');
        $t->record($tid, $id, 'status_changed', $staffId, 'staff', 'Staff reason', ['from' => 'open', 'to' => 'investigating']);
        $t->record($tid, $id, 'handler_changed', $staffId, 'staff', null, ['from_user_id' => null, 'to_user_id' => $staffId]);
        $t->record($tid, $id, 'filing_changed', $staffId, 'staff', null, ['severity' => ['from' => 'low', 'to' => 'medium']]);
        $t->record($tid, $id, 'authority_recorded', $staffId, 'staff', null, ['notified' => true, 'reference' => 'POL-1']);
        $t->record($tid, $id, 'staff_note', $staffId, 'staff', 'Private staff note');
        $t->record($tid, $id, 'message_to_reporter', $staffId, 'staff', 'Thanks, we are on it.');
        $t->record($tid, $id, 'message_to_organisation', $staffId, 'staff', 'Please stand the volunteer down.', [], $orgId);
        $t->record($tid, $id, 'reporter_addition', (int) $incident->reported_by, 'reporter', 'I remembered something else.');
        $t->record($tid, $id, 'org_update', null, 'organisation', 'Volunteer stood down.', [], $orgId);
        $t->record($tid, $id, 'shared_with_organisation', $staffId, 'staff', null, ['organization_id' => $orgId], $orgId);
        $t->record($tid, $id, 'share_withdrawn', $staffId, 'staff', null, ['organization_id' => $orgId, 'reason' => 'withdrawn'], $orgId);
        $t->record($tid, $id, 'migrated', null, 'system');

        return [$incident, $orgId];
    }
}
