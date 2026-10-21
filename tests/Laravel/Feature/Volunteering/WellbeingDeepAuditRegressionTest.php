<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Volunteering;

use App\Console\Commands\AssessVolunteerWellbeing;
use App\Core\TenantContext;
use App\Jobs\SendVolunteerLowMoodEmails;
use App\Models\User;
use App\Services\Enterprise\GdprService;
use App\Services\NotificationService;
use App\Services\RetentionPolicyService;
use App\Services\Volunteering\WellbeingRecipientResolver;
use App\Services\VolunteeringConfigurationService;
use App\Services\VolunteerWellbeingService as Wellbeing;
use Carbon\Carbon;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * The deep wellbeing audit of 21 Oct 2026 (.local-docs-archive/wellbeing-audit-2026-10-21,
 * DEEP-AUDIT*.md), turned from "reproduces the fault" into "proves the fix". Finding
 * numbers (S = server, O = operations) are the report's. Each test runs in a community
 * of its own so that who is told is exactly what is counted.
 */
class WellbeingDeepAuditRegressionTest extends TestCase
{
    use DatabaseTransactions;

    private const ISO = '/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/';

    protected function setUp(): void
    {
        parent::setUp();
        $this->withTenant($this->makeTenant('Deep audit', null));
        Queue::fake();
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        parent::tearDown();
    }

    private function makeTenant(string $name, ?int $parentId, bool $active = true): int
    {
        $id = (int) DB::table('tenants')->insertGetId([
            'name' => $name, 'slug' => 'deep-' . uniqid(), 'domain' => null,
            'is_active' => $active, 'parent_id' => $parentId, 'path' => '/', 'depth' => $parentId ? 1 : 0,
            'allows_subtenants' => true, 'features' => json_encode(['volunteering' => true]),
            'contact_email' => 'support@example.test', 'created_at' => now(), 'updated_at' => now(),
        ]);
        DB::table('tenants')->where('id', $id)->update(['path' => $parentId ? "/{$parentId}/{$id}/" : "/{$id}/"]);

        return $id;
    }

    private function member(array $overrides = [], ?int $tenantId = null): User
    {
        $tenantId ??= $this->testTenantId;
        $user = User::factory()->forTenant($tenantId)->create(array_merge([
            'role' => 'member', 'status' => 'active', 'is_approved' => true,
        ], $overrides));
        TenantContext::setById($this->testTenantId);

        return $user;
    }

    private function hours(int $userId, int $daysAgo, float $hours): void
    {
        DB::table('vol_logs')->insert([
            'tenant_id' => $this->testTenantId, 'user_id' => $userId, 'hours' => $hours,
            'status' => 'approved', 'date_logged' => now()->subDays($daysAgo)->toDateString(),
            'created_at' => now(), 'updated_at' => now(),
        ]);
    }

    private function sharedLowCheckin(int $userId, int $daysAgo = 0): int
    {
        return (int) DB::table('vol_mood_checkins')->insertGetId([
            'tenant_id' => $this->testTenantId, 'user_id' => $userId, 'mood' => 1,
            'share_with_team' => 1, 'created_at' => now()->subDays($daysAgo),
        ]);
    }

    private function alerts(int $userId)
    {
        return DB::table('vol_wellbeing_alerts')->where('tenant_id', $this->testTenantId)->where('user_id', $userId)->orderBy('id')->get();
    }

    private function openAlerts(int $userId): int
    {
        return $this->alerts($userId)->whereIn('status', ['active', 'acknowledged'])->count();
    }

    private function org(User $owner, string $status = 'approved'): int
    {
        return (int) DB::table('vol_organizations')->insertGetId([
            'tenant_id' => $this->testTenantId, 'user_id' => $owner->id, 'name' => 'Org ' . uniqid(),
            'slug' => 'org-' . uniqid(), 'status' => $status, 'created_at' => now(),
        ]);
    }

    private function approvedApplication(int $orgId, User $volunteer, int $daysAgo = 0): void
    {
        $oppId = (int) DB::table('vol_opportunities')->insertGetId([
            'tenant_id' => $this->testTenantId, 'organization_id' => $orgId, 'created_by' => $volunteer->id,
            'title' => 'Opp', 'description' => 'd', 'is_active' => 1, 'status' => 'open',
            'created_at' => now(), 'updated_at' => now(),
        ]);
        DB::table('vol_applications')->insert([
            'tenant_id' => $this->testTenantId, 'opportunity_id' => $oppId, 'user_id' => $volunteer->id,
            'status' => 'approved', 'created_at' => now()->subDays($daysAgo), 'updated_at' => now()->subDays($daysAgo),
        ]);
    }

    // ── S1. Activity-only risk can be raised again after a conclusion ─────────

    public function test_s1_activity_only_risk_reopens_once_the_conclusion_is_more_than_14_days_old(): void
    {
        $v = $this->member();
        // 10 hours 31-60 days ago, nothing since: declining_significantly (25) + gap > 30 days (10) = 35.
        $this->hours($v->id, 40, 10);
        $this->assertSame(35, Wellbeing::detectBurnoutRisk($v->id, true)['risk_score']);
        $alertId = (int) $this->alerts($v->id)->first()->id;
        $this->assertTrue(Wellbeing::updateAlert($alertId, 'resolved'));

        // Concluded five days ago: the same pattern does not reopen a case staff closed.
        DB::table('vol_wellbeing_alerts')->where('id', $alertId)->update(['resolved_at' => now()->subDays(5), 'updated_at' => now()->subDays(5)]);
        Wellbeing::detectBurnoutRisk($v->id, true);
        $this->assertSame(0, $this->openAlerts($v->id));

        // Concluded thirty days ago and the pattern is still there: a new alert.
        DB::table('vol_wellbeing_alerts')->where('id', $alertId)->update(['resolved_at' => now()->subDays(30), 'updated_at' => now()->subDays(30)]);
        Wellbeing::detectBurnoutRisk($v->id, true);
        $this->assertSame(1, $this->openAlerts($v->id));
    }

    public function test_s1_an_auto_resolved_alert_does_not_hide_a_later_decline_for_ever(): void
    {
        $v = $this->member();
        $this->hours($v->id, 40, 10);
        Wellbeing::detectBurnoutRisk($v->id, true);

        $this->hours($v->id, 2, 10);
        Wellbeing::runTenantAssessment();
        $this->assertSame('resolved', $this->alerts($v->id)->first()->status);

        DB::table('vol_logs')->where('user_id', $v->id)->update(['date_logged' => now()->subDays(40)->toDateString()]);
        DB::table('vol_wellbeing_alerts')->where('user_id', $v->id)->update(['resolved_at' => now()->subDays(60), 'updated_at' => now()->subDays(60)]);
        Wellbeing::runTenantAssessment();

        $this->assertSame(1, $this->openAlerts($v->id));
    }

    // ── S8. A check-in in the same second as a conclusion still counts ────────

    public function test_s8_a_new_checkin_in_the_same_second_as_a_conclusion_raises_an_alert(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-10-21 10:00:00'));
        $this->member(['role' => 'admin']);
        $v = $this->member();
        $this->sharedLowCheckin($v->id, 2);
        Wellbeing::detectBurnoutRisk($v->id, true);
        $alertId = (int) $this->alerts($v->id)->first()->id;
        $this->assertTrue(Wellbeing::updateAlert($alertId, 'resolved'));

        $result = Wellbeing::recordCheckin($v->id, 1, null, true);

        $this->assertSame('told', $result['outcome']);
        $this->assertSame(1, $this->openAlerts($v->id));
        $newAlert = (int) $this->alerts($v->id)->last()->id;
        $this->assertSame($newAlert, (int) DB::table('vol_wellbeing_alert_notifications')->where('checkin_id', $result['id'])->value('alert_id'));
    }

    // ── S2. An organisation sees only what it was told ────────────────────────

    public function test_s2_an_organisation_does_not_see_a_disclosure_from_before_the_relationship(): void
    {
        $owner = $this->member();
        $orgId = $this->org($owner);
        $this->member(['role' => 'admin']);
        $v = $this->member();

        $result = Wellbeing::recordCheckin($v->id, 2, 'private words', true);
        $this->assertSame('told', $result['outcome']);
        $this->approvedApplication($orgId, $v, 0);

        $this->assertSame([], Wellbeing::getOrganisationWellbeing($this->testTenantId, $orgId));
    }

    public function test_s2_an_organisation_still_sees_what_it_was_told(): void
    {
        $owner = $this->member();
        $orgId = $this->org($owner);
        $v = $this->member();
        $this->approvedApplication($orgId, $v, 5);

        Wellbeing::recordCheckin($v->id, 2, 'private words', true);

        $items = Wellbeing::getOrganisationWellbeing($this->testTenantId, $orgId);
        $this->assertCount(1, $items);
        $this->assertMatchesRegularExpression(self::ISO, (string) $items[0]['told_at']);
        $this->assertMatchesRegularExpression(self::ISO, (string) $items[0]['checkin_at']);
        $this->assertArrayNotHasKey('note', $items[0]);
    }

    // ── S3/O2. Wellbeing off means check-ins are refused, not half-handled ────

    public function test_s3_with_the_wellbeing_tab_off_the_member_endpoints_refuse(): void
    {
        $this->member(['role' => 'admin']);
        $v = $this->member();
        VolunteeringConfigurationService::set(VolunteeringConfigurationService::CONFIG_TAB_WELLBEING, false);

        Sanctum::actingAs($v, ['*']);
        $this->apiPost('/v2/volunteering/wellbeing/checkin', ['mood' => 1, 'share_with_team' => true])
            ->assertStatus(403)
            ->assertJsonPath('errors.0.code', 'FEATURE_DISABLED');
        $this->apiGet('/v2/volunteering/wellbeing')
            ->assertStatus(403)
            ->assertJsonPath('errors.0.code', 'FEATURE_DISABLED');

        $this->assertSame(0, DB::table('vol_mood_checkins')->where('user_id', $v->id)->count());
        $this->assertCount(0, $this->alerts($v->id));
        $this->assertSame(0, DB::table('vol_wellbeing_alert_notifications')->where('volunteer_user_id', $v->id)->count());
    }

    // ── S16. Member input is validated, not coerced ──────────────────────────

    public function test_s16_mood_and_note_are_validated(): void
    {
        $v = $this->member();
        Sanctum::actingAs($v, ['*']);

        foreach (['1.9', '2abc', 0, 6, null] as $bad) {
            $this->apiPost('/v2/volunteering/wellbeing/checkin', ['mood' => $bad])
                ->assertStatus(422)
                ->assertJsonPath('errors.0.field', 'mood');
        }
        $this->apiPost('/v2/volunteering/wellbeing/checkin', ['mood' => 4, 'note' => ['an', 'array']])
            ->assertStatus(422)
            ->assertJsonPath('errors.0.field', 'note');
        $this->apiPost('/v2/volunteering/wellbeing/checkin', ['mood' => 4, 'note' => str_repeat('x', 501)])
            ->assertStatus(422)
            ->assertJsonPath('errors.0.field', 'note');

        $this->apiPost('/v2/volunteering/wellbeing/checkin', ['mood' => '4', 'note' => '0'])->assertOk();
        $this->assertSame('0', DB::table('vol_mood_checkins')->where('user_id', $v->id)->value('note'), 'a note of "0" is kept');
    }

    // ── ISO times on every wellbeing time field ──────────────────────────────

    public function test_wellbeing_times_are_iso_8601_with_an_offset(): void
    {
        $staff = $this->member(['role' => 'admin']);
        $v = $this->member();
        Sanctum::actingAs($v, ['*']);
        $checkin = $this->apiPost('/v2/volunteering/wellbeing/checkin', ['mood' => 1, 'share_with_team' => true])->assertOk()->json('data');
        $this->assertSame('told', $checkin['outcome']);
        $this->assertMatchesRegularExpression(self::ISO, $checkin['told_at']);

        $again = $this->apiPost('/v2/volunteering/wellbeing/checkin', ['mood' => 1, 'share_with_team' => true])->assertOk()->json('data');
        $this->assertSame('already_told_today', $again['outcome']);
        $this->assertMatchesRegularExpression(self::ISO, $again['told_at']);

        $dash = $this->apiGet('/v2/volunteering/wellbeing')->assertOk()->json('data');
        $this->assertMatchesRegularExpression(self::ISO, $dash['last_team_notified_at']);
        $this->assertMatchesRegularExpression(self::ISO, $dash['recent_checkins'][0]['created_at']);

        Sanctum::actingAs($staff, ['*']);
        $list = $this->apiGet('/v2/admin/volunteering/wellbeing/alerts')->assertOk();
        $alert = $list->json('data.0');
        foreach (['created_at', 'updated_at', 'last_told_at'] as $field) {
            $this->assertMatchesRegularExpression(self::ISO, $alert[$field], $field);
        }
        $this->assertMatchesRegularExpression(self::ISO, $alert['latest_checkin']['created_at']);

        $detail = $this->apiGet('/v2/admin/volunteering/wellbeing/alerts/' . $alert['id'])->assertOk()->json('data');
        $this->assertMatchesRegularExpression(self::ISO, $detail['alert']['created_at']);
        $this->assertMatchesRegularExpression(self::ISO, $detail['checkins'][0]['created_at']);
        // Newest first: the second check-in was "already told"; the first carries the stamp.
        $this->assertNull($detail['checkins'][0]['team_notified_at']);
        $this->assertMatchesRegularExpression(self::ISO, $detail['checkins'][1]['team_notified_at']);
        $this->assertMatchesRegularExpression(self::ISO, $detail['notifications'][0]['created_at']);

        $note = $this->apiPost('/v2/admin/volunteering/wellbeing/alerts/' . $alert['id'] . '/notes', ['body' => 'Called them.'])->assertStatus(201)->json('data.note');
        $this->assertMatchesRegularExpression(self::ISO, $note['created_at']);
    }

    // ── S7. One record per check-in, recipient and channel ───────────────────

    public function test_s7_a_duplicate_notification_row_is_treated_as_already_recorded(): void
    {
        $this->member(['role' => 'admin']);
        $v = $this->member();
        $result = Wellbeing::recordCheckin($v->id, 1, null, true);
        $row = DB::table('vol_wellbeing_alert_notifications')->where('checkin_id', $result['id'])->where('channel', 'bell')->first();

        $copy = (array) $row;
        unset($copy['id']);
        $method = new \ReflectionMethod(Wellbeing::class, 'recordNotification');
        $method->setAccessible(true);
        $this->assertSame((int) $row->id, $method->invoke(null, $copy));
        $this->assertSame(1, DB::table('vol_wellbeing_alert_notifications')->where('checkin_id', $result['id'])->where('channel', 'bell')->count());
    }

    // ── S4. Retention follows the alert ──────────────────────────────────────

    public function test_s4_retention_keeps_who_was_told_while_the_alert_is_open(): void
    {
        $this->member(['role' => 'admin']);
        $v = $this->member();
        Wellbeing::recordCheckin($v->id, 1, null, true);
        $alertId = (int) $this->alerts($v->id)->first()->id;
        $this->assertTrue(Wellbeing::updateAlert($alertId, 'acknowledged'));
        DB::table('vol_wellbeing_alert_notifications')->where('volunteer_user_id', $v->id)->update(['created_at' => now()->subDays(731)]);

        $this->assertNull(RetentionPolicyService::upsertPolicy($this->testTenantId, 'vol_wellbeing_alert_notifications', 730, true));
        RetentionPolicyService::enforceForTenant($this->testTenantId);

        $this->assertGreaterThan(0, DB::table('vol_wellbeing_alert_notifications')->where('alert_id', $alertId)->count());

        // Once the case is concluded, the old record may go.
        $this->assertTrue(Wellbeing::updateAlert($alertId, 'resolved'));
        RetentionPolicyService::enforceForTenant($this->testTenantId);
        $this->assertSame(0, DB::table('vol_wellbeing_alert_notifications')->where('alert_id', $alertId)->count());
    }

    public function test_s4_purging_a_concluded_alert_takes_its_notes_with_it(): void
    {
        $staff = $this->member(['role' => 'admin']);
        $v = $this->member();
        $this->sharedLowCheckin($v->id);
        Wellbeing::detectBurnoutRisk($v->id, true);
        $alertId = (int) $this->alerts($v->id)->first()->id;
        $this->assertNotNull(Wellbeing::addAlertNote($alertId, $staff->id, 'Spoke to them about a bereavement.'));
        $this->assertTrue(Wellbeing::updateAlert($alertId, 'resolved'));
        DB::table('vol_wellbeing_alerts')->where('id', $alertId)->update(['created_at' => now()->subDays(731)]);

        $this->assertNull(RetentionPolicyService::upsertPolicy($this->testTenantId, 'vol_wellbeing_alerts', 730, true));
        RetentionPolicyService::enforceForTenant($this->testTenantId);

        $this->assertSame(0, DB::table('vol_wellbeing_alerts')->where('id', $alertId)->count());
        $this->assertSame(0, DB::table('vol_wellbeing_alert_notes')->where('alert_id', $alertId)->count());
    }

    // ── S5/S6. Erasure ───────────────────────────────────────────────────────

    public function test_s5_erasing_a_volunteer_deletes_the_bells_other_people_received_about_them(): void
    {
        $staff = $this->member(['role' => 'admin']);
        $v = $this->member(['first_name' => 'Zebedee', 'last_name' => 'Probe']);
        $result = Wellbeing::recordCheckin($v->id, 1, 'a private note', true);
        $this->assertSame('told', $result['outcome']);
        $bell = DB::table('notifications')->where('user_id', $staff->id)->where('type', 'volunteer_wellbeing')->first();
        $this->assertNotNull($bell);
        $unrelated = (int) DB::table('notifications')->insertGetId([
            'tenant_id' => $this->testTenantId, 'user_id' => $staff->id, 'message' => 'Unrelated',
            'type' => 'volunteer_wellbeing', 'idempotency_key' => 'wellbeing:' . ($result['id'] + 100000) . ':' . $staff->id,
            'created_at' => now(),
        ]);

        (new GdprService($this->testTenantId))->executeAccountDeletion($v->id, $staff->id);

        $this->assertNull(DB::table('notifications')->where('id', $bell->id)->first());
        $this->assertNotNull(DB::table('notifications')->where('id', $unrelated)->first(), 'only bells about this person go');
    }

    public function test_s5_bells_in_the_parent_community_are_deleted_too(): void
    {
        $parentId = $this->makeTenant('Parent', null);
        $parentAdmin = $this->member(['role' => 'admin'], $parentId);
        $childId = $this->makeTenant('Child', $parentId);
        $this->withTenant($childId);
        $v = $this->member([], $childId);

        $result = Wellbeing::recordCheckin($v->id, 1, null, true);
        $this->assertSame(1, DB::table('notifications')->where('tenant_id', $parentId)->where('user_id', $parentAdmin->id)->where('type', 'volunteer_wellbeing')->count());

        (new GdprService($childId))->executeAccountDeletion($v->id, null);

        $this->assertSame(0, DB::table('notifications')->where('tenant_id', $parentId)->where('user_id', $parentAdmin->id)
            ->where('idempotency_key', 'like', 'wellbeing:' . $result['id'] . ':%')->count());
    }

    public function test_s6_erasing_a_staff_member_keeps_the_record_that_someone_was_told(): void
    {
        $staff = $this->member(['role' => 'admin']);
        $v = $this->member();
        $result = Wellbeing::recordCheckin($v->id, 1, null, true);
        $this->assertSame(1, Wellbeing::peopleToldFor($this->testTenantId, $result['id']));

        (new GdprService($this->testTenantId))->executeAccountDeletion($staff->id, null);

        $rows = DB::table('vol_wellbeing_alert_notifications')->where('checkin_id', $result['id'])->get();
        $this->assertNotEmpty($rows);
        foreach ($rows as $row) {
            $this->assertNull($row->recipient_user_id);
            $this->assertNull($row->recipient_email);
            $this->assertSame('staff', $row->tier);
        }
        $this->assertSame(1, Wellbeing::peopleToldFor($this->testTenantId, $result['id']), 'the check-in still reads as having reached someone');
    }

    // ── S9. Recipient chain respects status ──────────────────────────────────

    public function test_s9_an_inactive_parent_community_is_not_told(): void
    {
        $parentId = $this->makeTenant('Dead parent', null, false);
        $parentAdmin = $this->member(['role' => 'admin'], $parentId);
        $childId = $this->makeTenant('Child', $parentId);
        $this->withTenant($childId);
        $v = $this->member([], $childId);

        $resolved = WellbeingRecipientResolver::resolve($childId, $v->id, []);

        $this->assertArrayNotHasKey($parentAdmin->id, $resolved['users']);
    }

    public function test_s9_a_suspended_or_pending_organisation_is_not_told(): void
    {
        foreach (['suspended', 'pending'] as $status) {
            $owner = $this->member();
            $orgId = $this->org($owner, $status);
            $v = $this->member();
            $this->approvedApplication($orgId, $v, 5);

            $result = Wellbeing::recordCheckin($v->id, 1, null, true);

            $this->assertSame(0, DB::table('vol_wellbeing_alert_notifications')->where('checkin_id', $result['id'])->where('recipient_user_id', $owner->id)->count(), $status);
            $this->assertSame([], Wellbeing::getOrganisationWellbeing($this->testTenantId, $orgId), $status);
        }
    }

    // ── S10. The boundary day belongs to the recent window ───────────────────

    public function test_s10_hours_logged_exactly_30_days_ago_count_as_recent(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-10-21 12:00:00'));
        $v = $this->member();
        $this->hours($v->id, 30, 5);
        $this->hours($v->id, 45, 5);

        $a = Wellbeing::detectBurnoutRisk($v->id, false);

        $this->assertSame(5.0, $a['indicators']['hours_trend']['recent_hours']);
        $this->assertSame(5.0, $a['indicators']['hours_trend']['previous_hours']);
    }

    // ── S12. Push dedupe does not swallow a second volunteer's push ──────────

    public function test_s12_push_dedupe_is_per_thread_when_a_thread_is_given(): void
    {
        $method = new \ReflectionMethod(\App\Services\NotificationDispatcher::class, 'pushDedupKey');
        $method->setAccessible(true);
        $a = $method->invoke(null, 7, 'volunteer_wellbeing', null, ['thread_id' => 'wellbeing:1']);
        $b = $method->invoke(null, 7, 'volunteer_wellbeing', null, ['thread_id' => 'wellbeing:2']);
        $c = $method->invoke(null, 7, 'volunteer_wellbeing', null, []);
        $this->assertNotSame($a, $b);
        $this->assertNotSame($a, $c);
        $this->assertSame($c, $method->invoke(null, 7, 'volunteer_wellbeing', null, []));
    }

    // ── S13. The mood word stays out of subjects, previews and lock screens ──

    public function test_s13_subject_preview_and_push_body_do_not_carry_the_mood(): void
    {
        foreach (['en', 'de', 'fr', 'es', 'ga', 'it', 'pt', 'nl', 'pl', 'ja', 'ar'] as $locale) {
            \App\I18n\LocaleContext::withLocale($locale, function () use ($locale) {
                $params = ['name' => 'Alice', 'mood' => '@@MOOD@@'];
                $this->assertStringNotContainsString('@@MOOD@@', (string) __('emails_misc.volunteer_wellbeing.subject', $params), $locale);
                $this->assertStringNotContainsString('@@MOOD@@', (string) __('emails_misc.volunteer_wellbeing.preview', $params), $locale);
                $this->assertStringNotContainsString(':subject', (string) trans('notifications.push.volunteer_wellbeing.body', [], $locale), $locale);
            });
        }
    }

    // ── S15. The admin list never hides a query error as "no alerts" ─────────

    public function test_s15_the_alert_list_does_not_swallow_errors(): void
    {
        $src = (string) file_get_contents(app_path('Services/VolunteerWellbeingService.php'));
        $start = strpos($src, 'function getActiveAlerts');
        $body = substr($src, $start, (int) strpos($src, 'function updateAlert') - $start);
        $this->assertStringNotContainsString('return [];', $body);
    }

    // ── S17. Export: the member's own facts in, third-party addresses masked ─

    public function test_s17_export_carries_share_flags_and_masks_addresses(): void
    {
        $v = $this->member();
        DB::table('tenants')->where('id', $this->testTenantId)->update(['contact_email' => 'office@community.example']);
        $result = Wellbeing::recordCheckin($v->id, 1, null, true);
        $this->assertSame('told', $result['outcome']);

        $method = new \ReflectionMethod(GdprService::class, 'exportVolunteerData');
        $method->setAccessible(true);
        $data = $method->invoke(new GdprService($this->testTenantId), $v->id);

        $checkin = (array) $data['mood_checkins'][0];
        $this->assertArrayHasKey('share_with_team', $checkin);
        $this->assertArrayHasKey('team_notified_at', $checkin);
        $emails = array_filter(array_map(fn ($r) => ((array) $r)['recipient_email'] ?? null, $data['wellbeing_alert_notifications']));
        $this->assertNotEmpty($emails);
        foreach ($emails as $email) {
            $this->assertSame('o***@community.example', $email);
        }
    }

    // ── O1/O6/S11. The email job ─────────────────────────────────────────────

    public function test_o1_the_job_timeout_is_below_the_queue_retry_after(): void
    {
        $job = new SendVolunteerLowMoodEmails($this->testTenantId, 1, 'x', 1, []);
        $this->assertLessThan((int) config('queue.connections.redis.retry_after', 90), $job->timeout);
    }

    public function test_o6_a_job_that_dies_clears_a_told_stamp_nobody_is_behind(): void
    {
        $v = $this->member();
        $result = Wellbeing::recordCheckin($v->id, 1, null, true); // only the community address
        $this->assertSame('told', $result['outcome']);
        $this->assertNotNull(DB::table('vol_mood_checkins')->where('id', $result['id'])->value('team_notified_at'));
        $rowIds = DB::table('vol_wellbeing_alert_notifications')->where('checkin_id', $result['id'])->pluck('id')->map(fn ($id) => (int) $id)->all();

        (new SendVolunteerLowMoodEmails($this->testTenantId, $v->id, 'V', 1, $rowIds))->failed(new \RuntimeException('worker died'));

        $this->assertNull(DB::table('vol_mood_checkins')->where('id', $result['id'])->value('team_notified_at'));
    }

    /** @return list<array{to: string, subject: string, body: string, options: array<string, mixed>}> */
    private function captureEmails(): \ArrayObject
    {
        $sent = new \ArrayObject();
        $this->mock(\App\Services\EmailDispatchService::class, function ($mock) use ($sent) {
            $mock->shouldReceive('send')->andReturnUsing(function (string $to, string $subject, string $body, array $options = []) use ($sent) {
                $sent[] = ['to' => $to, 'subject' => $subject, 'body' => $body, 'options' => $options];
                return true;
            });
        });

        return $sent;
    }

    public function test_s11_the_volunteers_own_copy_does_not_count_failed_addresses(): void
    {
        $v = $this->member(['role' => 'admin']);
        $other = $this->member(['role' => 'admin']);
        $result = Wellbeing::recordCheckin($v->id, 1, null, true);
        // Everything sent to the other staff member failed.
        DB::table('vol_wellbeing_alert_notifications')->where('checkin_id', $result['id'])->where('recipient_user_id', $other->id)->update(['status' => 'failed']);
        $this->assertSame(0, Wellbeing::peopleToldFor($this->testTenantId, $result['id']));
        $rowIds = DB::table('vol_wellbeing_alert_notifications')->where('checkin_id', $result['id'])->where('channel', 'email')->pluck('id')->map(fn ($id) => (int) $id)->all();

        $sent = $this->captureEmails();
        (new SendVolunteerLowMoodEmails($this->testTenantId, $v->id, 'V', 1, $rowIds))->handle();

        $selfMail = collect($sent->getArrayCopy())->first(fn ($m) => $m['to'] === $v->email);
        $this->assertNotNull($selfMail);
        $this->assertStringContainsString('Nobody else', $selfMail['body'], 'the volunteer is not told that a failed address was reached');
    }

    public function test_an_address_only_email_is_not_framed_as_a_members_email_and_replies_reach_the_community(): void
    {
        $v = $this->member();
        DB::table('tenants')->where('id', $this->testTenantId)->update(['contact_email' => 'office@community.example']);
        $result = Wellbeing::recordCheckin($v->id, 1, null, true);
        $rowIds = DB::table('vol_wellbeing_alert_notifications')->where('checkin_id', $result['id'])->pluck('id')->map(fn ($id) => (int) $id)->all();

        $sent = $this->captureEmails();
        (new SendVolunteerLowMoodEmails($this->testTenantId, $v->id, 'V', 1, $rowIds))->handle();

        $mail = $sent->getArrayCopy()[0] ?? null;
        $this->assertNotNull($mail);
        $this->assertSame('office@community.example', $mail['to']);
        $this->assertSame('office@community.example', $mail['options']['replyTo'] ?? null);
        $this->assertStringNotContainsString((string) __('emails.footer.member_notice', ['community' => 'Deep audit']), $mail['body']);
    }

    // ── O3. A new high/critical alert from the nightly scan bells staff once ─

    public function test_o3_the_scan_bells_staff_once_for_a_new_high_alert(): void
    {
        $staff = $this->member(['role' => 'admin']);
        $v = $this->member();
        // Hours collapsed (+25), 45-day gap (+10) and eight shifts booked this week (+15) = 50 → high.
        $this->hours($v->id, 45, 20);
        $opp = (int) DB::table('vol_opportunities')->insertGetId([
            'tenant_id' => $this->testTenantId, 'title' => 'Audit opp', 'description' => 'x', 'is_active' => 1, 'created_at' => now(),
        ]);
        for ($i = 0; $i < 8; $i++) {
            $shift = (int) DB::table('vol_shifts')->insertGetId([
                'tenant_id' => $this->testTenantId, 'opportunity_id' => $opp,
                'start_time' => now()->addHours(6 + $i * 18)->format('Y-m-d H:i:s'),
                'end_time' => now()->addHours(8 + $i * 18)->format('Y-m-d H:i:s'), 'capacity' => 2,
            ]);
            DB::table('vol_applications')->insert([
                'tenant_id' => $this->testTenantId, 'opportunity_id' => $opp, 'shift_id' => $shift,
                'user_id' => $v->id, 'status' => 'approved', 'created_at' => now(), 'updated_at' => now(),
            ]);
        }
        $assessment = Wellbeing::detectBurnoutRisk($v->id, false);
        $this->assertContains($assessment['risk_level'], ['high', 'critical'], 'fixture must be high: ' . $assessment['risk_score']);

        Wellbeing::runTenantAssessment();
        Wellbeing::runTenantAssessment();

        $bells = DB::table('notifications')->where('user_id', $staff->id)->where('type', 'volunteer_wellbeing')->get();
        $this->assertCount(1, $bells);
        $alertId = (int) $this->alerts($v->id)->first()->id;
        $this->assertStringContainsString('?alert=' . $alertId, (string) $bells[0]->link);
        $this->assertSame('wellbeing-scan:' . $alertId . ':' . $staff->id, $bells[0]->idempotency_key);
        $this->assertSame(1, (int) $this->alerts($v->id)->first()->coordinator_notified);
        // The volunteer did not ask for contact: nothing is sent to them.
        $this->assertSame(0, DB::table('notifications')->where('user_id', $v->id)->where('type', 'volunteer_wellbeing')->count());
    }

    public function test_o3_a_moderate_scan_alert_bells_nobody(): void
    {
        $staff = $this->member(['role' => 'admin']);
        $v = $this->member();
        $this->hours($v->id, 40, 10); // 35, moderate
        Wellbeing::runTenantAssessment();

        $this->assertCount(1, $this->alerts($v->id));
        $this->assertSame(0, DB::table('notifications')->where('user_id', $staff->id)->where('type', 'volunteer_wellbeing')->count());
    }

    // ── O4. The scan leaves a "last ran" stamp the admin page shows ──────────

    public function test_o4_a_successful_scan_is_stamped_and_shown_on_the_alert_list(): void
    {
        Cache::forget(AssessVolunteerWellbeing::LAST_OK_CACHE_KEY);
        $staff = $this->member(['role' => 'admin']);

        $this->artisan('volunteering:assess-wellbeing', ['--tenant' => $this->testTenantId])->assertExitCode(0);
        $this->assertNotNull(Cache::get(AssessVolunteerWellbeing::LAST_OK_CACHE_KEY));

        Sanctum::actingAs($staff, ['*']);
        $meta = $this->apiGet('/v2/admin/volunteering/wellbeing/alerts')->assertOk()->json('meta');
        $this->assertMatchesRegularExpression(self::ISO, (string) $meta['last_scan_at']);
    }

    // ── O-P3. Category ───────────────────────────────────────────────────────

    public function test_wellbeing_notifications_are_in_the_safeguarding_category(): void
    {
        $this->assertSame('safeguarding', app(NotificationService::class)->categoryFor('volunteer_wellbeing'));
    }

    // ── C11 (server half). A refused link names its row ──────────────────────

    public function test_a_refused_support_link_names_its_row(): void
    {
        $admin = $this->member(['role' => 'admin']);
        Sanctum::actingAs($admin, ['*']);

        $this->apiPut('/v2/admin/volunteering/wellbeing/settings', ['support_links' => [
            ['label' => 'Fine', 'url' => 'https://example.org'],
            ['label' => 'Bad', 'url' => 'javascript:alert(1)'],
        ]])->assertStatus(422)->assertJsonPath('errors.0.field', 'support_links.1');
    }
}
