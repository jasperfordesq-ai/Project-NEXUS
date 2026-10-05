<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Volunteering\Incidents;

use App\Models\User;
use App\Services\EmailDispatchService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Laravel\Sanctum\Sanctum;
use Mockery;
use Tests\Laravel\TestCase;

/**
 * Behaviours pinned after the independent review of the incident case record
 * (5 October 2026): edge cases the first tests did not reach.
 */
final class IncidentReviewFixesTest extends TestCase
{
    use DatabaseTransactions;
    use IncidentFixtures;

    /** @var list<array{to:string,subject:string,body:string}> */
    private array $sent = [];

    protected function setUp(): void
    {
        parent::setUp();
        Queue::fake();
        $this->withoutMiddleware([
            \Illuminate\Routing\Middleware\ThrottleRequests::class,
            \Illuminate\Routing\Middleware\ThrottleRequestsWithRedis::class,
        ]);
        $this->enableVolunteering();
        $this->sent = [];
        $spy = Mockery::mock(EmailDispatchService::class);
        $spy->shouldReceive('send')->andReturnUsing(function (string $to, string $subject, string $body, array $options = []) {
            $this->sent[] = ['to' => $to, 'subject' => $subject, 'body' => $body];
            return true;
        });
        $this->app->instance(EmailDispatchService::class, $spy);
    }

    private function bells(User $user): array
    {
        return DB::table('notifications')->where('user_id', $user->id)->pluck('link')->all();
    }

    private function mailed(User $user): int
    {
        return count(array_filter($this->sent, fn ($m) => strcasecmp($m['to'], (string) $user->email) === 0));
    }

    public function test_a_report_whose_history_cannot_be_written_is_not_half_saved(): void
    {
        // Make the history insert fail, as a database error would.
        DB::connection()->beforeExecuting(function (string $query) {
            if (str_contains($query, 'insert into `vol_incident_events`')) {
                throw new \RuntimeException('timeline unavailable');
            }
        });
        Sanctum::actingAs($this->user(), ['*']);

        $response = $this->apiPost('/v2/volunteering/incidents', [
            'title' => 'INCREVIEW atomic', 'description' => 'A description that is long enough to be accepted.',
            'severity' => 'medium', 'incident_type' => 'concern',
        ]);

        $this->assertGreaterThanOrEqual(400, $response->getStatusCode());
        $this->assertSame(0, DB::table('vol_safeguarding_incidents')->where('title', 'INCREVIEW atomic')->count(),
            'no incident without its first history row — a retry must not create a duplicate');
    }

    public function test_information_from_a_reporter_who_is_also_the_handler_still_reaches_staff(): void
    {
        $reporterHandler = $this->user('broker');
        $otherStaff = $this->user('broker');
        $incident = $this->incident($reporterHandler, ['assigned_to' => $reporterHandler->id]);
        Sanctum::actingAs($reporterHandler, ['*']);

        $this->apiPost("/v2/volunteering/incidents/{$incident->id}/additions", ['body' => 'More detail that someone on the team must see.'])->assertStatus(201);

        $this->assertSame(1, $this->mailed($otherStaff), 'falls back to the rest of the team instead of telling nobody');
        $this->assertSame(0, $this->mailed($reporterHandler));
    }

    public function test_a_status_change_saved_with_a_new_handler_tells_the_new_handler_not_the_old(): void
    {
        $old = $this->user('broker');
        $new = $this->user('broker');
        $incident = $this->incident($this->user(), ['assigned_to' => $old->id]);
        Sanctum::actingAs($this->user('admin'), ['*']);

        $this->apiPut("/v2/admin/volunteering/incidents/{$incident->id}", ['status' => 'investigating', 'assigned_to' => $new->id])->assertStatus(200);

        $this->assertSame([], $this->bells($old), 'the previous handler is not told about a case no longer theirs');
        $this->assertGreaterThanOrEqual(2, count($this->bells($new)), 'assignment + status change');
    }

    public function test_a_status_change_does_not_tell_a_handler_who_has_lost_staff_access(): void
    {
        $handler = $this->user('broker');
        $incident = $this->incident($this->user(), ['assigned_to' => $handler->id]);
        DB::table('users')->where('id', $handler->id)->update(['role' => 'member']);
        Sanctum::actingAs($this->user('admin'), ['*']);

        $this->apiPut("/v2/admin/volunteering/incidents/{$incident->id}", ['status' => 'investigating'])->assertStatus(200);

        $this->assertSame([], $this->bells($handler));
    }

    public function test_a_lead_the_incident_is_about_is_not_offered_or_counted_as_a_reader(): void
    {
        $leadSubject = $this->user();
        $orgId = $this->organisation($this->user(), 'INCREVIEW Org', ['dlp_user_id' => $leadSubject->id]);
        $incident = $this->incident($this->user(), ['organization_id' => $orgId, 'subject_user_id' => $leadSubject->id]);
        Sanctum::actingAs($this->user('broker'), ['*']);

        $this->assertSame([], $this->apiGet("/v2/admin/volunteering/incidents/{$incident->id}")->json('data.organisation_leads'));
        $this->apiPost("/v2/admin/volunteering/incidents/{$incident->id}/share")
            ->assertStatus(422)->assertJsonPath('errors.0.field', 'dlp_user_id');
        $this->assertSame(0, DB::table('vol_incident_shares')->where('incident_id', $incident->id)->count());
    }

    public function test_an_organisation_cannot_add_to_a_closed_incident(): void
    {
        $owner = $this->user();
        $orgId = $this->organisation($owner, 'INCREVIEW Closed Org');
        $incident = $this->incident($this->user(), ['organization_id' => $orgId, 'status' => 'closed']);
        Sanctum::actingAs($owner, ['*']);

        $this->apiPost("/v2/volunteering/organisations/{$orgId}/incidents/{$incident->id}/updates", ['body' => 'An update after the incident was closed.'])
            ->assertStatus(409)->assertJsonPath('errors.0.code', 'INCIDENT_CLOSED');
    }

    public function test_staff_are_not_told_about_their_own_message_to_the_organisation(): void
    {
        $staffOrgAdmin = $this->user('broker');
        $orgId = $this->organisation($this->user(), 'INCREVIEW Msg Org');
        $this->orgMember($orgId, $staffOrgAdmin, 'admin');
        $incident = $this->incident($this->user(), ['organization_id' => $orgId]);
        Sanctum::actingAs($staffOrgAdmin, ['*']);

        $this->apiPost("/v2/admin/volunteering/incidents/{$incident->id}/messages", ['audience' => 'organisation', 'body' => 'Please call us today.'])->assertStatus(201);

        $this->assertSame(0, $this->mailed($staffOrgAdmin));
        $this->assertSame([], $this->bells($staffOrgAdmin));
    }

    public function test_withdrawing_a_share_twice_is_harmless(): void
    {
        $lead = $this->user();
        $orgId = $this->organisation($this->user(), 'INCREVIEW Share Org', ['dlp_user_id' => $lead->id]);
        $incident = $this->incident($this->user(), ['organization_id' => $orgId]);
        Sanctum::actingAs($this->user('broker'), ['*']);

        $this->apiPost("/v2/admin/volunteering/incidents/{$incident->id}/share")->assertStatus(201);
        $this->apiDelete("/v2/admin/volunteering/incidents/{$incident->id}/share")->assertStatus(200);
        $this->apiDelete("/v2/admin/volunteering/incidents/{$incident->id}/share")->assertStatus(200)->assertJsonPath('data.shared', false);
        $this->assertSame(1, DB::table('vol_incident_events')->where('incident_id', $incident->id)->where('event_type', 'share_withdrawn')->count());
    }

    public function test_the_organisation_list_does_not_query_per_incident(): void
    {
        $owner = $this->user();
        $orgId = $this->organisation($owner, 'INCREVIEW Busy Org');
        $oppId = $this->opportunity($orgId, 'INCREVIEW Opp');
        for ($i = 0; $i < 15; $i++) {
            $this->incident($this->user(), ['organization_id' => $orgId, 'opportunity_id' => $oppId]);
        }
        Sanctum::actingAs($owner, ['*']);

        DB::flushQueryLog();
        DB::enableQueryLog();
        $items = $this->apiGet("/v2/volunteering/organisations/{$orgId}/incidents")->assertStatus(200)->json('data.items');
        $queries = count(DB::getQueryLog());
        DB::disableQueryLog();

        $this->assertCount(15, $items);
        $this->assertSame('INCREVIEW Opp', $items[0]['opportunity_title']);
        $this->assertLessThan(40, $queries, "listing 15 incidents took {$queries} queries");
    }
}
