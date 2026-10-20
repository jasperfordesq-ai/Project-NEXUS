<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Volunteering;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\VolunteerWellbeingService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * A volunteer's own wellbeing check-in must count (owner report, 7 Oct 2026).
 *
 * Until then a check-in was stored and shown back to the volunteer, and used for
 * nothing else: six "Struggling" check-ins in three days left the wellbeing score
 * at 80 and told nobody. Now a Low or Struggling check-in lowers the score, and —
 * only when the volunteer agrees — tells the community's team (bell + email) and
 * the people who answer for the organisations they volunteer with. Organisations
 * get the name and how the volunteer feels, never the note. One alert a day.
 */
class VolunteerWellbeingMoodCheckinTest extends TestCase
{
    use DatabaseTransactions;

    private const NOTE = 'Private words only the team should read';

    private function enableVolunteering(): void
    {
        DB::table('tenants')->where('id', $this->testTenantId)->update([
            'features' => json_encode(['volunteering' => true, 'organisations' => true]),
        ]);
        TenantContext::setById($this->testTenantId);
    }

    private function person(array $overrides = [], ?int $tenantId = null): User
    {
        return User::factory()->forTenant($tenantId ?? $this->testTenantId)->create(array_merge([
            'status' => 'active',
            'is_approved' => true,
            'role' => 'member',
        ], $overrides));
    }

    /** An organisation the volunteer has an approved application with. Returns its owner. */
    private function organisationFor(User $volunteer): User
    {
        $owner = $this->person();
        $orgId = (int) DB::table('vol_organizations')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $owner->id,
            'name' => 'Wellbeing fixture organisation',
            'slug' => 'wellbeing-fixture-org-' . uniqid(),
            'status' => 'approved',
            'created_at' => now(),
        ]);
        $oppId = (int) DB::table('vol_opportunities')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'organization_id' => $orgId,
            'created_by' => $owner->id,
            'title' => 'Wellbeing fixture opportunity',
            'description' => 'Helping out.',
            'is_active' => 1,
            'status' => 'open',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        DB::table('vol_applications')->insert([
            'tenant_id' => $this->testTenantId,
            'opportunity_id' => $oppId,
            'user_id' => $volunteer->id,
            'status' => 'approved',
            'created_at' => now()->subDays(10),
            'updated_at' => now()->subDays(10),
        ]);

        return $owner;
    }

    private function checkin(User $volunteer, int $mood, ?bool $share, string $note = self::NOTE)
    {
        Sanctum::actingAs($volunteer, ['*']);
        $body = ['mood' => $mood, 'note' => $note];
        if ($share !== null) {
            $body['share_with_team'] = $share;
        }

        return $this->apiPost('/v2/volunteering/wellbeing/checkin', $body);
    }

    private function bellsFor(User $user): \Illuminate\Support\Collection
    {
        return DB::table('notifications')
            ->where('tenant_id', $this->testTenantId)
            ->where('user_id', $user->id)
            ->where('type', 'volunteer_wellbeing')
            ->get();
    }

    public function test_a_struggling_check_in_lowers_the_volunteers_own_score_even_when_not_shared(): void
    {
        $this->enableVolunteering();
        $volunteer = $this->person();

        Sanctum::actingAs($volunteer, ['*']);
        $before = $this->apiGet('/v2/volunteering/wellbeing')->assertOk()->json('data.score');

        $this->checkin($volunteer, 1, false)->assertOk();

        Sanctum::actingAs($volunteer, ['*']);
        $after = $this->apiGet('/v2/volunteering/wellbeing')->assertOk()->json('data');

        $this->assertSame(100, $before);
        $this->assertLessThan(50, $after['score']);
        $this->assertSame('high', $after['burnout_risk']);
        $this->assertNotEmpty($after['warnings']);
        $this->assertFalse($after['recent_checkins'][0]['shared']);
    }

    public function test_a_shared_struggling_check_in_tells_the_team_and_the_organisation(): void
    {
        $this->enableVolunteering();
        $volunteer = $this->person();
        $orgOwner = $this->organisationFor($volunteer);
        $admin = $this->person(['is_admin' => 1]);
        $broker = $this->person(['role' => 'broker']);
        $bystander = $this->person();
        $otherTenantAdmin = $this->person(['role' => 'admin'], $this->otherTenantId());

        $response = $this->checkin($volunteer, 1, true)->assertOk();
        $this->assertTrue($response->json('data.shared'));
        $this->assertTrue($response->json('data.team_notified'));

        $this->assertCount(1, $this->bellsFor($admin));
        $this->assertCount(1, $this->bellsFor($broker));
        $this->assertCount(1, $this->bellsFor($orgOwner));
        $this->assertCount(0, $this->bellsFor($bystander));
        $this->assertCount(0, $this->bellsFor($volunteer));
        $this->assertSame(0, DB::table('notifications')->where('user_id', $otherTenantAdmin->id)->where('type', 'volunteer_wellbeing')->count());

        // Nobody's bell carries the private note; the organisation's never does.
        foreach ([$admin, $broker, $orgOwner] as $recipient) {
            $this->assertStringNotContainsString(self::NOTE, (string) $this->bellsFor($recipient)->first()->message);
        }

        $alert = DB::table('vol_wellbeing_alerts')
            ->where('tenant_id', $this->testTenantId)
            ->where('user_id', $volunteer->id)
            ->where('status', 'active')
            ->first();
        $this->assertNotNull($alert, 'a shared struggling check-in raises an active alert');
        $this->assertSame(1, (int) $alert->coordinator_notified);

        $row = DB::table('vol_mood_checkins')->where('user_id', $volunteer->id)->first();
        $this->assertSame(1, (int) $row->share_with_team);
        $this->assertNotNull($row->team_notified_at);
    }

    public function test_the_team_and_the_organisation_are_emailed_without_the_note(): void
    {
        $this->enableVolunteering();
        $volunteer = $this->person();
        $orgOwner = $this->organisationFor($volunteer);
        $admin = $this->person(['is_admin' => 1]);

        $sent = [];
        $this->mock(\App\Services\EmailDispatchService::class, function ($mock) use (&$sent) {
            $mock->shouldReceive('send')->andReturnUsing(function (string $to, string $subject, string $body) use (&$sent) {
                $sent[$to] = ['subject' => $subject, 'body' => $body];
                return true;
            });
        });

        $this->checkin($volunteer, 1, true)->assertOk();

        $this->assertArrayHasKey($admin->email, $sent);
        $this->assertArrayHasKey($orgOwner->email, $sent);
        $this->assertArrayNotHasKey($volunteer->email, $sent);
        foreach ($sent as $email) {
            $this->assertStringNotContainsString(self::NOTE, $email['subject'] . $email['body']);
        }
        $this->assertStringContainsString('/admin/volunteering/wellbeing', $sent[$admin->email]['body']);
        $this->assertStringContainsString('/profile/' . $volunteer->id, $sent[$orgOwner->email]['body']);
        $this->assertStringContainsString('Wellbeing fixture organisation', $sent[$orgOwner->email]['body']);
        $this->assertStringNotContainsString('{{', $sent[$admin->email]['subject'] . $sent[$admin->email]['body']);
    }

    public function test_emails_go_on_the_queue_so_the_volunteer_is_not_kept_waiting(): void
    {
        $this->enableVolunteering();
        $volunteer = $this->person();
        $admin = $this->person(['is_admin' => 1]);
        \Illuminate\Support\Facades\Queue::fake();

        $this->checkin($volunteer, 1, true)->assertOk();

        // The bell is immediate; the email is queued on the emails queue.
        $this->assertCount(1, $this->bellsFor($admin));
        $adminRow = DB::table('vol_wellbeing_alert_notifications')
            ->where('tenant_id', $this->testTenantId)
            ->where('recipient_user_id', $admin->id)
            ->where('channel', 'email')
            ->first();
        $this->assertNotNull($adminRow, 'the queued email is recorded before the job runs');
        $this->assertSame('queued', $adminRow->status);
        \Illuminate\Support\Facades\Queue::assertPushedOn('emails', \App\Jobs\SendVolunteerLowMoodEmails::class, function ($job) use ($volunteer, $adminRow) {
            return $job->volunteerId === (int) $volunteer->id
                && in_array((int) $adminRow->id, $job->logRowIds, true)
                && !str_contains(serialize($job), self::NOTE);
        });
    }

    public function test_the_team_can_read_the_note_on_the_alert_and_brokers_can_open_it(): void
    {
        $this->enableVolunteering();
        $volunteer = $this->person();
        $broker = $this->person(['role' => 'broker']);

        $this->checkin($volunteer, 2, true)->assertOk();

        Sanctum::actingAs($broker, ['*']);
        $alerts = $this->apiGet('/v2/admin/volunteering/wellbeing/alerts')->assertOk()->json('data');
        $mine = collect($alerts)->firstWhere('user_id', $volunteer->id);

        $this->assertNotNull($mine);
        $this->assertSame('low_mood', $mine['reason']);
        $this->assertSame(2, $mine['latest_checkin']['mood']);
        $this->assertSame(self::NOTE, $mine['latest_checkin']['note']);

        Sanctum::actingAs($broker, ['*']);
        $this->apiPut('/v2/admin/volunteering/wellbeing/alerts/' . $mine['id'], ['status' => 'acknowledged'])->assertOk();
    }

    public function test_a_volunteer_who_does_not_agree_is_not_shared(): void
    {
        $this->enableVolunteering();
        $volunteer = $this->person();
        $admin = $this->person(['is_admin' => 1]);

        $response = $this->checkin($volunteer, 1, false)->assertOk();
        $this->assertFalse($response->json('data.team_notified'));

        $this->assertCount(0, $this->bellsFor($admin));
        $this->assertDatabaseMissing('vol_wellbeing_alerts', ['tenant_id' => $this->testTenantId, 'user_id' => $volunteer->id]);

        // The daily assessment must not surface a private check-in either.
        TenantContext::setById($this->testTenantId);
        VolunteerWellbeingService::detectBurnoutRisk((int) $volunteer->id, true);
        $this->assertDatabaseMissing('vol_wellbeing_alerts', ['tenant_id' => $this->testTenantId, 'user_id' => $volunteer->id]);
    }

    public function test_an_older_client_that_does_not_send_the_choice_is_not_shared(): void
    {
        $this->enableVolunteering();
        $volunteer = $this->person();
        $admin = $this->person(['is_admin' => 1]);

        $this->checkin($volunteer, 1, null)->assertOk();

        $this->assertCount(0, $this->bellsFor($admin));
        $this->assertSame(0, (int) DB::table('vol_mood_checkins')->where('user_id', $volunteer->id)->value('share_with_team'));
    }

    public function test_a_good_mood_tells_nobody_even_when_sharing_is_ticked(): void
    {
        $this->enableVolunteering();
        $volunteer = $this->person();
        $admin = $this->person(['is_admin' => 1]);

        $response = $this->checkin($volunteer, 4, true)->assertOk();

        $this->assertFalse($response->json('data.shared'));
        $this->assertCount(0, $this->bellsFor($admin));
        $this->assertDatabaseMissing('vol_wellbeing_alerts', ['tenant_id' => $this->testTenantId, 'user_id' => $volunteer->id]);
    }

    public function test_repeated_check_ins_on_the_same_day_alert_once(): void
    {
        $this->enableVolunteering();
        $volunteer = $this->person();
        $admin = $this->person(['is_admin' => 1]);

        $this->checkin($volunteer, 1, true)->assertOk();
        $second = $this->checkin($volunteer, 1, true)->assertOk();
        $this->checkin($volunteer, 2, true)->assertOk();

        $this->assertFalse($second->json('data.team_notified'));
        $this->assertCount(1, $this->bellsFor($admin));
        $this->assertSame(1, DB::table('vol_wellbeing_alerts')->where('user_id', $volunteer->id)->where('status', 'active')->count());
    }

    /**
     * Owner decision, 20 Oct 2026: for wellbeing the "never about yourself" rule
     * is dropped. On hOUR Timebank the owner was the only staff account, so the
     * list was empty and the feature looked dead. A lone admin who is the
     * volunteer is told, as the confirmation that someone was reached.
     */
    public function test_a_lone_admin_who_is_the_volunteer_is_still_told_as_a_confirmation(): void
    {
        $this->enableVolunteering();
        $volunteerAdmin = $this->person(['is_admin' => 1]);

        $response = $this->checkin($volunteerAdmin, 1, true)->assertOk();

        $this->assertTrue($response->json('data.team_notified'));
        $this->assertSame('told', $response->json('data.outcome'));
        $this->assertSame(1, $response->json('data.told_count'));
        $this->assertCount(1, $this->bellsFor($volunteerAdmin));
        $this->assertDatabaseHas('vol_wellbeing_alert_notifications', [
            'tenant_id' => $this->testTenantId,
            'volunteer_user_id' => $volunteerAdmin->id,
            'recipient_user_id' => $volunteerAdmin->id,
            'tier' => 'self',
            'channel' => 'bell',
            'status' => 'sent',
        ]);
    }

    public function test_team_notified_is_false_and_the_check_in_is_not_marked_when_nobody_can_be_told(): void
    {
        $this->enableVolunteering();
        // No staff, no organisation, no wellbeing contact, no community contact email.
        DB::table('tenants')->where('id', $this->testTenantId)->update(['contact_email' => null]);
        $volunteer = $this->person();

        $response = $this->checkin($volunteer, 1, true)->assertOk();

        $this->assertTrue($response->json('data.shared'));
        $this->assertFalse($response->json('data.team_notified'));
        $this->assertSame('nobody_available', $response->json('data.outcome'));
        $this->assertSame(0, $response->json('data.told_count'));
        $row = DB::table('vol_mood_checkins')->where('user_id', $volunteer->id)->first();
        $this->assertNull($row->team_notified_at, 'a day with nobody told must not block the next attempt');
        $this->assertNotNull(DB::table('vol_wellbeing_alerts')->where('user_id', $volunteer->id)->where('status', 'active')->first());
    }

    public function test_the_next_check_in_retries_when_nobody_could_be_told_before(): void
    {
        $this->enableVolunteering();
        DB::table('tenants')->where('id', $this->testTenantId)->update(['contact_email' => null]);
        $volunteer = $this->person();

        $this->checkin($volunteer, 1, true)->assertOk();
        $admin = $this->person(['is_admin' => 1]);
        $second = $this->checkin($volunteer, 1, true)->assertOk();

        $this->assertTrue($second->json('data.team_notified'));
        $this->assertSame('told', $second->json('data.outcome'));
        $this->assertCount(1, $this->bellsFor($admin));
    }

    public function test_a_second_shared_check_in_on_the_same_day_reports_already_told(): void
    {
        $this->enableVolunteering();
        $volunteer = $this->person();
        $this->person(['is_admin' => 1]);

        $this->checkin($volunteer, 1, true)->assertOk();
        $second = $this->checkin($volunteer, 2, true)->assertOk();

        $this->assertFalse($second->json('data.team_notified'));
        $this->assertSame('already_told_today', $second->json('data.outcome'));
        $this->assertNotNull($second->json('data.told_at'));
    }

    public function test_a_private_check_in_reports_private_and_a_good_mood_reports_not_low(): void
    {
        $this->enableVolunteering();
        $volunteer = $this->person();

        $this->assertSame('private', $this->checkin($volunteer, 1, false)->assertOk()->json('data.outcome'));
        $this->assertSame('not_low', $this->checkin($volunteer, 4, true)->assertOk()->json('data.outcome'));
    }

    /**
     * Production, 20 Oct 2026: the email subject read "Timebank Ireland said they
     * are feeling low" because the owner's account is an organisation profile.
     * A wellbeing message is about a person.
     */
    public function test_the_bell_and_email_use_the_persons_name_not_the_organisation_name(): void
    {
        $this->enableVolunteering();
        $volunteer = $this->person([
            'profile_type' => 'organisation',
            'organization_name' => 'Timebank Ireland',
            'first_name' => 'Jasper',
            'last_name' => 'Ford',
        ]);
        $admin = $this->person(['is_admin' => 1]);

        $sent = [];
        $this->mock(\App\Services\EmailDispatchService::class, function ($mock) use (&$sent) {
            $mock->shouldReceive('send')->andReturnUsing(function (string $to, string $subject, string $body) use (&$sent) {
                $sent[$to] = ['subject' => $subject, 'body' => $body];
                return true;
            });
        });

        $this->checkin($volunteer, 2, true)->assertOk();

        $bell = (string) $this->bellsFor($admin)->first()->message;
        $this->assertStringContainsString('Jasper Ford', $bell);
        $this->assertStringNotContainsString('Timebank Ireland', $bell);
        $this->assertStringContainsString('Jasper Ford', $sent[$admin->email]['subject']);
        $this->assertStringNotContainsString('Timebank Ireland', $sent[$admin->email]['subject']);

        Sanctum::actingAs($admin, ['*']);
        $alerts = $this->apiGet('/v2/admin/volunteering/wellbeing/alerts')->assertOk()->json('data');
        $this->assertSame('Jasper Ford', collect($alerts)->firstWhere('user_id', $volunteer->id)['user_name']);
    }

    public function test_each_person_told_is_recorded_with_channel_and_outcome_but_never_the_note(): void
    {
        $this->enableVolunteering();
        $volunteer = $this->person();
        $orgOwner = $this->organisationFor($volunteer);
        $admin = $this->person(['is_admin' => 1]);

        $this->mock(\App\Services\EmailDispatchService::class, function ($mock) {
            $mock->shouldReceive('send')->andReturn(true);
        });

        $this->checkin($volunteer, 1, true)->assertOk();

        $rows = DB::table('vol_wellbeing_alert_notifications')
            ->where('tenant_id', $this->testTenantId)
            ->where('volunteer_user_id', $volunteer->id)
            ->get();
        $byKey = $rows->mapWithKeys(fn ($r) => [$r->recipient_user_id . ':' . $r->channel => $r]);

        $this->assertSame('staff', $byKey[$admin->id . ':bell']->tier);
        $this->assertSame('sent', $byKey[$admin->id . ':bell']->status);
        $this->assertSame('sent', $byKey[$admin->id . ':email']->status);
        $this->assertSame('organisation', $byKey[$orgOwner->id . ':bell']->tier);
        $this->assertSame('sent', $byKey[$orgOwner->id . ':email']->status);
        $this->assertNotNull($byKey[$admin->id . ':bell']->checkin_id);
        $this->assertNotNull($byKey[$admin->id . ':bell']->alert_id);
        $this->assertStringNotContainsString(self::NOTE, json_encode($rows));
        $this->assertArrayNotHasKey('note', (array) $rows->first());
        $this->assertArrayNotHasKey('mood', (array) $rows->first());
    }

    public function test_a_shared_low_check_in_sends_a_time_sensitive_push_to_staff(): void
    {
        $this->enableVolunteering();
        $volunteer = $this->person(['first_name' => 'Pat', 'last_name' => 'Murphy']);
        $admin = $this->person(['is_admin' => 1]);

        $this->assertTrue(\App\Support\Push\PushCopy::isCurated('volunteer_wellbeing'));
        $this->assertTrue(\App\Support\Push\PushCopy::isTimeSensitive('volunteer_wellbeing'));

        $this->checkin($volunteer, 1, true, 'A very private note')->assertOk();

        $log = DB::table('push_log')->where('user_id', $admin->id)->where('activity_type', 'volunteer_wellbeing')->first();
        $this->assertNotNull($log, 'fanOutPush records a push_log row for the staff member');
        $this->assertStringNotContainsString('A very private note', json_encode($log));
    }

    private function otherTenantId(): int
    {
        $id = (int) DB::table('tenants')->where('id', '!=', $this->testTenantId)->value('id');
        $this->assertGreaterThan(0, $id, 'fixture needs a second tenant');

        return $id;
    }
}
