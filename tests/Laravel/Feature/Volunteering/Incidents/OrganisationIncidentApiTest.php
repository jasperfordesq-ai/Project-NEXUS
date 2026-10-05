<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Volunteering\Incidents;

use App\Models\User;
use App\Services\Volunteering\IncidentShareService;
use App\Services\Volunteering\IncidentTimelineService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Queue;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/** Spec §4.3: the organisation an incident is linked to — who may look, and what they see. */
final class OrganisationIncidentApiTest extends TestCase
{
    use DatabaseTransactions;
    use IncidentFixtures;

    private User $owner;
    private User $orgAdmin;
    private User $lead;
    private User $deputy;
    private User $reporter;
    private int $orgId;
    private object $incident;

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

        $this->owner = $this->user();
        $this->orgAdmin = $this->user();
        $this->lead = $this->user();   // the lead need not be an organisation member
        $this->deputy = $this->user();
        $this->reporter = $this->user();
        DB::table('users')->where('id', $this->reporter->id)->update(['name' => 'INCORG Reporter Name']);
        $this->orgId = $this->organisation($this->owner, 'INCORG Org', [
            'dlp_user_id' => $this->lead->id, 'deputy_dlp_user_id' => $this->deputy->id,
        ]);
        $this->orgMember($this->orgId, $this->orgAdmin, 'admin');
        $oppId = $this->opportunity($this->orgId, 'INCORG Opp');
        $this->incident = $this->incident($this->reporter, [
            'title' => 'INCORG secret title', 'description' => 'INCORG secret description of what happened.',
            'organization_id' => $this->orgId, 'opportunity_id' => $oppId,
        ]);
    }

    private function listUri(?int $orgId = null): string
    {
        return '/v2/volunteering/organisations/' . ($orgId ?? $this->orgId) . '/incidents';
    }

    private function itemUri(?int $orgId = null, ?int $id = null): string
    {
        return $this->listUri($orgId) . '/' . ($id ?? (int) $this->incident->id);
    }

    public function test_owner_admin_lead_and_deputy_see_the_list(): void
    {
        foreach ([$this->owner, $this->orgAdmin, $this->lead, $this->deputy] as $who) {
            Sanctum::actingAs($who, ['*']);
            $response = $this->apiGet($this->listUri())->assertStatus(200);
            $this->assertSame([(int) $this->incident->id], array_column($response->json('data.items'), 'id'));
            $this->assertFalse($response->json('data.items.0.full_report_shared'));
            $this->assertStringNotContainsString('INCORG secret', $response->getContent());
            $this->assertStringNotContainsString('INCORG Reporter Name', $response->getContent());
        }
    }

    public function test_people_with_no_relation_to_the_organisation_are_refused(): void
    {
        $otherOrgAdmin = $this->user();
        $this->orgMember($this->organisation($this->user(), 'INCORG Other'), $otherOrgAdmin, 'admin');
        $plainMember = $this->user();
        $this->orgMember($this->orgId, $plainMember, 'member');
        $removedAdmin = $this->user();
        $this->orgMember($this->orgId, $removedAdmin, 'admin', 'removed');

        foreach ([$plainMember, $removedAdmin, $otherOrgAdmin, $this->user('broker'), $this->reporter] as $who) {
            Sanctum::actingAs($who, ['*']);
            $response = $this->apiGet($this->listUri());
            $response->assertStatus(403)->assertJsonPath('errors.0.code', 'NOT_ORGANISATION_CONTACT');
            $this->assertStringNotContainsString('INCORG', $response->getContent());
            $this->apiGet($this->itemUri())->assertStatus(404);
        }
    }

    public function test_a_contact_sees_the_summary_and_never_the_report(): void
    {
        $timeline = app(IncidentTimelineService::class);
        $staff = $this->user('broker');
        $timeline->record($this->testTenantId, (int) $this->incident->id, 'reporter_addition', $this->reporter->id, 'reporter', 'INCORG reporter addition text');
        $timeline->record($this->testTenantId, (int) $this->incident->id, 'message_to_organisation', $staff->id, 'staff', 'Please call the team.', [], $this->orgId);
        Sanctum::actingAs($this->orgAdmin, ['*']);

        $response = $this->apiGet($this->itemUri())->assertStatus(200);
        $view = $response->json('data');

        $this->assertSame('org_contact', $view['relation']);
        $this->assertFalse($view['full_report_shared']);
        $this->assertArrayNotHasKey('title', $view);
        $this->assertArrayNotHasKey('description', $view);
        $this->assertContains('message_to_organisation', array_column($view['timeline'], 'type'));
        $this->assertNotContains('reporter_addition', array_column($view['timeline'], 'type'));
        $this->assertStringNotContainsString('INCORG secret', $response->getContent());
        $this->assertStringNotContainsString('INCORG reporter addition', $response->getContent());
        $this->assertStringNotContainsString('INCORG Reporter Name', $response->getContent());
    }

    public function test_the_lead_sees_the_full_report_only_once_shared_and_never_who_reported_it(): void
    {
        app(IncidentTimelineService::class)->record($this->testTenantId, (int) $this->incident->id, 'reporter_addition', $this->reporter->id, 'reporter', 'INCORG reporter addition text');
        Sanctum::actingAs($this->lead, ['*']);

        $this->assertArrayNotHasKey('title', $this->apiGet($this->itemUri())->assertStatus(200)->json('data'));

        app(IncidentShareService::class)->share($this->testTenantId, $this->incident, $this->user('broker')->id);
        $response = $this->apiGet($this->itemUri())->assertStatus(200);
        $view = $response->json('data');

        $this->assertTrue($view['full_report_shared']);
        $this->assertSame('INCORG secret title', $view['title']);
        $this->assertContains('reporter_addition', array_column($view['timeline'], 'type'));
        $this->assertArrayNotHasKey('reporter_name', $view);
        $this->assertArrayNotHasKey('reported_by', $view);
        $this->assertStringNotContainsString('INCORG Reporter Name', $response->getContent());
        $this->assertStringNotContainsString('"actor_user_id"', $response->getContent());
        $this->assertTrue($this->apiGet($this->listUri())->json('data.items.0.full_report_shared'));
    }

    public function test_an_organisation_update_goes_on_the_timeline(): void
    {
        Sanctum::actingAs($this->orgAdmin, ['*']);

        $this->apiPost($this->itemUri() . '/updates', ['body' => '  We have stood the volunteer down pending review.  '])->assertStatus(201);

        $row = DB::table('vol_incident_events')->where('incident_id', $this->incident->id)->first();
        $this->assertSame('org_update', $row->event_type);
        $this->assertSame('organisation', $row->actor_role);
        $this->assertSame($this->orgId, (int) $row->organization_id);
        $this->assertSame('We have stood the volunteer down pending review.', $row->body);

        $this->apiPost($this->itemUri() . '/updates', ['body' => 'too short'])
            ->assertStatus(422)->assertJsonPath('errors.0.field', 'body');
        Sanctum::actingAs($this->user(), ['*']);
        $this->apiPost($this->itemUri() . '/updates', ['body' => 'Not my organisation but trying anyway.'])->assertStatus(404);
        $this->assertSame(1, DB::table('vol_incident_events')->where('incident_id', $this->incident->id)->count());
    }

    public function test_a_removed_org_admin_loses_access_at_once(): void
    {
        Sanctum::actingAs($this->orgAdmin, ['*']);
        $this->apiGet($this->itemUri())->assertStatus(200);

        DB::table('org_members')->where('organization_id', $this->orgId)->where('user_id', $this->orgAdmin->id)->update(['status' => 'removed']);

        $this->apiGet($this->itemUri())->assertStatus(404);
        $this->apiGet($this->listUri())->assertStatus(403);
    }

    public function test_an_incident_moved_to_another_organisation_disappears_from_the_old_one(): void
    {
        $newOrg = $this->organisation($this->user(), 'INCORG New');
        DB::table('vol_safeguarding_incidents')->where('id', $this->incident->id)->update(['organization_id' => $newOrg, 'opportunity_id' => null]);
        Sanctum::actingAs($this->orgAdmin, ['*']);

        $this->apiGet($this->itemUri())->assertStatus(404);
        $this->assertSame([], $this->apiGet($this->listUri())->assertStatus(200)->json('data.items'));
        // Asking for it through the new organisation's address does not help either.
        $this->apiGet($this->itemUri($newOrg))->assertStatus(404);
    }

    public function test_an_incident_about_the_org_admin_is_hidden_from_them(): void
    {
        DB::table('vol_safeguarding_incidents')->where('id', $this->incident->id)->update(['subject_user_id' => $this->orgAdmin->id]);
        Sanctum::actingAs($this->orgAdmin, ['*']);

        $this->assertSame([], $this->apiGet($this->listUri())->assertStatus(200)->json('data.items'));
        $this->apiGet($this->itemUri())->assertStatus(404);
        $this->apiPost($this->itemUri() . '/updates', ['body' => 'Trying to add to the incident about me.'])->assertStatus(404);
    }

    public function test_another_communitys_organisation_is_not_reachable(): void
    {
        $foreignOwner = $this->user('member', 999);
        Sanctum::actingAs($this->owner, ['*']);
        $foreignOrg = (int) DB::table('vol_organizations')->insertGetId([
            'tenant_id' => 999, 'user_id' => $foreignOwner->id, 'name' => 'INCORG Foreign', 'status' => 'active', 'created_at' => now(),
        ]);

        $this->apiGet($this->listUri($foreignOrg))->assertStatus(403);
    }
}
