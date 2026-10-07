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
        $this->assertStringContainsString('/broker/safeguarding/volunteering', $sent[$admin->email]['body']);
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
        \Illuminate\Support\Facades\Queue::assertPushedOn('emails', \App\Jobs\SendVolunteerLowMoodEmails::class, function ($job) use ($volunteer, $admin) {
            return $job->volunteerId === (int) $volunteer->id
                && array_key_exists((int) $admin->id, $job->recipients)
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

    public function test_a_volunteer_who_is_also_staff_is_not_alerted_about_themselves(): void
    {
        $this->enableVolunteering();
        $volunteerAdmin = $this->person(['is_admin' => 1]);
        $otherAdmin = $this->person(['is_admin' => 1]);

        $this->checkin($volunteerAdmin, 1, true)->assertOk();

        $this->assertCount(0, $this->bellsFor($volunteerAdmin));
        $this->assertCount(1, $this->bellsFor($otherAdmin));
    }

    private function otherTenantId(): int
    {
        $id = (int) DB::table('tenants')->where('id', '!=', $this->testTenantId)->value('id');
        $this->assertGreaterThan(0, $id, 'fixture needs a second tenant');

        return $id;
    }
}
