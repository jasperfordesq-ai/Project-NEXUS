<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Volunteering;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\EmailDispatchService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Laravel\Sanctum\Sanctum;
use Mockery;
use Tests\Laravel\TestCase;

/**
 * Who is told when a volunteering safeguarding incident is reported, and what
 * staff can change on it afterwards.
 *
 * Pins:
 * - every active administrator and broker is emailed — but never someone the
 *   incident is about (F-507), who used to receive the alert like everyone else;
 * - the staff email names the organisation, the opportunity and the kind of
 *   incident in words, not the stored code;
 * - the organisation's owner, admins and DLP are emailed a SHORTER notice that
 *   leaves out the title, the description and the reporter, and the reporter
 *   and plain members are not emailed;
 * - staff can link an incident to an organisation later, which tells that
 *   organisation; the opportunity and organisation must agree;
 * - staff can correct the type, severity and date and record the authorities.
 */
final class VolunteerIncidentNotificationTest extends TestCase
{
    use DatabaseTransactions;

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
        $row = DB::table('tenants')->where('id', $this->testTenantId)->first(['features']);
        $features = json_decode((string) ($row->features ?? '{}'), true) ?: [];
        $features['volunteering'] = true;
        DB::table('tenants')->where('id', $this->testTenantId)->update(['features' => json_encode($features)]);
        TenantContext::setById($this->testTenantId);

        $this->sent = [];
        $spy = Mockery::mock(EmailDispatchService::class);
        $spy->shouldReceive('send')->andReturnUsing(function (string $to, string $subject, string $body, array $options = []) {
            $this->sent[] = ['to' => $to, 'subject' => $subject, 'body' => $body];
            return true;
        });
        $this->app->instance(EmailDispatchService::class, $spy);
    }

    public function test_a_report_emails_every_admin_and_broker_with_the_organisation_named(): void
    {
        $admin = $this->user('admin');
        $broker = $this->user('broker');
        $member = $this->user('member');
        [$orgId, $oppId] = $this->organisationWithOpportunity($this->user('member'), 'INCNOTE Food Bank', 'INCNOTE Sorting');

        Sanctum::actingAs($member, ['*']);
        $this->report(['title' => 'INCNOTE staff alert', 'incident_type' => 'near_miss', 'organization_id' => $orgId, 'opportunity_id' => $oppId]);

        foreach ([$admin, $broker] as $staff) {
            $mail = $this->mailTo($staff);
            $this->assertNotNull($mail, "{$staff->role} is emailed");
            $this->assertStringContainsString('INCNOTE staff alert', $mail['subject']);
            $this->assertStringContainsString('INCNOTE Food Bank', $mail['body']);
            $this->assertStringContainsString('INCNOTE Sorting', $mail['body']);
            $this->assertStringContainsString('A near miss (nobody was harmed)', $mail['body'], 'the kind is in words');
            $this->assertStringNotContainsString('near_miss', $mail['body']);
        }
        // The reporting member gets their own confirmation, never the staff alert (spec §6).
        $this->assertStringContainsString('We have received your safeguarding report', (string) ($this->mailTo($member)['subject'] ?? ''));
        $this->assertCount(1, array_filter($this->sent, fn ($m) => strcasecmp($m['to'], (string) $member->email) === 0));
    }

    public function test_a_staff_member_the_incident_is_about_is_not_told(): void
    {
        $other = $this->user('broker');
        $subjectBroker = $this->user('broker');
        Sanctum::actingAs($this->user('member'), ['*']);

        $this->report(['title' => 'INCNOTE about a broker', 'subject_user_id' => $subjectBroker->id]);

        $this->assertNotNull($this->mailTo($other));
        $this->assertNull($this->mailTo($subjectBroker), 'F-507: no email about an incident about yourself');
        $this->assertFalse(
            DB::table('notifications')->where('user_id', $subjectBroker->id)->where('type', 'safeguarding_flag')->exists(),
            'F-507: no bell either'
        );
    }

    public function test_the_organisations_owner_admins_and_dlp_get_a_notice_without_the_details(): void
    {
        $owner = $this->user('member');
        $orgAdmin = $this->user('member');
        $dlp = $this->user('member');
        $plainMember = $this->user('member');
        $reporter = $this->user('member');
        [$orgId] = $this->organisationWithOpportunity($owner, 'INCNOTE Garden Trust', 'INCNOTE Weeding');
        $this->orgMember($orgId, $orgAdmin, 'admin');
        $this->orgMember($orgId, $plainMember, 'member');
        $this->orgMember($orgId, $reporter, 'admin'); // the reporter is an org admin too
        DB::table('vol_organizations')->where('id', $orgId)->update(['dlp_user_id' => $dlp->id]);

        Sanctum::actingAs($reporter, ['*']);
        $this->report([
            'title' => 'INCNOTE secret title',
            'description' => 'INCNOTE secret description of what the volunteer saw happen.',
            'organization_id' => $orgId,
        ]);

        $incidentId = (int) DB::table('vol_safeguarding_incidents')->where('title', 'INCNOTE secret title')->value('id');
        foreach ([$owner, $orgAdmin, $dlp] as $contact) {
            $mail = $this->mailTo($contact);
            $this->assertNotNull($mail, 'an organisation contact is emailed');
            $this->assertStringContainsString('INCNOTE Garden Trust', $mail['subject']);
            // 🔴 The organisation is told a report exists — not what it says or who made it.
            $this->assertStringNotContainsString('INCNOTE secret title', $mail['subject'] . $mail['body']);
            $this->assertStringNotContainsString('INCNOTE secret description', $mail['body']);
            $this->assertStringNotContainsString((string) $reporter->first_name, $mail['body']);
            $this->assertTrue(
                DB::table('notifications')->where('user_id', $contact->id)->where('type', 'safeguarding_flag')
                    ->where('link', "/volunteering/org/{$orgId}/safeguarding/{$incidentId}")->exists(),
                'and gets a bell pointing at the organisation page for that report'
            );
        }
        $this->assertNull($this->mailTo($plainMember), 'a plain member of the organisation is not told');
        // The reporter gets only their own confirmation — not the organisation's notice.
        $toReporter = array_values(array_filter($this->sent, fn ($m) => strcasecmp($m['to'], (string) $reporter->email) === 0));
        $this->assertCount(1, $toReporter, 'the reporter is not sent the organisation notice');
        $this->assertStringContainsString('We have received your safeguarding report', $toReporter[0]['subject']);
    }

    public function test_an_organisation_contact_the_incident_is_about_is_not_told(): void
    {
        $owner = $this->user('member');
        $orgAdmin = $this->user('member');
        [$orgId] = $this->organisationWithOpportunity($owner, 'INCNOTE Club', 'INCNOTE Coaching');
        $this->orgMember($orgId, $orgAdmin, 'admin');

        Sanctum::actingAs($this->user('member'), ['*']);
        $this->report(['title' => 'INCNOTE about the org admin', 'organization_id' => $orgId, 'subject_user_id' => $orgAdmin->id]);

        $this->assertNotNull($this->mailTo($owner));
        $this->assertNull($this->mailTo($orgAdmin));
    }

    public function test_staff_can_link_an_incident_to_an_organisation_which_tells_it(): void
    {
        $owner = $this->user('member');
        [$orgId, $oppId] = $this->organisationWithOpportunity($owner, 'INCNOTE Late Org', 'INCNOTE Late Opp');
        $incidentId = $this->incident((int) $this->user('member')->id, 'INCNOTE unlinked');
        Sanctum::actingAs($this->user('broker'), ['*']);

        // Choosing only the opportunity files it under that opportunity's organisation.
        $this->apiPut("/v2/admin/volunteering/incidents/{$incidentId}", ['opportunity_id' => $oppId])->assertStatus(200);

        $row = DB::table('vol_safeguarding_incidents')->where('id', $incidentId)->first();
        $this->assertSame($orgId, (int) $row->organization_id);
        $this->assertSame($oppId, (int) $row->opportunity_id);
        $this->assertNotNull($this->mailTo($owner), 'the newly linked organisation is told');

        // Saving again with the same organisation does not tell it twice.
        $this->sent = [];
        $this->apiPut("/v2/admin/volunteering/incidents/{$incidentId}", ['organization_id' => $orgId, 'opportunity_id' => $oppId])->assertStatus(200);
        $this->assertNull($this->mailTo($owner));
    }

    public function test_changing_the_organisation_drops_an_opportunity_from_the_old_one_and_a_mismatch_is_refused(): void
    {
        [$orgA, $oppA] = $this->organisationWithOpportunity($this->user('member'), 'INCNOTE Org A', 'INCNOTE Opp A');
        [$orgB] = $this->organisationWithOpportunity($this->user('member'), 'INCNOTE Org B', 'INCNOTE Opp B');
        $incidentId = $this->incident((int) $this->user('member')->id, 'INCNOTE move me');
        DB::table('vol_safeguarding_incidents')->where('id', $incidentId)->update(['organization_id' => $orgA, 'opportunity_id' => $oppA]);
        Sanctum::actingAs($this->user('broker'), ['*']);

        // An explicit pair that does not belong together is refused and nothing changes.
        $this->apiPut("/v2/admin/volunteering/incidents/{$incidentId}", ['organization_id' => $orgB, 'opportunity_id' => $oppA])
            ->assertStatus(422)->assertJsonPath('errors.0.field', 'opportunity_id');
        $this->assertSame($orgA, (int) DB::table('vol_safeguarding_incidents')->where('id', $incidentId)->value('organization_id'));

        $this->apiPut("/v2/admin/volunteering/incidents/{$incidentId}", ['organization_id' => $orgB])->assertStatus(200);
        $row = DB::table('vol_safeguarding_incidents')->where('id', $incidentId)->first();
        $this->assertSame($orgB, (int) $row->organization_id);
        $this->assertNull($row->opportunity_id, 'the old organisation’s opportunity is dropped');

        // And the link can be removed altogether.
        $this->apiPut("/v2/admin/volunteering/incidents/{$incidentId}", ['organization_id' => null])->assertStatus(200);
        $this->assertNull(DB::table('vol_safeguarding_incidents')->where('id', $incidentId)->value('organization_id'));
    }

    public function test_saving_without_changing_the_status_does_not_tell_the_reporter_it_changed(): void
    {
        $reporter = $this->user('member');
        $incidentId = $this->incident((int) $reporter->id, 'INCNOTE resave');
        Sanctum::actingAs($this->user('broker'), ['*']);
        $bells = fn () => DB::table('notifications')->where('user_id', $reporter->id)->where('type', 'safeguarding_flag')->count();

        // The staff screen sends the current status with every save.
        $this->apiPut("/v2/admin/volunteering/incidents/{$incidentId}", ['status' => 'open', 'severity' => 'high'])->assertStatus(200);
        $this->assertSame(0, $bells(), 'nothing changed for the reporter');

        $this->apiPut("/v2/admin/volunteering/incidents/{$incidentId}", ['status' => 'investigating'])->assertStatus(200);
        $this->assertSame(1, $bells(), 'a real status change is still news');
        $this->assertSame(
            "/volunteering/incidents/{$incidentId}",
            DB::table('notifications')->where('user_id', $reporter->id)->where('type', 'safeguarding_flag')->orderByDesc('id')->value('link'),
            'and links to the report\'s own page'
        );
    }

    public function test_staff_can_correct_type_severity_date_and_record_the_authorities(): void
    {
        $incidentId = $this->incident((int) $this->user('member')->id, 'INCNOTE correct me');
        Sanctum::actingAs($this->user('broker'), ['*']);
        $date = now()->subDays(5)->toDateString();

        $this->apiPut("/v2/admin/volunteering/incidents/{$incidentId}", [
            'incident_type' => 'allegation',
            'severity' => 'high',
            'incident_date' => $date,
            'authority_notified' => true,
            'authority_reference' => '  POL-2026-0042  ',
        ])->assertStatus(200);

        $row = DB::table('vol_safeguarding_incidents')->where('id', $incidentId)->first();
        $this->assertSame('allegation', $row->incident_type);
        $this->assertSame('high', $row->severity);
        $this->assertSame($date, (string) $row->incident_date);
        $this->assertSame(1, (int) $row->authority_notified);
        $this->assertSame('POL-2026-0042', $row->authority_reference);

        foreach ([
            ['incident_type' => 'invented'],
            ['severity' => 'apocalyptic'],
            ['incident_date' => now()->addDays(2)->toDateString()],
            ['incident_date' => '2026-02-31'],
            ['authority_reference' => str_repeat('x', 101)],
        ] as $bad) {
            $this->apiPut("/v2/admin/volunteering/incidents/{$incidentId}", $bad)->assertStatus(422);
        }
        $this->assertSame('allegation', DB::table('vol_safeguarding_incidents')->where('id', $incidentId)->value('incident_type'));
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    private function report(array $fields): void
    {
        $this->apiPost('/v2/volunteering/incidents', array_merge([
            'description' => 'A volunteer was left alone with a client for several hours.',
            'severity' => 'medium',
            'incident_type' => 'concern',
        ], $fields))->assertStatus(201);
    }

    /** @return array{to:string,subject:string,body:string}|null */
    private function mailTo(User $user): ?array
    {
        foreach ($this->sent as $mail) {
            if (strcasecmp($mail['to'], (string) $user->email) === 0) {
                return $mail;
            }
        }
        return null;
    }

    /** @return array{0:int,1:int} */
    private function organisationWithOpportunity(User $owner, string $name, string $opportunity): array
    {
        $orgId = (int) DB::table('vol_organizations')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $owner->id,
            'name' => $name,
            'status' => 'active',
            'created_at' => now(),
        ]);
        $oppId = (int) DB::table('vol_opportunities')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'organization_id' => $orgId,
            'title' => $opportunity,
            'description' => $opportunity . ' description',
            'is_active' => 1,
            'created_at' => now(),
        ]);
        return [$orgId, $oppId];
    }

    private function orgMember(int $orgId, User $user, string $role): void
    {
        DB::table('org_members')->insert([
            'tenant_id' => $this->testTenantId,
            'organization_id' => $orgId,
            'org_type' => 'volunteer',
            'user_id' => $user->id,
            'role' => $role,
            'status' => 'active',
            'created_at' => now(),
        ]);
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
            'status' => 'open',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function user(string $role): User
    {
        $u = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true]);
        DB::table('users')->where('id', $u->id)->update(['role' => $role]);

        return User::find($u->id);
    }
}
