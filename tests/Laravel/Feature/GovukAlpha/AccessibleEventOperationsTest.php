<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\GovukAlpha;

use App\Core\TenantContext;
use App\Enums\EventStaffRole;
use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Config;
use Illuminate\Support\Facades\DB;
use Illuminate\Testing\TestResponse;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

final class AccessibleEventOperationsTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();

        Config::set('events.attendance_credit_mode', 'off');
        Config::set('events.registration.default_capacity_pool_key', 'event');
        Config::set('events.registration.legacy_dual_write', true);
        DB::table('tenants')->where('id', $this->testTenantId)->update([
            'features' => json_encode(['events' => true], JSON_THROW_ON_ERROR),
        ]);
        TenantContext::reset();
        TenantContext::setById($this->testTenantId);
    }

    public function test_owner_people_workspace_filters_normalizes_invalid_queries_and_updates_via_prg(): void
    {
        $owner = $this->member('Accessible People Owner');
        $member = $this->member('Accessible People Pending');
        $eventId = $this->event($owner);
        $this->registration($eventId, $member, $owner, 'pending');
        Sanctum::actingAs($owner, ['*']);

        $peoplePath = "/{$this->testTenantSlug}/accessible/events/{$eventId}/people";
        $this->get($peoplePath)
            ->assertOk()
            ->assertSeeText('Accessible People Pending')
            ->assertSeeText('Manual check-in')
            ->assertDontSee((string) $member->email);

        $this->get($peoplePath . '?page=not-a-page')
            ->assertRedirect($peoplePath);

        $this->accessiblePost($peoplePath, [
            'action' => 'approve',
            'user_ids' => [(string) $member->id],
            'confirmation' => '1',
            'idempotency_key' => 'accessible-people-approve',
        ])->assertRedirect($peoplePath . '?status=people-updated&updated=1&failed=0');

        self::assertSame('confirmed', DB::table('event_registrations')
            ->where('tenant_id', $this->testTenantId)
            ->where('event_id', $eventId)
            ->where('user_id', $member->id)
            ->value('registration_state'));
    }

    public function test_registration_manager_cannot_open_or_discover_attendance_workspace(): void
    {
        $owner = $this->member('Accessible Registration Owner');
        $manager = $this->member('Accessible Registration Manager');
        $eventId = $this->event($owner);
        $this->assignStaff($eventId, $manager, EventStaffRole::RegistrationManager, $owner);
        Sanctum::actingAs($manager, ['*']);

        $peoplePath = "/{$this->testTenantSlug}/accessible/events/{$eventId}/people";
        $checkInPath = "/{$this->testTenantSlug}/accessible/events/{$eventId}/check-in";
        $this->get($peoplePath)
            ->assertOk()
            ->assertDontSee($checkInPath, false);
        $this->get($checkInPath)->assertForbidden();
    }

    public function test_co_organizer_can_confirm_and_submit_a_moderated_draft(): void
    {
        DB::table('tenant_settings')->updateOrInsert(
            ['tenant_id' => $this->testTenantId, 'setting_key' => 'moderation.enabled'],
            ['setting_value' => '1', 'updated_at' => now()],
        );
        DB::table('tenant_settings')->updateOrInsert(
            ['tenant_id' => $this->testTenantId, 'setting_key' => 'moderation.require_event'],
            ['setting_value' => '1', 'updated_at' => now()],
        );
        $owner = $this->member('Accessible Publication Owner');
        $manager = $this->member('Accessible Co-organizer');
        $eventId = $this->event($owner, false, [
            'status' => 'draft',
            'publication_status' => 'draft',
        ]);
        $this->assignStaff($eventId, $manager, EventStaffRole::CoOrganizer, $owner);
        Sanctum::actingAs($manager, ['*']);
        $path = "/{$this->testTenantSlug}/accessible/events/{$eventId}";

        $this->get($path)
            ->assertOk()
            ->assertSeeText(__('govuk_alpha.events.submit_for_review'))
            ->assertSeeText(__('govuk_alpha.events.publication_submit_confirm'));
        $this->accessiblePost($path . '/submit', [])
            ->assertRedirect($path . '?status=event-submitted');

        self::assertSame('pending_review', DB::table('events')->where('id', $eventId)->value('publication_status'));
        self::assertSame(1, DB::table('content_moderation_queue')
            ->where('tenant_id', $this->testTenantId)
            ->where('content_type', 'event')
            ->where('content_id', $eventId)
            ->where('status', 'pending')
            ->count());
    }

    public function test_check_in_staff_receive_redacted_roster_and_version_conflicts_use_prg(): void
    {
        $owner = $this->member('Accessible Attendance Owner');
        $staff = $this->member('Accessible Attendance Staff');
        $attendee = $this->member('Accessible Attendance Attendee');
        $unrelated = $this->member('Accessible Attendance Unrelated');
        $eventId = $this->event($owner, true);
        $this->registration($eventId, $attendee, $owner, 'confirmed');
        $this->assignStaff($eventId, $staff, EventStaffRole::CheckInStaff, $owner);
        Sanctum::actingAs($staff, ['*']);

        $peoplePath = "/{$this->testTenantSlug}/accessible/events/{$eventId}/people";
        $checkInPath = "/{$this->testTenantSlug}/accessible/events/{$eventId}/check-in";
        $this->get($peoplePath)->assertForbidden();
        $this->get($checkInPath)
            ->assertOk()
            ->assertSeeText('Accessible Attendance Attendee')
            ->assertDontSee((string) $attendee->email)
            ->assertDontSeeText('Accessible Attendance Unrelated');

        $mutationPath = $checkInPath . '/' . $attendee->id;
        $this->accessiblePost($mutationPath, [
            'action' => 'check_in',
            'expected_version' => '0',
            'confirmation' => '1',
            'idempotency_key' => 'accessible-attendance-check-in',
        ])->assertRedirect($checkInPath . '?status=attendance-updated');

        self::assertSame('checked_in', DB::table('event_attendance')
            ->where('tenant_id', $this->testTenantId)
            ->where('event_id', $eventId)
            ->where('user_id', $attendee->id)
            ->value('attendance_status'));

        $this->accessiblePost($mutationPath, [
            'action' => 'check_out',
            'expected_version' => '0',
            'confirmation' => '1',
            'idempotency_key' => 'accessible-attendance-stale-check-out',
        ])->assertRedirect($checkInPath . '?status=attendance-conflict');

        $this->accessiblePost($checkInPath . '/' . $unrelated->id, [
            'action' => 'check_in',
            'expected_version' => '0',
            'confirmation' => '1',
            'idempotency_key' => 'accessible-attendance-unrelated',
        ])->assertRedirect($checkInPath . '?status=attendance-invalid');
    }

    public function test_all_day_list_and_detail_use_event_timezone_and_exclusive_end_date(): void
    {
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-08-09 00:00:00', 'UTC'));

        try {
            $owner = $this->member('Accessible All Day Owner');
            $eventId = $this->event($owner, false, [
                'title' => 'Auckland community days',
                'start_time' => CarbonImmutable::parse('2026-08-09 12:00:00', 'UTC'),
                'end_time' => CarbonImmutable::parse('2026-08-11 12:00:00', 'UTC'),
                'timezone' => 'Pacific/Auckland',
                'all_day' => 1,
            ]);
            Sanctum::actingAs($owner, ['*']);

            foreach ([
                "/{$this->testTenantSlug}/accessible/events",
                "/{$this->testTenantSlug}/accessible/events/{$eventId}",
            ] as $path) {
                $this->get($path)
                    ->assertOk()
                    ->assertSeeText('Auckland community days')
                    ->assertSeeTextInOrder(['10 August 2026', 'All day', '11 August 2026'])
                    ->assertDontSeeText('12 August 2026')
                    ->assertDontSeeText('12:00pm');
            }
        } finally {
            CarbonImmutable::setTestNow();
        }
    }

    private function accessiblePost(string $uri, array $data): TestResponse
    {
        $token = 'accessible-event-operations-token';
        $this->withSession(['_token' => $token]);

        return $this->post($uri, array_merge(['_token' => $token], $data));
    }

    private function member(string $name): User
    {
        return User::factory()->forTenant($this->testTenantId)->create([
            'name' => $name,
            'first_name' => $name,
            'role' => 'member',
            'status' => 'active',
            'is_approved' => true,
        ]);
    }

    /** @param array<string, mixed> $overrides */
    private function event(User $owner, bool $started = false, array $overrides = []): int
    {
        $start = $started ? now()->subMinutes(15) : now()->addWeek();

        return (int) DB::table('events')->insertGetId(array_merge([
            'tenant_id' => $this->testTenantId,
            'user_id' => (int) $owner->id,
            'title' => 'Accessible operations event',
            'description' => 'Accessible event operations fixture.',
            'start_time' => $start,
            'end_time' => $start->copy()->addHours(2),
            'timezone' => 'UTC',
            'timezone_source' => 'explicit',
            'all_day' => 0,
            'occurrence_key' => 'accessible-operations:' . bin2hex(random_bytes(8)),
            'is_recurring_template' => 0,
            'max_attendees' => 20,
            'status' => 'active',
            'publication_status' => 'published',
            'operational_status' => 'scheduled',
            'lifecycle_version' => 0,
            'created_at' => now(),
            'updated_at' => now(),
        ], $overrides));
    }

    private function registration(int $eventId, User $member, User $actor, string $state): void
    {
        $now = now();
        DB::table('event_registrations')->insert([
            'tenant_id' => $this->testTenantId,
            'event_id' => $eventId,
            'user_id' => (int) $member->id,
            'capacity_pool_key' => 'event',
            'registration_state' => $state,
            'registration_version' => 1,
            'state_changed_at' => $now,
            'state_changed_by' => (int) $actor->id,
            'confirmed_at' => $state === 'confirmed' ? $now : null,
            'created_at' => $now,
            'updated_at' => $now,
        ]);
        DB::table('event_rsvps')->insert([
            'tenant_id' => $this->testTenantId,
            'event_id' => $eventId,
            'user_id' => (int) $member->id,
            'status' => $state === 'confirmed' ? 'going' : 'interested',
            'created_at' => $now,
            'updated_at' => $now,
        ]);
    }

    private function assignStaff(int $eventId, User $staff, EventStaffRole $role, User $owner): void
    {
        DB::table('event_staff_assignments')->insert([
            'tenant_id' => $this->testTenantId,
            'event_id' => $eventId,
            'user_id' => (int) $staff->id,
            'role' => $role->value,
            'status' => 'active',
            'assignment_version' => 1,
            'granted_at' => now(),
            'granted_by' => (int) $owner->id,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }
}
