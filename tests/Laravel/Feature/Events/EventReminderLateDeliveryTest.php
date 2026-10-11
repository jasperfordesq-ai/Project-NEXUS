<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Events;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\EventNotificationOutboxProcessor;
use App\Services\EventReminderPreferenceService;
use App\Services\EventReminderScheduleService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\App;
use Illuminate\Support\Facades\Config;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * E-102: a member who registered fifteen minutes before an event received the
 * default 60-minute reminder at once, saying the event "starts in 1 hour".
 *
 * A reminder that was already due when the member's place was confirmed has
 * nothing to tell them, so it is never sent. A reminder that goes out late for
 * another reason (the scheduler was down) states the time actually remaining.
 */
final class EventReminderLateDeliveryTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();
        Carbon::setTestNow('2035-05-10 12:00:00 UTC');
        App::setLocale('en');
        TenantContext::reset();
        TenantContext::setById($this->testTenantId);
        Config::set('events.reminders.mode', 'canonical');
        Config::set('events.reminders.default_offsets_minutes', [1440, 60]);
        Config::set('events.reminders.catch_up_horizon_minutes', 1440);
        Config::set('events.notification_delivery.consumer_enabled', true);
        Config::set('events.notification_delivery.mode', 'outbox_authoritative');
        Config::set('events.notification_delivery.channels', ['in_app']);
        Config::set('events.notification_delivery.max_attempts', 3);
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        TenantContext::reset();
        parent::tearDown();
    }

    public function test_reminders_already_due_when_the_place_was_confirmed_are_never_sent(): void
    {
        // Registered at 12:00 for an event starting at 12:15: both the
        // 24-hour and the 1-hour reminder were due before the member joined.
        [$user, $eventId, $registrationId] = $this->subject(now()->addMinutes(15), now());

        $rows = collect(app(EventReminderScheduleService::class)->reconcileConfirmedRegistration(
            $eventId,
            (int) $user->id,
            $registrationId,
            1,
        ))->keyBy('offset_minutes');

        self::assertSame('suppressed', $rows->get(60)['status']);
        self::assertSame('registered_after_due', $rows->get(60)['reason_code']);
        self::assertSame('suppressed', $rows->get(1440)['status']);
        self::assertSame('registered_after_due', $rows->get(1440)['reason_code']);

        $queued = app(EventReminderScheduleService::class)->queueDueSchedules();
        self::assertSame(0, $queued['queued']);
        self::assertSame(0, $this->reminderNotifications((int) $user->id));
    }

    public function test_a_reminder_missed_after_the_member_registered_is_still_caught_up(): void
    {
        // Registered three days ago, but schedules are only being built now
        // (recovery after drift). The 1-hour reminder fell due at 11:15, after
        // the member joined, so it is a genuine catch-up.
        [$user, $eventId, $registrationId] = $this->subject(now()->addMinutes(15), now()->subDays(3));

        $rows = collect(app(EventReminderScheduleService::class)->reconcileConfirmedRegistration(
            $eventId,
            (int) $user->id,
            $registrationId,
            1,
        ))->keyBy('offset_minutes');

        self::assertSame('pending', $rows->get(60)['status']);
        self::assertSame('catch_up_due', $rows->get(60)['reason_code']);
    }

    public function test_a_reminder_sent_late_states_the_time_actually_remaining(): void
    {
        [$user, $eventId, $registrationId] = $this->subject(
            now()->addHours(2),
            now()->subDays(3),
            [60],
        );
        app(EventReminderScheduleService::class)->reconcileConfirmedRegistration(
            $eventId,
            (int) $user->id,
            $registrationId,
            1,
        );

        // The 1-hour reminder was due at 13:00, but the scheduler only runs
        // again at 13:35 — 25 minutes before the start.
        Carbon::setTestNow('2035-05-10 13:35:00 UTC');
        self::assertSame(1, app(EventReminderScheduleService::class)->queueDueSchedules()['queued']);
        app(EventNotificationOutboxProcessor::class)->processBatch(10, $this->testTenantId);

        $message = (string) DB::table('notifications')
            ->where('tenant_id', $this->testTenantId)
            ->where('user_id', $user->id)
            ->where('type', 'event_reminder')
            ->value('message');
        self::assertStringContainsString('starts in 25 minutes', $message);
        self::assertStringNotContainsString('1 hour', $message);
    }

    public function test_a_late_reminder_more_than_an_hour_out_is_rounded_to_hours(): void
    {
        [$user, $eventId, $registrationId] = $this->subject(
            now()->addDays(2),
            now()->subDays(3),
            [1440],
        );
        app(EventReminderScheduleService::class)->reconcileConfirmedRegistration(
            $eventId,
            (int) $user->id,
            $registrationId,
            1,
        );

        // Due 2035-05-11 12:00; sent at 17:10, 18 h 50 min before the start.
        Carbon::setTestNow('2035-05-11 17:10:00 UTC');
        self::assertSame(1, app(EventReminderScheduleService::class)->queueDueSchedules()['queued']);
        app(EventNotificationOutboxProcessor::class)->processBatch(10, $this->testTenantId);

        $message = (string) DB::table('notifications')
            ->where('tenant_id', $this->testTenantId)
            ->where('user_id', $user->id)
            ->where('type', 'event_reminder')
            ->value('message');
        self::assertStringContainsString('starts in 19 hours', $message);
        self::assertStringNotContainsString('1 day', $message);
    }

    public function test_a_reminder_sent_on_time_keeps_its_nominal_wording(): void
    {
        [$user, $eventId, $registrationId] = $this->subject(
            now()->addHours(2),
            now()->subDays(3),
            [60],
        );
        app(EventReminderScheduleService::class)->reconcileConfirmedRegistration(
            $eventId,
            (int) $user->id,
            $registrationId,
            1,
        );

        Carbon::setTestNow('2035-05-10 13:01:00 UTC');
        self::assertSame(1, app(EventReminderScheduleService::class)->queueDueSchedules()['queued']);
        app(EventNotificationOutboxProcessor::class)->processBatch(10, $this->testTenantId);

        $message = (string) DB::table('notifications')
            ->where('tenant_id', $this->testTenantId)
            ->where('user_id', $user->id)
            ->where('type', 'event_reminder')
            ->value('message');
        self::assertStringContainsString('starts in 1 hour', $message);
    }

    /**
     * @param list<int>|null $offsets custom reminder rules; null keeps the defaults
     * @return array{User,int,int}
     */
    private function subject(Carbon $start, Carbon $confirmedAt, ?array $offsets = null): array
    {
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
            'preferred_language' => 'en',
            'notification_preferences' => ['email_events' => false, 'push_enabled' => false],
        ]);
        $eventId = (int) DB::table('events')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $user->id,
            'title' => 'Late reminder fixture',
            'description' => 'Reminder wording fixture.',
            'start_time' => $start,
            'end_time' => $start->copy()->addHour(),
            'timezone' => 'UTC',
            'status' => 'active',
            'publication_status' => 'published',
            'operational_status' => 'scheduled',
            'lifecycle_version' => 1,
            'calendar_sequence' => 0,
            'is_recurring_template' => false,
            'created_at' => now()->subDays(5),
            'updated_at' => now()->subDays(5),
        ]);
        $registrationId = (int) DB::table('event_registrations')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'event_id' => $eventId,
            'user_id' => $user->id,
            'capacity_pool_key' => 'event',
            'registration_state' => 'confirmed',
            'registration_version' => 1,
            'state_changed_at' => $confirmedAt,
            'state_changed_by' => $user->id,
            'confirmed_at' => $confirmedAt,
            'created_at' => $confirmedAt,
            'updated_at' => $confirmedAt,
        ]);
        if ($offsets !== null) {
            app(EventReminderPreferenceService::class)->replaceEventPreferences(
                $eventId,
                (int) $user->id,
                ['reminders_enabled' => true],
                array_map(static fn (int $offset): array => ['offset_minutes' => $offset], $offsets),
                0,
            );
        }

        return [$user, $eventId, $registrationId];
    }

    private function reminderNotifications(int $userId): int
    {
        app(EventNotificationOutboxProcessor::class)->processBatch(10, $this->testTenantId);

        return DB::table('notifications')
            ->where('tenant_id', $this->testTenantId)
            ->where('user_id', $userId)
            ->where('type', 'event_reminder')
            ->count();
    }
}
