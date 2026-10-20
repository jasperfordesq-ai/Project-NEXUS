<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Volunteering;

use App\Core\TenantContext;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * One wellbeing alert, opened by staff: what the volunteer shared, why the
 * alert was raised, who was told and when, and the notes staff add. Notes are
 * append-only (the database refuses UPDATE and DELETE). The sidebar badge and
 * the overview's attention row count the active alerts.
 */
class VolunteerWellbeingAlertDetailTest extends TestCase
{
    use DatabaseTransactions;

    private const NOTE = 'My note, for the team only';

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

    /** A shared Struggling check-in by $volunteer; returns the active alert id. */
    private function raiseAlert(User $volunteer): int
    {
        Sanctum::actingAs($volunteer, ['*']);
        $this->apiPost('/v2/volunteering/wellbeing/checkin', ['mood' => 1, 'note' => self::NOTE, 'share_with_team' => true])->assertOk();

        return (int) DB::table('vol_wellbeing_alerts')->where('tenant_id', $this->testTenantId)->where('user_id', $volunteer->id)->where('status', 'active')->value('id');
    }

    public function test_staff_open_an_alert_and_see_the_check_ins_who_was_told_and_the_notes(): void
    {
        $this->enableVolunteering();
        $admin = $this->person(['is_admin' => 1, 'first_name' => 'Ann', 'last_name' => 'Admin']);
        $broker = $this->person(['role' => 'broker']);
        $volunteer = $this->person(['first_name' => 'Pat', 'last_name' => 'Murphy']);
        $alertId = $this->raiseAlert($volunteer);

        Sanctum::actingAs($broker, ['*']);
        $view = $this->apiGet('/v2/admin/volunteering/wellbeing/alerts/' . $alertId)->assertOk()->json('data');

        $this->assertSame($alertId, $view['alert']['id']);
        $this->assertSame('Pat Murphy', $view['alert']['user_name']);
        $this->assertSame('low_mood', $view['alert']['reason']);
        $this->assertSame('active', $view['alert']['status']);
        $this->assertTrue($view['alert']['coordinator_notified']);
        $this->assertArrayHasKey('mood', $view['indicators']);
        $this->assertSame(1, $view['checkins'][0]['mood']);
        $this->assertSame(self::NOTE, $view['checkins'][0]['note']);
        $this->assertNotNull($view['checkins'][0]['team_notified_at']);

        $told = collect($view['notifications']);
        $this->assertSame(2, $told->where('recipient.id', (int) $admin->id)->count(), 'a bell and an email for the admin');
        $adminBell = $told->first(fn ($n) => ($n['recipient']['id'] ?? null) === (int) $admin->id && $n['channel'] === 'bell');
        $this->assertSame('Ann Admin', $adminBell['recipient']['name']);
        $this->assertSame('staff', $adminBell['tier']);
        $this->assertSame('sent', $adminBell['status']);
        $this->assertSame([], $view['notes']);
        $this->assertNull($view['alert']['legacy_notes']);
    }

    public function test_an_address_only_recipient_is_shown_masked(): void
    {
        $this->enableVolunteering();
        DB::table('tenants')->where('id', $this->testTenantId)->update(['contact_email' => 'safeguarding@community.example']);
        $volunteer = $this->person();
        $alertId = $this->raiseAlert($volunteer);
        $admin = $this->person(['is_admin' => 1]);

        Sanctum::actingAs($admin, ['*']);
        $view = $this->apiGet('/v2/admin/volunteering/wellbeing/alerts/' . $alertId)->assertOk()->json('data');

        $row = collect($view['notifications'])->firstWhere('tier', 'community_contact_email');
        $this->assertNotNull($row);
        $this->assertNull($row['recipient']);
        $this->assertSame('s***@community.example', $row['email_masked']);
    }

    public function test_notes_are_appended_with_their_author_and_cannot_be_changed_or_removed(): void
    {
        $this->enableVolunteering();
        $broker = $this->person(['role' => 'broker', 'first_name' => 'Bea', 'last_name' => 'Broker']);
        $volunteer = $this->person();
        $alertId = $this->raiseAlert($volunteer);

        Sanctum::actingAs($broker, ['*']);
        $created = $this->apiPost('/v2/admin/volunteering/wellbeing/alerts/' . $alertId . '/notes', ['body' => '  Rang Pat, left a message.  '])
            ->assertStatus(201)
            ->json('data.note');
        $this->assertSame('Rang Pat, left a message.', $created['body']);
        $this->assertSame('Bea Broker', $created['author']['name']);

        Sanctum::actingAs($broker, ['*']);
        $this->apiPost('/v2/admin/volunteering/wellbeing/alerts/' . $alertId . '/notes', ['body' => '   '])
            ->assertStatus(422)
            ->assertJsonPath('errors.0.field', 'body');

        // The old free-text path now appends too, instead of overwriting coordinator_notes.
        Sanctum::actingAs($broker, ['*']);
        $this->apiPut('/v2/admin/volunteering/wellbeing/alerts/' . $alertId, ['status' => 'acknowledged', 'note' => 'Acknowledged after the call.'])->assertOk();

        Sanctum::actingAs($broker, ['*']);
        $view = $this->apiGet('/v2/admin/volunteering/wellbeing/alerts/' . $alertId)->assertOk()->json('data');
        $this->assertSame(['Rang Pat, left a message.', 'Acknowledged after the call.'], array_column($view['notes'], 'body'));
        $this->assertNull($view['alert']['legacy_notes']);
        $this->assertSame('acknowledged', $view['alert']['status']);

        if (DB::getDriverName() === 'mysql') {
            $noteId = (int) $created['id'];
            try {
                DB::table('vol_wellbeing_alert_notes')->where('id', $noteId)->update(['body' => 'edited']);
                $this->fail('the database should refuse an UPDATE on a note');
            } catch (\Illuminate\Database\QueryException $e) {
                $this->assertStringContainsString('vol_wellbeing_alert_notes_immutable', $e->getMessage());
            }
            try {
                DB::table('vol_wellbeing_alert_notes')->where('id', $noteId)->delete();
                $this->fail('the database should refuse a DELETE on a note');
            } catch (\Illuminate\Database\QueryException $e) {
                $this->assertStringContainsString('vol_wellbeing_alert_notes_immutable', $e->getMessage());
            }
        }
    }

    public function test_a_member_cannot_open_an_alert_and_another_communitys_alert_is_not_found(): void
    {
        $this->enableVolunteering();
        $volunteer = $this->person();
        $alertId = $this->raiseAlert($volunteer);
        $member = $this->person();
        $otherAdmin = $this->person(['is_admin' => 1], 999);

        Sanctum::actingAs($member, ['*']);
        $this->apiGet('/v2/admin/volunteering/wellbeing/alerts/' . $alertId)->assertStatus(403);

        DB::table('tenants')->where('id', 999)->update(['features' => json_encode(['volunteering' => true])]);
        $this->withTenant(999);
        Sanctum::actingAs($otherAdmin, ['*']);
        $this->apiGet('/v2/admin/volunteering/wellbeing/alerts/' . $alertId)->assertStatus(404);
        Sanctum::actingAs($otherAdmin, ['*']);
        $this->apiPost('/v2/admin/volunteering/wellbeing/alerts/' . $alertId . '/notes', ['body' => 'nope'])->assertStatus(404);
    }

    public function test_the_alert_list_says_how_many_were_told_and_the_badge_counts_active_alerts(): void
    {
        $this->enableVolunteering();
        $admin = $this->person(['is_admin' => 1]);
        $volunteer = $this->person();
        $this->raiseAlert($volunteer);

        Sanctum::actingAs($admin, ['*']);
        $alerts = $this->apiGet('/v2/admin/volunteering/wellbeing/alerts')->assertOk()->json('data');
        $mine = collect($alerts)->firstWhere('user_id', (int) $volunteer->id);
        $this->assertSame(1, $mine['told_count']);
        $this->assertNotNull($mine['last_told_at']);

        Sanctum::actingAs($admin, ['*']);
        $counts = $this->apiGet('/v2/admin/badge-counts')->assertOk()->json('data');
        $this->assertSame(1, $counts['active_wellbeing_alerts']);
    }
}
