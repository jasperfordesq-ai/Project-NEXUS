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
 * Spec §6: who is told what, by bell and email, about a safeguarding incident.
 * Every email says what happened and links to the right page; none carries text
 * anyone wrote (notes, messages, additions, updates).
 */
final class IncidentNotificationMatrixTest extends TestCase
{
    use DatabaseTransactions;
    use IncidentFixtures;

    private const SECRET = 'INCMATRIX private words nobody may email';

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

    /** @return list<array{to:string,subject:string,body:string}> */
    private function mailsTo(User $user): array
    {
        return array_values(array_filter($this->sent, fn ($m) => strcasecmp($m['to'], (string) $user->email) === 0));
    }

    private function bellLinks(User $user): array
    {
        return DB::table('notifications')->where('user_id', $user->id)->orderBy('id')->pluck('link')->all();
    }

    private function assertNoFreeTextEmailed(): void
    {
        foreach ($this->sent as $mail) {
            $this->assertStringNotContainsString(self::SECRET, $mail['subject'] . $mail['body']);
        }
    }

    /** An organisation with an owner, an admin, a lead and a deputy, and an open incident linked to it. */
    private function scene(?User $reporter = null, array $incident = []): array
    {
        $people = [
            'owner' => $this->user(), 'admin' => $this->user(), 'lead' => $this->user(), 'deputy' => $this->user(),
            'member' => $this->user(), 'reporter' => $reporter ?? $this->user(),
        ];
        $orgId = $this->organisation($people['owner'], 'INCMATRIX Org', [
            'dlp_user_id' => $people['lead']->id, 'deputy_dlp_user_id' => $people['deputy']->id,
        ]);
        $this->orgMember($orgId, $people['admin'], 'admin');
        $this->orgMember($orgId, $people['member'], 'member');
        $row = $this->incident($people['reporter'], array_merge(['organization_id' => $orgId], $incident));

        return [$row, $orgId, $people];
    }

    public function test_the_reporter_gets_a_confirmation_with_the_reference_and_no_details(): void
    {
        $reporter = $this->user();
        Sanctum::actingAs($reporter, ['*']);
        $id = (int) $this->apiPost('/v2/volunteering/incidents', [
            'title' => 'INCMATRIX title', 'description' => self::SECRET . ' and more description.',
            'severity' => 'medium', 'incident_type' => 'concern',
        ])->assertStatus(201)->json('data.id');

        $mails = $this->mailsTo($reporter);
        $this->assertCount(1, $mails);
        $this->assertStringContainsString("#{$id}", $mails[0]['subject'] . $mails[0]['body']);
        $this->assertContains("/volunteering/incidents/{$id}", $this->bellLinks($reporter));
        $this->assertNoFreeTextEmailed();
    }

    public function test_staff_who_report_get_the_confirmation_not_the_staff_alert(): void
    {
        $admin = $this->user('admin');
        Sanctum::actingAs($admin, ['*']);
        $this->apiPost('/v2/volunteering/incidents', [
            'title' => 'INCMATRIX staff report', 'description' => 'A description long enough to be accepted here.',
            'severity' => 'high', 'incident_type' => 'concern',
        ])->assertStatus(201);

        $mails = $this->mailsTo($admin);
        $this->assertCount(1, $mails, 'one email: the reporter confirmation');
        $this->assertStringNotContainsString('INCMATRIX staff report', $mails[0]['subject'], 'not the staff alert, which carries the title');
        $this->assertNotContains('/broker/safeguarding/volunteering', $this->bellLinks($admin));
    }

    public function test_a_status_change_emails_the_reporter_once_and_bells_the_organisation(): void
    {
        [$incident, $orgId, $p] = $this->scene(null, ['severity' => 'critical']);
        Sanctum::actingAs($this->user('broker'), ['*']);

        $this->apiPut("/v2/admin/volunteering/incidents/{$incident->id}", ['status' => 'investigating'])->assertStatus(200);

        $reporterMails = $this->mailsTo($p['reporter']);
        $this->assertCount(1, $reporterMails, 'one plain update — not also the staff-style alert');
        $this->assertStringNotContainsString('/broker/', $reporterMails[0]['body']);
        $this->assertContains("/volunteering/incidents/{$incident->id}", $this->bellLinks($p['reporter']));

        foreach (['owner', 'admin', 'lead', 'deputy'] as $who) {
            $this->assertContains("/volunteering/org/{$orgId}/safeguarding/{$incident->id}", $this->bellLinks($p[$who]), "{$who} gets a bell");
            $this->assertSame([], $this->mailsTo($p[$who]), "{$who} gets no email for a status change");
        }
        $this->assertSame([], $this->bellLinks($p['member']));
    }

    public function test_a_status_change_does_not_tell_an_organisation_admin_it_is_about(): void
    {
        $subject = $this->user();
        [$incident, $orgId, $p] = $this->scene();
        $this->orgMember($orgId, $subject, 'admin');
        DB::table('vol_safeguarding_incidents')->where('id', $incident->id)->update(['subject_user_id' => $subject->id]);
        Sanctum::actingAs($this->user('broker'), ['*']);

        $this->apiPut("/v2/admin/volunteering/incidents/{$incident->id}", ['status' => 'investigating'])->assertStatus(200);

        $this->assertSame([], $this->bellLinks($subject));
        $this->assertSame([], $this->mailsTo($subject));
    }

    public function test_a_message_to_the_reporter_reaches_only_the_reporter(): void
    {
        [$incident, , $p] = $this->scene();
        Sanctum::actingAs($this->user('broker'), ['*']);

        $this->apiPost("/v2/admin/volunteering/incidents/{$incident->id}/messages", ['audience' => 'reporter', 'body' => self::SECRET])->assertStatus(201);

        $this->assertCount(1, $this->mailsTo($p['reporter']));
        $this->assertContains("/volunteering/incidents/{$incident->id}", $this->bellLinks($p['reporter']));
        $this->assertCount(1, $this->sent, 'nobody else is emailed');
        $this->assertNoFreeTextEmailed();
    }

    public function test_a_message_to_the_organisation_reaches_its_owner_admins_and_leads_not_the_reporter(): void
    {
        $reporter = $this->user();
        [$incident, $orgId, $p] = $this->scene($reporter);
        $this->orgMember($orgId, $reporter, 'admin'); // the reporter also helps run the organisation
        Sanctum::actingAs($this->user('broker'), ['*']);

        $this->apiPost("/v2/admin/volunteering/incidents/{$incident->id}/messages", ['audience' => 'organisation', 'body' => self::SECRET])->assertStatus(201);

        foreach (['owner', 'admin', 'lead', 'deputy'] as $who) {
            $this->assertCount(1, $this->mailsTo($p[$who]), "{$who} is emailed");
            $this->assertContains("/volunteering/org/{$orgId}/safeguarding/{$incident->id}", $this->bellLinks($p[$who]));
        }
        $this->assertSame([], $this->mailsTo($reporter));
        $this->assertSame([], $this->mailsTo($p['member']));
        $this->assertNoFreeTextEmailed();
    }

    public function test_a_reporter_addition_goes_to_the_handler_when_there_is_one(): void
    {
        $handler = $this->user('broker');
        $otherStaff = $this->user('broker');
        [$incident, , $p] = $this->scene(null, ['assigned_to' => $handler->id]);
        Sanctum::actingAs($p['reporter'], ['*']);

        $this->apiPost("/v2/volunteering/incidents/{$incident->id}/additions", ['body' => self::SECRET])->assertStatus(201);

        $this->assertCount(1, $this->mailsTo($handler));
        $this->assertContains("/broker/safeguarding/volunteering/{$incident->id}", $this->bellLinks($handler));
        $this->assertSame([], $this->mailsTo($otherStaff));
        $this->assertSame([], $this->mailsTo($p['lead']), 'the organisation is not emailed about an addition');
        $this->assertNoFreeTextEmailed();
    }

    public function test_without_a_handler_an_organisation_update_goes_to_all_staff_except_its_subject(): void
    {
        $staffA = $this->user('broker');
        $staffB = $this->user('admin');
        $subjectStaff = $this->user('broker');
        [$incident, $orgId, $p] = $this->scene(null, ['subject_user_id' => $subjectStaff->id]);
        Sanctum::actingAs($p['owner'], ['*']);

        $this->apiPost("/v2/volunteering/organisations/{$orgId}/incidents/{$incident->id}/updates", ['body' => self::SECRET])->assertStatus(201);

        $this->assertCount(1, $this->mailsTo($staffA));
        $this->assertCount(1, $this->mailsTo($staffB));
        $this->assertSame([], $this->mailsTo($subjectStaff), 'F-507: never told about an incident about them');
        $this->assertSame([], $this->mailsTo($p['owner']), 'the writer is not told about their own update');
        $this->assertSame([], $this->mailsTo($p['reporter']));
        $this->assertNoFreeTextEmailed();
    }

    public function test_sharing_tells_the_lead_and_deputy_only(): void
    {
        [$incident, $orgId, $p] = $this->scene();
        Sanctum::actingAs($this->user('broker'), ['*']);

        $this->apiPost("/v2/admin/volunteering/incidents/{$incident->id}/share")->assertStatus(201);

        foreach (['lead', 'deputy'] as $who) {
            $this->assertCount(1, $this->mailsTo($p[$who]), "{$who} is emailed");
            $this->assertContains("/volunteering/org/{$orgId}/safeguarding/{$incident->id}", $this->bellLinks($p[$who]));
        }
        foreach (['owner', 'admin', 'member', 'reporter'] as $who) {
            $this->assertSame([], $this->mailsTo($p[$who]), "{$who} is not emailed about the share");
        }
        foreach ($this->sent as $mail) {
            $this->assertStringNotContainsString('INCCASE fixture', $mail['subject'] . $mail['body'], 'the email says sign in to read it');
        }
    }
}
