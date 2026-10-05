<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Controllers;

use App\Core\TenantContext;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Queue;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * Volunteering safeguarding incidents could not be tied to anything: the report
 * forms sent only a title, description, severity and category, so every incident
 * reached staff with no organisation, no opportunity, no person, type "other" and
 * today's date. And staff had no way to hand an incident to a named handler.
 *
 * Pins: the report-options list the forms choose from; the extra fields are
 * stored; a future date and a mismatched opportunity are refused; the staff list
 * carries the people an incident can be handed to; handing it over notifies the
 * handler and only broker-tier staff can be chosen.
 */
final class VolunteerIncidentReportingTest extends TestCase
{
    use DatabaseTransactions;

    private int $orgId = 0;
    private int $opportunityId = 0;

    protected function setUp(): void
    {
        parent::setUp();
        Queue::fake();
        Mail::fake();
        $this->withoutMiddleware([
            \Illuminate\Routing\Middleware\ThrottleRequests::class,
            \Illuminate\Routing\Middleware\ThrottleRequestsWithRedis::class,
        ]);
        $row = DB::table('tenants')->where('id', $this->testTenantId)->first(['features']);
        $features = json_decode((string) ($row->features ?? '{}'), true) ?: [];
        $features['volunteering'] = true;
        DB::table('tenants')->where('id', $this->testTenantId)->update(['features' => json_encode($features)]);
        TenantContext::setById($this->testTenantId);

        $owner = $this->user('member');
        $this->orgId = $this->organisation((int) $owner->id, 'INCREP Food Bank', 'active');
        $this->opportunityId = $this->opportunity($this->orgId, 'INCREP Sorting donations');
    }

    public function test_report_options_list_this_communitys_active_organisations_and_their_opportunities(): void
    {
        $owner = $this->user('member');
        $pendingOrg = $this->organisation((int) $owner->id, 'INCREP Pending Org', 'pending');
        $this->opportunity($pendingOrg, 'INCREP Pending opportunity');

        Sanctum::actingAs($this->user('member'), ['*']);
        $response = $this->apiGet('/v2/volunteering/incidents/report-options');
        $response->assertStatus(200);

        $data = $response->json('data');
        $orgNames = array_column($data['organisations'], 'name');
        $this->assertContains('INCREP Food Bank', $orgNames);
        $this->assertNotContains('INCREP Pending Org', $orgNames);

        $opportunity = collect($data['opportunities'])->firstWhere('id', $this->opportunityId);
        $this->assertNotNull($opportunity);
        $this->assertSame('INCREP Sorting donations', $opportunity['title']);
        $this->assertSame($this->orgId, $opportunity['organization_id']);
        $this->assertSame('INCREP Food Bank', $opportunity['organization_name']);
        $this->assertNotContains('INCREP Pending opportunity', array_column($data['opportunities'], 'title'));

        // Only what the form needs — never the organisation's internal fields.
        $this->assertSame(['id', 'name'], array_keys($data['organisations'][0]));
    }

    public function test_report_options_need_a_signed_in_member(): void
    {
        $this->apiGet('/v2/volunteering/incidents/report-options')->assertStatus(401);
    }

    public function test_a_report_stores_organisation_opportunity_person_type_and_date(): void
    {
        $reporter = $this->user('member');
        $subject = $this->user('member');
        Sanctum::actingAs($reporter, ['*']);

        $response = $this->apiPost('/v2/volunteering/incidents', [
            'title' => 'INCREP full report',
            'description' => 'A volunteer was left alone with a client for hours.',
            'severity' => 'high',
            'incident_type' => 'concern',
            'incident_date' => now()->subDays(3)->toDateString(),
            'organization_id' => $this->orgId,
            'opportunity_id' => $this->opportunityId,
            'subject_user_id' => $subject->id,
        ]);
        $response->assertStatus(201);

        $row = DB::table('vol_safeguarding_incidents')->where('title', 'INCREP full report')->first();
        $this->assertNotNull($row);
        $this->assertSame('concern', $row->incident_type);
        $this->assertSame(now()->subDays(3)->toDateString(), (string) $row->incident_date);
        $this->assertSame($this->orgId, (int) $row->organization_id);
        $this->assertSame($this->opportunityId, (int) $row->opportunity_id);
        $this->assertSame((int) $subject->id, (int) $row->subject_user_id);
    }

    public function test_a_blank_date_means_today(): void
    {
        Sanctum::actingAs($this->user('member'), ['*']);

        $this->apiPost('/v2/volunteering/incidents', [
            'title' => 'INCREP blank date',
            'description' => 'Something worrying happened this morning on shift.',
            'severity' => 'low',
            'incident_date' => '',
        ])->assertStatus(201);

        $this->assertSame(
            now()->toDateString(),
            (string) DB::table('vol_safeguarding_incidents')->where('title', 'INCREP blank date')->value('incident_date')
        );
    }

    public function test_a_date_in_the_future_is_refused(): void
    {
        Sanctum::actingAs($this->user('member'), ['*']);

        $this->apiPost('/v2/volunteering/incidents', [
            'title' => 'INCREP future',
            'description' => 'This date has not happened yet, so it is a mistake.',
            'severity' => 'low',
            'incident_date' => now()->addDays(2)->toDateString(),
        ])->assertStatus(422);

        $this->assertFalse(DB::table('vol_safeguarding_incidents')->where('title', 'INCREP future')->exists());
    }

    public function test_an_opportunity_from_another_organisation_is_refused(): void
    {
        $otherOrg = $this->organisation((int) $this->user('member')->id, 'INCREP Other Org', 'active');
        Sanctum::actingAs($this->user('member'), ['*']);

        $this->apiPost('/v2/volunteering/incidents', [
            'title' => 'INCREP mismatch',
            'description' => 'The opportunity chosen belongs to a different organisation.',
            'severity' => 'low',
            'organization_id' => $otherOrg,
            'opportunity_id' => $this->opportunityId,
        ])->assertStatus(422);

        $this->assertFalse(DB::table('vol_safeguarding_incidents')->where('title', 'INCREP mismatch')->exists());
    }

    public function test_the_staff_list_names_who_can_handle_an_incident_and_the_opportunity(): void
    {
        $broker = $this->user('broker');
        $member = $this->user('member');
        $this->incident((int) $member->id, 'INCREP listed');

        Sanctum::actingAs($broker, ['*']);
        $response = $this->apiGet('/v2/admin/volunteering/incidents');
        $response->assertStatus(200);

        $handlerIds = array_column($response->json('data.handlers'), 'id');
        $this->assertContains((int) $broker->id, $handlerIds);
        $this->assertNotContains((int) $member->id, $handlerIds, 'an ordinary member cannot handle a safeguarding incident');

        $incident = collect($response->json('data.incidents'))->firstWhere('title', 'INCREP listed');
        $this->assertSame('INCREP Sorting donations', $incident['opportunity_title']);
        $this->assertSame('INCREP Food Bank', $incident['organization_name']);
    }

    /**
     * The staff screen asked for one page of 20 and had no way to ask for more,
     * so incident 21 onwards could not be reached at all. The API must page
     * through everything and say how many there are.
     */
    public function test_the_staff_list_pages_through_every_incident(): void
    {
        // Only this test's incidents, so the counts are exact on a shared DB.
        $otherOwner = $this->user('member');
        $orgId = $this->organisation((int) $otherOwner->id, 'INCPAGE Org', 'active');
        $member = $this->user('member');
        for ($i = 1; $i <= 23; $i++) {
            $id = $this->incident((int) $member->id, sprintf('INCPAGE %02d', $i));
            DB::table('vol_safeguarding_incidents')->where('id', $id)->update(['organization_id' => $orgId, 'opportunity_id' => null]);
        }

        Sanctum::actingAs($this->user('broker'), ['*']);
        $first = $this->apiGet('/v2/admin/volunteering/incidents?search=INCPAGE&per_page=20&page=1');
        $first->assertStatus(200);
        $this->assertSame(23, $first->json('data.total'));
        $this->assertCount(20, $first->json('data.incidents'));

        $second = $this->apiGet('/v2/admin/volunteering/incidents?search=INCPAGE&per_page=20&page=2');
        $second->assertStatus(200);
        $this->assertSame(23, $second->json('data.total'));
        $this->assertCount(3, $second->json('data.incidents'));

        $seen = array_merge(
            array_column($first->json('data.incidents'), 'id'),
            array_column($second->json('data.incidents'), 'id'),
        );
        $this->assertCount(23, array_unique($seen), 'no incident is missed or shown twice across the pages');
    }

    public function test_staff_can_search_incidents_by_words_organisation_and_the_people_on_them(): void
    {
        $reporter = $this->user('member');
        $subject = $this->user('member');
        DB::table('users')->where('id', $subject->id)->update(['name' => 'Zebedee Incsearchperson']);

        $aboutSubject = $this->incident((int) $reporter->id, 'INCSRCH about a person');
        DB::table('vol_safeguarding_incidents')->where('id', $aboutSubject)->update(['subject_user_id' => $subject->id]);
        $this->incident((int) $reporter->id, 'INCSRCH loose paving');

        Sanctum::actingAs($this->user('broker'), ['*']);

        $titles = fn (string $q) => array_column(
            $this->apiGet('/v2/admin/volunteering/incidents?search=' . urlencode($q))->assertStatus(200)->json('data.incidents'),
            'title'
        );

        $this->assertSame(['INCSRCH loose paving'], $titles('INCSRCH loose'));
        $this->assertSame(['INCSRCH about a person'], $titles('Incsearchperson'));
        // The organisation's name finds both of this test's incidents.
        $byOrg = $titles('INCREP Food Bank');
        $this->assertContains('INCSRCH about a person', $byOrg);
        $this->assertContains('INCSRCH loose paving', $byOrg);
        // A literal "%" is a character to find, not a wildcard matching everything.
        $this->assertSame([], $titles('INCSRCH%paving'));
    }

    public function test_an_unknown_status_filter_is_ignored_rather_than_hiding_everything(): void
    {
        $member = $this->user('member');
        $this->incident((int) $member->id, 'INCSTAT still listed');

        Sanctum::actingAs($this->user('broker'), ['*']);
        $titles = array_column(
            $this->apiGet('/v2/admin/volunteering/incidents?status=bogus&search=INCSTAT')->assertStatus(200)->json('data.incidents'),
            'title'
        );
        $this->assertSame(['INCSTAT still listed'], $titles);

        $none = $this->apiGet('/v2/admin/volunteering/incidents?status=closed&search=INCSTAT')->assertStatus(200);
        $this->assertSame([], $none->json('data.incidents'));
    }

    public function test_handing_an_incident_to_a_broker_records_it_and_tells_them(): void
    {
        $handler = $this->user('broker');
        $incidentId = $this->incident((int) $this->user('member')->id, 'INCREP handover');
        Sanctum::actingAs($this->user('broker'), ['*']);

        $this->apiPut("/v2/admin/volunteering/incidents/{$incidentId}", [
            'assigned_to' => (string) $handler->id,
        ])->assertStatus(200);

        $this->assertSame((int) $handler->id, (int) DB::table('vol_safeguarding_incidents')->where('id', $incidentId)->value('assigned_to'));
        $this->assertTrue(
            DB::table('notifications')
                ->where('tenant_id', $this->testTenantId)
                ->where('user_id', $handler->id)
                ->where('type', 'safeguarding_assignment')
                ->exists(),
            'the new handler is told the incident is theirs'
        );
    }

    public function test_an_ordinary_member_cannot_be_made_the_handler(): void
    {
        $member = $this->user('member');
        $incidentId = $this->incident((int) $this->user('member')->id, 'INCREP member handler');
        Sanctum::actingAs($this->user('broker'), ['*']);

        $this->apiPut("/v2/admin/volunteering/incidents/{$incidentId}", [
            'assigned_to' => $member->id,
        ])->assertStatus(422)->assertJsonPath('errors.0.field', 'assigned_to');

        $this->assertNull(DB::table('vol_safeguarding_incidents')->where('id', $incidentId)->value('assigned_to'));
    }

    public function test_the_handler_can_be_cleared(): void
    {
        $handler = $this->user('broker');
        $incidentId = $this->incident((int) $this->user('member')->id, 'INCREP clear handler');
        DB::table('vol_safeguarding_incidents')->where('id', $incidentId)->update(['assigned_to' => $handler->id]);
        Sanctum::actingAs($this->user('broker'), ['*']);

        $this->apiPut("/v2/admin/volunteering/incidents/{$incidentId}", [
            'assigned_to' => null,
        ])->assertStatus(200);

        $this->assertNull(DB::table('vol_safeguarding_incidents')->where('id', $incidentId)->value('assigned_to'));
    }

    private function incident(int $reporterId, string $title): int
    {
        return (int) DB::table('vol_safeguarding_incidents')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'reported_by' => $reporterId,
            'title' => $title,
            'incident_type' => 'concern',
            'category' => 'general',
            'severity' => 'medium',
            'description' => $title . ' narrative',
            'organization_id' => $this->orgId,
            'opportunity_id' => $this->opportunityId,
            'status' => 'open',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function organisation(int $ownerId, string $name, string $status): int
    {
        return (int) DB::table('vol_organizations')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $ownerId,
            'name' => $name,
            'status' => $status,
            'created_at' => now(),
        ]);
    }

    private function opportunity(int $orgId, string $title): int
    {
        return (int) DB::table('vol_opportunities')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'organization_id' => $orgId,
            'title' => $title,
            'description' => $title . ' description',
            'is_active' => 1,
            'created_at' => now(),
        ]);
    }

    private function user(string $role): User
    {
        $u = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true]);
        DB::table('users')->where('id', $u->id)->update(['role' => $role]);

        return User::find($u->id);
    }
}
